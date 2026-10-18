/**
 * 把 Excel 工作簿转成 schema v1 的 CSV 文本，再交给 parseCsv。
 * SheetJS 只在这里动态加载：选 CSV 时不会请求 vendor 里的 xlsx 文件。
 * 只读第一个工作表。
 */

import { headerKey } from "./schema.js";

export class WorkbookError extends Error {
  constructor(message) {
    super(message);
    this.name = "WorkbookError";
  }
}

let libraryPromise;

/**
 * 浏览器里的 UMD 构建没有 default 导出，求值后挂在 globalThis.XLSX。
 * Node 的动态 import 则把 module.exports 放在 default 上。
 */
export function libraryFromModule(mod) {
  if (typeof mod?.default?.read === "function") return mod.default;
  if (typeof mod?.read === "function") return mod;
  if (typeof globalThis.XLSX?.read === "function") return globalThis.XLSX;
  return null;
}

export function loadXlsxLibrary() {
  if (!libraryPromise) {
    libraryPromise = import("../vendor/xlsx-0.20.3.full.min.js")
      .then((mod) => {
        const lib = libraryFromModule(mod);
        if (!lib) throw new WorkbookError("没有载入 Excel 解析库。");
        return lib;
      })
      .catch((error) => {
        libraryPromise = null;
        if (error?.name === "WorkbookError") throw error;
        throw new WorkbookError("没有载入 Excel 解析库。");
      });
  }
  return libraryPromise;
}

/**
 * @param {ArrayBuffer | ArrayBufferView} data
 * @param {{
 *   config?: object | null,
 *   loadXlsx?: () => Promise<object>,
 * }} [options]
 * @returns {Promise<string>}
 */
export async function workbookToCsv(data, options = {}) {
  const bytes = toUint8Array(data);
  assertExcelContainer(bytes);
  const load = options.loadXlsx ?? loadXlsxLibrary;
  let XLSX;
  try {
    XLSX = await load();
  } catch (error) {
    if (error?.name === "WorkbookError") throw error;
    throw new WorkbookError("没有载入 Excel 解析库。");
  }
  if (typeof XLSX?.read !== "function") {
    throw new WorkbookError("没有载入 Excel 解析库。");
  }

  let workbook;
  try {
    workbook = XLSX.read(bytes, {
      type: "array",
      cellFormula: true,
      cellNF: true,
      cellDates: false,
      cellText: false,
      dense: false,
    });
  } catch {
    throw new WorkbookError("这个文件读不出来，请确认它是 Excel 工作簿（.xlsx / .xls）。");
  }

  const sheetName = workbook.SheetNames?.[0];
  if (!sheetName || !workbook.Sheets?.[sheetName]) {
    throw new WorkbookError("这个工作簿里没有工作表。");
  }
  const sheet = workbook.Sheets[sheetName];
  if (!sheet["!ref"]) throw new WorkbookError("第一张工作表是空的。");

  const range = XLSX.utils.decode_range(sheet["!ref"]);
  const aliases = headerAliases(options.config);
  const columns = headerColumns(sheet, XLSX, range, aliases);
  const date1904 = Boolean(workbook.Workbook?.WBProps?.date1904);
  const headerExcelRow = range.s.r + 1;
  const table = [columns.map((column) => column.name)];

  for (let row = range.s.r + 1; row <= range.e.r; row += 1) {
    const excelRow = row + 1;
    const record = columns.map((column) =>
      formatCell(
        column.name,
        sheet[XLSX.utils.encode_cell({ r: row, c: column.col })] ?? null,
        excelRow - headerExcelRow,
        XLSX,
        date1904,
      ),
    );
    const blank = columns.every(
      (column, index) => column.name === "no" || record[index] === "",
    );
    if (blank) continue;
    table.push(record);
  }

  return encodeCsv(table);
}

/**
 * 与 live-data tools/xlsx_to_csv.py 一样：先把不换行空格和全角空格换成普通空格，
 * 再 trim、转小写、去掉末尾的点。「ワンマン/対バン/フェス」记为 type。
 * 参考脚本里两列参与者的加长写法记成导出 CSV 的列名；片段拼出来，源码不写真实姓名。
 * 其余列保持规范化后的名字。保留列交给现有解析；非保留列就是参与者列。
 * config.header_aliases，或 people[].header → people[].column，可以再改名。
 */
function spell(...parts) {
  return parts.join("");
}

function builtinHeaderAliases() {
  return {
    "ワンマン/対バン/フェス": "type",
    [spell("re", "my", "yy")]: spell("re", "my"),
    [spell("ne", "gi", "ii")]: spell("ne", "gi"),
  };
}

function headerToken(value) {
  return String(value ?? "")
    .replaceAll("\u00a0", " ")
    .replaceAll("\u3000", " ")
    .trim()
    .toLowerCase()
    .replace(/\.+$/, "");
}

function headerAliases(config) {
  const aliases = builtinHeaderAliases();
  if (!config || typeof config !== "object" || Array.isArray(config)) return aliases;

  const extra = config.header_aliases;
  if (extra && typeof extra === "object" && !Array.isArray(extra)) {
    for (const [from, to] of Object.entries(extra)) {
      const source = headerToken(from);
      const target = headerToken(to);
      if (source && target) aliases[source] = target;
    }
  }

  if (Array.isArray(config.people)) {
    for (const person of config.people) {
      if (!person || typeof person !== "object" || person.header == null) continue;
      const source = headerToken(person.header);
      const target = headerKey(person.column);
      if (source && target) aliases[source] = target;
    }
  }
  return aliases;
}

function resolveHeader(value, aliases) {
  const token = headerToken(value);
  if (!token) return "";
  if (Object.prototype.hasOwnProperty.call(aliases, token)) return aliases[token];
  return token;
}

function headerColumns(sheet, XLSX, range, aliases) {
  const columns = [];
  const seen = new Set();
  for (let col = range.s.c; col <= range.e.c; col += 1) {
    const cell = sheet[XLSX.utils.encode_cell({ r: range.s.r, c: col })];
    const name = resolveHeader(cell?.v, aliases);
    if (!name) continue;
    if (seen.has(name)) {
      throw new WorkbookError(`表头里有重复的列「${name}」。`);
    }
    seen.add(name);
    columns.push({ name, col });
  }
  if (columns.length === 0) throw new WorkbookError("第一张工作表没有表头。");
  return columns;
}

function formatCell(name, cell, fallbackNo, XLSX, date1904) {
  const formula = typeof cell?.f === "string" && cell.f.length > 0;
  const missing = !cell || cell.v == null;
  if (formula && missing) {
    if (name === "no") return String(fallbackNo);
    return "";
  }
  if (name === "date") return formatDateValue(cell, XLSX, date1904);
  if (missing) return "";
  return stringify(cell.v);
}

function formatDateValue(cell, XLSX, date1904) {
  if (!cell || cell.v == null) return "";
  const value = cell.v;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return ymd(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    if (cell.z && typeof XLSX.SSF?.is_date === "function" && XLSX.SSF.is_date(cell.z)) {
      const code = XLSX.SSF.parse_date_code(value, { date1904: Boolean(date1904) });
      if (
        code &&
        Number.isFinite(code.y) &&
        Number.isFinite(code.m) &&
        Number.isFinite(code.d)
      ) {
        return ymd(code.y, code.m, code.d);
      }
    }
    return stringify(value);
  }
  return formatDateText(value);
}

function formatDateText(value) {
  const original = String(value ?? "");
  const trimmed = original.trim();
  if (!trimmed) return "";
  for (const sep of ["-", "/", "."]) {
    const escaped = sep === "." ? "\\." : sep;
    const match = new RegExp(
      `^(\\d{4})${escaped}(\\d{1,2})${escaped}(\\d{1,2})$`,
    ).exec(trimmed);
    if (!match) continue;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const utc = new Date(Date.UTC(year, month - 1, day));
    if (
      utc.getUTCFullYear() === year &&
      utc.getUTCMonth() === month - 1 &&
      utc.getUTCDate() === day
    ) {
      return ymd(year, month, day);
    }
  }
  return original;
}

function ymd(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function stringify(value) {
  if (value == null) return "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "";
    if (Object.is(value, -0)) return "0";
    if (Number.isInteger(value)) return String(value);
    return value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  }
  return String(value);
}

function encodeCsv(rows) {
  return `${rows.map((row) => row.map(escapeField).join(",")).join("\r\n")}\r\n`;
}

function escapeField(value) {
  const text = value == null ? "" : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

function assertExcelContainer(bytes) {
  const zip = bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
  const ole =
    bytes.length >= 8 &&
    bytes[0] === 0xd0 &&
    bytes[1] === 0xcf &&
    bytes[2] === 0x11 &&
    bytes[3] === 0xe0;
  if (!zip && !ole) {
    throw new WorkbookError("这个文件读不出来，请确认它是 Excel 工作簿（.xlsx / .xls）。");
  }
}

function toUint8Array(data) {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  throw new WorkbookError("没有读到工作簿的内容。");
}

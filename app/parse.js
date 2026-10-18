/**
 * 用 vendor 里的 PapaParse 5.7.0 解析 schema v1 CSV。
 * 浏览器里若已有全局 Papa 就用它；Node 里则加载 vendor 文件。
 */

import {
  ParseError,
  classifyHeaders,
  isAttended,
  normalizeConfig,
  parseDate,
  parsePrice,
  splitArtists,
} from "./schema.js";

export { ParseError } from "./schema.js";

const PAPA_PATH = "../vendor/papaparse-5.7.0.min.js";
let vendorPapa;

function loadPapa() {
  if (typeof globalThis.Papa?.parse === "function") return globalThis.Papa;
  if (vendorPapa) return vendorPapa;
  const builtin = globalThis.process?.getBuiltinModule?.("node:module");
  if (!builtin?.createRequire) {
    throw new ParseError([
      {
        line: null,
        code: "papa_missing",
        message: "找不到 PapaParse。请先加载 vendor/papaparse-5.7.0.min.js。",
      },
    ]);
  }
  vendorPapa = builtin.createRequire(import.meta.url)(PAPA_PATH);
  if (typeof vendorPapa?.parse !== "function") {
    throw new ParseError([
      {
        line: null,
        code: "papa_missing",
        message: "vendor/papaparse-5.7.0.min.js 没有提供 parse。",
      },
    ]);
  }
  return vendorPapa;
}

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * 每条 CSV 记录的起始物理行（从 1 计）。
 * 引号内的换行只增加行号，不新开一条记录。
 * 文件以换行结束时，补上 PapaParse 会保留的那条空记录，方便逐条对齐。
 */
function recordStartLines(text) {
  const starts = [];
  if (text.length === 0) return starts;
  let line = 1;
  let inQuotes = false;
  let atRecordStart = true;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (atRecordStart) {
      starts.push(line);
      atRecordStart = false;
    }
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') i += 1;
      else inQuotes = !inQuotes;
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      line += 1;
      if (!inQuotes) atRecordStart = true;
    }
  }
  if (atRecordStart) starts.push(line);
  return starts;
}

/**
 * index 指向引号出问题的字符时，返回它所在记录的起始物理行。
 * 扫描停在该字符之前，所以报的是记录开头，不是引号那一行本身（两者不同时）。
 */
function recordStartLineAt(text, index) {
  let line = 1;
  let recordLine = 1;
  let inQuotes = false;
  let atRecordStart = true;
  const end = Math.min(Math.max(index, 0), text.length);
  for (let i = 0; i < end; i++) {
    const ch = text[i];
    if (atRecordStart) {
      recordLine = line;
      atRecordStart = false;
    }
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') i += 1;
      else inQuotes = !inQuotes;
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      line += 1;
      if (!inQuotes) atRecordStart = true;
    }
  }
  if (atRecordStart) recordLine = line;
  return recordLine;
}

function unclosedQuoteErrors(source, papaErrors, starts) {
  const errors = [];
  const seen = new Set();
  for (const error of papaErrors ?? []) {
    if (error?.code !== "MissingQuotes" && error?.code !== "InvalidQuotes") continue;
    let line = null;
    if (typeof error.index === "number") line = recordStartLineAt(source, error.index);
    else if (typeof error.row === "number" && starts[error.row] != null) line = starts[error.row];
    if (seen.has(line)) continue;
    seen.add(line);
    errors.push({
      line,
      unit: "line",
      code: "unclosed_quote",
      message: "引号没有闭合，这一行之后的内容不能再分成新的记录",
    });
  }
  return errors;
}

function greedyEmpty(fields) {
  return fields.map((field) => (field == null ? "" : String(field))).join("").trim() === "";
}

function fieldText(fields, index) {
  if (index == null || index >= fields.length) return "";
  const value = fields[index];
  return value == null ? "" : String(value);
}

/**
 * 解析一份观演 CSV。
 * 能和 PapaParse 的记录边界对齐时，错误里的行号是该记录在文件中的起始物理行；
 * 对不齐时改称「第 N 条记录」。
 *
 * @param {string} text UTF-8 文本，可以带 BOM
 * @param {object} [configInput] config.json 的对象。别名读 artist_aliases 或 aliases
 * @returns {{
 *   rows: object[],
 *   participants: { column: string, label: string }[],
 *   config: object,
 * }}
 */
export function parseCsv(text, configInput) {
  if (typeof text !== "string") {
    throw new ParseError([
      { line: null, code: "bad_input", message: "CSV 必须是字符串" },
    ]);
  }
  const config = normalizeConfig(configInput);
  const source = stripBom(text);
  if (source.trim() === "") {
    throw new ParseError([{ line: 1, code: "empty", message: "CSV 为空" }]);
  }

  const parsed = loadPapa().parse(source, {
    header: false,
    skipEmptyLines: false,
    delimiter: ",",
  });
  const starts = recordStartLines(source);
  const quotes = unclosedQuoteErrors(source, parsed.errors, starts);
  if (quotes.length > 0) throw new ParseError(quotes);
  const physical = parsed.data.length === starts.length;
  const unit = physical ? "line" : "record";
  const kept = [];
  parsed.data.forEach((fields, index) => {
    if (greedyEmpty(fields)) return;
    kept.push({
      fields,
      line: physical ? starts[index] : kept.length + 1,
    });
  });

  if (kept.length === 0) {
    throw new ParseError([
      { line: 1, unit, code: "empty", message: "CSV 没有表头" },
    ]);
  }

  const header = kept[0];
  const headerFields = header.fields.map((field) =>
    String(field ?? "").replace(/^\uFEFF/, "").trim(),
  );
  const classified = classifyHeaders(headerFields, config.people, header.line, unit);
  const errors = classified.errors.slice();

  const indexByKey = new Map();
  for (const column of classified.columns) {
    if (!indexByKey.has(column.key)) {
      indexByKey.set(column.key, headerFields.indexOf(column.field));
    }
  }

  const rows = [];
  const aliases = config.artistAliases;
  for (let index = 1; index < kept.length; index++) {
    const record = kept[index];
    const line = physical ? record.line : index + 1;
    const read = (key) => fieldText(record.fields, indexByKey.get(key));

    let date = null;
    if (indexByKey.has("date")) {
      const rawDate = read("date");
      const checked = parseDate(rawDate);
      if (!checked.ok) {
        errors.push({
          line,
          unit,
          code: "bad_date",
          message: `日期「${rawDate.trim()}」不是 YYYY-MM-DD`,
        });
      } else {
        date = checked.date;
      }
    }

    const artist = read("artist");
    const artists = splitArtists(artist, aliases);
    const attended = Object.create(null);
    for (const person of classified.participants) {
      attended[person.column] = isAttended(read(person.column));
    }

    rows.push({
      line,
      date,
      event: read("event").trim(),
      artist,
      artists: artists.raw,
      artistsForCount: artists.counted,
      no: read("no").trim(),
      venue: read("venue").trim(),
      city: read("city").trim(),
      type: read("type").trim(),
      price: parsePrice(read("price")),
      region: read("region").trim(),
      attended,
    });
  }

  if (errors.length > 0) throw new ParseError(errors);
  return {
    rows,
    participants: classified.participants,
    config,
  };
}

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

function cell(record, field) {
  if (!field) return "";
  const value = record[field];
  return value == null ? "" : String(value);
}

/**
 * 解析一份观演 CSV。
 * 行号按记录计：表头是第 1 行，引号单元格里的换行仍算同一行。
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
    header: true,
    skipEmptyLines: "greedy",
    delimiter: ",",
    transformHeader(header) {
      return String(header).replace(/^\uFEFF/, "").trim();
    },
  });

  const fields = parsed.meta?.fields ?? [];
  const renamedHeaders = parsed.meta?.renamedHeaders ?? null;
  const errors = [];
  const renamedFields = new Set();
  if (renamedHeaders) {
    for (const [renamed, original] of Object.entries(renamedHeaders)) {
      renamedFields.add(renamed);
      errors.push({
        line: 1,
        code: "duplicate_column",
        message: `重复的列「${original}」`,
      });
    }
  }

  const classified = classifyHeaders(
    fields.filter((field) => !renamedFields.has(field)),
    config.people,
  );
  errors.push(...classified.errors);

  const fieldByKey = new Map();
  for (const column of classified.columns) {
    if (!fieldByKey.has(column.key)) fieldByKey.set(column.key, column.field);
  }

  const rows = [];
  const aliases = config.artistAliases;
  parsed.data.forEach((record, index) => {
    const line = index + 2;
    const read = (key) => cell(record, fieldByKey.get(key));

    let date = null;
    if (fieldByKey.has("date")) {
      const rawDate = read("date");
      const checked = parseDate(rawDate);
      if (!checked.ok) {
        errors.push({
          line,
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
  });

  if (errors.length > 0) throw new ParseError(errors);
  return {
    rows,
    participants: classified.participants,
    config,
  };
}

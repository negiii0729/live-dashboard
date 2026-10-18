/**
 * schema v1 的列规则、艺人拆分和配置归一化。
 * 纯函数，不读 DOM，别名只来自调用方传入的 config。
 */

export class ParseError extends Error {
  constructor(errors) {
    const list = errors.map((error) => ({
      line: error.line ?? null,
      code: error.code || "invalid",
      message: error.message,
      unit: error.unit === "record" ? "record" : "line",
    }));
    super(list.map(formatParseError).join("\n"));
    this.name = "ParseError";
    this.errors = list;
    this.line = list[0]?.line ?? null;
  }
}

function formatParseError(error) {
  if (typeof error.line !== "number") return error.message;
  const unit = error.unit === "record" ? "条记录" : "行";
  return `第 ${error.line} ${unit}：${error.message}`;
}

export const RESERVED_COLUMNS = Object.freeze([
  "date",
  "event",
  "artist",
  "no",
  "venue",
  "city",
  "type",
  "price",
  "region",
]);

const RESERVED = new Set(RESERVED_COLUMNS);

/** 记为「去了」的单元格。比较时忽略首尾空白和拉丁字母大小写。 */
export const ATTENDED_VALUES = Object.freeze([
  "\u2705",
  "\u2714",
  "\u2713",
  "\u25CB",
  "1",
  "y",
  "yes",
  "true",
]);

const ATTENDED = new Set(ATTENDED_VALUES);

export function headerLabel(header) {
  return String(header ?? "").replace(/^\uFEFF/, "").trim();
}

/** trim、小写，再去掉末尾连续的 '.'。`NO.` 和 `DATE.` 因此对应保留列 no、date。 */
export function headerKey(header) {
  return headerLabel(header).toLowerCase().replace(/\.+$/, "");
}

export function isAttended(value) {
  return ATTENDED.has(String(value ?? "").trim().toLowerCase());
}

/**
 * 空单元格是「待定」。其他值必须是真实存在的 YYYY-MM-DD。
 * @returns {{ ok: boolean, date: string | null }}
 */
export function parseDate(value) {
  const text = String(value ?? "").trim();
  if (text === "") return { ok: true, date: null };
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return { ok: false, date: null };
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    return { ok: false, date: null };
  }
  return { ok: true, date: text };
}

/** 空或无法解析时返回 null，表示「无票价」，不算校验错误。 */
export function parsePrice(value) {
  const text = String(value ?? "").trim();
  if (text === "") return null;
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

/**
 * 与参考 split_artists 一致：去掉 \r，按 \n 拆行；
 * 每行 strip，再用 lstrip("/／") 去掉开头连续的 "/" 和 "／"，再 strip；空行丢弃。
 * 别名只写入 counted，raw 保持拆分后的原文。
 * @param {string} text
 * @param {Record<string, string>} [aliases]
 * @returns {{ raw: string[], counted: string[] }}
 */
export function splitArtists(text, aliases = {}) {
  const raw = [];
  for (const part of String(text ?? "").replaceAll("\r", "").split("\n")) {
    let line = part.trim();
    line = line.replace(/^[\/／]+/, "");
    line = line.trim();
    if (line) raw.push(line);
  }
  const counted = raw.map((name) => {
    if (!Object.prototype.hasOwnProperty.call(aliases, name)) return name;
    const mapped = aliases[name];
    return typeof mapped === "string" && mapped.length > 0 ? mapped : name;
  });
  return { raw, counted };
}

function plainAliases(source, label) {
  if (source == null) return {};
  if (typeof source !== "object" || Array.isArray(source)) {
    throw new ParseError([
      {
        line: null,
        code: "bad_config",
        message: `${label} 必须是对象，键是原文，值是计数用的名字`,
      },
    ]);
  }
  const aliases = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === "string" && value.length > 0) aliases[key] = value;
  }
  return aliases;
}

function plainPeople(people) {
  if (people == null) return null;
  if (!Array.isArray(people)) {
    throw new ParseError([
      { line: null, code: "bad_config", message: "people 必须是数组" },
    ]);
  }
  return people.map((person, index) => {
    if (person == null || typeof person !== "object" || Array.isArray(person)) {
      throw new ParseError([
        {
          line: null,
          code: "bad_config",
          message: `people 第 ${index + 1} 项必须是对象`,
        },
      ]);
    }
    const column = String(person.column ?? "").trim();
    if (!column) {
      throw new ParseError([
        {
          line: null,
          code: "bad_config",
          message: `people 第 ${index + 1} 项缺少 column`,
        },
      ]);
    }
    const label =
      person.label == null ? null : String(person.label).trim() || null;
    return { column, label };
  });
}

/**
 * 读取 config。别名优先用 artist_aliases，否则用 aliases。
 * 不在这里写死任何名字。
 */
export function normalizeConfig(input = {}) {
  if (input == null) input = {};
  if (typeof input !== "object" || Array.isArray(input)) {
    throw new ParseError([
      { line: null, code: "bad_config", message: "config 必须是对象" },
    ]);
  }
  if (input.schema != null && input.schema !== 1) {
    throw new ParseError([
      {
        line: null,
        code: "bad_schema",
        message: `不支持的 schema「${input.schema}」，目前只接受 1`,
      },
    ]);
  }

  const aliasSource =
    input.artist_aliases != null ? input.artist_aliases : input.aliases;
  const aliasLabel =
    input.artist_aliases != null ? "artist_aliases" : "aliases";

  let priceMode = "total";
  if (input.price_mode != null && input.price_mode !== "") {
    priceMode = String(input.price_mode);
  }

  return {
    schema: 1,
    title: input.title == null ? "" : String(input.title),
    people: plainPeople(input.people),
    priceMode,
    currency:
      input.currency == null || input.currency === ""
        ? "CNY"
        : String(input.currency),
    defaultRegion:
      input.default_region == null ? null : String(input.default_region),
    artistAliases: plainAliases(aliasSource, aliasLabel),
  };
}

/**
 * @param {string[]} fields 表头原文
 * @param {{ column: string, label: string | null }[] | null} people
 * @param {number} [headerLine] 表头所在的物理行；对不齐时用记录序号
 * @param {"line" | "record"} [unit]
 */
export function classifyHeaders(fields, people, headerLine = 1, unit = "line") {
  const errors = [];
  const seen = new Set();
  const columns = [];

  for (const field of fields) {
    const label = headerLabel(field);
    const key = headerKey(field);
    if (!key) continue;
    if (seen.has(key)) {
      errors.push({
        line: headerLine,
        unit,
        code: "duplicate_column",
        message: `重复的列「${label}」`,
      });
      continue;
    }
    seen.add(key);
    columns.push({
      field,
      key,
      label,
      participant: !RESERVED.has(key),
    });
  }

  if (!seen.has("event") && !seen.has("artist")) {
    errors.push({
      line: headerLine,
      unit,
      code: "missing_event_artist",
      message: "缺少 event 和 artist 列，至少要有其中一列",
    });
  }

  const headerParticipants = columns
    .filter((column) => column.participant)
    .map((column) => ({ column: column.key, label: column.label }));

  const resolved = resolveParticipants(headerParticipants, people, headerLine, unit);
  return {
    columns,
    participants: resolved.participants,
    errors: errors.concat(resolved.errors),
  };
}

function resolveParticipants(headerParticipants, people, headerLine, unit) {
  if (!people || people.length === 0) {
    return { participants: headerParticipants, errors: [] };
  }

  const byKey = new Map(
    headerParticipants.map((person) => [person.column, person]),
  );
  const errors = [];
  const used = new Set();
  const ordered = [];

  for (const person of people) {
    const key = headerKey(person.column);
    const found = byKey.get(key);
    if (!found) {
      errors.push({
        line: headerLine,
        unit,
        code: "unknown_participant",
        message: `配置的参与者列「${person.column}」不是表里的参与者列`,
      });
      continue;
    }
    if (used.has(key)) {
      errors.push({
        line: headerLine,
        unit,
        code: "duplicate_participant",
        message: `配置的参与者列「${person.column}」重复了`,
      });
      continue;
    }
    used.add(key);
    ordered.push({
      column: found.column,
      label: person.label || found.label,
    });
  }

  for (const person of headerParticipants) {
    if (!used.has(person.column)) ordered.push(person);
  }
  return { participants: ordered, errors };
}

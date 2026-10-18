/**
 * 观演统计。纯函数，吃 parseCsv 的结果，不读页面，也不写死参与者名字。
 * today 可以传入，方便和参考脚本对齐。
 */

import { parseDate } from "./schema.js";

/** 固定排在前面的三种类型。其他类型按已看场次里第一次出现的顺序接在后面。 */
export const FIXED_TYPES = Object.freeze(["ワンマン", "対バン", "フェス"]);

const TOP_ARTISTS = 20;
const TOP_VENUES = 12;

/** 参考脚本内置的城市→地区。不在表里、又没有 region 列时用 defaultRegion，否则是中国大陆。 */
const JP_CITIES = new Set([
  "東京",
  "大阪",
  "千葉",
  "仙台",
  "名古屋",
  "京都",
  "神戸",
  "福岡",
  "川崎",
  "横浜",
  "札幌",
  "埼玉",
  "広島",
  "金沢",
  "新潟",
  "沖縄",
  "静岡",
  "岡山",
  "熊本",
  "奈良",
]);

const HMT_CITIES = new Set(["香港", "澳门", "台北", "台湾"]);

const STAT_KEYS = new Set([
  "today",
  "total",
  "together",
  "together_pct",
  "spend",
  "spend_n",
  "price_total",
  "no_price",
  "upcoming",
  "undated",
  "unmarked",
  "types",
  "type_cnt",
  "years",
  "per_year",
  "top_art",
  "unique_artists",
  "city",
  "region",
  "venue",
  "first",
  "last",
]);

/**
 * 按 Unicode 码点比较，不按语言环境的字母表。
 * 较短的字符串若是另一条的前缀，则较短的更小。
 */
export function compareCodePoints(a, b) {
  const left = Array.from(String(a));
  const right = Array.from(String(b));
  const n = Math.min(left.length, right.length);
  for (let i = 0; i < n; i += 1) {
    const diff = left[i].codePointAt(0) - right[i].codePointAt(0);
    if (diff !== 0) return diff;
  }
  return left.length - right.length;
}

/**
 * Python 3 的 round：四舍六入五成双。
 * ndigits 省略或为 0 时舍入到整数；大于 0 时保留相应小数。
 * 先把二进制浮点展开成精确整数，再按十进制位四舍六入，和 Python 对同一 double 的结果一致。
 */
export function pythonRound(value, ndigits = 0) {
  if (!Number.isFinite(value)) {
    throw new Error("pythonRound 需要有限数字");
  }
  if (!Number.isInteger(ndigits) || ndigits < 0) {
    throw new Error("ndigits 必须是非负整数");
  }
  if (value === 0) return 0;

  const parts = splitDouble(value);
  const negative = parts.mantissa < 0n;
  const power = 5n ** BigInt(ndigits);
  const magnitude = (negative ? -parts.mantissa : parts.mantissa) * power;
  const shift = parts.exponent + ndigits;
  let rounded;
  if (shift >= 0) {
    rounded = magnitude << BigInt(shift);
  } else {
    rounded = divHalfEven(magnitude, 1n << BigInt(-shift));
  }
  if (negative) rounded = -rounded;
  return scaledToNumber(rounded, ndigits);
}

/**
 * @param {{
 *   rows: object[],
 *   participants?: { column: string, label?: string }[],
 *   config?: object,
 * }} parsed parseCsv 的返回值
 * @param {string | { today?: string }} [todayOrOptions] YYYY-MM-DD，或带 today 的选项
 */
export function compute(parsed, todayOrOptions = {}) {
  if (parsed == null || !Array.isArray(parsed.rows)) {
    throw new Error("compute 需要 parseCsv 的结果");
  }
  const options =
    typeof todayOrOptions === "string" ? { today: todayOrOptions } : todayOrOptions ?? {};
  const today = resolveToday(options.today);
  const config = parsed.config ?? {};
  const priceMode = config.priceMode ?? "total";
  if (priceMode !== "total" && priceMode !== "per_person") {
    throw new Error(`未知的 price_mode「${priceMode}」，只接受 total 或 per_person`);
  }

  const columns = (parsed.participants ?? []).map((person) => person.column);
  assertStatKeysFree(columns);

  const attended = [];
  const upcoming = [];
  const undated = [];
  const unmarked = [];
  for (const row of parsed.rows) {
    const status = rowStatus(row, today, columns);
    if (status === "attended") attended.push(row);
    else if (status === "upcoming") upcoming.push(row);
    else if (status === "undated") undated.push(row);
    else unmarked.push(row);
  }

  const counts = {};
  const only = {};
  for (const column of columns) {
    counts[column] = 0;
    only[column] = 0;
  }
  let together = 0;
  for (const row of attended) {
    const heads = markedHeads(row, columns);
    for (const column of columns) {
      if (!row.attended?.[column]) continue;
      counts[column] += 1;
      if (heads === 1) only[column] += 1;
    }
    if (columns.length >= 2 && heads === columns.length) together += 1;
  }

  const spend = new Map();
  const spendN = new Map();
  const regionCounts = new Map();
  const cityCounts = new Map();
  const venueCounts = new Map();
  let priceTotal = 0;
  let noPrice = 0;
  let first = "";
  let last = "";

  for (const row of attended) {
    const city = text(row.city);
    const venue = text(row.venue);
    const region = resolveRegion(row, city, config);
    bump(regionCounts, region);
    bump(cityCounts, city);
    if (venue) bump(venueCounts, venue);

    if (!first || row.date < first) first = row.date;
    if (!last || row.date > last) last = row.date;

    const price = finitePrice(row.price);
    if (price == null) {
      noPrice += 1;
      continue;
    }
    const heads = markedHeads(row, columns);
    priceTotal += priceMode === "per_person" ? price * heads : price;
    bump(spend, region, price);
    bump(spendN, region, 1);
  }

  const types = typeList(attended);
  const typeCnt = {};
  for (const type of types) typeCnt[type] = 0;
  const yearSet = new Set();
  for (const row of attended) {
    yearSet.add(row.date.slice(0, 4));
    const type = text(row.type);
    if (type) typeCnt[type] += 1;
  }
  const years = [...yearSet].sort(compareCodePoints);
  const yearIndex = new Map(years.map((year, index) => [year, index]));
  const perYear = {};
  for (const type of types) perYear[type] = years.map(() => 0);
  for (const row of attended) {
    const type = text(row.type);
    if (!type) continue;
    perYear[type][yearIndex.get(row.date.slice(0, 4))] += 1;
  }

  const { topArt, uniqueArtists } = rankArtists(attended);

  const result = {
    today,
    total: attended.length,
  };
  for (const column of columns) result[column] = counts[column];
  if (columns.length >= 2) {
    result.together = together;
    result.together_pct = attended.length
      ? pythonRound((100 * together) / attended.length, 1)
      : 0;
  } else {
    result.together = null;
    result.together_pct = null;
  }
  for (const column of columns) result[`${column}_only`] = only[column];

  result.spend = roundedMap(spend);
  result.spend_n = objectFromMap(spendN);
  result.price_total = priceTotal;
  result.no_price = noPrice;
  result.upcoming = upcoming.length;
  result.undated = undated.length;
  result.unmarked = unmarked.length;
  result.types = types;
  result.type_cnt = typeCnt;
  result.years = years;
  result.per_year = perYear;
  result.top_art = topArt;
  result.unique_artists = uniqueArtists;
  result.city = mostCommon(cityCounts);
  result.region = mostCommon(regionCounts);
  result.venue = mostCommon(venueCounts, TOP_VENUES);
  result.first = first;
  result.last = last;
  return result;
}

function resolveToday(today) {
  const value = today ?? localToday();
  const checked = parseDate(value);
  if (!checked.ok || checked.date == null) {
    throw new Error(`today 必须是 YYYY-MM-DD，收到「${value}」`);
  }
  return checked.date;
}

function localToday() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function assertStatKeysFree(columns) {
  const used = new Set();
  for (const column of columns) {
    for (const key of [column, `${column}_only`]) {
      if (STAT_KEYS.has(key) || used.has(key)) {
        throw new Error(`参与者列「${column}」和统计字段重名，请换一个列名`);
      }
      used.add(key);
    }
  }
}

function rowStatus(row, today, columns) {
  if (!row.date) return "undated";
  if (row.date > today) return "upcoming";
  if (columns.length === 0) return "attended";
  if (columns.some((column) => row.attended?.[column])) return "attended";
  return "unmarked";
}

function markedHeads(row, columns) {
  let count = 0;
  for (const column of columns) {
    if (row.attended?.[column]) count += 1;
  }
  return count;
}

function text(value) {
  return String(value ?? "").trim();
}

function finitePrice(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function resolveRegion(row, city, config) {
  const explicit = text(row.region);
  if (explicit) return explicit;
  if (JP_CITIES.has(city)) return "日本";
  if (HMT_CITIES.has(city)) return "港台澳";
  return config.defaultRegion || "中国大陆";
}

function bump(map, key, by = 1) {
  map.set(key, (map.get(key) || 0) + by);
}

function typeList(attended) {
  const types = [...FIXED_TYPES];
  const seen = new Set(FIXED_TYPES);
  for (const row of attended) {
    const type = text(row.type);
    if (!type || seen.has(type)) continue;
    seen.add(type);
    types.push(type);
  }
  return types;
}

function rankArtists(attended) {
  const artOne = new Map();
  const artMulti = new Map();
  for (const row of attended) {
    const bucket = text(row.type) === "ワンマン" ? artOne : artMulti;
    for (const name of uniqueNames(row)) bump(bucket, name, 1);
  }
  const names = [...new Set([...artOne.keys(), ...artMulti.keys()])];
  // 与参考脚本相同：总数降序，ワンマン 数降序，再按码点升序。
  // 城市、场馆、地区的同次数并列才按首次出现顺序。
  names.sort((a, b) => {
    const totalA = (artOne.get(a) || 0) + (artMulti.get(a) || 0);
    const totalB = (artOne.get(b) || 0) + (artMulti.get(b) || 0);
    if (totalA !== totalB) return totalB - totalA;
    const oneA = artOne.get(a) || 0;
    const oneB = artOne.get(b) || 0;
    if (oneA !== oneB) return oneB - oneA;
    const byName = compareCodePoints(a, b);
    if (byName !== 0) return byName;
    return 0;
  });
  const topArt = names.slice(0, TOP_ARTISTS).map((name) => {
    const one = artOne.get(name) || 0;
    const multi = artMulti.get(name) || 0;
    return [name, one + multi, one, multi];
  });
  return { topArt, uniqueArtists: names.length };
}

function uniqueNames(row) {
  const source = row.artistsForCount ?? row.artists ?? [];
  const seen = [];
  const have = new Set();
  for (const item of source) {
    if (typeof item !== "string" || item === "" || have.has(item)) continue;
    have.add(item);
    seen.push(item);
  }
  return seen;
}

/** 次数高的在前；次数相同则保持首次出现的顺序。 */
function mostCommon(map, limit = Infinity) {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

function roundedMap(map) {
  const out = {};
  for (const [key, value] of map) out[key] = pythonRound(value);
  return out;
}

function objectFromMap(map) {
  const out = {};
  for (const [key, value] of map) out[key] = value;
  return out;
}

function splitDouble(value) {
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setFloat64(0, value);
  const bits = view.getBigUint64(0);
  const sign = (bits >> 63n) === 1n ? -1n : 1n;
  const exponentBits = Number((bits >> 52n) & 0x7ffn);
  const fraction = bits & 0xfffffffffffffn;
  let mantissa;
  let exponent;
  if (exponentBits === 0) {
    mantissa = fraction;
    exponent = -1022 - 52;
  } else {
    mantissa = fraction | (1n << 52n);
    exponent = exponentBits - 1023 - 52;
  }
  return { mantissa: sign * mantissa, exponent };
}

function divHalfEven(numerator, denominator) {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const twice = remainder * 2n;
  if (twice > denominator) return quotient + 1n;
  if (twice < denominator) return quotient;
  return quotient % 2n === 0n ? quotient : quotient + 1n;
}

function scaledToNumber(rounded, ndigits) {
  if (ndigits === 0) {
    const number = Number(rounded);
    return number === 0 ? 0 : number;
  }
  const negative = rounded < 0n;
  let digits = (negative ? -rounded : rounded).toString();
  if (digits.length <= ndigits) digits = digits.padStart(ndigits + 1, "0");
  const point = digits.length - ndigits;
  const text = `${negative ? "-" : ""}${digits.slice(0, point)}.${digits.slice(point)}`;
  const number = Number(text);
  return number === 0 ? 0 : number;
}

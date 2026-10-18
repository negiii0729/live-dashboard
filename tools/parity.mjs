#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { compute } from "../app/compute.js";
import { parseCsv } from "../app/parse.js";

const usage = `用法:
  node tools/parity.mjs <csv> <config> <today> <golden.json>
  node tools/parity.mjs <csv> <config> <today>
  node tools/parity.mjs <csv> --today YYYY-MM-DD [--config config.json] [--golden golden.json]

按配置解析 CSV，计算截止日期当天的统计。
第 4 个位置参数或 --golden 给出 golden JSON 时，逐字段比较：
全部一致则退出码为 0；有差异则退出码非 0，并把不一致的键路径写到标准错误。
没有 golden 时，把统计 JSON 打印到标准输出。--today 和 --config 与以前相同。

参与者场次和「仅某人」用表头里的列名（列顺序），不写死人名。
price_total 是已看场次的票价合计：price_mode 为 total（默认）时把 price 直接相加，
为 per_person 时乘该场到场人数。这里打印未取整的原值；页面显示时才四舍五入到整数元。
不输出按人头估算的 spend_heads。
spend / spend_n 仍是按地区把原价相加后的对照字段。`;

const MISMATCH_LIMIT = 50;

export function collectMismatches(actual, expected) {
  const out = [];
  walk(actual, expected, "", out);
  return out;
}

export function formatMismatchReport(mismatches) {
  const lines = [`与 golden 不一致（${mismatches.length} 处）：`];
  for (const item of mismatches.slice(0, MISMATCH_LIMIT)) {
    lines.push(`- ${item.path}：${item.message}`);
  }
  if (mismatches.length > MISMATCH_LIMIT) {
    lines.push(`…还有 ${mismatches.length - MISMATCH_LIMIT} 处未列出`);
  }
  return lines.join("\n");
}

function run(argv) {
  const parsed = parseArgs(argv);
  if (parsed.help) {
    console.log(usage);
    process.exit(0);
  }
  if (parsed.error) {
    console.error(usage);
    process.exit(1);
  }
  const { csv, config: configPath, today, golden: goldenPath } = parsed.slots;
  try {
    let config = {};
    if (configPath) {
      config = parseJson(readText(configPath), "配置");
    }
    const stats = compute(parseCsv(readCsv(csv), config), today);
    if (!goldenPath) {
      process.stdout.write(`${stringifyStats(stats)}\n`);
      return;
    }
    const golden = parseJson(readText(goldenPath), "golden");
    const mismatches = collectMismatches(stats, golden);
    if (mismatches.length === 0) {
      process.stdout.write("与 golden 一致\n");
      return;
    }
    console.error(formatMismatchReport(mismatches));
    process.exit(1);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

function parseArgs(argv) {
  const flags = {};
  const positionals = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") return { help: true };
    if (arg === "--today" || arg === "--config" || arg === "--golden") {
      const name = arg.slice(2);
      if (Object.prototype.hasOwnProperty.call(flags, name)) return { error: true };
      const value = argv[i + 1];
      if (value == null || value.startsWith("-")) return { error: true };
      flags[name] = value;
      i += 1;
      continue;
    }
    if (arg.startsWith("-")) return { error: true };
    positionals.push(arg);
  }
  if (positionals.length > 4) return { error: true };

  const slots = { csv: "", config: "", today: "", golden: "" };
  const names = ["csv", "config", "today", "golden"];
  if (positionals.length <= 1) {
    slots.csv = positionals[0] ?? "";
  } else {
    for (let i = 0; i < positionals.length; i += 1) slots[names[i]] = positionals[i];
  }
  for (const name of ["config", "today", "golden"]) {
    if (!Object.prototype.hasOwnProperty.call(flags, name)) continue;
    if (slots[name]) return { error: true };
    slots[name] = flags[name];
  }
  if (!slots.csv || !slots.today) return { error: true };
  return { slots };
}

function readText(filePath) {
  try {
    return readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  } catch (error) {
    const reason = error && error.code ? error.code : error.message;
    throw new Error(`读不到文件：${filePath}（${reason}）`);
  }
}

function readCsv(filePath) {
  try {
    return readFileSync(filePath, "utf8");
  } catch (error) {
    const reason = error && error.code ? error.code : error.message;
    throw new Error(`读不到文件：${filePath}（${reason}）`);
  }
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label}不是合法 JSON：${error.message}`);
  }
}

function walk(actual, expected, path, out) {
  if (sameValue(actual, expected)) return;
  const actualKind = valueKind(actual);
  const expectedKind = valueKind(expected);
  if (actualKind !== expectedKind || (actualKind !== "object" && actualKind !== "array")) {
    out.push({
      path: path || "（根）",
      message: `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`,
    });
    return;
  }
  if (actualKind === "array") {
    const length = Math.max(actual.length, expected.length);
    for (let index = 0; index < length; index += 1) {
      const child = `${path}[${index}]`;
      if (index >= expected.length) {
        out.push({
          path: child,
          message: `实际有此路径，golden 没有（实际 ${JSON.stringify(actual[index])}）`,
        });
      } else if (index >= actual.length) {
        out.push({
          path: child,
          message: `golden 有此路径，实际没有（期望 ${JSON.stringify(expected[index])}）`,
        });
      } else {
        walk(actual[index], expected[index], child, out);
      }
    }
    return;
  }
  const seen = new Set();
  const keys = [];
  for (const key of Object.keys(expected)) {
    seen.add(key);
    keys.push(key);
  }
  for (const key of Object.keys(actual)) {
    if (!seen.has(key)) keys.push(key);
  }
  for (const key of keys) {
    const child = joinKey(path, key);
    const inActual = Object.prototype.hasOwnProperty.call(actual, key);
    const inExpected = Object.prototype.hasOwnProperty.call(expected, key);
    if (!inExpected) {
      out.push({
        path: child,
        message: `实际有此路径，golden 没有（实际 ${JSON.stringify(actual[key])}）`,
      });
    } else if (!inActual) {
      out.push({
        path: child,
        message: `golden 有此路径，实际没有（期望 ${JSON.stringify(expected[key])}）`,
      });
    } else {
      walk(actual[key], expected[key], child, out);
    }
  }
}

function sameValue(actual, expected) {
  return actual === expected || (Number.isNaN(actual) && Number.isNaN(expected));
}

function valueKind(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function joinKey(parent, key) {
  const text = String(key);
  const piece = /^[\p{L}\p{N}_]+$/u.test(text) ? text : `[${JSON.stringify(text)}]`;
  if (!parent) return piece;
  return piece.startsWith("[") ? `${parent}${piece}` : `${parent}.${piece}`;
}

function stringifyStats(value, depth = 0, key = "", parent = null) {
  if (value === null) return "null";
  if (typeof value === "number") return formatNumber(value, key, parent);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const pad = " ".repeat(depth + 1);
    const inner = value
      .map((item) => `${pad}${stringifyStats(item, depth + 1)}`)
      .join(",\n");
    return `[\n${inner}\n${" ".repeat(depth)}]`;
  }
  const keys = Object.keys(value);
  if (keys.length === 0) return "{}";
  const pad = " ".repeat(depth + 1);
  const inner = keys
    .map((name) => {
      const rendered = stringifyStats(value[name], depth + 1, name, value);
      return `${pad}${JSON.stringify(name)}: ${rendered}`;
    })
    .join(",\n");
  return `{\n${inner}\n${" ".repeat(depth)}}`;
}

function formatNumber(value, key, parent) {
  if (value === 0) {
    if (key === "together_pct" && parent?.total) return "0.0";
    return "0";
  }
  if (key === "together_pct" && parent?.total && Number.isInteger(value)) {
    return value.toFixed(1);
  }
  if (Number.isInteger(value)) return String(value);
  return JSON.stringify(value);
}

function invokedAsCli() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedAsCli()) run(process.argv.slice(2));

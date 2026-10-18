#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { compute } from "../app/compute.js";
import { parseCsv } from "../app/parse.js";

const usage = `用法: node tools/parity.mjs <file.csv> --today YYYY-MM-DD [--config config.json]

解析 CSV 并打印统计 JSON，字段名与参考脚本的 --json 相同。
参与者场次和「仅某人」用表头里的列名（列顺序），不写死人名。
price_total 是已看场次的票价合计：price_mode 为 total（默认）时把 price 直接相加，
为 per_person 时乘该场到场人数。不输出按人头估算的 spend_heads。
spend / spend_n 仍是按地区把原价相加后的对照字段。`;

const args = process.argv.slice(2);
let csvPath = "";
let today = "";
let configPath = "";

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === "-h" || arg === "--help") {
    console.log(usage);
    process.exit(0);
  }
  if (arg === "--today") {
    today = args[i + 1] ?? "";
    i += 1;
    continue;
  }
  if (arg === "--config") {
    configPath = args[i + 1] ?? "";
    i += 1;
    continue;
  }
  if (arg.startsWith("--")) {
    console.error(usage);
    process.exit(1);
  }
  if (!csvPath) csvPath = arg;
  else {
    console.error(usage);
    process.exit(1);
  }
}

if (!csvPath || !today) {
  console.error(usage);
  process.exit(1);
}

try {
  let config = {};
  if (configPath) {
    const raw = readFileSync(configPath, "utf8").replace(/^\uFEFF/, "");
    try {
      config = JSON.parse(raw);
    } catch (error) {
      throw new Error(`配置不是合法 JSON：${error.message}`);
    }
  }
  const parsed = parseCsv(readFileSync(csvPath, "utf8"), config);
  const stats = compute(parsed, today);
  process.stdout.write(`${stringifyStats(stats)}\n`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
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

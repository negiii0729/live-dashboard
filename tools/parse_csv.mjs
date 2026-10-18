#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { parseCsv } from "../app/parse.js";

const usage = `用法: node tools/parse_csv.mjs <file.csv> [config.json]

解析 schema v1 的 CSV，并打印数据行数和参与者列。
参与者列是表头去掉首尾空白后的小写名字，顺序与表头一致。
config.json 可选：别名读 artist_aliases（没有则读 aliases），显示名和顺序读 people。`;

const file = process.argv[2];
if (!file || file === "-h" || file === "--help") {
  console.error(usage);
  process.exit(file ? 0 : 1);
}

const configPath = process.argv[3];

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
  const text = readFileSync(file, "utf8");
  const result = parseCsv(text, config);
  const names = result.participants.map((person) => person.column);
  console.log(`rows: ${result.rows.length}`);
  console.log(`participants: [${names.join(", ")}]`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

#!/usr/bin/env node
/**
 * 把一份 CSV 打成和页面相同的 KPI、筛选项和表格文字。
 * 文件留在仓库外，不要把真实观演表提交进来。
 *
 * 用法: node tools/preview_text.mjs <file.csv> --today YYYY-MM-DD [--config config.json]
 */
import { readFileSync } from "node:fs";
import { attendanceStatus, compute } from "../app/compute.js";
import { parseCsv } from "../app/parse.js";
import {
  cityOptions,
  footnote,
  kpiCards,
  listDetail,
  sortRows,
  subtitleText,
  tableColumns,
  tableView,
  typeOptions,
  whoFilterOptions,
  yearOptions,
} from "../app/render.js";

const usage = `用法: node tools/preview_text.mjs <file.csv> --today YYYY-MM-DD [--config config.json]

按页面上的口径打印 KPI、图表用到的数字、谁去了的选项和表格。
不写死参与者名字。票价合计是 compute 的 price_total，不打印按人头乘过的另一套数。
--today 要和对照用的截止日期相同。不要把真实 CSV 提交进这个仓库。`;

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
  process.stdout.write(previewText(parsed, stats, { config: parsed.config }));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

function previewText(parsed, stats, options = {}) {
  const people = parsed.participants ?? [];
  const rows = parsed.rows ?? [];
  const lines = [];
  lines.push(`截至 ${stats.today}`);
  lines.push(`参与者 ${people.map((person) => person.label).join("、") || "（无）"}`);
  lines.push(subtitleText(stats));
  lines.push("");
  for (const card of kpiCards(stats, people)) {
    lines.push(`${card.label}\t${card.value}`);
    lines.push(`\t${card.hint}`);
  }
  lines.push("");
  lines.push("谁去了");
  for (const option of whoFilterOptions(people)) lines.push(`\t${option.label}`);
  lines.push("");
  lines.push("类型");
  for (const type of stats.types ?? []) lines.push(`\t${type}\t${stats.type_cnt?.[type] ?? 0}`);
  lines.push("城市");
  for (const [name, count] of stats.city ?? []) lines.push(`\t${name}\t${count}`);
  lines.push("地区");
  for (const [name, count] of stats.region ?? []) lines.push(`\t${name}\t${count}`);
  lines.push("艺人");
  for (const [name, total, one, other] of stats.top_art ?? []) {
    lines.push(`\t${name}\t${total}\tワンマン ${one}\t其他 ${other}`);
  }
  lines.push("场馆");
  for (const [name, count] of stats.venue ?? []) lines.push(`\t${name}\t${count}`);
  lines.push("");
  lines.push(`年份 ${yearOptions(rows).join(" ")}`);
  lines.push(`类型筛选 ${typeOptions(rows).join(" ")}`);
  lines.push(`城市筛选 ${cityOptions(rows).join(" ")}`);
  lines.push("");
  const columns = tableColumns(people).map((column) => column.label);
  lines.push(columns.join("\t"));
  const ordered = sortRows(rows, "no", 1);
  for (const row of ordered) {
    const view = tableView(row, people, stats.today);
    const date = view.statusLabel ? `${view.date} ${view.statusLabel}` : view.date;
    lines.push(
      [view.no, date, view.event, view.artist, view.venue, view.city, view.type, view.price, ...view.marks].join(
        "\t",
      ),
    );
  }
  lines.push("");
  lines.push(`${rows.length} / ${rows.length} 条`);
  const upcoming = rows.filter(
    (row) => attendanceStatus(row, stats.today, people.map((person) => person.column)) === "upcoming",
  );
  lines.push("即将到来");
  for (const row of upcoming) {
    const item = listDetail(row, people, { upcoming: true });
    lines.push(`\t${item.date}\t${item.title}\t${item.detail}`);
  }
  lines.push("");
  lines.push(footnote(stats, people, options));
  lines.push("");
  return `${lines.join("\n")}\n`;
}

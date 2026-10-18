import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { compute } from "../app/compute.js";
import { parseCsv } from "../app/parse.js";
import {
  applyFilters,
  attendanceLabel,
  buildCharts,
  cityOptions,
  footnote,
  formatNumber,
  hasTypeCounts,
  kpiCards,
  pieSeriesLayout,
  listDetail,
  matchesWho,
  render,
  sortRows,
  subtitleText,
  tableColumns,
  tableView,
  typeOptions,
  whoFilterOptions,
  yearOptions,
} from "../app/render.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const today = "2026-10-18";
const forbiddenNames = new RegExp(
  ["ne", "gi"].join("") + "|" + ["re", "my"].join("") + "|" + ["liv", "es.csv"].join(""),
  "i",
);

function fixture(name) {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

function parsed(name, config) {
  return parseCsv(fixture(name), config);
}

function ready(name, config, day = today) {
  const result = parsed(name, config);
  return { parsed: result, stats: compute(result, day) };
}

test("formatNumber groups thousands and keeps a fractional part", () => {
  assert.equal(formatNumber(72533), "72,533");
  assert.equal(formatNumber(871.5), "871.5");
  assert.equal(formatNumber(0), "0");
  assert.equal(formatNumber(1000), "1,000");
  assert.equal(formatNumber(-12.5), "-12.5");
});

test("who filter options follow the participants, including 1, 2, and 3 people", () => {
  const three = [
    { column: "a", label: "甲" },
    { column: "b", label: "乙" },
    { column: "c", label: "丙" },
  ];
  assert.deepEqual(
    whoFilterOptions(three).map((option) => option.label),
    ["谁去了", "甲 去了", "乙 去了", "丙 去了", "一起", "仅 甲", "仅 乙", "仅 丙"],
  );
  assert.deepEqual(
    whoFilterOptions(three).map((option) => option.value),
    ["", "went:a", "went:b", "went:c", "all", "only:a", "only:b", "only:c"],
  );

  const two = parsed("compute-two.csv").participants;
  assert.deepEqual(
    two.map((person) => person.label),
    ["alice", "bob"],
  );
  assert.deepEqual(
    whoFilterOptions(two).map((option) => option.label),
    ["谁去了", "alice 去了", "bob 去了", "一起", "仅 alice", "仅 bob"],
  );

  const one = parsed("participants-1.csv").participants;
  assert.deepEqual(
    whoFilterOptions(one).map((option) => [option.value, option.label]),
    [
      ["", "谁去了"],
      ["went:mika", "mika 去了"],
      ["only:mika", "仅 mika"],
    ],
  );
  assert.equal(
    whoFilterOptions(one).some((option) => option.value === "all"),
    false,
  );

  assert.deepEqual(whoFilterOptions([]), [{ value: "", label: "谁去了" }]);
  assert.deepEqual(whoFilterOptions(parsed("participants-0.csv").participants), [
    { value: "", label: "谁去了" },
  ]);
});

test("a column named all still gets its own went and only values", () => {
  const people = [{ column: "all", label: "全体" }];
  assert.deepEqual(
    whoFilterOptions(people).map((option) => option.value),
    ["", "went:all", "only:all"],
  );
  const row = { attended: { all: true } };
  assert.equal(matchesWho(row, people, "went:all"), true);
  assert.equal(matchesWho(row, people, "all"), false);
  assert.equal(matchesWho(row, people, "only:all"), true);
});

test("who matching uses marks for 1, 2, and 3 participants and does not throw", () => {
  const two = ready("compute-two.csv");
  const people = two.parsed.participants;
  const rows = two.parsed.rows;
  assert.equal(applyFilters(rows, people, { who: "all" }, today).length, 7);
  assert.equal(applyFilters(rows, people, { who: "only:alice" }, today).length, 3);
  assert.equal(applyFilters(rows, people, { who: "only:bob" }, today).length, 3);
  assert.equal(applyFilters(rows, people, { who: "went:alice" }, today).length, 10);
  assert.equal(applyFilters(rows, people, { status: "upcoming" }, today).length, 1);
  assert.equal(applyFilters(rows, people, { status: "undated" }, today).length, 1);
  assert.equal(applyFilters(rows, people, { status: "unmarked" }, today).length, 2);
  assert.equal(applyFilters(rows, people, { query: "northwind" }, today).length, 3);
  assert.equal(applyFilters(rows, people, { type: "ワンマン" }, today).length, 6);
  assert.equal(applyFilters(rows, people, { city: "杭州" }, today).length, 3);
  assert.equal(applyFilters(rows, people, { year: "2024" }, today).length, 1);

  const three = ready("compute-three.csv");
  assert.equal(applyFilters(three.parsed.rows, three.parsed.participants, { who: "all" }, today).length, 3);
  assert.equal(
    applyFilters(three.parsed.rows, three.parsed.participants, { who: "only:cara" }, today).length,
    1,
  );
  assert.equal(
    applyFilters(three.parsed.rows, three.parsed.participants, { who: "went:alice" }, today).length,
    5,
  );

  const one = ready("participants-1.csv");
  assert.equal(applyFilters(one.parsed.rows, one.parsed.participants, { who: "all" }, today).length, 0);
  assert.equal(applyFilters(one.parsed.rows, one.parsed.participants, { who: "went:mika" }, today).length, 2);
  assert.equal(applyFilters(one.parsed.rows, one.parsed.participants, { who: "only:mika" }, today).length, 2);
  assert.doesNotThrow(() => buildCharts(one.stats, one.parsed.rows, one.parsed.participants));
  assert.doesNotThrow(() => buildCharts(three.stats, three.parsed.rows, three.parsed.participants));
});

test("kpi cards follow participant count and show price_total", () => {
  const two = ready("compute-two.csv");
  const cards = kpiCards(two.stats, two.parsed.participants);
  assert.deepEqual(
    cards.map((card) => card.label),
    ["已看场次", "alice", "bob", "一起看", "票价合计（表内原值）", "即将到来"],
  );
  assert.equal(cards[0].value, "11");
  assert.equal(cards[0].hint, "2017–2026 · 有日期且已过");
  assert.equal(cards[1].hint, "其中仅 alice 3 场");
  assert.equal(cards[2].hint, "其中仅 bob 3 场");
  assert.equal(cards[3].value, "5");
  assert.equal(cards[3].hint, "占 45.5%");
  assert.equal(cards[4].value, "¥871.5");
  assert.equal(cards[4].hint, "1 场无票价未计");
  assert.equal(cards[5].value, "1");
  assert.equal(cards[5].hint, "待定 1 · 已过未标记 2");
  assert.equal(subtitleText(two.stats), "2017-11-12 — 2026-10-18 · 截至 2026-10-18 · 共 6 组艺人");

  const one = ready("participants-1.csv");
  assert.deepEqual(
    kpiCards(one.stats, one.parsed.participants).map((card) => card.key),
    ["total", "mika", "price", "upcoming"],
  );

  const three = ready("compute-three.csv");
  const threeCards = kpiCards(three.stats, three.parsed.participants);
  assert.equal(threeCards.some((card) => card.key === "together"), true);
  assert.deepEqual(
    threeCards.map((card) => card.label),
    ["已看场次", "alice", "bob", "cara", "一起看", "票价合计（表内原值）", "即将到来"],
  );

  const none = ready("participants-0.csv");
  assert.deepEqual(
    kpiCards(none.stats, none.parsed.participants).map((card) => card.key),
    ["total", "price", "upcoming"],
  );
  assert.match(footnote(none.stats, none.parsed.participants), /没有参与者列/);
});

test("the footnote describes the direct price total", () => {
  const two = ready("compute-two.csv");
  const note = footnote(two.stats, two.parsed.participants);
  assert.match(note, /price 直接相加/);
  assert.match(note, /2026-10-18/);
  assert.doesNotMatch(note, /按人头/);
  assert.doesNotMatch(note, /spend_heads/);
  const perPerson = footnote(two.stats, two.parsed.participants, { priceMode: "per_person" });
  assert.match(perPerson, /单人票价/);
  assert.doesNotMatch(perPerson, /按人头/);
});

test("attendance labels and list lines use participant labels", () => {
  const people = [
    { column: "a", label: "甲" },
    { column: "b", label: "乙" },
    { column: "c", label: "丙" },
  ];
  assert.equal(attendanceLabel({ attended: { a: true, b: true, c: true } }, people), "一起");
  assert.equal(attendanceLabel({ attended: { a: true, b: true } }, people), "甲、乙");
  assert.equal(attendanceLabel({ attended: {} }, people), "未标记");
  assert.equal(attendanceLabel({ attended: { a: true } }, [{ column: "a", label: "甲" }]), "甲");

  const two = ready("compute-two.csv");
  const upcoming = two.parsed.rows.find((row) => row.event === "Winter Upcoming");
  const detail = listDetail(upcoming, two.parsed.participants, { upcoming: true });
  assert.equal(detail.date, "2026-12-01");
  assert.equal(detail.title, "Quartz Owls");
  assert.equal(detail.detail, "Winter Upcoming · Quartz Room · 上海 · 一起");

  const harbor = two.parsed.rows.find((row) => row.no === "2");
  assert.equal(tableView(harbor, two.parsed.participants, today).artist, "Paper Moon / Glass Harbor / Paper Moon");
  assert.deepEqual(tableView(harbor, two.parsed.participants, today).marks, ["✅", "✅"]);
  const missed = two.parsed.rows.find((row) => row.no === "9");
  assert.equal(tableView(missed, two.parsed.participants, today).price, "999");
  assert.equal(tableView(missed, two.parsed.participants, today).status, "unmarked");
  const blankPrice = two.parsed.rows.find((row) => row.no === "8");
  assert.equal(tableView(blankPrice, two.parsed.participants, today).price, "");
  const zero = two.parsed.rows.find((row) => row.no === "15");
  assert.equal(tableView(zero, two.parsed.participants, today).price, "0");
});

test("table columns and filter lists come from the rows", () => {
  const two = parsed("compute-two.csv");
  assert.deepEqual(
    tableColumns(two.participants).map((column) => column.label),
    ["#", "日期", "活动", "艺人", "场馆", "城市", "类型", "票价", "alice", "bob"],
  );
  assert.deepEqual(
    tableColumns(parsed("participants-3.csv").participants).map((column) => column.label),
    ["#", "日期", "活动", "艺人", "场馆", "城市", "类型", "票价", "mika", "sora", "jun"],
  );
  assert.deepEqual(yearOptions(two.rows), [
    "2026",
    "2025",
    "2024",
    "2023",
    "2022",
    "2021",
    "2020",
    "2019",
    "2018",
    "2017",
  ]);
  assert.deepEqual(typeOptions(two.rows), ["ワンマン", "対バン", "フェス"]);
  assert.deepEqual(typeOptions(parsed("participants-0.csv").rows), [
    "ワンマン",
    "対バン",
    "フェス",
    "solo",
    "fest",
  ]);
  assert.equal(cityOptions(two.rows).includes("杭州"), true);
  assert.equal(cityOptions(two.rows).includes(""), false);
  const byPrice = sortRows(two.rows, "price", -1);
  assert.equal(byPrice[0].price, 999);
  assert.equal(sortRows(two.rows, "no", 1)[0].no, "1");
});

test("chart series use the computed numbers and color cities by region", () => {
  const two = ready("compute-two.csv");
  const before = two.stats.city.map((entry) => entry[0]);
  const charts = buildCharts(two.stats, two.parsed.rows, two.parsed.participants);
  assert.deepEqual(
    two.stats.city.map((entry) => entry[0]),
    before,
  );
  assert.deepEqual(
    charts.type.series[0].data.map((item) => [item.name, item.value]),
    [
      ["ワンマン", 4],
      ["対バン", 3],
      ["フェス", 4],
    ],
  );
  assert.equal(charts.type.series[0].data[0].itemStyle.color, "#ff6b8b");
  assert.equal(charts.year.series.at(-1).label.show, true);
  assert.equal(charts.year.series[0].label, undefined);
  assert.deepEqual(charts.year.series[0].data, two.stats.per_year["ワンマン"]);
  assert.equal(charts.artist.yAxis.data.at(-1), "Brightvale");
  assert.equal(charts.artist.yAxis.data[0], "Paper Moon");
  assert.deepEqual(charts.artist.series[0].data.at(-1), 1);
  assert.deepEqual(charts.artist.series[1].data.at(-1), 2);
  assert.equal(charts.city.graphic[0].style.text, "中国大陆 7   日本 2   港台澳 2");

  const colorOf = new Map(
    charts.city.series[0].data.map((item, index) => [charts.city.yAxis.data[index], item.itemStyle.color]),
  );
  assert.equal(colorOf.get("杭州"), "#7be0a6");
  assert.equal(colorOf.get("上海"), colorOf.get("杭州"));
  assert.equal(colorOf.get("北京"), colorOf.get("杭州"));
  assert.equal(colorOf.get("東京"), "#5cc8ff");
  assert.equal(colorOf.get("香港"), "#c39bff");
  assert.equal(colorOf.get("台北"), colorOf.get("香港"));
  assert.notEqual(colorOf.get("東京"), colorOf.get("杭州"));
  assert.equal(charts.venue.series[0].data[0], two.stats.venue.at(-1)[1]);
});

test("a csv without a type column does not draw three empty pie slices", () => {
  const csv = "date,event,artist,alice\n2024-01-01,Show,Northwind,✅\n2024-02-02,Other,Paper Moon,✅\n";
  const result = parseCsv(csv);
  const stats = compute(result, today);
  assert.equal(hasTypeCounts(stats), false);
  assert.equal(stats.type_cnt["ワンマン"], 0);
  assert.equal(stats.type_cnt["対バン"], 0);
  assert.equal(stats.type_cnt["フェス"], 0);
  const charts = buildCharts(stats, result.rows, result.participants);
  assert.equal(charts.type, null);
  const source = readFileSync(new URL("../app/render.js", import.meta.url), "utf8");
  assert.match(source, /无类型数据/);

  const withType = ready("compute-two.csv");
  assert.equal(hasTypeCounts(withType.stats), true);
  assert.ok(buildCharts(withType.stats, withType.parsed.rows, withType.parsed.participants).type);
});

test("a phone-width pie keeps its labels inside the chart", () => {
  const wide = pieSeriesLayout(800);
  const phone = pieSeriesLayout(390);
  const outer = (layout) => Number(String(layout.radius[1]).replace("%", ""));
  assert.ok(outer(phone) < outer(wide));
  assert.ok(outer(phone) <= 40);
  assert.equal(phone.label.overflow, "break");
  assert.equal(phone.label.alignTo, "edge");
  assert.equal(phone.label.bleedMargin, 0);

  const two = ready("compute-two.csv");
  const charts = buildCharts(two.stats, two.parsed.rows, two.parsed.participants, { width: 390 });
  assert.deepEqual(charts.type.series[0].radius, phone.radius);
  assert.equal(charts.type.series[0].label.alignTo, "edge");
  assert.deepEqual(
    charts.type.series[0].data.map((item) => item.value),
    [4, 3, 4],
  );
});

test("render rejects a missing container before touching the page", () => {
  const host = { appendChild() {} };
  assert.throws(() => render({}, [], [], null), /容器/);
  assert.throws(() => render("nope", [], [], host), /统计/);
  assert.throws(() => render({}, "rows", [], host), /行/);
});

test("the page and the renderer stay generic", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const source = readFileSync(new URL("../app/render.js", import.meta.url), "utf8");
  assert.match(html, /examples\/sample\.csv/);
  assert.match(html, /render\(stats, parsed\.rows, parsed\.participants/);
  assert.match(html, /<script type="module">/);
  assert.match(html, /选择文件/);
  assert.match(html, /清除数据/);
  assert.match(html, /loaded\.source === "sample"/);
  assert.doesNotMatch(html, /sample\s*:\s*true/);
  assert.doesNotMatch(html, /https?:\/\//);
  assert.doesNotMatch(html, /按人头/);
  assert.doesNotMatch(source, /按人头/);
  assert.doesNotMatch(source, /spend_heads/);
  assert.doesNotMatch(`${html}\n${source}`, forbiddenNames);
  assert.equal(
    readFileSync(new URL("../examples/sample.csv", import.meta.url), "utf8"),
    readFileSync(new URL("./fixtures/compute-two.csv", import.meta.url), "utf8"),
  );
});

test("preview text prints the page numbers for a local CSV", () => {
  const run = spawnSync(
    process.execPath,
    ["tools/preview_text.mjs", "examples/sample.csv", "--today", today],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /票价合计（表内原值）\t¥871\.5/);
  assert.match(run.stdout, /一起看\t5/);
  assert.match(run.stdout, /alice 去了/);
  assert.match(run.stdout, /仅 bob/);
  assert.match(run.stdout, /Brightvale\t3/);
  assert.doesNotMatch(run.stdout, /按人头/);
  assert.doesNotMatch(run.stdout, /spend_heads/);
  assert.doesNotMatch(run.stdout, forbiddenNames);

  const one = spawnSync(
    process.execPath,
    ["tools/preview_text.mjs", "tests/fixtures/participants-1.csv", "--today", today],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(one.status, 0, one.stderr);
  assert.match(one.stdout, /mika 去了/);
  assert.doesNotMatch(one.stdout, /一起看/);
  assert.doesNotMatch(one.stdout, /\t一起\n/);

  const three = spawnSync(
    process.execPath,
    ["tools/preview_text.mjs", "tests/fixtures/participants-3.csv", "--today", today],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(three.status, 0, three.stderr);
  assert.match(three.stdout, /一起看/);
  assert.match(three.stdout, /仅 jun/);

  const missing = spawnSync(process.execPath, ["tools/preview_text.mjs"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /--today/);
});

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { compute, compareCodePoints, pythonRound } from "../app/compute.js";
import { parseCsv } from "../app/parse.js";

const root = fileURLToPath(new URL("..", import.meta.url));

function fixture(name) {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

function statsOf(name, config, today = "2026-10-18") {
  return compute(parseCsv(fixture(name), config), today);
}

test("pythonRound uses half-to-even on the same doubles as Python", () => {
  assert.equal(pythonRound(0.5), 0);
  assert.equal(pythonRound(1.5), 2);
  assert.equal(pythonRound(2.5), 2);
  assert.equal(pythonRound(3.5), 4);
  assert.equal(pythonRound(-0.5), 0);
  assert.equal(pythonRound(-1.5), -2);
  assert.equal(pythonRound(10.5), 10);
  assert.equal(pythonRound(11.5), 12);
  assert.equal(pythonRound(671.5), 672);
  assert.equal(pythonRound(6.25, 1), 6.2);
  assert.equal(pythonRound(12.25, 1), 12.2);
  assert.equal(pythonRound(12.35, 1), 12.3);
  assert.equal(pythonRound(1.25, 1), 1.2);
  assert.equal(pythonRound(1.35, 1), 1.4);
  assert.equal(pythonRound(2.675, 2), 2.67);
  assert.equal(pythonRound((100 * 5) / 11, 1), 45.5);
  assert.equal(pythonRound(100 / 16, 1), 6.2);
});

test("pythonRound matches Python round across a fixed sample of doubles", () => {
  const hexes = [];
  const seen = new Set();
  function add(value) {
    if (!Number.isFinite(value) || Object.is(value, -0)) value = value === 0 ? 0 : value;
    if (!Number.isFinite(value)) return;
    const buf = Buffer.alloc(8);
    buf.writeDoubleBE(value);
    const hex = buf.toString("hex");
    if (seen.has(hex)) return;
    seen.add(hex);
    hexes.push(hex);
  }
  for (let i = 0; i <= 400; i += 1) {
    add(i / 10);
    add(i / 8);
    add(i / 100);
    add(-i / 10);
  }
  for (let total = 1; total <= 48; total += 1) {
    for (let together = 0; together <= total; together += 1) {
      add((100 * together) / total);
    }
  }
  add(2.675);
  add(12.35);
  add(671.5);
  add(0);

  const py = `
import json, struct, sys
hexes = json.load(sys.stdin)
out = []
for h in hexes:
    x = struct.unpack(">d", bytes.fromhex(h))[0]
    out.append([round(x), round(x, 1), round(x, 2)])
json.dump(out, sys.stdout)
`;
  const run = spawnSync("python3", ["-c", py], {
    input: JSON.stringify(hexes),
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr);
  const expected = JSON.parse(run.stdout);
  assert.equal(expected.length, hexes.length);
  for (let i = 0; i < hexes.length; i += 1) {
    const value = Buffer.from(hexes[i], "hex").readDoubleBE(0);
    assert.equal(pythonRound(value), expected[i][0], `integer ${value}`);
    assert.equal(pythonRound(value, 1), expected[i][1], `1dp ${value}`);
    assert.equal(pythonRound(value, 2), expected[i][2], `2dp ${value}`);
  }
});

test("string order follows Unicode code points", () => {
  assert.ok(compareCodePoints("foxtrot", "écho") < 0);
  assert.ok("écho".localeCompare("foxtrot") < 0);
  assert.ok(compareCodePoints("ä", "b") > 0);
  assert.ok("ä".localeCompare("b") < 0);
  assert.equal(compareCodePoints("North", "North"), 0);
  assert.ok(compareCodePoints("North", "Northwind") < 0);
  assert.ok(compareCodePoints("A", "a") < 0);
});

test("the two-person fixture matches every golden field except the price total", () => {
  const golden = JSON.parse(fixture("compute-two.golden.json"));
  const actual = statsOf("compute-two.csv");

  for (const [key, value] of Object.entries(golden)) {
    if (key === "spend_heads") continue;
    assert.deepEqual(actual[key], value, key);
  }
  const actualKeys = Object.keys(actual)
    .filter((key) => key !== "price_total")
    .sort();
  const goldenKeys = Object.keys(golden)
    .filter((key) => key !== "spend_heads")
    .sort();
  assert.deepEqual(actualKeys, goldenKeys);

  assert.deepEqual(
    actual.top_art.map((row) => row[0]),
    ["Brightvale", "Northwind", "Amberline", "Glass Harbor", "Zebra Finch", "Paper Moon"],
  );
  assert.deepEqual(actual.city.slice(0, 2), [
    ["杭州", 3],
    ["上海", 3],
  ]);
  assert.deepEqual(actual.venue.slice(0, 2), [
    ["North Pier", 2],
    ["Amber Court", 2],
  ]);
  const zebra = actual.top_art.find((row) => row[0] === "Zebra Finch");
  const paper = actual.top_art.find((row) => row[0] === "Paper Moon");
  assert.deepEqual(zebra, ["Zebra Finch", 1, 1, 0]);
  assert.deepEqual(paper, ["Paper Moon", 1, 0, 1]);

  // 已看且有票价的场次，price 直接相加，不乘到场人数，也不先按地区舍入再相加。
  const direct = 200 + 150.5 + 80 + 60 + 300 + 10.5 + 10.5 + 40 + 20 + 0;
  const roundedRegions = 672 + 100 + 100;
  const byHeads = 200 * 2 + 150.5 * 2 + 80 + 60 + 300 * 2 + 10.5 + 10.5 + 40 + 20 + 0 * 2;
  assert.equal(direct, 871.5);
  assert.equal(roundedRegions, 872);
  assert.equal(byHeads, 1522);
  assert.equal(actual.price_total, 871.5);
  assert.notEqual(actual.price_total, roundedRegions);
  assert.notEqual(actual.price_total, byHeads);
  assert.equal(
    Object.values(golden.spend_heads).reduce((sum, value) => sum + value, 0),
    byHeads,
  );
});

test("price total sums attended prices and does not use a head count", () => {
  const csv = [
    "date,event,artist,price,alice,bob",
    "2024-01-01,Both,Northwind,100,✅,✅",
    "2024-02-01,Only Alice,Paper Moon,40,✅,",
    "2024-03-01,Unmarked,Glass Harbor,25,,",
    "2024-04-01,No Price,Lantern Club,,✅,✅",
    "2026-12-01,Future,Copper Kite,999,✅,✅",
  ].join("\n");
  const totalMode = compute(parseCsv(csv), "2026-10-18");
  assert.equal(totalMode.total, 3);
  assert.equal(totalMode.no_price, 1);
  assert.equal(totalMode.price_total, 140);
  assert.notEqual(totalMode.price_total, 100 * 2 + 40);

  const perPerson = compute(parseCsv(csv, { price_mode: "per_person" }), "2026-10-18");
  assert.equal(perPerson.price_total, 100 * 2 + 40);
  assert.equal(perPerson.spend["中国大陆"], pythonRound(140));
});

test("three participants count together and only-one generically", () => {
  const stats = statsOf("compute-three.csv");
  assert.equal(stats.total, 5);
  assert.equal(stats.upcoming, 1);
  assert.equal(stats.undated, 1);
  assert.equal(stats.unmarked, 1);
  assert.equal(stats.alice, 3);
  assert.equal(stats.bob, 3);
  assert.equal(stats.cara, 2);
  assert.equal(stats.together, 1);
  assert.equal(stats.together_pct, 20);
  assert.equal(stats.alice_only, 1);
  assert.equal(stats.bob_only, 1);
  assert.equal(stats.cara_only, 1);
  assert.equal(stats.no_price, 1);
  assert.equal(stats.price_total, 100 + 50 + 80 + 30);
  assert.deepEqual(stats.region, [
    ["中国大陆", 2],
    ["港台澳", 2],
    ["日本", 1],
  ]);

  // per_person = Σ(price × 该场 ✅ 人数)。空白票价、未来场、待定、未标记都不进合计。
  // 2024-01-01 三人 100×3，02-01 一人 50，03-01 一人 80，05-01 一人 30。
  const perPerson = statsOf("compute-three.csv", { price_mode: "per_person" });
  const hand = 100 * 3 + 50 * 1 + 80 * 1 + 30 * 1;
  assert.equal(hand, 460);
  assert.equal(perPerson.price_total, hand);
  assert.equal(perPerson.no_price, 1);
  assert.notEqual(perPerson.price_total, 100 * 2 + 50 + 80 + 30);
});

test("a past date with no participant columns counts as attended", () => {
  const stats = statsOf("participants-0.csv");
  assert.equal(stats.total, 4);
  assert.equal(stats.together, null);
  assert.equal(stats.together_pct, null);
  assert.equal(stats.no_price, 2);
  assert.equal(stats.price_total, 180);
  assert.deepEqual(stats.types, ["ワンマン", "対バン", "フェス", "solo", "fest"]);
  assert.deepEqual(stats.type_cnt, {
    ワンマン: 0,
    対バン: 0,
    フェス: 0,
    solo: 3,
    fest: 1,
  });
  assert.deepEqual(stats.years, ["2024"]);
  assert.deepEqual(stats.per_year.solo, [3]);
  assert.deepEqual(stats.per_year.fest, [1]);
  assert.deepEqual(stats.per_year["ワンマン"], [0]);
  assert.deepEqual(stats.region, [["East", 4]]);
  assert.deepEqual(stats.spend, { East: 180 });
  assert.deepEqual(
    stats.top_art.map((row) => row[0]),
    ["Glass Harbor", "Lantern Club", "Northwind", "Paper Moon"],
  );
  assert.equal(stats.first, "2024-04-01");
  assert.equal(stats.last, "2024-04-04");

  const perPerson = statsOf("participants-0.csv", { price_mode: "per_person" });
  assert.equal(perPerson.price_total, 0);
});

test("one participant omits together and still counts only-that-person", () => {
  const stats = statsOf("participants-1.csv");
  assert.equal(stats.total, 2);
  assert.equal(stats.unmarked, 1);
  assert.equal(stats.mika, 2);
  assert.equal(stats.mika_only, 2);
  assert.equal(stats.together, null);
  assert.equal(stats.together_pct, null);
  assert.deepEqual(
    stats.top_art.map((row) => row[0]),
    ["Lantern Club", "Paper Moon"],
  );
});

test("today is injectable and classifies the boundary dates", () => {
  const csv = [
    "date,event,artist,alice",
    "2026-10-17,Past,Northwind,✅",
    "2026-10-18,Today Show,Paper Moon,✅",
    "2026-10-19,Next,Glass Harbor,✅",
    ",Later,Lantern Club,✅",
    "2026-10-01,Bare,Copper Kite,",
  ].join("\n");
  const onDay = compute(parseCsv(csv), "2026-10-18");
  assert.equal(onDay.total, 2);
  assert.equal(onDay.alice, 2);
  assert.equal(onDay.upcoming, 1);
  assert.equal(onDay.undated, 1);
  assert.equal(onDay.unmarked, 1);
  assert.equal(onDay.first, "2026-10-17");
  assert.equal(onDay.last, "2026-10-18");

  const before = compute(parseCsv(csv), "2026-10-16");
  assert.equal(before.total, 0);
  assert.equal(before.upcoming, 3);
  assert.equal(before.unmarked, 1);
  assert.equal(before.together, null);
  assert.equal(before.first, "");
  assert.equal(before.last, "");

  const noneYet = compute(
    parseCsv("date,event,alice,bob\n2026-12-01,Later,✅,✅\n"),
    "2026-10-18",
  );
  assert.equal(noneYet.total, 0);
  assert.equal(noneYet.together, 0);
  assert.equal(noneYet.together_pct, 0);
});

test("the same artist twice in one event counts once, split into one-man and other shows", () => {
  const csv = [
    "date,event,artist,type,alice",
    '2024-01-01,Show,"Northwind\n/Northwind\n／Northwind",ワンマン,✅',
    '2024-02-01,Fest,"Northwind\nPaper Moon",フェス,✅',
  ].join("\n");
  const stats = compute(parseCsv(csv), "2026-10-18");
  assert.deepEqual(stats.top_art, [
    ["Northwind", 2, 1, 1],
    ["Paper Moon", 1, 0, 1],
  ]);
  assert.equal(stats.unique_artists, 2);
});

test("aliases affect counting only, and a repeated aliased name is deduped", () => {
  const csv = [
    "date,event,artist,type,alice,bob",
    '2024-01-01,Show,"Copper Kite\nKite",ワンマン,✅,✅',
    "2024-02-01,Other,Paper Moon,フェス,✅,",
  ].join("\n");
  const stats = compute(
    parseCsv(csv, {
      aliases: { Kite: "Copper Kite", "Paper Moon": "Paper Moon Union" },
    }),
    "2026-10-18",
  );
  assert.deepEqual(stats.top_art, [
    ["Copper Kite", 1, 1, 0],
    ["Paper Moon Union", 1, 0, 1],
  ]);
});

test("region prefers the region column, then the built-in city map, then default_region", () => {
  const csv = [
    "date,event,artist,city,region,price,alice",
    "2024-01-01,Show,Northwind,東京,,10,✅",
    "2024-01-02,Show,Paper Moon,香港,,20,✅",
    "2024-01-03,Show,Glass Harbor,台北,东海岸,30,✅",
    "2024-01-04,Show,Lantern Club,Lumen Bay,,40,✅",
    "2024-01-05,Show,Copper Kite,深圳,,50,✅",
  ].join("\n");
  const stats = compute(
    parseCsv(csv, { default_region: "虚构地区" }),
    "2026-10-18",
  );
  assert.deepEqual(stats.region, [
    ["虚构地区", 2],
    ["日本", 1],
    ["港台澳", 1],
    ["东海岸", 1],
  ]);
  assert.equal(stats.price_total, 150);

  const builtin = compute(parseCsv(csv), "2026-10-18");
  assert.deepEqual(builtin.region, [
    ["中国大陆", 2],
    ["日本", 1],
    ["港台澳", 1],
    ["东海岸", 1],
  ]);
});

test("equal artist counts sort by one-man count, then code point, ahead of first appearance", () => {
  const csv = [
    "date,event,artist,type,alice,bob",
    "2024-01-01,First,écho,フェス,✅,✅",
    "2024-01-02,Second,foxtrot,フェス,✅,✅",
    "2024-01-03,Third,écho,ワンマン,✅,",
    "2024-01-04,Fourth,foxtrot,ワンマン,,✅",
  ].join("\n");
  const stats = compute(parseCsv(csv), "2026-10-18");
  assert.deepEqual(
    stats.top_art.map((row) => row[0]),
    ["foxtrot", "écho"],
  );
  assert.deepEqual(stats.top_art[0], ["foxtrot", 2, 1, 1]);
  assert.deepEqual(stats.top_art[1], ["écho", 2, 1, 1]);
});

test("together percentage rounds half to even", () => {
  const lines = ["date,event,artist,alice,bob"];
  for (let i = 1; i <= 16; i += 1) {
    const day = String(i).padStart(2, "0");
    const mark = i === 1 ? "✅,✅" : "✅,";
    lines.push(`2020-01-${day},Show ${day},Northwind,${mark}`);
  }
  const stats = compute(parseCsv(lines.join("\n")), "2026-10-18");
  assert.equal(stats.total, 16);
  assert.equal(stats.together, 1);
  assert.equal(stats.together_pct, 6.2);
});

test("venue ties keep first appearance and stop at 12", () => {
  const lines = ["date,event,artist,venue,alice"];
  const names = [];
  for (let i = 2; i <= 13; i += 1) names.push(`Hall ${String(i).padStart(2, "0")}`);
  names.push("Hall 01");
  names.forEach((name, index) => {
    const day = String(index + 1).padStart(2, "0");
    lines.push(`2020-03-${day},Show,Northwind,${name},✅`);
  });
  const stats = compute(parseCsv(lines.join("\n")), "2026-10-18");
  assert.equal(stats.venue.length, 12);
  assert.deepEqual(
    stats.venue.map((row) => row[0]),
    names.slice(0, 12),
  );
  assert.equal(
    stats.venue.some((row) => row[0] === "Hall 01"),
    false,
  );
});

test("top artists keep 20 after a code-point tie break", () => {
  const lines = ["date,event,artist,alice"];
  for (let i = 1; i <= 21; i += 1) {
    const day = String(i).padStart(2, "0");
    lines.push(`2020-04-${day},Show,Band ${day},✅`);
  }
  const stats = compute(parseCsv(lines.join("\n")), "2026-10-18");
  assert.equal(stats.unique_artists, 21);
  assert.equal(stats.top_art.length, 20);
  assert.equal(stats.top_art[0][0], "Band 01");
  assert.equal(stats.top_art[19][0], "Band 20");
  assert.equal(
    stats.top_art.some((row) => row[0] === "Band 21"),
    false,
  );
});

test("unknown price_mode is a Chinese error and is not treated as total", () => {
  const csv = "date,event,artist,price,alice\n2024-01-01,Show,Northwind,10,✅\n";
  assert.throws(
    () => compute(parseCsv(csv, { price_mode: "heads" }), "2026-10-18"),
    (error) => {
      assert.match(error.message, /未知的 price_mode「heads」/);
      assert.match(error.message, /只接受 total 或 per_person/);
      return true;
    },
  );
  const parsed = parseCsv(csv);
  parsed.config.priceMode = "by_head";
  assert.throws(
    () => compute(parsed, "2026-10-18"),
    (error) => {
      assert.match(error.message, /未知的 price_mode「by_head」/);
      assert.doesNotMatch(error.message, /10/);
      return true;
    },
  );
  assert.equal(compute(parseCsv(csv), "2026-10-18").price_total, 10);
  assert.throws(() => compute(parseCsv(csv), "2026/10/18"), /today/);
  assert.throws(() => compute(parseCsv(csv), "2026-02-31"), /today/);
});

test("currency does not change the numeric total", () => {
  const base = statsOf("compute-two.csv");
  const jpy = statsOf("compute-two.csv", { currency: "JPY", price_mode: "total" });
  const usd = statsOf("compute-two.csv", { currency: "usd" });
  assert.equal(base.price_total, 871.5);
  assert.equal(jpy.price_total, base.price_total);
  assert.equal(usd.price_total, base.price_total);
  assert.equal(jpy.no_price, base.no_price);
  assert.equal(jpy.currency, undefined);
  assert.equal(parseCsv(fixture("compute-two.csv"), { currency: "JPY" }).config.currency, "JPY");
});

test("python-style prices add into price_total and a blank stays uncounted", () => {
  const csv = [
    "date,event,artist,price,alice",
    "2024-01-01,Dot,Northwind,.5,✅",
    "2024-01-02,Trail,Paper Moon,5.,✅",
    "2024-01-03,Exp,Glass Harbor,1e3,✅",
    "2024-01-04,Sci,Lantern Club,1.5e1,✅",
    "2024-01-05,Word,Copper Kite,免费,✅",
  ].join("\n");
  const stats = compute(parseCsv(csv), "2026-10-18");
  const hand = 0.5 + 5 + 1000 + 15;
  assert.equal(hand, 1020.5);
  assert.equal(stats.price_total, hand);
  assert.equal(stats.no_price, 1);
  assert.equal(stats.total, 5);
});

test("a participant column that collides with a stat field is rejected", () => {
  const csv = "date,event,artist,total\n2024-01-01,Show,Northwind,✅\n";
  assert.throws(() => compute(parseCsv(csv), "2026-10-18"), /total/);
});

test("parity CLI prints compute() as JSON", () => {
  const run = spawnSync(
    process.execPath,
    ["tools/parity.mjs", "tests/fixtures/compute-two.csv", "--today", "2026-10-18"],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stderr, "");
  const printed = JSON.parse(run.stdout);
  assert.deepEqual(printed, statsOf("compute-two.csv"));
  assert.equal(printed.price_total, 871.5);
  assert.equal(printed.spend_heads, undefined);

  const missing = spawnSync(process.execPath, ["tools/parity.mjs", "tests/fixtures/compute-two.csv"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /--today/);

  const help = spawnSync(process.execPath, ["tools/parity.mjs", "--help"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--today/);
});

test("compute stays a pure module", () => {
  const source = readFileSync(new URL("../app/compute.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\bdocument\b/);
  assert.doesNotMatch(source, /\bwindow\b/);
  assert.doesNotMatch(source, /papaparse/i);
  assert.doesNotMatch(source, /localeCompare/);
});

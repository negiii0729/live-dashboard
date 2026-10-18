import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { compute } from "../app/compute.js";
import { parseCsv } from "../app/parse.js";
import { collectMismatches, formatMismatchReport } from "../tools/parity.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const today = "2026-10-18";
const csvPath = "tests/fixtures/parity-sample.csv";
const configPath = "tests/fixtures/parity-sample.config.json";
const goldenPath = "tests/fixtures/parity-sample.golden.json";
const mismatchPath = "tests/fixtures/parity-sample.mismatch.json";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function sampleStats() {
  return compute(parseCsv(read(csvPath), JSON.parse(read(configPath))), today);
}

function runParity(args) {
  return spawnSync(process.execPath, ["tools/parity.mjs", ...args], {
    cwd: root,
    encoding: "utf8",
  });
}

test("collectMismatches lists nested paths, missing keys, and extra keys", () => {
  const actual = {
    total: 3,
    city: [["临江", 2]],
    price_total: 240,
    spend: { 东岸: 200, 雾湾: 40 },
  };
  const expected = {
    spend: { 雾湾: 40, 东岸: 1 },
    total: -1,
    city: [["不存在的城市", 2]],
    spend_heads: { 不应出现: 1 },
  };
  const mismatches = collectMismatches(actual, expected);
  const byPath = new Map(mismatches.map((item) => [item.path, item.message]));
  assert.equal(byPath.size, mismatches.length);
  assert.equal(byPath.get("total"), "期望 -1，实际 3");
  assert.equal(byPath.get("city[0][0]"), '期望 "不存在的城市"，实际 "临江"');
  assert.equal(byPath.get("spend.东岸"), "期望 1，实际 200");
  assert.equal(byPath.get("price_total"), "实际有此路径，golden 没有（实际 240）");
  assert.equal(byPath.get("spend_heads"), 'golden 有此路径，实际没有（期望 {"不应出现":1}）');
  assert.equal(byPath.has("spend.雾湾"), false);
  assert.deepEqual(collectMismatches({ b: 1, a: [1, { k: 2 }] }, { a: [1, { k: 2 }], b: 1 }), []);
  assert.equal(collectMismatches([1, 2], [1])[0].path, "[1]");

  const report = formatMismatchReport(mismatches);
  assert.match(report, /^与 golden 不一致（5 处）：/);
  assert.match(report, /^- total：期望 -1，实际 3$/m);
});

test("positional golden compare exits 0 when every field matches", () => {
  const stats = sampleStats();
  const golden = JSON.parse(read(goldenPath));
  assert.equal(stats.total, 3);
  assert.equal(stats.price_total, 240);
  assert.equal(stats.together, 1);
  assert.equal(stats.together_pct, 33.3);
  assert.equal(stats.no_price, 1);
  assert.equal(stats.spend["雾湾"], 40);
  assert.equal(stats.top_art[0][0], "纸灯");
  assert.deepEqual(stats, golden);

  const positional = runParity([csvPath, configPath, today, goldenPath]);
  assert.equal(positional.status, 0, positional.stderr);
  assert.equal(positional.stderr, "");
  assert.equal(positional.stdout, "与 golden 一致\n");

  const flagged = runParity([
    csvPath,
    "--config",
    configPath,
    "--today",
    today,
    "--golden",
    goldenPath,
  ]);
  assert.equal(flagged.status, 0, flagged.stderr);
  assert.equal(flagged.stderr, "");
  assert.equal(flagged.stdout, "与 golden 一致\n");
});

test("positional compare exits non-zero and lists mismatched paths", () => {
  const stats = sampleStats();
  const mismatch = JSON.parse(read(mismatchPath));
  const mismatches = collectMismatches(stats, mismatch);
  const paths = mismatches.map((item) => item.path);
  assert.ok(paths.includes("total"));
  assert.ok(paths.includes("city[0][0]"));
  assert.ok(paths.includes("spend.东岸"));
  assert.ok(paths.includes("price_total"));
  assert.ok(paths.includes("spend_heads"));

  const run = runParity([csvPath, configPath, today, mismatchPath]);
  assert.equal(run.status, 1);
  assert.equal(run.stdout, "");
  assert.equal(run.stderr, `${formatMismatchReport(mismatches)}\n`);
  assert.match(run.stderr, /与 golden 不一致（5 处）/);
  assert.match(run.stderr, /- total：期望 -1，实际 3/);
  assert.match(run.stderr, /- city\[0\]\[0\]：期望 "不存在的城市"/);
  assert.match(run.stderr, /- spend\.东岸：期望 1，实际 /);
  assert.match(run.stderr, /- price_total：实际有此路径，golden 没有/);
  assert.match(run.stderr, /- spend_heads：golden 有此路径，实际没有/);
});

test("omitting golden still prints stats JSON", () => {
  const stats = sampleStats();
  const positional = runParity([csvPath, configPath, today]);
  assert.equal(positional.status, 0, positional.stderr);
  assert.equal(positional.stderr, "");
  assert.deepEqual(JSON.parse(positional.stdout), stats);

  const help = runParity(["--help"]);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /node tools\/parity\.mjs <csv> <config> <today> <golden\.json>/);
  assert.match(help.stdout, /--today/);
  assert.match(help.stdout, /--golden/);
});

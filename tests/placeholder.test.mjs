import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("index.html is a static page with a native module", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /<script type="module">/);
  assert.match(html, /vendor\/echarts-5\.5\.1\.min\.js/);
  assert.match(html, /vendor\/papaparse-5\.7\.0\.min\.js/);
  assert.doesNotMatch(html, /https?:\/\//);
});

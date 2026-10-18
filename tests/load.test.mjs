import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compute } from "../app/compute.js";
import { kpiCards } from "../app/render.js";
import {
  LoadError,
  csvFileNameOk,
  describeLoadedSource,
  loadDashboard,
  loadQueryConfig,
  messageFor,
  resolveResource,
  searchAfterImport,
} from "../app/load.js";
import { parseCsv } from "../app/parse.js";
import { ParseError } from "../app/schema.js";
import { createMemoryStorage } from "../app/storage.js";

const today = "2026-10-18";
const forbiddenNames = new RegExp(
  ["ne", "gi"].join("") + "|" + ["re", "my"].join("") + "|" + ["liv", "es.csv"].join(""),
  "i",
);

function ok(text) {
  return {
    ok: true,
    status: 200,
    text: async () => text,
  };
}

function sampleCsv() {
  return readFileSync(new URL("../examples/sample.csv", import.meta.url), "utf8");
}

test("storage keeps an import until it is cleared", async () => {
  const storage = createMemoryStorage();
  assert.equal(storage.read(), null);
  storage.write({ csv: "date,event\n2024-01-01,Show\n", name: "shows.csv" });
  assert.deepEqual(storage.read(), {
    csv: "date,event\n2024-01-01,Show\n",
    name: "shows.csv",
  });

  const loaded = await loadDashboard({
    search: "",
    storage,
    fetch: async () => {
      throw new Error("should not fetch");
    },
  });
  assert.equal(loaded.source, "import");
  assert.equal(loaded.sample, false);
  assert.equal(loaded.name, "shows.csv");
  assert.match(loaded.csv, /Show/);

  storage.clear();
  assert.equal(storage.read(), null);
  let requested = "";
  const again = await loadDashboard({
    search: "",
    storage,
    sampleUrl: "examples/sample.csv",
    fetch: async (url) => {
      requested = url;
      return ok("date,event\n2024-01-01,Example\n");
    },
  });
  assert.equal(again.source, "sample");
  assert.equal(again.sample, true);
  assert.equal(requested, "examples/sample.csv");
});

test("corrupt storage is ignored and a failed write is reported in Chinese", () => {
  const map = new Map();
  const storage = createMemoryStorage();
  map.set("unused", "1");
  const broken = {
    getItem() {
      return "{";
    },
    setItem() {
      throw new Error("quota");
    },
    removeItem() {},
  };
  return import("../app/storage.js").then(({ createStorage, StorageError }) => {
    const reading = createStorage(broken);
    assert.equal(reading.read(), null);
    assert.throws(() => reading.write({ csv: "a", name: "a.csv" }), (error) => {
      assert.ok(error instanceof StorageError);
      assert.match(error.message, /存不下/);
      return true;
    });
    assert.equal(map.size, 1);
    assert.equal(storage.read(), null);
  });
});

test("?data= beats a saved import, and a relative path is not the example", async () => {
  const storage = createMemoryStorage();
  storage.write({ csv: "date,event\n2024-01-01,Saved\n", name: "saved.csv" });
  const remote = "date,event,artist\n2024-05-01,Remote,Northwind\n";
  const loaded = await loadDashboard({
    search: "?data=https://example.com/shows.csv",
    storage,
    fetch: async (url) => {
      assert.equal(url, "https://example.com/shows.csv");
      return ok(remote);
    },
  });
  assert.equal(loaded.source, "remote");
  assert.equal(loaded.sample, false);
  assert.match(loaded.csv, /Remote/);
  assert.equal(storage.read().name, "saved.csv");

  const relative = await loadDashboard({
    search: "?data=examples/sample.csv",
    storage: createMemoryStorage(),
    fetch: async (url) => {
      assert.equal(url, "examples/sample.csv");
      return ok(sampleCsv());
    },
  });
  assert.equal(relative.source, "data");
  assert.equal(relative.sample, false);
  const notice = describeLoadedSource(relative);
  assert.equal(notice.showGuide, false);
  assert.equal(notice.sample, false);
  assert.equal(notice.label, "当前数据来自 ?data= 链接。");
  assert.doesNotMatch(notice.label, /夹具|虚构|示例/);
});

test("?fixture= overrides a saved import and still rejects a remote path", async () => {
  const storage = createMemoryStorage();
  storage.write({ csv: "date,event\n2024-01-01,Saved\n", name: "saved.csv" });
  const loaded = await loadDashboard({
    search: "?fixture=tests/fixtures/participants-1.csv",
    storage,
    fetch: async (url) => ok(`from:${url}`),
  });
  assert.equal(loaded.source, "fixture");
  assert.equal(loaded.sample, false);
  assert.equal(loaded.csv, "from:tests/fixtures/participants-1.csv");
  assert.equal(storage.read().name, "saved.csv");

  await assert.rejects(
    () =>
      loadDashboard({
        search: "?fixture=https://example.com/shows.csv",
        storage: createMemoryStorage(),
        fetch: async () => ok("nope"),
      }),
    (error) => {
      assert.ok(error instanceof LoadError);
      assert.match(error.message, /fixture 只接受本站上的相对路径/);
      return true;
    },
  );
  assert.throws(() => resolveResource("../secret.csv", "data"), /不能越出本站/);
  assert.throws(() => resolveResource("javascript:alert(1)", "data"), /http、https/);
});

test("?config= aliases change unique_artists and ?today= changes the cutoff", async () => {
  const csv = [
    "date,event,artist,alice",
    "2024-01-01,Show,Copper Kite,✅",
    "2024-02-01,Show,Kite,✅",
    "2024-03-01,Show,Paper Moon,✅",
    "2026-12-01,Later,Lantern Club,✅",
  ].join("\n");
  const config = JSON.stringify({
    schema: 1,
    title: "Alias Desk",
    aliases: { Kite: "Copper Kite" },
  });
  const loaded = await loadDashboard({
    search: "?data=https://example.com/shows.csv&config=https://example.com/config.json&today=2026-10-18",
    storage: createMemoryStorage(),
    fetch: async (url) => ok(String(url).includes("config") ? config : csv),
  });
  assert.equal(loaded.sample, false);
  assert.equal(loaded.today, today);
  const parsed = parseCsv(loaded.csv, loaded.config);
  const stats = compute(parsed, loaded.today);
  assert.equal(parsed.config.title, "Alias Desk");
  assert.equal(stats.unique_artists, 2);
  assert.equal(stats.upcoming, 1);
  const plain = compute(parseCsv(csv), today);
  assert.equal(plain.unique_artists, 3);

  const earlier = await loadDashboard({
    search: "?today=2020-01-01",
    storage: createMemoryStorage(),
    fetch: async () => ok(csv),
  });
  assert.equal(earlier.source, "sample");
  assert.equal(earlier.sample, true);
  const earlyStats = compute(parseCsv(earlier.csv, earlier.config), earlier.today);
  assert.equal(earlyStats.total, 0);
  assert.equal(earlyStats.today, "2020-01-01");
});

test("404, a blocked cross-origin read, and a bad csv each have a Chinese message", async () => {
  await assert.rejects(
    () =>
      loadDashboard({
        search: "?data=https://example.com/missing.csv",
        storage: createMemoryStorage(),
        fetch: async () => ({ ok: false, status: 404, text: async () => "missing" }),
      }),
    (error) => {
      assert.ok(error instanceof LoadError);
      assert.match(error.message, /没有找到这份数据/);
      assert.match(error.message, /404/);
      assert.doesNotMatch(error.message, /Failed to fetch/);
      return true;
    },
  );

  await assert.rejects(
    () =>
      loadDashboard({
        search: "?config=https://example.com/missing.json",
        storage: createMemoryStorage(),
        fetch: async () => ({ ok: false, status: 404, text: async () => "" }),
      }),
    (error) => {
      assert.match(error.message, /没有找到这份配置/);
      assert.match(error.message, /404/);
      return true;
    },
  );

  await assert.rejects(
    () =>
      loadDashboard({
        search: "?data=https://example.com/blocked.csv",
        storage: createMemoryStorage(),
        fetch: async () => {
          throw new TypeError("Failed to fetch");
        },
      }),
    (error) => {
      assert.match(error.message, /跨域/);
      assert.match(error.message, /无法读取/);
      assert.doesNotMatch(error.message, /Failed to fetch/);
      return true;
    },
  );

  const bad = 'date,event\n2024-01-01,E,"unterminated\nbad,E,B\n';
  assert.throws(
    () => parseCsv(bad),
    (error) => {
      const text = messageFor(error);
      assert.match(text, /这份 CSV 没有通过校验/);
      assert.match(text, /第 2 行：引号没有闭合/);
      assert.ok(text.trim().length > 0);
      return true;
    },
  );

  const badDate = messageFor(
    new ParseError([{ line: 4, code: "bad_date", message: "日期「2024/02/02」不是 YYYY-MM-DD" }]),
  );
  assert.match(badDate, /这份 CSV 没有通过校验/);
  assert.match(badDate, /第 4 行/);

  await assert.rejects(
    () =>
      loadDashboard({
        search: "?today=2026/10/18",
        storage: createMemoryStorage(),
        fetch: async () => ok("date,event\n"),
      }),
    (error) => {
      assert.match(messageFor(error), /YYYY-MM-DD/);
      return true;
    },
  );

  await assert.rejects(
    () =>
      loadDashboard({
        search: "?config=https://example.com/config.json",
        storage: createMemoryStorage(),
        fetch: async () => ok("{"),
      }),
    (error) => {
      assert.match(error.message, /不是合法的 JSON/);
      return true;
    },
  );
});

test("?config= applies price_mode and currency to the fictional sample", async () => {
  const csv = sampleCsv();
  const config = readFileSync(new URL("../examples/config.json", import.meta.url), "utf8");
  const loaded = await loadDashboard({
    search: "?data=examples/sample.csv&config=examples/config.json&today=2026-10-18",
    storage: createMemoryStorage(),
    fetch: async (url) => ok(String(url).endsWith("config.json") ? config : csv),
  });
  const parsed = parseCsv(loaded.csv, loaded.config);
  const stats = compute(parsed, loaded.today);
  assert.equal(parsed.config.priceMode, "per_person");
  assert.equal(parsed.config.currency, "CNY");
  assert.deepEqual(
    parsed.participants.map((person) => person.label),
    ["Alice", "Bob"],
  );
  // 与 compute-two 的到场场次相同：两人 200、150.5、300、0，一人 80、60、10.5、10.5、40、20。
  const hand = 200 * 2 + 150.5 * 2 + 80 + 60 + 300 * 2 + 10.5 + 10.5 + 40 + 20 + 0 * 2;
  assert.equal(hand, 1522);
  assert.equal(stats.price_total, hand);
  const price = kpiCards(stats, parsed.participants, { currency: parsed.config.currency }).find(
    (card) => card.key === "price",
  );
  assert.equal(price.value, "¥1,522");
  assert.equal(price.hint, "1 场无票价未计");

  const usdFile = readFileSync(new URL("./fixtures/currency-usd.json", import.meta.url), "utf8");
  const usdLoaded = await loadDashboard({
    search: "?data=examples/sample.csv&config=tests/fixtures/currency-usd.json&today=2026-10-18",
    storage: createMemoryStorage(),
    fetch: async (url) => ok(String(url).includes("currency-usd") ? usdFile : csv),
  });
  const usdParsed = parseCsv(usdLoaded.csv, usdLoaded.config);
  const usdStats = compute(usdParsed, usdLoaded.today);
  assert.equal(usdStats.price_total, 871.5);
  const usdPrice = kpiCards(usdStats, usdParsed.participants, {
    currency: usdParsed.config.currency,
  }).find((card) => card.key === "price");
  assert.equal(usdPrice.value, "$872");

  const bad = readFileSync(new URL("./fixtures/bad-price-mode.json", import.meta.url), "utf8");
  await assert.rejects(
    () =>
      loadDashboard({
        search: "?config=tests/fixtures/bad-price-mode.json",
        storage: createMemoryStorage(),
        fetch: async () => ok(bad),
      }),
    (error) => {
      const text = messageFor(error);
      assert.match(text, /配置没有通过校验/);
      assert.match(text, /未知的 price_mode「heads」/);
      assert.match(text, /只接受 total 或 per_person/);
      assert.doesNotMatch(text, /按人头/);
      return true;
    },
  );
});

test("a failed load is not described as a fictional sample", () => {
  const failed = describeLoadedSource(null);
  assert.equal(failed.showGuide, false);
  assert.equal(failed.sample, false);
  assert.doesNotMatch(failed.label, /虚构示例|下面是一份/);

  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const showError = html.slice(html.indexOf("function showError"), html.indexOf("function syncChrome"));
  assert.match(showError, /guide\.hidden = true/);
  assert.doesNotMatch(showError, /虚构示例/);
  assert.doesNotMatch(html, /guide\.hidden = false/);

  const sample = describeLoadedSource({ source: "sample", sample: true });
  assert.equal(sample.showGuide, true);
  assert.match(sample.label, /内置示例/);
  const fixture = describeLoadedSource({ source: "fixture", sample: false });
  assert.match(fixture.label, /夹具/);
  assert.equal(fixture.showGuide, false);
});

test("a relative ?data= 404 is not called a fixture", async () => {
  await assert.rejects(
    () =>
      loadDashboard({
        search: "?data=examples/missing.csv",
        storage: createMemoryStorage(),
        fetch: async () => ({ ok: false, status: 404, text: async () => "" }),
      }),
    (error) => {
      assert.match(error.message, /没有找到这份数据/);
      assert.doesNotMatch(error.message, /夹具|虚构示例/);
      return true;
    },
  );
});

test("a local import with ?config= loads that config for validation and for the saved view", async () => {
  const csv = [
    "date,event,artist,price,alice,bob",
    "2024-01-01,Show,Copper Kite,100,✅,✅",
    "2024-02-01,Show,Kite,50,✅,",
  ].join("\n");
  const config = JSON.stringify({
    schema: 1,
    title: "Imported Desk",
    price_mode: "per_person",
    currency: "USD",
    artist_aliases: { Kite: "Copper Kite" },
    people: [{ column: "alice", label: "Alice" }, { column: "bob", label: "Bob" }],
  });
  const search = "?data=https://example.com/old.csv&config=https://example.com/config.json&today=2026-10-18";
  const fetched = [];
  const fetchConfig = async (url) => {
    fetched.push(String(url));
    assert.match(String(url), /config\.json$/);
    return ok(config);
  };

  const loadedConfig = await loadQueryConfig({ search, fetch: fetchConfig });
  const checked = parseCsv(csv, loadedConfig);
  assert.equal(checked.config.priceMode, "per_person");
  assert.equal(checked.config.currency, "USD");
  assert.equal(checked.config.title, "Imported Desk");
  assert.deepEqual(
    checked.participants.map((person) => person.label),
    ["Alice", "Bob"],
  );

  const strict = await loadQueryConfig({
    search: "?config=https://example.com/strict.json",
    fetch: async () =>
      ok(JSON.stringify({ people: [{ column: "zoe", label: "Zoe" }] })),
  });
  assert.throws(
    () => parseCsv(csv, strict),
    (error) => {
      const text = messageFor(error);
      assert.match(text, /配置没有通过校验/);
      assert.match(text, /zoe/);
      return true;
    },
  );

  const storage = createMemoryStorage();
  storage.write({ csv, name: "local.csv" });
  const next = searchAfterImport(search);
  assert.doesNotMatch(next, /(?:^|[?&])data=/);
  assert.doesNotMatch(next, /fixture=/);
  assert.doesNotMatch(next, /vault=/);
  assert.match(next, /config=/);
  assert.match(next, /today=2026-10-18/);

  const viewed = await loadDashboard({
    search: next,
    storage,
    fetch: fetchConfig,
  });
  assert.equal(viewed.source, "import");
  assert.equal(viewed.sample, false);
  assert.equal(viewed.name, "local.csv");
  const parsed = parseCsv(viewed.csv, viewed.config);
  const stats = compute(parsed, viewed.today);
  assert.equal(stats.unique_artists, 1);
  assert.equal(stats.price_total, 250);
  const price = kpiCards(stats, parsed.participants, { currency: parsed.config.currency }).find(
    (card) => card.key === "price",
  );
  assert.equal(price.value, "$250");
  assert.equal(describeLoadedSource(viewed).showGuide, false);
  assert.doesNotMatch(describeLoadedSource(viewed).label, /夹具|虚构|示例/);
  assert.ok(fetched.length >= 2);

  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const importFn = html.slice(html.indexOf("async function importFile"), html.indexOf("pickButton.addEventListener"));
  assert.match(importFn, /loadQueryConfig/);
  assert.match(importFn, /params\.has\("config"\)/);
  assert.match(importFn, /parseCsv\(csv, config\)/);
  assert.match(importFn, /searchAfterImport|rememberImport/);
});

test("csv file names and the loading sources stay generic", () => {
  assert.equal(csvFileNameOk("shows.csv"), true);
  assert.equal(csvFileNameOk("Shows.CSV"), true);
  assert.equal(csvFileNameOk(""), true);
  assert.equal(csvFileNameOk("notes.txt"), false);
  assert.equal(csvFileNameOk("sheet.xlsx"), false);

  const blob = ["../app/load.js", "../app/storage.js", "../index.html", "../README.md"]
    .map((file) => readFileSync(new URL(file, import.meta.url), "utf8"))
    .join("\n");
  assert.doesNotMatch(blob, forbiddenNames);
  assert.match(readFileSync(new URL("../README.md", import.meta.url), "utf8"), /\?fixture=/);
  assert.match(readFileSync(new URL("../README.md", import.meta.url), "utf8"), /localStorage/);
});

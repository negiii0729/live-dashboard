import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compute } from "../app/compute.js";
import {
  LoadError,
  csvFileNameOk,
  loadDashboard,
  messageFor,
  resolveResource,
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
  assert.equal(relative.source, "fixture");
  assert.equal(relative.sample, false);
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

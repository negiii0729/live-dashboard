import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compute } from "../app/compute.js";
import {
  fetchVaultDocument,
  loadDashboard,
  messageFor,
} from "../app/load.js";
import { parseCsv } from "../app/parse.js";
import { createMemoryStorage } from "../app/storage.js";
import {
  STALE_REMEMBERED_PASSWORD,
  decryptVault,
  parseVault,
  unlockRememberedVault,
} from "../app/vault.js";

const today = "2026-10-18";
const password = "test-pass";
const csvUrl = new URL("./fixtures/vault-source.csv", import.meta.url);
const configUrl = new URL("./fixtures/vault-source.config.json", import.meta.url);
const vaultUrl = new URL("./fixtures/vault-test.json", import.meta.url);

function ok(text) {
  return { ok: true, status: 200, text: async () => text };
}

function csvText() {
  return readFileSync(csvUrl, "utf8");
}

function configText() {
  return readFileSync(configUrl, "utf8");
}

function vaultText() {
  return readFileSync(vaultUrl, "utf8");
}

test("decrypting the fixture restores the csv bytes, config, and compute() KPIs", { timeout: 120_000 }, async () => {
  const sourceCsv = csvText();
  const sourceConfig = JSON.parse(configText());
  const calls = [];
  let sawNetwork = false;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = () => {
    sawNetwork = true;
    throw new Error("decrypt must not fetch");
  };
  try {
    const doc = await fetchVaultDocument({
      search: `?vault=tests/fixtures/vault-test.json&unused=${password}&today=${today}`,
      fetch: async (url, init) => {
        calls.push({ url: String(url), init });
        assert.equal(init, undefined);
        assert.equal(url, "tests/fixtures/vault-test.json");
        assert.doesNotMatch(String(url), /test-pass/);
        return ok(vaultText());
      },
    });
    assert.equal(calls.length, 1);
    assert.equal(JSON.stringify(calls).includes(password), false);
    assert.equal(doc.today, today);
    assert.equal(doc.vault.v, 1);
    assert.equal(doc.vault.kdf, "PBKDF2-SHA256");
    assert.ok(doc.vault.iter >= 310000);

    const opened = await decryptVault(doc.vault, password, webcrypto);
    assert.equal(sawNetwork, false);
    assert.equal(opened.csv, sourceCsv);
    assert.deepEqual(Buffer.from(opened.csv, "utf8"), readFileSync(csvUrl));
    assert.deepEqual(opened.config, sourceConfig);
    assert.equal(JSON.stringify(opened.config), JSON.stringify(sourceConfig));

    const fromVault = compute(parseCsv(opened.csv, opened.config), today);
    const fromPlain = compute(parseCsv(sourceCsv, sourceConfig), today);
    assert.deepEqual(fromVault, fromPlain);
    assert.equal(fromVault.total, 3);
    assert.equal(fromVault.together, 1);
    assert.equal(fromVault.price_total, 290.5);
    assert.equal(fromVault.unique_artists, 4);
    assert.equal(fromVault.upcoming, 1);
    assert.equal(fromVault.undated, 1);
    assert.ok(fromVault.top_art.some((item) => item[0] === "North Wind"));
    assert.ok(fromVault.top_art.some((item) => item[0] === "玻璃港"));
    assert.equal(fromPlain.alice, 2);
    assert.equal(fromPlain.bob, 2);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("a wrong password throws the 密码不对 path", { timeout: 120_000 }, async () => {
  const vault = parseVault(vaultText());
  await assert.rejects(
    () => decryptVault(vault, "wrong-pass", webcrypto),
    (error) => {
      assert.equal(error.name, "VaultError");
      assert.equal(error.code, "bad_password");
      assert.equal(error.message, "密码不对");
      assert.equal(messageFor(error), "密码不对");
      assert.doesNotMatch(error.message, /OperationError|decrypt/i);
      return true;
    },
  );
});

test("vault fetch errors stay in Chinese and the password is not sent", async () => {
  const passwordInPage = "test-pass";
  await assert.rejects(
    () =>
      fetchVaultDocument({
        search: `?vault=https://example.com/missing.json&unused=${passwordInPage}`,
        fetch: async (url, init) => {
          assert.equal(url, "https://example.com/missing.json");
          assert.equal(init, undefined);
          assert.equal(JSON.stringify({ url, init }).includes(passwordInPage), false);
          return { ok: false, status: 404, text: async () => "missing" };
        },
      }),
    (error) => {
      assert.match(messageFor(error), /没有找到这份加密数据/);
      assert.match(error.message, /404/);
      assert.doesNotMatch(error.message, /Failed to fetch/);
      return true;
    },
  );

  await assert.rejects(
    () =>
      fetchVaultDocument({
        search: "?vault=https://example.com/blocked.json",
        fetch: async () => {
          throw new TypeError("Failed to fetch");
        },
      }),
    (error) => {
      assert.match(messageFor(error), /加密数据无法读取/);
      assert.match(error.message, /跨域/);
      assert.doesNotMatch(error.message, /Failed to fetch/);
      return true;
    },
  );

  await assert.rejects(
    () =>
      fetchVaultDocument({
        search: "?vault=https://example.com/vault.json",
        fetch: async () => ok("not-json"),
      }),
    (error) => {
      assert.equal(messageFor(error), "加密数据不是合法的 JSON。");
      return true;
    },
  );

  await assert.rejects(
    () =>
      fetchVaultDocument({
        search: "?vault=https://example.com/vault.json",
        fetch: async () => ok(JSON.stringify({ v: 2, kdf: "PBKDF2-SHA256" })),
      }),
    (error) => {
      assert.equal(messageFor(error), "这份加密数据的版本不受支持。");
      return true;
    },
  );

  await assert.rejects(
    () =>
      fetchVaultDocument({
        search: "?vault=https://example.com/vault.json",
        fetch: async () => ok(JSON.stringify({ v: 1, kdf: "scrypt", iter: 310000 })),
      }),
    (error) => {
      assert.equal(messageFor(error), "这份加密数据的密钥算法不受支持。");
      return true;
    },
  );

  await assert.rejects(
    () =>
      fetchVaultDocument({
        search: "?vault=https://example.com/vault.json",
        fetch: async () =>
          ok(JSON.stringify({ v: 1, kdf: "PBKDF2-SHA256", iter: 1000, salt: "AA==", iv: "AA==", ct: "AA==" })),
      }),
    (error) => {
      assert.equal(messageFor(error), "这份加密数据的迭代次数不受支持。");
      return true;
    },
  );

  await assert.rejects(
    () => fetchVaultDocument({ search: "?vault=", fetch: async () => ok("{}") }),
    (error) => {
      assert.match(messageFor(error), /\?vault=/);
      return true;
    },
  );
});

test("?data= is unchanged when a vault parameter is also present", async () => {
  const calls = [];
  const loaded = await loadDashboard({
    search: "?data=https://example.com/shows.csv&vault=https://example.com/vault.json",
    storage: createMemoryStorage(),
    fetch: async (url) => {
      calls.push(String(url));
      return ok("date,event\n2024-01-01,Plain\n");
    },
  });
  assert.equal(loaded.source, "remote");
  assert.equal(loaded.sample, false);
  assert.match(loaded.csv, /Plain/);
  assert.deepEqual(calls, ["https://example.com/shows.csv"]);
});

test("remembered vault password is removed by clear", () => {
  const storage = createMemoryStorage();
  storage.write({ csv: "date,event\n2024-01-01,Show\n", name: "shows.csv" });
  storage.writeVaultPassword({ url: "tests/fixtures/vault-test.json", password });
  assert.deepEqual(storage.readVaultPassword(), {
    url: "tests/fixtures/vault-test.json",
    password,
  });
  storage.clear();
  assert.equal(storage.read(), null);
  assert.equal(storage.readVaultPassword(), null);

  const broken = {
    getItem() {
      return "{";
    },
    setItem() {},
    removeItem() {},
  };
  return import("../app/storage.js").then(({ createStorage }) => {
    assert.equal(createStorage(broken).readVaultPassword(), null);
  });
});

test("a remembered password that cannot decrypt is deleted", { timeout: 120_000 }, async () => {
  const storage = createMemoryStorage();
  const url = "tests/fixtures/vault-test.json";
  const secret = "SECRETX";
  storage.writeVaultPassword({ url, password: secret });
  const failed = await unlockRememberedVault(
    parseVault(vaultText()),
    storage.readVaultPassword().password,
    storage,
    webcrypto,
  );
  assert.equal(failed.ok, false);
  assert.equal(failed.message, STALE_REMEMBERED_PASSWORD);
  assert.match(failed.message, /之前记住的密码已经打不开/);
  assert.match(failed.message, /已从这台浏览器里删掉/);
  assert.equal(failed.message.includes(secret), false);
  assert.equal(storage.readVaultPassword(), null);

  storage.writeVaultPassword({ url, password });
  const opened = await unlockRememberedVault(
    parseVault(vaultText()),
    storage.readVaultPassword().password,
    storage,
    webcrypto,
  );
  assert.equal(opened.ok, true);
  assert.equal(opened.opened.csv, csvText());
  assert.equal(storage.readVaultPassword().password, password);
});

test("a remembered password stays when this browser cannot decrypt", async () => {
  const storage = createMemoryStorage();
  const secret = "SECRETX";
  storage.writeVaultPassword({ url: "tests/fixtures/vault-test.json", password: secret });
  await assert.rejects(
    () =>
      unlockRememberedVault(parseVault(vaultText()), storage.readVaultPassword().password, storage, {}),
    (error) => {
      assert.equal(error.code, "no_crypto");
      return true;
    },
  );
  assert.equal(storage.readVaultPassword().password, secret);
});

test("the page drops a remembered password that cannot open the vault", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const vault = readFileSync(new URL("../app/vault.js", import.meta.url), "utf8");
  assert.match(html, /unlockRememberedVault\(/);
  assert.match(html, /showPasswordForm\(\s*remembered\.message/);
  assert.doesNotMatch(html, /unlockVault\(\s*saved\.password/);
  assert.match(vault, /clearVaultPassword\(\)/);
  assert.match(vault, /之前记住的密码已经打不开这份数据，已从这台浏览器里删掉/);
  assert.equal(vault.includes("SECRETX"), false);
});

test("the page asks for a password locally and does not put it on a request", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const vault = readFileSync(new URL("../app/vault.js", import.meta.url), "utf8");
  const load = readFileSync(new URL("../app/load.js", import.meta.url), "utf8");
  assert.match(html, /记住密码/);
  assert.match(html, /输入密码/);
  assert.match(html, /fetchVaultDocument/);
  assert.match(html, /decryptVault/);
  assert.match(html, /preventDefault/);
  assert.match(html, /id = "vault-password"/);
  assert.doesNotMatch(html, /https?:\/\//);
  assert.doesNotMatch(html, /searchParams\.set\(\s*["']password/);
  assert.doesNotMatch(html, /fetch\s*\(/);
  assert.match(vault, /密码不对/);
  assert.match(load, /fetchImpl\(target\.url\)/);
  assert.doesNotMatch(load, /password/);
});

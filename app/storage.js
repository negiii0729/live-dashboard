/**
 * 把导入的 CSV 存在浏览器里。页面用 localStorage；测试可以换成内存实现。
 * 只存表格原文和文件名，不存统计结果。
 * 记住的 vault 密码另存一把钥匙。「清除数据」会连密码一起删掉。
 */

const KEY = "live-dashboard.import.v1";
const VAULT_PASSWORD_KEY = "live-dashboard.vault-password.v1";

export class StorageError extends Error {
  constructor(message) {
    super(message);
    this.name = "StorageError";
  }
}

export function createMemoryStorage() {
  const map = new Map();
  return createStorage({
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
  });
}

export function createBrowserStorage() {
  let store;
  try {
    store = globalThis.localStorage;
  } catch {
    store = null;
  }
  if (!store || typeof store.getItem !== "function") {
    throw new StorageError("这台浏览器不能在本地保存表格。");
  }
  return createStorage(store);
}

export function createStorage(store) {
  return {
    read() {
      let raw;
      try {
        raw = store.getItem(KEY);
      } catch {
        return null;
      }
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed.csv !== "string") return null;
        return {
          csv: parsed.csv,
          name: typeof parsed.name === "string" ? parsed.name : "",
        };
      } catch {
        return null;
      }
    },
    write(record) {
      if (record == null || typeof record.csv !== "string") {
        throw new StorageError("没有可以保存的表格内容。");
      }
      const payload = JSON.stringify({
        csv: record.csv,
        name: typeof record.name === "string" ? record.name : "",
      });
      try {
        store.setItem(KEY, payload);
      } catch {
        throw new StorageError("浏览器存不下这份表。可以先点「清除数据」，或改用 ?data= 链接打开。");
      }
    },
    readVaultPassword() {
      let raw;
      try {
        raw = store.getItem(VAULT_PASSWORD_KEY);
      } catch {
        return null;
      }
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed.password !== "string" || typeof parsed.url !== "string") return null;
        return { url: parsed.url, password: parsed.password };
      } catch {
        return null;
      }
    },
    writeVaultPassword(record) {
      if (record == null || typeof record.password !== "string" || typeof record.url !== "string") {
        throw new StorageError("没有可以保存的密码。");
      }
      try {
        store.setItem(
          VAULT_PASSWORD_KEY,
          JSON.stringify({ url: record.url, password: record.password }),
        );
      } catch {
        throw new StorageError("浏览器存不下这个密码。可以先点「清除数据」。");
      }
    },
    clearVaultPassword() {
      try {
        store.removeItem(VAULT_PASSWORD_KEY);
      } catch {
        throw new StorageError("没有清除掉保存在浏览器里的密码。");
      }
    },
    clear() {
      try {
        store.removeItem(KEY);
        store.removeItem(VAULT_PASSWORD_KEY);
      } catch {
        throw new StorageError("没有清除掉保存在浏览器里的表格。");
      }
    },
  };
}

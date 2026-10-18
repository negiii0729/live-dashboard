/**
 * 解开 vault.json。密钥派生和 AES-GCM 都在本地 WebCrypto 里完成，不发网络请求。
 * 文件格式与 tools/encrypt_vault.py 相同：PBKDF2-SHA256，再 AES-256-GCM。
 */

export const MIN_ITERATIONS = 310000;
export const VAULT_VERSION = 1;
export const VAULT_KDF = "PBKDF2-SHA256";

export class VaultError extends Error {
  constructor(message, extra = {}) {
    super(message);
    this.name = "VaultError";
    this.code = extra.code || "vault";
  }
}

function stripBom(text) {
  const value = String(text ?? "");
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

function decodeBase64(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/**
 * 读 vault.json 文本，检查版本、算法和字段长度。不派生密钥。
 * @returns {{ v: number, kdf: string, iter: number, salt: Uint8Array, iv: Uint8Array, ct: Uint8Array }}
 */
export function parseVault(text) {
  let value;
  try {
    value = JSON.parse(stripBom(text));
  } catch {
    throw new VaultError("加密数据不是合法的 JSON。", { code: "bad_json" });
  }
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new VaultError("加密数据不是合法的 JSON。", { code: "bad_json" });
  }
  if (value.v !== VAULT_VERSION) {
    throw new VaultError("这份加密数据的版本不受支持。", { code: "bad_version" });
  }
  if (value.kdf !== VAULT_KDF) {
    throw new VaultError("这份加密数据的密钥算法不受支持。", { code: "bad_kdf" });
  }
  if (!Number.isSafeInteger(value.iter) || value.iter < MIN_ITERATIONS) {
    throw new VaultError("这份加密数据的迭代次数不受支持。", { code: "bad_iter" });
  }
  const salt = decodeBase64(value.salt);
  const iv = decodeBase64(value.iv);
  const ct = decodeBase64(value.ct);
  if (!salt || salt.length !== 16 || !iv || iv.length !== 12 || !ct || ct.length < 16) {
    throw new VaultError("这份加密数据的格式不对。", { code: "bad_format" });
  }
  return {
    v: VAULT_VERSION,
    kdf: VAULT_KDF,
    iter: value.iter,
    salt,
    iv,
    ct,
  };
}

function requireCrypto(provided) {
  const crypto = provided ?? globalThis.crypto;
  if (!crypto?.subtle || typeof crypto.subtle.importKey !== "function") {
    throw new VaultError("这台浏览器不能在本地解密。", { code: "no_crypto" });
  }
  return crypto;
}

function readPayload(bytes) {
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new VaultError("解密后的内容不是可用的观演数据。", { code: "bad_payload" });
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new VaultError("解密后的内容不是可用的观演数据。", { code: "bad_payload" });
  }
  if (
    value == null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    typeof value.csv !== "string" ||
    (value.config != null && (typeof value.config !== "object" || Array.isArray(value.config)))
  ) {
    throw new VaultError("解密后的内容不是可用的观演数据。", { code: "bad_payload" });
  }
  return { csv: value.csv, config: value.config ?? null };
}

/**
 * 用密码解开 parseVault 的结果。错密码抛出 message 为「密码不对」的 VaultError。
 * 不访问网络。
 * @param {ReturnType<typeof parseVault>} vault
 * @param {string} password
 * @param {Crypto} [cryptoImpl]
 */
export async function decryptVault(vault, password, cryptoImpl) {
  if (typeof password !== "string") {
    throw new VaultError("密码不对", { code: "bad_password" });
  }
  const crypto = requireCrypto(cryptoImpl);
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  const key = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: vault.salt,
      iterations: vault.iter,
      hash: "SHA-256",
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
  let plain;
  try {
    plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: vault.iv, tagLength: 128 },
      key,
      vault.ct,
    );
  } catch {
    throw new VaultError("密码不对", { code: "bad_password" });
  }
  return readPayload(plain);
}

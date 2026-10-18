/**
 * 决定这一次打开页面用哪份表。
 * loadDashboard 的优先级：?data= ，?fixture= ，浏览器里保存的导入，内置示例。
 * ?vault= 不在 loadDashboard 里解密。页面用 fetchVaultDocument 取 vault.json，
 * 再在本地解开。地址里同时有 ?data= 和 ?vault= 时，仍走 ?data=。
 * ?config= 和 ?today= 套在选中的表上，本地导入也先读 ?config=。
 * 示例与否只看数据来源：只有落到内置示例才标成示例。
 * 同源相对路径的 ?data= 不是夹具，也不标成示例。
 */

import { ParseError, normalizeConfig, parseDate } from "./schema.js";
import { VaultError, parseVault } from "./vault.js";

export class LoadError extends Error {
  constructor(message, extra = {}) {
    super(message);
    this.name = "LoadError";
    this.code = extra.code || "load";
    this.status = extra.status ?? null;
  }
}

const CONFIG_CODES = new Set([
  "bad_config",
  "bad_schema",
  "bad_price_mode",
  "bad_currency",
  "unknown_participant",
  "duplicate_participant",
]);

export function csvFileNameOk(name) {
  if (!name) return true;
  return /\.csv$/i.test(String(name));
}

export function excelFileNameOk(name) {
  const text = String(name ?? "");
  return /\.xlsx$/i.test(text) || /\.xls$/i.test(text);
}

export function importFileNameOk(name) {
  if (!name) return true;
  return csvFileNameOk(name) || excelFileNameOk(name);
}

/**
 * CSV 直接读文本。Excel 才动态加载 app/xlsx.js，再由它加载 vendor 里的 SheetJS。
 * @param {{ name?: string, text?: () => Promise<string>, arrayBuffer?: () => Promise<ArrayBuffer> }} file
 * @param {{ config?: object | null, loadXlsxModule?: () => Promise<{ workbookToCsv: Function }>, loadXlsx?: () => Promise<object> }} [options]
 */
export async function readImportFile(file, options = {}) {
  if (!file) throw new LoadError("没有拿到文件。");
  const name = file.name || "";
  if (excelFileNameOk(name)) {
    const loadModule = options.loadXlsxModule ?? (() => import("./xlsx.js"));
    let mod;
    try {
      mod = await loadModule();
    } catch {
      throw new LoadError("没有载入 Excel 解析库。");
    }
    const workbookToCsv = mod?.workbookToCsv ?? mod?.default?.workbookToCsv;
    if (typeof workbookToCsv !== "function") {
      throw new LoadError("没有载入 Excel 解析库。");
    }
    let bytes;
    try {
      bytes = await file.arrayBuffer();
    } catch {
      throw new LoadError("没有读到这个文件。");
    }
    return workbookToCsv(bytes, {
      config: options.config ?? null,
      loadXlsx: options.loadXlsx,
    });
  }
  if (csvFileNameOk(name)) {
    try {
      return await file.text();
    } catch {
      throw new LoadError("没有读到这个文件。");
    }
  }
  throw new LoadError("请导入 CSV 或 Excel（.xlsx / .xls）文件。");
}

export function messageFor(error) {
  if (error instanceof LoadError || error instanceof VaultError) return error.message;
  if (error?.name === "StorageError") return error.message;
  if (error?.name === "WorkbookError") return error.message;
  if (error?.name === "ParseError") {
    const aboutConfig = error.errors?.some((item) => CONFIG_CODES.has(item.code));
    const lead = aboutConfig ? "配置没有通过校验。" : "这份 CSV 没有通过校验。";
    return `${lead}\n${error.message}`;
  }
  if (error instanceof Error && error.message) return `页面没有渲染出来：${error.message}`;
  return "页面没有渲染出来。";
}

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * 远程地址只接受 http 和 https。本站路径不能以 / 开头，也不能包含 ..。
 * fixture 不能指向别的网站。
 */
export function resolveResource(value, role) {
  const text = String(value ?? "").trim();
  if (!text) {
    throw new LoadError(emptyMessage(role), { code: "empty" });
  }
  let parsed = null;
  try {
    parsed = new URL(text);
  } catch {
    parsed = null;
  }
  if (parsed && /^https?:$/.test(parsed.protocol)) {
    if (role === "fixture") {
      throw new LoadError("fixture 只接受本站上的相对路径。", { code: "bad_path" });
    }
    return { url: text, remote: true };
  }
  if (parsed) {
    throw new LoadError(schemeMessage(role), { code: "bad_scheme" });
  }
  if (!/^[A-Za-z0-9_./-]+$/.test(text) || text.startsWith("/") || text.includes("..")) {
    throw new LoadError(relativeMessage(role), { code: "bad_path" });
  }
  return { url: text, remote: false };
}

function emptyMessage(role) {
  if (role === "data") return "?data= 后面没有地址。";
  if (role === "config") return "?config= 后面没有地址。";
  if (role === "vault") return "?vault= 后面没有地址。";
  if (role === "today") return "?today= 后面没有日期。";
  return "fixture 后面没有路径。";
}

function schemeMessage(role) {
  if (role === "config") return "配置链接只接受 http、https，或本站相对路径。";
  if (role === "vault") return "加密数据的链接只接受 http、https，或本站相对路径。";
  return "数据链接只接受 http、https，或本站相对路径。";
}

function relativeMessage(role) {
  if (role === "fixture") return "fixture 只接受本站上的相对路径。";
  if (role === "config") return "配置的相对路径不能越出本站。";
  if (role === "vault") return "加密数据的相对路径不能越出本站。";
  return "数据的相对路径不能越出本站。";
}

export function parseConfigText(text) {
  let value;
  try {
    value = JSON.parse(stripBom(String(text ?? "")));
  } catch {
    throw new LoadError("配置文件不是合法的 JSON。", { code: "bad_json" });
  }
  try {
    normalizeConfig(value);
  } catch (error) {
    if (error instanceof ParseError) throw error;
    throw error;
  }
  return value;
}

function resolveToday(value) {
  if (value == null) return undefined;
  const text = String(value).trim();
  if (!text) throw new LoadError(emptyMessage("today"), { code: "bad_today" });
  const checked = parseDate(text);
  if (!checked.ok || checked.date == null) {
    throw new LoadError(`截止日期 ?today= 必须是 YYYY-MM-DD，收到「${text}」。`, {
      code: "bad_today",
    });
  }
  return checked.date;
}

function networkMessage(role) {
  if (role === "config") return "配置链接无法读取：浏览器拦截了跨域请求。";
  if (role === "fixture") return "没有读到这个夹具：浏览器拦截了请求。";
  if (role === "sample") return "没有读到示例数据。";
  if (role === "vault") return "加密数据无法读取：浏览器拦截了跨域请求。";
  return "数据链接无法读取：浏览器拦截了跨域请求。请换一个允许网页直接读取的公开 CSV，例如 GitHub 上的 raw 文件。";
}

function httpMessage(role, status) {
  if (status === 404) {
    if (role === "config") return "没有找到这份配置（HTTP 404）。请检查 ?config= 的地址。";
    if (role === "fixture") return "没有找到这个夹具（HTTP 404）。";
    if (role === "sample") return "没有找到示例数据（HTTP 404）。";
    if (role === "vault") return "没有找到这份加密数据（HTTP 404）。请检查 ?vault= 的地址。";
    return "没有找到这份数据（HTTP 404）。请检查 ?data= 的地址。";
  }
  const code = status ? `（HTTP ${status}）` : "";
  if (role === "config") return `读取配置失败${code}。`;
  if (role === "fixture") return `读取夹具失败${code}。`;
  if (role === "sample") return `读取示例数据失败${code}。`;
  if (role === "vault") return `读取加密数据失败${code}。`;
  return `读取数据失败${code}。`;
}

async function fetchText(fetchImpl, target, role) {
  let response;
  try {
    response = await fetchImpl(target.url);
  } catch {
    throw new LoadError(networkMessage(role), { code: "network" });
  }
  if (!response || response.ok !== true) {
    const status = Number(response?.status) || 0;
    throw new LoadError(httpMessage(role, status), { code: "http", status: status || null });
  }
  try {
    return await response.text();
  } catch {
    throw new LoadError(httpMessage(role, 0), { code: "http" });
  }
}

function pack(source, fields) {
  return {
    source,
    sample: source === "sample",
    csv: fields.csv,
    config: fields.config ?? null,
    today: fields.today,
    name: fields.name || "",
  };
}

/**
 * 页面顶栏怎么称呼这次的数据。
 * 只有 source 为 sample 时才说这是示例，并显示示例说明。
 * 相对路径的 ?data=（source 为 data）和远程 ?data= 用同一句，不叫夹具。
 * 没有载入成功时不提示例。
 */
export function describeLoadedSource(loaded) {
  if (loaded?.source === "import") {
    return {
      sample: false,
      showGuide: false,
      label: loaded.name
        ? `已导入 ${loaded.name}，保存在这台浏览器里。`
        : "已导入的表格保存在这台浏览器里。",
    };
  }
  if (loaded?.source === "remote" || loaded?.source === "data") {
    return {
      sample: false,
      showGuide: false,
      label: "当前数据来自 ?data= 链接。",
    };
  }
  if (loaded?.source === "fixture") {
    return {
      sample: false,
      showGuide: false,
      label: "当前数据来自本站夹具。",
    };
  }
  if (loaded?.source === "sample") {
    return {
      sample: true,
      showGuide: true,
      label: "当前是内置示例。也可以把 CSV 或 Excel 拖进页面。",
    };
  }
  return {
    sample: false,
    showGuide: false,
    label: "没有把表格载入页面。也可以把 CSV 或 Excel 拖进页面。",
  };
}

/**
 * 读取地址里的 ?config=。没有这项时返回 null。
 * 地址规则、跨域提示和 JSON 校验与 loadDashboard 里的 ?config= 相同。
 */
export async function loadQueryConfig(options = {}) {
  const params = new URLSearchParams(String(options.search ?? "").replace(/^\?/, ""));
  if (!params.has("config")) return null;
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const target = resolveResource(params.get("config"), "config");
  return parseConfigText(await fetchText(fetchImpl, target, "config"));
}

/**
 * 本地导入成功后，地址里去掉 ?data=、?fixture=、?vault=，留下 ?config= 和 ?today=。
 */
export function searchAfterImport(search) {
  const params = new URLSearchParams(String(search ?? "").replace(/^\?/, ""));
  params.delete("data");
  params.delete("fixture");
  params.delete("vault");
  const text = params.toString();
  return text ? `?${text}` : "";
}

/**
 * @param {{
 *   search?: string,
 *   fetch?: typeof fetch,
 *   storage?: { read: () => { csv: string, name: string } | null },
 *   sampleUrl?: string,
 * }} options
 */
export async function loadDashboard(options = {}) {
  const params = new URLSearchParams(
    String(options.search ?? "").replace(/^\?/, ""),
  );
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const storage = options.storage;
  const sampleUrl = options.sampleUrl || "examples/sample.csv";
  const today = resolveToday(params.has("today") ? params.get("today") : null);

  let config = null;
  if (params.has("config")) {
    const target = resolveResource(params.get("config"), "config");
    const text = await fetchText(fetchImpl, target, "config");
    config = parseConfigText(text);
  }

  if (params.has("data")) {
    const target = resolveResource(params.get("data"), "data");
    const csv = await fetchText(fetchImpl, target, "data");
    return pack(target.remote ? "remote" : "data", {
      csv,
      config,
      today,
      name: target.url,
    });
  }

  if (params.has("fixture")) {
    const target = resolveResource(params.get("fixture"), "fixture");
    const csv = await fetchText(fetchImpl, target, "fixture");
    return pack("fixture", { csv, config, today, name: target.url });
  }

  const saved = storage?.read?.() ?? null;
  if (saved?.csv) {
    return pack("import", {
      csv: saved.csv,
      config,
      today,
      name: saved.name || "",
    });
  }

  const csv = await fetchText(fetchImpl, { url: sampleUrl, remote: false }, "sample");
  return pack("sample", { csv, config, today, name: sampleUrl });
}

/**
 * 只获取 ?vault= 指向的文件，并检查它是不是本工具认识的 vault。
 * 不接收密码，请求里也只有这个地址（以及可选的 ?config=）。
 */
export async function fetchVaultDocument(options = {}) {
  const params = new URLSearchParams(String(options.search ?? "").replace(/^\?/, ""));
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const today = resolveToday(params.has("today") ? params.get("today") : null);

  let queryConfig = null;
  const hasQueryConfig = params.has("config");
  if (hasQueryConfig) {
    const target = resolveResource(params.get("config"), "config");
    queryConfig = parseConfigText(await fetchText(fetchImpl, target, "config"));
  }

  const target = resolveResource(params.has("vault") ? params.get("vault") : "", "vault");
  const text = await fetchText(fetchImpl, target, "vault");
  return {
    url: target.url,
    remote: target.remote,
    vault: parseVault(text),
    today,
    queryConfig,
    hasQueryConfig,
  };
}

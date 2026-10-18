/**
 * 决定这一次打开页面用哪份表。
 * 优先级：?data= ，?fixture= ，浏览器里保存的导入，内置示例。
 * ?config= 和 ?today= 套在选中的表上。示例与否只看数据来源，不另设开关。
 */

import { ParseError, normalizeConfig, parseDate } from "./schema.js";

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

export function messageFor(error) {
  if (error instanceof LoadError) return error.message;
  if (error?.name === "StorageError") return error.message;
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
  if (role === "today") return "?today= 后面没有日期。";
  return "fixture 后面没有路径。";
}

function schemeMessage(role) {
  if (role === "config") return "配置链接只接受 http、https，或本站相对路径。";
  return "数据链接只接受 http、https，或本站相对路径。";
}

function relativeMessage(role) {
  if (role === "fixture") return "fixture 只接受本站上的相对路径。";
  if (role === "config") return "配置的相对路径不能越出本站。";
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
  return "数据链接无法读取：浏览器拦截了跨域请求。请换一个允许网页直接读取的公开 CSV，例如 GitHub 上的 raw 文件。";
}

function httpMessage(role, status) {
  if (status === 404) {
    if (role === "config") return "没有找到这份配置（HTTP 404）。请检查 ?config= 的地址。";
    if (role === "fixture") return "没有找到这个夹具（HTTP 404）。";
    if (role === "sample") return "没有找到示例数据（HTTP 404）。";
    return "没有找到这份数据（HTTP 404）。请检查 ?data= 的地址。";
  }
  const code = status ? `（HTTP ${status}）` : "";
  if (role === "config") return `读取配置失败${code}。`;
  if (role === "fixture") return `读取夹具失败${code}。`;
  if (role === "sample") return `读取示例数据失败${code}。`;
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
    return pack(target.remote ? "remote" : "fixture", {
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

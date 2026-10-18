/**
 * 把 compute 的统计和 parse 的行画成页面。
 * 参与者名字只来自调用方传入的 participants，不写死人数。
 * 筛选项、KPI、图表配置是纯函数，不碰 DOM，方便单测。
 * render(stats, rows, participants, el) 负责挂到容器上，供以后换数据时重画。
 */

import { FIXED_TYPES, attendanceStatus, regionName } from "./compute.js";

const TYPE_COLORS = Object.freeze({
  ワンマン: "#ff6b8b",
  対バン: "#5cc8ff",
  フェス: "#ffc857",
});

const MORE_TYPE_COLORS = Object.freeze(["#7be0a6", "#c39bff", "#8f7bff", "#ff9f6b", "#5ce1e6"]);

/** 城市柱按地区上色。这三个地区沿用原来柱状图里的绿、蓝、紫。 */
const REGION_COLORS = Object.freeze({
  中国大陆: "#7be0a6",
  日本: "#5cc8ff",
  港台澳: "#c39bff",
});

const MORE_REGION_COLORS = Object.freeze(["#ff6b8b", "#ffc857", "#8f7bff", "#ff9f6b", "#5ce1e6"]);

const STATUS_LABEL = Object.freeze({
  attended: "",
  upcoming: "即将",
  undated: "待定",
  unmarked: "未标记",
});

export const STATUS_FILTERS = Object.freeze([
  { value: "", label: "全部状态" },
  { value: "attended", label: "已看" },
  { value: "upcoming", label: "即将" },
  { value: "undated", label: "待定" },
  { value: "unmarked", label: "已过未标记" },
]);

const CHARTS = new WeakMap();
const VIEW = new WeakMap();
const MOUNTED = new Set();
let resizeBound = false;

/** 有正的类型计数才画饼图。全是 0 时三个扇区会被画成相等的 0%。 */
export function hasTypeCounts(stats) {
  const counts = stats?.type_cnt;
  if (!counts || typeof counts !== "object") return false;
  return Object.values(counts).some((value) => Number(value) > 0);
}

/**
 * 窄屏把饼图缩小，标签贴着图表边缘排，避免 390 宽时被画布裁掉。
 * width 未知时用桌面尺寸；页面画完后会按容器宽度再套一次。
 */
export function pieSeriesLayout(width) {
  const narrow = typeof width === "number" && width > 0 && width <= 480;
  if (narrow) {
    return {
      radius: ["22%", "36%"],
      center: ["50%", "42%"],
      label: {
        color: "#e7e9ee",
        fontSize: 11,
        lineHeight: 15,
        formatter: "{b}\n{c} 场 · {d}%",
        overflow: "break",
        width: 78,
        alignTo: "edge",
        edgeDistance: 2,
        bleedMargin: 0,
      },
      labelLine: { length: 6, length2: 4 },
    };
  }
  return {
    radius: ["40%", "62%"],
    center: ["50%", "46%"],
    label: {
      color: "#e7e9ee",
      formatter: "{b}\n{c} 场 · {d}%",
      overflow: "break",
      width: 120,
    },
    labelLine: { length: 8, length2: 8 },
  };
}

function cellText(value) {
  return String(value ?? "").trim();
}

function peopleOf(participants) {
  return Array.isArray(participants) ? participants : [];
}

function columnsOf(participants) {
  return peopleOf(participants).map((person) => person.column);
}

/**
 * 千分位用逗号，小数部分原样保留。
 * 票价合计不要用这个函数直接上屏：合计见 formatPriceTotal。
 */
export function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  const negative = number < 0;
  const raw = Object.is(Math.abs(number), 0) ? "0" : Math.abs(number).toString();
  const [whole, fraction] = raw.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}${fraction ? `.${fraction}` : ""}`;
}

/** 已知代码换成符号。CNY 和 JPY 都是 ¥。不在表里的代码原样返回。 */
export const CURRENCY_SYMBOLS = Object.freeze({
  CNY: "¥",
  JPY: "¥",
  USD: "$",
  EUR: "€",
  GBP: "£",
  HKD: "HK$",
  TWD: "NT$",
  KRW: "₩",
  SGD: "S$",
  AUD: "A$",
  CAD: "C$",
});

export function currencyCode(currency) {
  const text = String(currency ?? "").trim().toUpperCase();
  return text || "CNY";
}

export function currencySymbol(currency) {
  const code = currencyCode(currency);
  if (Object.prototype.hasOwnProperty.call(CURRENCY_SYMBOLS, code)) return CURRENCY_SYMBOLS[code];
  return code;
}

/**
 * 四舍五入到整数，恰好一半时远离 0（2.5 → 3，-1.5 → -2）。
 * 这是页面上「元」的显示规则，不是 together_pct 用的四舍六入五成双。
 */
export function roundHalfAwayFromZero(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const rounded = Math.round(Math.abs(number));
  if (rounded === 0) return 0;
  return number < 0 ? -rounded : rounded;
}

/**
 * 票价合计的显示：先四舍五入到整数元，再加币种符号。
 * 已知符号紧贴数字（¥72,533）；不认识的代码后面空一格（XYZ 72,533）。
 * 非有限数字显示为「—」。原始 price_total 不在这里改。
 */
export function formatPriceTotal(value, currency = "CNY") {
  const number = Number(value);
  if (!Number.isFinite(number)) return "\u2014";
  const digits = formatNumber(roundHalfAwayFromZero(number));
  const code = currencyCode(currency);
  if (Object.prototype.hasOwnProperty.call(CURRENCY_SYMBOLS, code)) {
    return `${CURRENCY_SYMBOLS[code]}${digits}`;
  }
  return `${code} ${digits}`;
}

export function typeColor(type, extraIndex = 0) {
  if (Object.prototype.hasOwnProperty.call(TYPE_COLORS, type)) return TYPE_COLORS[type];
  return MORE_TYPE_COLORS[extraIndex % MORE_TYPE_COLORS.length];
}

export function regionColor(region, extraIndex = 0) {
  if (Object.prototype.hasOwnProperty.call(REGION_COLORS, region)) return REGION_COLORS[region];
  return MORE_REGION_COLORS[extraIndex % MORE_REGION_COLORS.length];
}

/**
 * 「谁去了」的选项。
 * 顺序：不筛选、每位参与者、一起（至少两位时）、仅每位参与者。
 * value 用 went:/only: 加列名，避免列名本身和「一起」撞车。
 */
export function whoFilterOptions(participants) {
  const people = peopleOf(participants);
  const options = [{ value: "", label: "谁去了" }];
  for (const person of people) {
    options.push({ value: `went:${person.column}`, label: `${person.label} 去了` });
  }
  if (people.length >= 2) options.push({ value: "all", label: "一起" });
  for (const person of people) {
    options.push({ value: `only:${person.column}`, label: `仅 ${person.label}` });
  }
  return options;
}

export function matchesWho(row, participants, value) {
  if (!value) return true;
  const people = peopleOf(participants);
  const went = (person) => !!row?.attended?.[person.column];
  if (value === "all") return people.length >= 2 && people.every(went);
  if (value.startsWith("went:")) {
    const column = value.slice(5);
    return people.some((person) => person.column === column && went(person));
  }
  if (value.startsWith("only:")) {
    const column = value.slice(5);
    const marked = people.filter(went);
    return marked.length === 1 && marked[0].column === column;
  }
  return false;
}

export function yearOptions(rows) {
  const years = [];
  const seen = new Set();
  for (const row of rows ?? []) {
    const year = row?.date ? String(row.date).slice(0, 4) : "";
    if (!year || seen.has(year)) continue;
    seen.add(year);
    years.push(year);
  }
  years.sort();
  years.reverse();
  return years;
}

/** 三种固定类型始终在前，其余类型按行里第一次出现的顺序接上。 */
export function typeOptions(rows) {
  const extras = [];
  const seen = new Set(FIXED_TYPES);
  for (const row of rows ?? []) {
    const type = cellText(row?.type);
    if (!type || seen.has(type)) continue;
    seen.add(type);
    extras.push(type);
  }
  return [...FIXED_TYPES, ...extras];
}

export function cityOptions(rows) {
  const cities = [];
  const seen = new Set();
  for (const row of rows ?? []) {
    const city = cellText(row?.city);
    if (!city || seen.has(city)) continue;
    seen.add(city);
    cities.push(city);
  }
  return cities;
}

function yearSpan(stats) {
  const start = typeof stats?.first === "string" ? stats.first.slice(0, 4) : "";
  const end = typeof stats?.last === "string" ? stats.last.slice(0, 4) : "";
  if (start && end) return `${start}\u2013${end}`;
  return "";
}

export function subtitleText(stats) {
  const range = stats?.first && stats?.last ? `${stats.first} \u2014 ${stats.last}` : "\u2014";
  const today = stats?.today ?? "";
  const artists = stats?.unique_artists ?? 0;
  return `${range} · 截至 ${today} · 共 ${artists} 组艺人`;
}

export function kpiCards(stats, participants, options = {}) {
  const people = peopleOf(participants);
  const source = stats ?? {};
  const currency = options.currency ?? options.config?.currency;
  const span = yearSpan(source);
  const cards = [
    {
      key: "total",
      label: "已看场次",
      value: String(source.total ?? 0),
      hint: span ? `${span} · 有日期且已过` : "有日期且已过",
    },
  ];
  for (const person of people) {
    cards.push({
      key: person.column,
      label: person.label,
      value: String(source[person.column] ?? 0),
      hint: `其中仅 ${person.label} ${source[`${person.column}_only`] ?? 0} 场`,
    });
  }
  if (people.length >= 2 && source.together != null) {
    cards.push({
      key: "together",
      label: "一起看",
      value: String(source.together),
      hint: `占 ${source.together_pct}%`,
    });
  }
  cards.push({
    key: "price",
    label: "票价合计（表内原值）",
    value: formatPriceTotal(source.price_total, currency),
    hint: `${source.no_price ?? 0} 场无票价未计`,
    price: true,
  });
  cards.push({
    key: "upcoming",
    label: "即将到来",
    value: String(source.upcoming ?? 0),
    hint: `待定 ${source.undated ?? 0} · 已过未标记 ${source.unmarked ?? 0}`,
  });
  return cards;
}

export function footnote(stats, participants, options = {}) {
  const people = peopleOf(participants);
  const today = stats?.today ?? "";
  const who =
    people.length === 0
      ? "没有参与者列时，日期已过即算已看"
      : "且至少一位参与者到场";
  const priceMode = options.priceMode ?? options.config?.priceMode ?? "total";
  const price =
    priceMode === "per_person"
      ? "票价按单人票价乘以该场到场人数相加，无票价的场次不计"
      : "票价为已看场次的 price 直接相加，无票价的场次不计";
  return `口径：「已看」= 有日期、日期 ≤ ${today}、${who}。${price}。艺人统计按换行拆分，同一场内去重。`;
}

export function attendanceLabel(row, participants) {
  const people = peopleOf(participants);
  const went = people.filter((person) => row?.attended?.[person.column]);
  if (people.length >= 2 && went.length === people.length) return "一起";
  if (went.length === 0) return "未标记";
  return went.map((person) => person.label).join("、");
}

export function artistText(row) {
  const names = Array.isArray(row?.artists) ? row.artists : [];
  return names.filter((name) => typeof name === "string" && name !== "").join(" / ");
}

export function priceText(price) {
  if (typeof price === "number" && Number.isFinite(price)) return String(price);
  return "";
}

export function listDetail(row, participants, options = {}) {
  const event = cellText(row?.event);
  const venue = cellText(row?.venue) || "场馆待定";
  const city = cellText(row?.city);
  let detail = `${event ? `${event} · ` : ""}${venue} · ${city}`;
  if (options.upcoming) detail += ` · ${attendanceLabel(row, participants)}`;
  return {
    date: cellText(row?.date) || "待定",
    title: artistText(row) || "(艺人未填)",
    type: cellText(row?.type),
    detail,
  };
}

export function tableColumns(participants) {
  const fixed = [
    { key: "no", label: "#" },
    { key: "date", label: "日期" },
    { key: "event", label: "活动" },
    { key: "artist", label: "艺人" },
    { key: "venue", label: "场馆" },
    { key: "city", label: "城市" },
    { key: "type", label: "类型" },
    { key: "price", label: "票价" },
  ];
  const marks = peopleOf(participants).map((person) => ({
    key: "",
    label: person.label,
    participant: person.column,
  }));
  return fixed.concat(marks);
}

export function tableView(row, participants, today) {
  const people = peopleOf(participants);
  const status = attendanceStatus(row, today, columnsOf(people));
  return {
    status,
    no: cellText(row?.no),
    date: row?.date || "\u2014",
    statusLabel: STATUS_LABEL[status] ?? "",
    event: row?.event ?? "",
    artist: artistText(row),
    venue: row?.venue ?? "",
    city: row?.city ?? "",
    type: cellText(row?.type),
    price: priceText(row?.price),
    marks: people.map((person) => (row?.attended?.[person.column] ? "\u2705" : "")),
  };
}

export function applyFilters(rows, participants, filters = {}, today) {
  const people = peopleOf(participants);
  const columns = columnsOf(people);
  const query = cellText(filters.query).toLowerCase();
  return (rows ?? []).filter((row) => {
    if (query) {
      const haystack = [row?.event, row?.artist, row?.venue, row?.city].join(" ").toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    const year = row?.date ? String(row.date).slice(0, 4) : "";
    if (filters.year && year !== filters.year) return false;
    if (filters.type && cellText(row?.type) !== filters.type) return false;
    if (filters.city && cellText(row?.city) !== filters.city) return false;
    if (filters.status && attendanceStatus(row, today, columns) !== filters.status) return false;
    if (!matchesWho(row, people, filters.who ?? "")) return false;
    return true;
  });
}

export function sortRows(rows, key, direction = 1) {
  const sign = direction < 0 ? -1 : 1;
  const copy = (rows ?? []).slice();
  copy.sort((left, right) => {
    let a = left?.[key];
    let b = right?.[key];
    if (key === "no" || key === "price") {
      a = +a || 0;
      b = +b || 0;
    } else {
      a = a ?? "";
      b = b ?? "";
    }
    const compared = a > b ? 1 : a < b ? -1 : 0;
    return compared * sign;
  });
  return copy;
}

function axisBase() {
  return {
    axisLine: { lineStyle: { color: "#333848" } },
    axisLabel: { color: "#9aa0b2" },
    splitLine: { lineStyle: { color: "#23273300" } },
  };
}

function chartBase() {
  return {
    textStyle: {
      fontFamily: "Noto Sans CJK SC, Noto Sans CJK JP, sans-serif",
      color: "#c9cdd8",
    },
    backgroundColor: "transparent",
    animation: false,
  };
}

function seriesValues(stats, type) {
  const values = stats?.per_year?.[type];
  if (Array.isArray(values)) return values;
  return (stats?.years ?? []).map(() => 0);
}

function regionsForCities(stats, rows, participants, config) {
  const found = new Map();
  const columns = columnsOf(participants);
  for (const row of rows ?? []) {
    const city = cellText(row?.city);
    if (found.has(city)) continue;
    if (attendanceStatus(row, stats?.today, columns) !== "attended") continue;
    found.set(city, regionName(row, config));
  }
  const order = [];
  const seen = new Set();
  const push = (region) => {
    if (!region || seen.has(region)) return;
    seen.add(region);
    order.push(region);
  };
  for (const entry of stats?.region ?? []) push(entry[0]);
  for (const entry of stats?.city ?? []) {
    const city = entry[0];
    push(found.get(city) || regionName({ city, region: "" }, config));
  }
  const color = new Map();
  let extra = 0;
  for (const region of order) {
    if (Object.prototype.hasOwnProperty.call(REGION_COLORS, region)) {
      color.set(region, REGION_COLORS[region]);
    } else {
      color.set(region, MORE_REGION_COLORS[extra % MORE_REGION_COLORS.length]);
      extra += 1;
    }
  }
  const byCity = new Map();
  for (const entry of stats?.city ?? []) {
    const city = entry[0];
    const region = found.get(city) || regionName({ city, region: "" }, config);
    byCity.set(city, color.get(region) || "#5cc8ff");
  }
  return byCity;
}

function shortVenue(name) {
  const value = String(name ?? "");
  return value.length > 16 ? `${value.slice(0, 16)}\u2026` : value;
}

/** ECharts 的 option。不调用 echarts，单测可以直接对一下系列里的数字。 */
export function buildCharts(stats, rows, participants, options = {}) {
  const source = stats ?? {};
  const types = source.types ?? [...FIXED_TYPES];
  const typeCnt = source.type_cnt ?? {};
  let extraType = 0;
  const typeColorOf = new Map();
  for (const type of types) {
    if (Object.prototype.hasOwnProperty.call(TYPE_COLORS, type)) {
      typeColorOf.set(type, TYPE_COLORS[type]);
    } else {
      typeColorOf.set(type, MORE_TYPE_COLORS[extraType % MORE_TYPE_COLORS.length]);
      extraType += 1;
    }
  }
  const base = chartBase();
  const artists = (source.top_art ?? []).slice().reverse();
  const cities = (source.city ?? []).slice().reverse();
  const venues = (source.venue ?? []).slice().reverse();
  const cityColors = regionsForCities(source, rows, participants, options.config ?? {});
  const regionLine = (source.region ?? []).map((entry) => `${entry[0]} ${entry[1]}`).join("   ");
  const pie = pieSeriesLayout(options.width);

  const type = hasTypeCounts(source)
    ? Object.assign({}, base, {
        tooltip: { trigger: "item" },
        legend: { bottom: 0, textStyle: { color: "#c9cdd8" } },
        series: [
          {
            type: "pie",
            radius: pie.radius,
            center: pie.center,
            itemStyle: { borderColor: "#181b24", borderWidth: 3 },
            label: pie.label,
            labelLine: pie.labelLine,
            data: types.map((typeName) => ({
              name: typeName,
              value: typeCnt[typeName] ?? 0,
              itemStyle: { color: typeColorOf.get(typeName) },
            })),
          },
        ],
      })
    : null;

  const year = Object.assign({}, base, {
    tooltip: { trigger: "axis" },
    legend: { top: 0, textStyle: { color: "#c9cdd8" } },
    grid: { left: 36, right: 16, top: 36, bottom: 28 },
    xAxis: Object.assign(axisBase(), { type: "category", data: source.years ?? [] }),
    yAxis: Object.assign(axisBase(), {
      type: "value",
      splitLine: { lineStyle: { color: "#232733" } },
    }),
    series: types.map((typeName, index) => {
      const item = {
        name: typeName,
        type: "bar",
        stack: "y",
        itemStyle: { color: typeColorOf.get(typeName) },
        data: seriesValues(source, typeName),
      };
      if (index === types.length - 1) {
        item.label = {
          show: true,
          position: "top",
          color: "#e7e9ee",
          formatter: (params) =>
            types.reduce((sum, name) => sum + (seriesValues(source, name)[params.dataIndex] ?? 0), 0),
        };
      }
      return item;
    }),
  });

  const city = Object.assign({}, base, {
    tooltip: {},
    grid: { left: 10, right: 30, top: 10, bottom: 10, containLabel: true },
    xAxis: Object.assign(axisBase(), {
      type: "value",
      minInterval: 1,
      splitLine: { lineStyle: { color: "#232733" } },
    }),
    yAxis: Object.assign(axisBase(), { type: "category", data: cities.map((entry) => entry[0]) }),
    series: [
      {
        type: "bar",
        data: cities.map((entry) => ({
          value: entry[1],
          itemStyle: { color: cityColors.get(entry[0]) || "#5cc8ff" },
        })),
        label: { show: true, position: "right", color: "#e7e9ee" },
      },
    ],
    graphic: [
      {
        type: "text",
        right: 20,
        bottom: 30,
        style: { text: regionLine, fill: "#9aa0b2", fontSize: 13 },
      },
    ],
  });

  const artist = Object.assign({}, base, {
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    legend: { top: 0, textStyle: { color: "#c9cdd8" } },
    grid: { left: 10, right: 30, top: 30, bottom: 10, containLabel: true },
    xAxis: Object.assign(axisBase(), {
      type: "value",
      minInterval: 1,
      splitLine: { lineStyle: { color: "#232733" } },
    }),
    yAxis: Object.assign(axisBase(), { type: "category", data: artists.map((entry) => entry[0]) }),
    series: [
      {
        name: "ワンマン",
        type: "bar",
        stack: "a",
        itemStyle: { color: "#ff6b8b" },
        data: artists.map((entry) => entry[2]),
      },
      {
        name: "フェス/対バン 出演",
        type: "bar",
        stack: "a",
        itemStyle: { color: "#8f7bff" },
        data: artists.map((entry) => entry[3]),
        label: {
          show: true,
          position: "right",
          color: "#e7e9ee",
          formatter: (params) => artists[params.dataIndex]?.[1] ?? "",
        },
      },
    ],
  });

  const venue = Object.assign({}, base, {
    tooltip: {},
    grid: { left: 10, right: 30, top: 10, bottom: 10, containLabel: true },
    xAxis: Object.assign(axisBase(), {
      type: "value",
      minInterval: 1,
      splitLine: { lineStyle: { color: "#232733" } },
    }),
    yAxis: Object.assign(
      axisBase(),
      { type: "category", data: venues.map((entry) => shortVenue(entry[0])) },
      { axisLabel: { color: "#9aa0b2", fontSize: 11 } },
    ),
    series: [
      {
        type: "bar",
        itemStyle: { color: "#ffc857" },
        data: venues.map((entry) => entry[1]),
        label: { show: true, position: "right", color: "#e7e9ee" },
      },
    ],
  });

  return { type, year, city, artist, venue };
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function heading(title, small) {
  const node = document.createElement("h2");
  node.append(document.createTextNode(title));
  if (small) {
    const note = document.createElement("small");
    note.textContent = small;
    node.append(note);
  }
  return node;
}

function chartBox(title, small, name, className) {
  const box = element("div", "card");
  box.append(heading(title, small));
  const chart = element("div", className);
  chart.dataset.chart = name;
  box.append(chart);
  return box;
}

function emptyTypeBox() {
  const box = element("div", "card");
  box.append(heading("场次类型", "没有类型列"));
  box.append(element("div", "ch empty", "无类型数据"));
  return box;
}

function fillSelect(select, options) {
  select.replaceChildren();
  for (const option of options) select.append(new Option(option.label, option.value));
}

function tag(type) {
  if (!type) return null;
  const node = element("span", "tag", type);
  if (Object.prototype.hasOwnProperty.call(TYPE_COLORS, type)) node.classList.add(`t-${type}`);
  return node;
}

function listItem(row, participants, upcoming) {
  const view = listDetail(row, participants, { upcoming });
  const item = document.createElement("li");
  item.append(element("span", "d", view.date));
  const body = document.createElement("span");
  const title = element("b", null, view.title);
  body.append(title);
  const mark = tag(view.type);
  if (mark) body.append(document.createTextNode(" "), mark);
  body.append(document.createElement("br"), element("span", "m", view.detail));
  item.append(body);
  return item;
}

function fillList(list, rows, participants, upcoming) {
  if (rows.length === 0) {
    list.replaceChildren();
    if (upcoming) list.append(element("li", "m", "暂无"));
    return;
  }
  list.replaceChildren(...rows.map((row) => listItem(row, participants, upcoming)));
}

function tableRow(row, participants, today) {
  const view = tableView(row, participants, today);
  const tr = document.createElement("tr");
  tr.className = `s-${view.status}`;
  const cells = [
    ["num", view.no],
    ["", null],
    ["", view.event],
    ["art", view.artist],
    ["", view.venue],
    ["", view.city],
    ["", null],
    ["num", view.price],
  ];
  cells.forEach((spec, index) => {
    const td = element("td", spec[0] || null);
    if (index === 1) {
      td.append(document.createTextNode(view.date));
      if (view.statusLabel) {
        td.append(document.createElement("br"), element("span", "tag", view.statusLabel));
      }
    } else if (index === 6) {
      const mark = tag(view.type);
      if (mark) td.append(mark);
    } else {
      td.textContent = spec[1];
    }
    tr.append(td);
  });
  for (const mark of view.marks) tr.append(element("td", null, mark));
  return tr;
}

function disposeCharts(root) {
  const charts = CHARTS.get(root);
  if (!charts) return;
  for (const chart of charts) chart.dispose();
  CHARTS.delete(root);
  VIEW.delete(root);
  MOUNTED.delete(root);
}

function relayoutType(root) {
  const view = VIEW.get(root);
  const charts = CHARTS.get(root) ?? [];
  const node = root.querySelector?.("[data-chart=type]");
  if (!view || !node) return;
  const chart = charts.find((item) => item.getDom?.() === node);
  if (!chart) return;
  const next = buildCharts(view.stats, view.rows, view.participants, {
    ...view.options,
    width: node.clientWidth,
  }).type;
  if (next) chart.setOption(next);
}

function bindResize() {
  if (resizeBound || typeof window === "undefined") return;
  resizeBound = true;
  window.addEventListener("resize", () => {
    for (const root of MOUNTED) {
      for (const chart of CHARTS.get(root) ?? []) chart.resize();
      relayoutType(root);
    }
  });
}

function paintCharts(wrap, options) {
  const api = globalThis.echarts;
  const nodes = [...wrap.querySelectorAll("[data-chart]")];
  if (typeof api?.init !== "function") {
    for (const node of nodes) node.textContent = "图表库没有就绪";
    return [];
  }
  const charts = [];
  for (const node of nodes) {
    const option = options[node.dataset.chart];
    if (!option) continue;
    const chart = api.init(node);
    chart.setOption(option);
    charts.push(chart);
  }
  return charts;
}

/**
 * @param {object} stats compute() 的返回值
 * @param {object[]} rows parseCsv() 的 rows
 * @param {{ column: string, label: string }[]} participants
 * @param {Element} el 画到这个容器里，再次调用会先清掉上一次的图
 * @param {{ title?: string, config?: object, sample?: boolean, priceMode?: string }} [options]
 */
export function render(stats, rows, participants, el, options = {}) {
  if (el == null || typeof el.appendChild !== "function") {
    throw new TypeError("render 需要一个容器元素");
  }
  if (stats == null || typeof stats !== "object") {
    throw new TypeError("render 需要 compute 的统计结果");
  }
  if (!Array.isArray(rows)) throw new TypeError("render 需要 parse 的行");

  const people = peopleOf(participants);
  const config = options.config ?? {};
  const titleText = options.title || config.title || "Live 观演记录";
  disposeCharts(el);
  if (typeof document !== "undefined") document.title = titleText;

  const wrap = element("div", "wrap");
  wrap.append(element("h1", null, titleText));
  wrap.append(element("div", "sub", subtitleText(stats)));
  if (options.sample) {
    wrap.append(element("div", "sample", "当前显示的是仓库里的虚构示例，不是某个人的观演记录。"));
  }

  const cards = kpiCards(stats, people, { currency: config.currency });
  const kpis = element("div", "grid k");
  kpis.style.setProperty("--kpi-cols", String(Math.min(6, Math.max(cards.length, 1))));
  for (const card of cards) {
    const box = element("div", "card kpi");
    box.append(element("div", "l", card.label));
    const value = element("div", card.price ? "v price" : "v", card.value);
    box.append(value, element("div", "h", card.hint));
    kpis.append(box);
  }
  wrap.append(kpis);

  const types = element("div", "grid g2");
  types.append(
    hasTypeCounts(stats)
      ? chartBox("场次类型", "ワンマン / 対バン / フェス", "type", "ch")
      : emptyTypeBox(),
    chartBox("每年场次", "按类型堆叠", "year", "ch"),
  );
  const places = element("div", "grid g2");
  places.append(
    chartBox("城市", "已看场次", "city", "ch tall"),
    chartBox("看得最多的艺人 Top 20", "ワンマン ＋ フェス/対バン 出演", "artist", "ch tall"),
  );

  const upcomingRows = rows.filter(
    (row) => attendanceStatus(row, stats.today, columnsOf(people)) === "upcoming",
  );
  const undatedRows = rows.filter(
    (row) => attendanceStatus(row, stats.today, columnsOf(people)) === "undated",
  );
  const side = element("div", "grid g3");
  const venue = chartBox("常去场馆 Top 12", "", "venue", "ch");
  venue.querySelector("[data-chart]").style.height = "420px";
  const upCard = element("div", "card");
  const upHead = heading("即将到来", "");
  const upCount = element("small", null, `${upcomingRows.length} 场`);
  upHead.append(upCount);
  const upList = element("ul", "list");
  upCard.append(upHead, upList);
  const undatedCard = element("div", "card");
  const undatedHead = heading("待定 / 无日期", "");
  undatedHead.append(element("small", null, `${undatedRows.length} 条（不计入已看）`));
  const undatedList = element("ul", "list");
  undatedCard.append(undatedHead, undatedList);
  side.append(venue, upCard, undatedCard);
  wrap.append(types, places, side);
  fillList(upList, upcomingRows, people, true);
  fillList(undatedList, undatedRows, people, false);

  const tableCard = element("div", "card table-card");
  tableCard.append(heading("全部记录", ""));
  const filters = element("div", "filters");
  const query = element("input");
  query.dataset.filter = "query";
  query.placeholder = "搜索 活动 / 艺人 / 场馆 / 城市\u2026";
  const year = element("select");
  year.dataset.filter = "year";
  const type = element("select");
  type.dataset.filter = "type";
  const city = element("select");
  city.dataset.filter = "city";
  const status = element("select");
  status.dataset.filter = "status";
  const who = element("select");
  who.dataset.filter = "who";
  const count = element("span", "cnt");
  count.dataset.role = "count";
  filters.append(query, year, type, city, status, who, count);
  fillSelect(year, [{ value: "", label: "全部年份" }, ...yearOptions(rows).map((value) => ({ value, label: value }))]);
  fillSelect(type, [{ value: "", label: "全部类型" }, ...typeOptions(rows).map((value) => ({ value, label: value }))]);
  fillSelect(city, [{ value: "", label: "全部城市" }, ...cityOptions(rows).map((value) => ({ value, label: value }))]);
  fillSelect(status, STATUS_FILTERS);
  fillSelect(who, whoFilterOptions(people));

  const scroller = element("div", "tbl");
  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const column of tableColumns(people)) {
    const th = element("th", null, column.label);
    if (column.key) th.dataset.k = column.key;
    headRow.append(th);
  }
  thead.append(headRow);
  const tbody = document.createElement("tbody");
  table.append(thead, tbody);
  scroller.append(table);
  const note = element("div", "note", footnote(stats, people, options));
  tableCard.append(filters, scroller, note);
  wrap.append(tableCard);

  const sort = { key: "no", direction: 1 };
  const draw = () => {
    const view = sortRows(
      applyFilters(
        rows,
        people,
        {
          query: query.value,
          year: year.value,
          type: type.value,
          city: city.value,
          status: status.value,
          who: who.value,
        },
        stats.today,
      ),
      sort.key,
      sort.direction,
    );
    tbody.replaceChildren(...view.map((row) => tableRow(row, people, stats.today)));
    count.textContent = `${view.length} / ${rows.length} 条`;
  };
  for (const control of [query, year, type, city, status, who]) {
    control.addEventListener("input", draw);
  }
  headRow.querySelectorAll("th[data-k]").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.k;
      if (sort.key === key) sort.direction = -sort.direction;
      else {
        sort.key = key;
        sort.direction = 1;
      }
      draw();
    });
  });
  draw();

  el.replaceChildren(wrap);
  const viewOptions = { config };
  VIEW.set(el, { stats, rows, participants: people, options: viewOptions });
  const typeNode = wrap.querySelector("[data-chart=type]");
  const charts = paintCharts(
    wrap,
    buildCharts(stats, rows, people, {
      ...viewOptions,
      width: typeNode?.clientWidth ?? 0,
    }),
  );
  CHARTS.set(el, charts);
  MOUNTED.add(el);
  bindResize();
  return el;
}

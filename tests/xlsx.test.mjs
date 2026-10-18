import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { WorkbookError, workbookToCsv } from "../app/xlsx.js";
import {
  csvFileNameOk,
  excelFileNameOk,
  importFileNameOk,
  messageFor,
  readImportFile,
} from "../app/load.js";
import { parseCsv } from "../app/parse.js";

function spell(...parts) {
  return parts.join("");
}

function view(parsed) {
  return {
    participants: parsed.participants.map((person) => person.column),
    rows: parsed.rows.map((row) => ({
      line: row.line,
      no: row.no,
      date: row.date,
      event: row.event,
      artist: row.artist,
      artists: row.artists,
      venue: row.venue,
      city: row.city,
      type: row.type,
      price: row.price,
      region: row.region,
      attended: { ...row.attended },
    })),
  };
}

async function sheetjs() {
  const mod = await import("../vendor/xlsx-0.20.3.full.min.js");
  const lib = mod.default?.read ? mod.default : globalThis.XLSX;
  assert.equal(typeof lib.read, "function");
  return lib;
}

function fileBuffer(bytes) {
  if (bytes instanceof ArrayBuffer) return bytes.slice(0);
  const view = new Uint8Array(bytes);
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
}

function workbookBytes(XLSX, sheets) {
  const book = XLSX.utils.book_new();
  for (const [name, sheet] of sheets) XLSX.utils.book_append_sheet(book, sheet, name);
  return XLSX.write(book, { type: "array", bookType: "xlsx" });
}

test("an xlsx import matches its csv twin, including header quirks and the first sheet only", async () => {
  const XLSX = await sheetjs();
  const header = [
    "NO. ",
    "DATE ",
    "EVENT ",
    "ARTIST ",
    "VENUE ",
    "CITY ",
    `ワンマン/対バン/フェス`,
    "PRICE",
    "HANA",
    "KEN",
  ];
  const sheet = XLSX.utils.aoa_to_sheet([
    header,
    ["", "", "", "", "", "", "", "", "", ""],
    ["", "", "", "", "", "", "", "", "", ""],
    ["", "", "", "", "", "", "", "", "", ""],
    ["", "", "", "", "", "", "", "", "", ""],
  ]);
  sheet.A2 = { t: "n", f: "ROW()-1", v: 9 };
  sheet.B2 = { t: "n", v: 44941, z: "m/d/yy" };
  sheet.C2 = { t: "s", v: "Harbor Night" };
  sheet.D2 = { t: "s", v: "Northwind\n/Paper Moon" };
  sheet.E2 = { t: "s", v: "Glass Hall" };
  sheet.F2 = { t: "s", v: "上海" };
  sheet.G2 = { t: "s", v: "ワンマン" };
  sheet.H2 = { t: "n", v: 760 };
  sheet.I2 = { t: "s", v: "\u2705" };
  sheet.J2 = { t: "s", v: "\u2705" };

  sheet.A3 = { t: "n", f: "ROW()-1" };
  sheet.B3 = { t: "s", v: "2024/06/01" };
  sheet.C3 = { t: "s", v: "Lantern" };
  sheet.D3 = { t: "s", v: "Glass Harbor" };
  sheet.E3 = { t: "s", v: "River Club" };
  sheet.F3 = { t: "s", v: "杭州" };
  sheet.G3 = { t: "s", v: "対バン" };
  sheet.H3 = { t: "n", v: 12.5 };
  sheet.I3 = { t: "b", v: true };
  sheet.J3 = { t: "s", v: "" };

  sheet.A4 = { t: "n", f: "ROW()-1" };
  for (const col of "BCDEFGHIJ") delete sheet[`${col}4`];

  sheet.A5 = { t: "n", f: "ROW()-1" };
  delete sheet.B5;
  sheet.C5 = { t: "s", v: "Undated" };
  sheet.D5 = { t: "s", v: "Copper Kite" };
  sheet.E5 = { t: "s", v: "Small Room" };
  sheet.F5 = { t: "s", v: "北京" };
  sheet.G5 = { t: "s", v: "フェス" };
  delete sheet.H5;
  sheet.I5 = { t: "s", v: "\u274C" };
  sheet.J5 = { t: "s", v: "\u2705" };
  sheet["!ref"] = "A1:J5";

  const ignored = XLSX.utils.aoa_to_sheet([["EVENT"], ["Do Not Import This Sheet"]]);
  const bytes = workbookBytes(XLSX, [
    ["Shows", sheet],
    ["Ignore", ignored],
  ]);

  const csv = await workbookToCsv(bytes);
  assert.doesNotMatch(csv, /Do Not Import This Sheet/);
  assert.match(csv.split(/\r?\n/, 1)[0], /^no,date,event,artist,venue,city,type,price,hana,ken$/);

  const twin = [
    "no,date,event,artist,venue,city,type,price,hana,ken",
    '9,2023-01-15,Harbor Night,"Northwind',
    '/Paper Moon",Glass Hall,上海,ワンマン,760,✅,✅',
    "2,2024-06-01,Lantern,Glass Harbor,River Club,杭州,対バン,12.5,TRUE,",
    "4,,Undated,Copper Kite,Small Room,北京,フェス,,❌,✅",
    "",
  ].join("\n");

  assert.deepEqual(view(parseCsv(csv)), view(parseCsv(twin)));
  assert.deepEqual(view(parseCsv(csv)).rows.map((row) => row.line), [2, 4, 5]);
  assert.deepEqual(
    view(parseCsv(csv)).rows.map((row) => row.attended),
    [
      { hana: true, ken: true },
      { hana: true, ken: false },
      { hana: false, ken: true },
    ],
  );

  const viaLoader = await readImportFile({
    name: "shows.xlsx",
    arrayBuffer: async () => fileBuffer(bytes),
  });
  assert.equal(viaLoader, csv);
});

test("excel dates and plain date text become YYYY-MM-DD, and a bad date is left for validation", async () => {
  const XLSX = await sheetjs();
  const sheet = XLSX.utils.aoa_to_sheet([
    ["DATE ", "EVENT ", "ARTIST "],
    ["2024-1-5", "Padded", "Northwind"],
    ["2024.07.04", "Dotted", "Glass Harbor"],
    [" 2024/08/09 ", "Slashed", "Copper Kite"],
    ["2024/13/01", "Bad", "Lantern Club"],
    ["NO.\u00a0", "Spaced", "Paper Moon"],
  ]);
  sheet.A1 = { t: "s", v: "DATE\u3000" };
  sheet.A6 = { t: "s", v: "not-a-date" };
  sheet.C6 = { t: "s", v: "Paper Moon" };
  const csv = await workbookToCsv(workbookBytes(XLSX, [["Shows", sheet]]));
  assert.match(csv, /2024-01-05/);
  assert.match(csv, /2024-07-04/);
  assert.match(csv, /2024-08-09/);
  assert.match(csv, /2024\/13\/01/);
  assert.match(csv, /not-a-date/);
  assert.throws(() => parseCsv(csv), /不是 YYYY-MM-DD/);
});

test("participant columns stay as non-reserved headers unless config renames them", async () => {
  const XLSX = await sheetjs();
  const sheet = XLSX.utils.aoa_to_sheet([
    ["EVENT ", "HANAAA", "MIRA "],
    ["Harbor Night", "\u2705", "\u2705"],
  ]);
  const bytes = workbookBytes(XLSX, [["Shows", sheet]]);
  const plain = await workbookToCsv(bytes);
  assert.match(plain.split(/\r?\n/, 1)[0], /^event,hanaaa,mira$/);
  const parsed = parseCsv(plain);
  assert.deepEqual(
    parsed.participants.map((person) => person.column),
    ["hanaaa", "mira"],
  );
  assert.equal(parsed.rows[0].attended.hanaaa, true);

  const renamed = await workbookToCsv(bytes, {
    config: {
      header_aliases: { "MIRA ": "mio" },
      people: [{ column: "hana", header: "HANAAA", label: "Hana" }],
    },
  });
  assert.match(renamed.split(/\r?\n/, 1)[0], /^event,hana,mio$/);
  const withConfig = parseCsv(renamed, {
    people: [{ column: "hana", label: "Hana" }],
  });
  assert.equal(withConfig.participants[0].label, "Hana");
  assert.equal(withConfig.rows[0].attended.hana, true);
  assert.equal(withConfig.rows[0].attended.mio, true);
});

test("the reference converter's longer participant spellings map to its csv column ids", async () => {
  const XLSX = await sheetjs();
  const longA = spell("re", "my", "yy");
  const longB = spell("ne", "gi", "ii");
  const shortA = spell("re", "my");
  const shortB = spell("ne", "gi");
  const sheet = XLSX.utils.aoa_to_sheet([
    ["EVENT ", longA, longB],
    ["Harbor Night", "\u2705", "\u2705"],
  ]);
  const csv = await workbookToCsv(workbookBytes(XLSX, [["Shows", sheet]]));
  const header = csv.split(/\r?\n/, 1)[0];
  assert.equal(header, `event,${shortA},${shortB}`);
  assert.equal(parseCsv(csv).rows[0].attended[shortA], true);
  assert.equal(parseCsv(csv).rows[0].attended[shortB], true);
});

test("a formula-less duplicate header and an unreadable file are Chinese errors", async () => {
  const XLSX = await sheetjs();
  const sheet = XLSX.utils.aoa_to_sheet([
    ["EVENT ", "event"],
    ["Harbor Night", "x"],
  ]);
  await assert.rejects(
    () => workbookToCsv(workbookBytes(XLSX, [["Shows", sheet]])),
    (error) => {
      assert.ok(error instanceof WorkbookError);
      assert.match(messageFor(error), /重复的列「event」/);
      assert.doesNotMatch(messageFor(error), /页面没有渲染出来/);
      return true;
    },
  );

  await assert.rejects(
    () => workbookToCsv(new Uint8Array([1, 2, 3, 4])),
    (error) => {
      assert.ok(error instanceof WorkbookError);
      assert.match(error.message, /Excel/);
      return true;
    },
  );

  await assert.rejects(() => workbookToCsv("not-bytes"), /没有读到工作簿/);
});

test("csv and xls names, and lazy loading so csv does not fetch the xlsx vendor", async () => {
  assert.equal(excelFileNameOk("shows.xlsx"), true);
  assert.equal(excelFileNameOk("shows.XLS"), true);
  assert.equal(excelFileNameOk("shows.xls"), true);
  assert.equal(excelFileNameOk("shows.csv"), false);
  assert.equal(excelFileNameOk("shows.xlsm"), false);
  assert.equal(excelFileNameOk(""), false);
  assert.equal(csvFileNameOk("sheet.xlsx"), false);
  assert.equal(importFileNameOk("notes.txt"), false);
  assert.equal(importFileNameOk("shows.xlsx"), true);
  assert.equal(importFileNameOk("shows.xls"), true);
  assert.equal(importFileNameOk(""), true);

  let loads = 0;
  const csv = await readImportFile(
    {
      name: "shows.csv",
      text: async () => "date,event\n2024-01-01,Show\n",
      arrayBuffer: async () => {
        throw new Error("csv should not read bytes");
      },
    },
    {
      loadXlsxModule() {
        loads += 1;
        throw new Error("csv should not load xlsx");
      },
    },
  );
  assert.equal(loads, 0);
  assert.match(csv, /Show/);

  const excel = await readImportFile(
    {
      name: "shows.XLS",
      arrayBuffer: async () => new ArrayBuffer(0),
    },
    {
      async loadXlsxModule() {
        loads += 1;
        return {
          workbookToCsv: async () => "date,event\n2024-02-02,FromExcel\n",
        };
      },
    },
  );
  assert.equal(loads, 1);
  assert.match(excel, /FromExcel/);

  const loadSource = readFileSync(new URL("../app/load.js", import.meta.url), "utf8");
  const xlsxSource = readFileSync(new URL("../app/xlsx.js", import.meta.url), "utf8");
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(loadSource, /import\("\.\/xlsx\.js"\)/);
  assert.doesNotMatch(loadSource, /from ["']\.\/xlsx\.js["']/);
  assert.match(xlsxSource, /import\("\.\.\/vendor\/xlsx-0\.20\.3\.full\.min\.js"\)/);
  assert.doesNotMatch(xlsxSource, /from ["']\.\.\/vendor\/xlsx/);
  assert.doesNotMatch(html, /xlsx-0\.20\.3/);
  assert.match(html, /accept="[^"]*\.xlsx/);
  assert.match(html, /accept="[^"]*\.xls/);
  assert.match(html, /readImportFile/);
  assert.doesNotMatch(`${loadSource}\n${xlsxSource}\n${html}`, /<script[^>]+xlsx/i);
});

test("an .xls file is read from its first sheet", async () => {
  const XLSX = await sheetjs();
  const first = XLSX.utils.aoa_to_sheet([
    ["EVENT ", "CITY "],
    ["Lantern", "杭州"],
  ]);
  const second = XLSX.utils.aoa_to_sheet([["EVENT"], ["Skip Me"]]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, first, "First");
  XLSX.utils.book_append_sheet(book, second, "Second");
  const bytes = XLSX.write(book, { type: "array", bookType: "xls" });
  const csv = await workbookToCsv(bytes);
  const parsed = parseCsv(csv);
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].event, "Lantern");
  assert.equal(parsed.rows[0].city, "杭州");
  assert.doesNotMatch(csv, /Skip Me/);
});

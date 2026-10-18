import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseCsv } from "../app/parse.js";
import {
  ATTENDED_VALUES,
  ParseError,
  isAttended,
  splitArtists,
} from "../app/schema.js";

const root = fileURLToPath(new URL("..", import.meta.url));

function fixture(name) {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

function fixtureBytes(name) {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
}

function attendedOf(row) {
  return { ...row.attended };
}

test("splitArtists follows the line, slash, blank, and alias rules", () => {
  const cell = [
    "Northwind\t",
    "/Paper Moon",
    "\uFF0FGlass Harbor",
    "",
    "/",
    "  \t  ",
    "\uFF0F\tLantern Club",
  ].join("\r\n");
  const split = splitArtists(cell, { "Paper Moon": "Paper Moon Ensemble" });
  assert.deepEqual(split.raw, [
    "Northwind",
    "Paper Moon",
    "Glass Harbor",
    "Lantern Club",
  ]);
  assert.deepEqual(split.counted, [
    "Northwind",
    "Paper Moon Ensemble",
    "Glass Harbor",
    "Lantern Club",
  ]);

  assert.deepEqual(splitArtists("A\rB").raw, ["AB"]);
  assert.deepEqual(splitArtists("//A").raw, ["A"]);
  assert.deepEqual(splitArtists("／／A").raw, ["A"]);
  assert.deepEqual(splitArtists("/／A").raw, ["A"]);
  assert.deepEqual(splitArtists("North/Wind").raw, ["North/Wind"]);
  assert.deepEqual(splitArtists("Copper Kite\nCopper Kite").raw, [
    "Copper Kite",
    "Copper Kite",
  ]);
  assert.deepEqual(splitArtists("/Paper Moon", { "/Paper Moon": "Other" }).counted, [
    "Paper Moon",
  ]);
});

test("quoted multiline artist cells split like splitArtists and keep the original text", () => {
  const result = parseCsv(fixture("artists-multiline.csv"), {
    artist_aliases: { "Paper Moon": "Paper Moon Ensemble" },
  });
  assert.equal(result.rows.length, 2);
  assert.ok(fixture("artists-multiline.csv").split(/\r?\n/).length > 4);

  const show = result.rows[0];
  assert.equal(show.date, "2024-08-01");
  assert.equal(show.event.replaceAll("\r", ""), "Harbor\nNight");
  assert.deepEqual(show.artists, [
    "Northwind",
    "Paper Moon",
    "Glass Harbor",
    "Lantern Club",
  ]);
  assert.deepEqual(show.artistsForCount, [
    "Northwind",
    "Paper Moon Ensemble",
    "Glass Harbor",
    "Lantern Club",
  ]);
  assert.match(show.artist, /Paper Moon/);
  assert.doesNotMatch(show.artist, /Paper Moon Ensemble/);
  assert.deepEqual(result.rows[1].artists, ["Copper Kite"]);
  assert.deepEqual(result.rows[1].artistsForCount, ["Copper Kite"]);
  assert.deepEqual(attendedOf(show), { mika: true });
  assert.deepEqual(attendedOf(result.rows[1]), { mika: false });
});

test("aliases is accepted when artist_aliases is absent, and artist_aliases wins when both are set", () => {
  const csv = "date,event,artist\n2024-01-01,Show,Paper Moon\n";
  const fromAliases = parseCsv(csv, { aliases: { "Paper Moon": "Copper Kite" } });
  assert.deepEqual(fromAliases.rows[0].artists, ["Paper Moon"]);
  assert.deepEqual(fromAliases.rows[0].artistsForCount, ["Copper Kite"]);

  const both = parseCsv(csv, {
    artist_aliases: { "Paper Moon": "Lantern Club" },
    aliases: { "Paper Moon": "Copper Kite" },
  });
  assert.deepEqual(both.rows[0].artistsForCount, ["Lantern Club"]);
  assert.equal(both.rows[0].artist, "Paper Moon");
});

test("an unclosed quote reports the record start line and does not swallow later rows", () => {
  const csv = [
    "date,event,artist",
    '2024-01-01,E,"unterminated',
    "bad,E,B",
    "2024-02-02,Later,Northwind",
  ].join("\n");
  assert.throws(
    () => parseCsv(csv),
    (error) => {
      assert.ok(error instanceof ParseError);
      assert.equal(error.line, 2);
      assert.match(error.message, /第 2 行：引号没有闭合/);
      assert.equal(error.errors.length, 1);
      assert.equal(error.errors[0].code, "unclosed_quote");
      assert.equal(error.errors[0].unit, "line");
      return true;
    },
  );

  assert.throws(
    () => parseCsv('2024-01-01,E,"unterminated\nbad,E,B'),
    (error) => {
      assert.equal(error.line, 1);
      assert.match(error.message, /第 1 行：引号没有闭合/);
      return true;
    },
  );

  const afterClosed = [
    "event,date,artist",
    '"Harbor',
    'Night",2024-01-01,Northwind',
    'Later,2024-02-02,"unterminated',
    "bad,E,B",
    "Next,2024-03-03,Paper Moon",
  ].join("\n");
  assert.throws(
    () => parseCsv(afterClosed),
    (error) => {
      assert.equal(error.line, 4);
      assert.match(error.message, /第 4 行：引号没有闭合/);
      return true;
    },
  );

  const crlf = 'event,artist\r\nShow,Northwind\r\nLater,"unterminated\r\nbad,E,B\r\n';
  assert.throws(
    () => parseCsv(crlf),
    (error) => {
      assert.equal(error.line, 3);
      assert.match(error.message, /第 3 行：引号没有闭合/);
      return true;
    },
  );

  const blankBefore = 'date,event\n\n2024-01-01,"open\nstill\n';
  assert.throws(
    () => parseCsv(blankBefore),
    (error) => {
      assert.equal(error.line, 3);
      assert.match(error.message, /第 3 行：引号没有闭合/);
      return true;
    },
  );
});

test("escaped quotes stay inside one cell", () => {
  const result = parseCsv('event,artist\n"Say ""Hi""",Northwind\n');
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].event, 'Say "Hi"');
  assert.deepEqual(result.rows[0].artists, ["Northwind"]);
});

test("BOM, CRLF, and uppercase headers parse", () => {
  const bytes = fixtureBytes("bom-crlf-upper.csv");
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.ok(bytes.includes(Buffer.from("\r\n")));
  assert.ok(bytes.includes(Buffer.from("DATE,EVENT,ARTIST,CITY")));

  const result = parseCsv(fixture("bom-crlf-upper.csv"));
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].date, "2020-06-01");
  assert.equal(result.rows[0].event, "Harbor Night");
  assert.deepEqual(result.rows[0].artists, ["Northwind"]);
  assert.equal(result.rows[0].city, "Lumen Bay");
  assert.deepEqual(result.participants, []);
});

test("a bad date reports the physical file line", () => {
  const lines = fixture("bad-date.csv").split("\n");
  assert.match(lines[2], /2024\/03\/01/);
  assert.match(lines[3], /2023-02-29/);
  assert.match(lines[5], /2024-13-01/);

  assert.throws(
    () => parseCsv(fixture("bad-date.csv")),
    (error) => {
      assert.ok(error instanceof ParseError);
      assert.equal(error.line, 3);
      assert.match(error.message, /第 3 行/);
      assert.match(error.message, /第 4 行/);
      assert.match(error.message, /第 6 行/);
      assert.deepEqual(
        error.errors.map((item) => item.line),
        [3, 4, 6],
      );
      assert.ok(error.errors.every((item) => item.code === "bad_date"));
      return true;
    },
  );
});

test("a bad date after a quoted newline uses the physical file line", () => {
  const csv = 'event,date,artist\n"Harbor\nNight",2024-01-01,Northwind\nCedar Room,2024/02/02,Paper Moon\n';
  assert.throws(
    () => parseCsv(csv),
    (error) => {
      assert.equal(error.line, 4);
      assert.match(error.message, /第 4 行：日期「2024\/02\/02」/);
      assert.equal(error.errors[0].unit, "line");
      return true;
    },
  );

  const crlf = 'event,date\r\n"Harbor\r\nNight",2024-01-01\r\nLater,2024/03/03\r\n';
  assert.throws(
    () => parseCsv(crlf),
    (error) => {
      assert.equal(error.line, 4);
      assert.match(error.message, /第 4 行/);
      return true;
    },
  );

  const blank = "event,date\nShow,2024-01-01\n\nLater,2024/02/02\n";
  assert.throws(
    () => parseCsv(blank),
    (error) => {
      assert.equal(error.line, 4);
      assert.match(error.message, /第 4 行：日期「2024\/02\/02」/);
      return true;
    },
  );
});

test("a trailing dot is removed from headers after trim and lowercase", () => {
  const result = parseCsv(
    "NO.,DATE,EVENT,ARTIST,VENUE.,mika\n12,2024-06-01,Harbor Night,Northwind,Blue Hall,yes\n",
  );
  assert.deepEqual(result.participants, [{ column: "mika", label: "mika" }]);
  assert.equal(result.rows[0].no, "12");
  assert.equal(result.rows[0].date, "2024-06-01");
  assert.equal(result.rows[0].event, "Harbor Night");
  assert.equal(result.rows[0].venue, "Blue Hall");
  assert.deepEqual(result.rows[0].artists, ["Northwind"]);
  assert.deepEqual(attendedOf(result.rows[0]), { mika: true });

  const spaced = parseCsv(" NO. , DATE. , EVENT , artist , sora \n3,2024-07-01,Show,Copper Kite,1\n");
  assert.deepEqual(spaced.participants, [{ column: "sora", label: "sora" }]);
  assert.equal(spaced.rows[0].no, "3");
  assert.equal(spaced.rows[0].date, "2024-07-01");

  assert.throws(
    () => parseCsv("DATE.,EVENT\nnot-a-date,Show\n"),
    (error) => {
      assert.equal(error.line, 2);
      assert.match(error.message, /第 2 行/);
      assert.match(error.message, /not-a-date/);
      return true;
    },
  );
});

test("whitespace around a valid date is accepted and a blank date is undated", () => {
  const result = parseCsv("event,date\nShow,  2024-02-29  \nLater,   \n");
  assert.equal(result.rows[0].date, "2024-02-29");
  assert.equal(result.rows[1].date, null);
});

test("missing event and artist columns reports line 1", () => {
  assert.throws(
    () => parseCsv(fixture("missing-event-artist.csv")),
    (error) => {
      assert.ok(error instanceof ParseError);
      assert.equal(error.line, 1);
      assert.match(error.message, /第 1 行/);
      assert.match(error.message, /event/);
      assert.match(error.message, /artist/);
      assert.equal(error.errors[0].code, "missing_event_artist");
      return true;
    },
  );
});

test("either event or artist alone is enough", () => {
  const eventOnly = parseCsv(" Event ,venue\nHarbor Night,Blue Hall\n");
  assert.equal(eventOnly.rows[0].event, "Harbor Night");
  assert.deepEqual(eventOnly.rows[0].artists, []);
  assert.deepEqual(eventOnly.participants, []);

  const artistOnly = parseCsv("ARTIST,city\n/Copper Kite,Lumen Bay\n");
  assert.deepEqual(artistOnly.rows[0].artists, ["Copper Kite"]);
  assert.equal(artistOnly.rows[0].event, "");
});

test("zero, one, and three participant columns are recognized from the header", () => {
  const none = parseCsv(fixture("participants-0.csv"));
  assert.deepEqual(none.participants, []);
  assert.equal(none.rows.length, 4);
  assert.equal(none.rows[0].price, 180);
  assert.equal(none.rows[1].price, null);
  assert.equal(none.rows[2].price, null);
  assert.equal(none.rows[3].price, 0);
  assert.equal(none.rows[0].no, "7");
  assert.equal(none.rows[0].region, "East");
  assert.equal(none.rows[0].type, "solo");

  const one = parseCsv(fixture("participants-1.csv"));
  assert.deepEqual(one.participants, [{ column: "mika", label: "mika" }]);
  assert.deepEqual(one.rows.map((row) => attendedOf(row)), [
    { mika: true },
    { mika: false },
    { mika: true },
  ]);

  const three = parseCsv(fixture("participants-3.csv"));
  assert.deepEqual(three.participants, [
    { column: "mika", label: "mika" },
    { column: "sora", label: "sora" },
    { column: "jun", label: "jun" },
  ]);
  assert.deepEqual(three.rows.map((row) => attendedOf(row)), [
    { mika: true, sora: true, jun: true },
    { mika: true, sora: true, jun: true },
    { mika: true, sora: true, jun: false },
    { mika: false, sora: false, jun: false },
    { mika: true, sora: true, jun: true },
  ]);
});

test("people config relabels and reorders existing columns and cannot add one", () => {
  const csv = "date,event,mika,sora,jun\n2024-05-01,Lantern Fest,1,0,yes\n";
  const result = parseCsv(csv, {
    people: [
      { column: "Jun", label: "Jun A." },
      { column: "mika", label: "Mika B." },
    ],
  });
  assert.deepEqual(result.participants, [
    { column: "jun", label: "Jun A." },
    { column: "mika", label: "Mika B." },
    { column: "sora", label: "sora" },
  ]);
  assert.deepEqual(attendedOf(result.rows[0]), {
    jun: true,
    mika: true,
    sora: false,
  });

  assert.throws(
    () => parseCsv(csv, { people: [{ column: "kira", label: "Kira" }] }),
    (error) => {
      assert.equal(error.line, 1);
      assert.match(error.message, /第 1 行/);
      assert.match(error.message, /kira/);
      return true;
    },
  );
});

test("attendance marks match the schema list and other values do not", () => {
  for (const mark of ATTENDED_VALUES) {
    assert.equal(isAttended(mark), true);
    assert.equal(isAttended(` ${mark.toUpperCase()} `), true);
  }
  for (const mark of ["", "0", "no", "false", "ye", "\u274C", "2"]) {
    assert.equal(isAttended(mark), false);
  }
});

test("duplicate headers report line 1", () => {
  assert.throws(
    () => parseCsv("date,Date,event\n2024-01-01,2024-01-02,Show\n"),
    (error) => {
      assert.equal(error.line, 1);
      assert.match(error.message, /重复的列/);
      return true;
    },
  );
});

test("the parser loads vendored PapaParse and does not touch the DOM", () => {
  const parseSource = readFileSync(new URL("../app/parse.js", import.meta.url), "utf8");
  const schemaSource = readFileSync(new URL("../app/schema.js", import.meta.url), "utf8");
  assert.match(parseSource, /papaparse-5\.7\.0\.min\.js/);
  assert.doesNotMatch(parseSource, /\bdocument\b/);
  assert.doesNotMatch(parseSource, /\bwindow\b/);
  assert.doesNotMatch(schemaSource, /\bdocument\b/);
  assert.doesNotMatch(schemaSource, /papaparse/);
});

test("CLI prints the row count and participant columns", () => {
  const run = spawnSync(
    process.execPath,
    ["tools/parse_csv.mjs", "tests/fixtures/participants-3.csv"],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "rows: 5\nparticipants: [mika, sora, jun]\n");

  const none = spawnSync(
    process.execPath,
    ["tools/parse_csv.mjs", "tests/fixtures/participants-0.csv"],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(none.status, 0, none.stderr);
  assert.equal(none.stdout, "rows: 4\nparticipants: []\n");

  const bad = spawnSync(
    process.execPath,
    ["tools/parse_csv.mjs", "tests/fixtures/bad-date.csv"],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /第 3 行/);
});

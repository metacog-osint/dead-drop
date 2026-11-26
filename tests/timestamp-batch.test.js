// Timestamp batch reading. References: ISO 8601-1:2019 and RFC 3339 (date-time with offset), RFC 5322 section 3.3
// (day-name, day month year, numeric offset) and section 4.3 (two-digit years: 00-69 = 20xx), POSIX Unix time
// (seconds since 1970-01-01T00:00:00Z, no leap seconds), the military zone letters (A = UTC+1 ... I = UTC+9,
// K = UTC+10 ... M = UTC+12, N = UTC-1 ... Y = UTC-12, Z = UTC, J = local), and the IANA rules for America/Chicago.
// Worked examples by hand:
//   1729952400 s: 1729952400 / 86400 = 20022 days + 51600 s. 1970 to 2024 is 54 years with 13 leap days = 19723 days,
//     so day 299 of 2024 counting from 0 = 26 October (leap year: Jan-Sep is 274 days); 51600 s = 14:20:00.
//     So 2024-10-26T14:20:00Z.  1700000000 s = 2023-11-14T22:13:20Z (the widely quoted "1.7 billion" moment).
//   DTG 261430ZOCT25 = 2025-10-26T14:30Z; 261430ROCT25 is 14:30 at UTC-5, so 19:30Z.
//   2025-10-26T14:30:00.250-05:00 = 19:30:00.250Z.
//   Chicago source zone: 2026-03-08 02:30 is skipped (read as 08:30Z); 2026-11-01 01:30 repeats (first is 06:30Z).
//   Span from 2025-10-26T14:30Z to 2025-10-27T08:00Z = 17 h 30 min.
const test = require("node:test");
const assert = require("node:assert/strict");
const B = require("../site/lib/timestamp-batch.js");

const Z = (s) => Date.parse(s);
const read = (s, o) => B.parseLine(s, o);

test("batch: Unix time", () => {
  assert.equal(read("1729952400").ms, Z("2024-10-26T14:20:00Z"));
  assert.equal(read("1700000000").ms, Z("2023-11-14T22:13:20Z"));
  assert.equal(read("1700000000000").ms, Z("2023-11-14T22:13:20Z"));
  assert.equal(read("1700000000000").kind, "Unix milliseconds");
  assert.equal(read("1700000000.5").ms, Z("2023-11-14T22:13:20.500Z"));
  assert.equal(read("2025").ok, false);
  assert.equal(read("123456789012345").ok, false);
});

test("batch: ISO 8601 and RFC 3339", () => {
  assert.equal(read("2025-10-26T14:30:00Z").ms, Z("2025-10-26T14:30:00Z"));
  assert.equal(read("2025-10-26 14:30:00 UTC").ms, Z("2025-10-26T14:30:00Z"));
  assert.equal(read("2025-10-26T14:30:00.250-05:00").ms, Z("2025-10-26T19:30:00.250Z"));
  assert.equal(read("2025-10-26T14:30+0530").ms, Z("2025-10-26T09:00:00Z"));
  assert.equal(read("20251026T143000Z").ms, Z("2025-10-26T14:30:00Z"));
  assert.equal(read("2025-10-26").ms, Z("2025-10-26T00:00:00Z"));
  // With no zone of its own, the line is a clock in the source zone (UTC-5 in October in Chicago).
  assert.equal(read("2025-10-26 14:30", { sourceZone: "America/Chicago" }).ms, Z("2025-10-26T19:30:00Z"));
});

test("batch: clock changes in the source zone are flagged", () => {
  const gap = read("2026-03-08 02:30", { sourceZone: "America/Chicago" });
  assert.equal(gap.status, "skipped");
  assert.equal(gap.ms, Z("2026-03-08T08:30:00Z"));
  const rep = read("2026-11-01 01:30", { sourceZone: "America/Chicago" });
  assert.equal(rep.status, "ambiguous");
  assert.equal(rep.ms, Z("2026-11-01T06:30:00Z"));
  assert.equal(rep.notes.length, 1);
  // An explicit offset settles it: no flag.
  assert.equal(read("2026-11-01T01:30-06:00", { sourceZone: "America/Chicago" }).ms, Z("2026-11-01T07:30:00Z"));
  assert.equal(read("2026-11-01T01:30-06:00", { sourceZone: "America/Chicago" }).status, "ok");
});

test("batch: month names, numeric dates and date-time groups", () => {
  assert.equal(read("Oct 26, 2025 14:30 UTC").ms, Z("2025-10-26T14:30:00Z"));
  assert.equal(read("26 October 2025 2:30 pm").ms, Z("2025-10-26T14:30:00Z"));
  assert.equal(read("Sun, 26 Oct 2025 14:30:00 +0000").ms, Z("2025-10-26T14:30:00Z"));
  assert.equal(read("Oct 26 2025 12:05 am").ms, Z("2025-10-26T00:05:00Z"));
  assert.equal(read("26/10/2025 14:30").ms, Z("2025-10-26T14:30:00Z"));
  const forced = read("26/10/2025 14:30", { order: "mdy" });
  assert.equal(forced.ms, Z("2025-10-26T14:30:00Z"));
  assert.match(forced.notes[0], /only possible/);
  assert.equal(read("03/04/2026 10:00", { order: "dmy" }).ms, Z("2026-04-03T10:00:00Z"));
  assert.equal(read("03/04/2026 10:00", { order: "mdy" }).ms, Z("2026-03-04T10:00:00Z"));
  assert.match(read("03/04/2026 10:00").notes[0], /other order/);
  assert.equal(read("261430ZOCT25").ms, Z("2025-10-26T14:30:00Z"));
  assert.equal(read("261430ROCT25").ms, Z("2025-10-26T19:30:00Z"));
  assert.equal(read("261430Z OCT 2025").ms, Z("2025-10-26T14:30:00Z"));
  assert.deepEqual(["A", "I", "K", "M", "N", "Y", "Z"].map(B.militaryOffset), [60, 540, 600, 720, -60, -720, 0]);
  assert.equal(B.militaryOffset("J"), null);
  assert.equal(read("261430JOCT25").ok, false);
});

test("batch: bad lines are kept with a reason", () => {
  ["hello", "2025-02-29 10:00", "2025-10-26 14:30 EST", "31/31/2025", "2025-10-26 25:00", "13 Foo 2025",
    "Oct 26, 2025 13:30 pm"].forEach((s) => {
    const r = read(s);
    assert.equal(r.ok, false, s);
    assert.ok(r.error.length > 0, s);
  });
  const all = B.convertAll("2025-10-26T14:30:00Z\nnot a time\n\n2025-10-27T08:00:00Z\n", { targets: ["UTC", "America/Chicago"] });
  assert.equal(all.rows.length, 3);
  assert.equal(all.read, 2);
  assert.equal(all.failed, 1);
  assert.equal(all.rows[1].line, 2);
  assert.equal(all.spanText, "17 h 30 min");
  assert.equal(all.rows[0].out[1], "2025-10-26 09:30:00 CDT");
  assert.throws(() => B.convertAll("x", { sourceZone: "Not/AZone" }));
});

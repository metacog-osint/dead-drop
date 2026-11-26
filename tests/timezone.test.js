// Time zone conversion. Reference: the IANA tz database rules, read through ECMA-402 Intl.DateTimeFormat.
// Worked examples, from the published rules, not from running the code:
//   US Central (America/Chicago), Energy Policy Act of 2005 rule: DST from 02:00 local on the second Sunday of March
//   to 02:00 local on the first Sunday of November. In 2026 those Sundays are 8 March and 1 November.
//     8 Mar 2026 01:59 CST (UTC-6) = 07:59Z.   02:00-02:59 does not exist (clock jumps to 03:00 CDT, UTC-5).
//     02:30 is read as 08:30Z (02:30 + 6 h), which the clock shows as 03:30 CDT.   03:00 CDT = 08:00Z.
//     1 Nov 2026 01:30 happens twice: 01:30 CDT = 06:30Z, then 01:30 CST = 07:30Z.   02:00 CST = 08:00Z.
//   UK (Europe/London): BST from 01:00 UTC on the last Sunday of March (29 Mar 2026): 01:30 local is skipped.
//   Sydney (Australia/Sydney): AEDT ends 03:00 local on the first Sunday of April (5 Apr 2026), back to 02:00 AEST
//     (UTC+10): 02:30 happens at 15:30Z on 4 Apr (UTC+11) and again at 16:30Z (UTC+10).
//   India (Asia/Kolkata) is UTC+5:30 all year; Nepal (Asia/Kathmandu) UTC+5:45.
//   Kiritimati (Pacific/Kiritimati) is UTC+14, Pago Pago (Pacific/Pago_Pago) UTC-11: 25 hours apart, so the same
//   instant falls on different calendar dates two days apart in some hours.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const tz = require("../site/lib/timezone.js");

const Z = (s) => Date.parse(s);

test("timezone: Chicago spring forward, 8 Mar 2026", () => {
  const a = tz.localToUtc("America/Chicago", 2026, 3, 8, 1, 59, 0);
  assert.equal(a.status, "ok");
  assert.equal(a.utcMs, Z("2026-03-08T07:59:00Z"));
  const gap = tz.localToUtc("America/Chicago", 2026, 3, 8, 2, 30, 0);
  assert.equal(gap.status, "skipped");
  assert.equal(gap.utcMs, Z("2026-03-08T08:30:00Z"));
  assert.match(gap.note, /forward by 60 minutes/);
  assert.equal(tz.wallString(tz.wallTime("America/Chicago", gap.utcMs)), "2026-03-08 03:30:00");
  const b = tz.localToUtc("America/Chicago", 2026, 3, 8, 3, 0, 0);
  assert.equal(b.status, "ok");
  assert.equal(b.utcMs, Z("2026-03-08T08:00:00Z"));
  assert.equal(tz.offsetMinutes("America/Chicago", Z("2026-03-08T07:59:59Z")), -360);
  assert.equal(tz.offsetMinutes("America/Chicago", Z("2026-03-08T08:00:00Z")), -300);
});

test("timezone: Chicago fall back, 1 Nov 2026", () => {
  const a = tz.localToUtc("America/Chicago", 2026, 11, 1, 1, 30, 0);
  assert.equal(a.status, "ambiguous");
  assert.deepEqual(a.candidates, [Z("2026-11-01T06:30:00Z"), Z("2026-11-01T07:30:00Z")]);
  assert.equal(a.utcMs, Z("2026-11-01T06:30:00Z"));
  assert.match(a.note, /UTC-05:00.*UTC-06:00/);
  const b = tz.localToUtc("America/Chicago", 2026, 11, 1, 2, 0, 0);
  assert.equal(b.status, "ok");
  assert.equal(b.utcMs, Z("2026-11-01T08:00:00Z"));
  const c = tz.localToUtc("America/Chicago", 2026, 11, 1, 0, 59, 0);
  assert.equal(c.utcMs, Z("2026-11-01T05:59:00Z"));
  const n = tz.nextTransition("America/Chicago", Z("2026-06-01T00:00:00Z"));
  assert.equal(n.atMs, Z("2026-11-01T07:00:00Z"));
  assert.deepEqual([n.fromMinutes, n.toMinutes], [-300, -360]);
  assert.equal(tz.nextTransition("America/Chicago", Z("2026-01-01T00:00:00Z")).atMs, Z("2026-03-08T08:00:00Z"));
});

test("timezone: other zones, both hemispheres and half-hour offsets", () => {
  assert.equal(tz.localToUtc("Europe/London", 2026, 3, 29, 1, 30, 0).status, "skipped");
  assert.equal(tz.localToUtc("Europe/London", 2026, 3, 29, 2, 0, 0).utcMs, Z("2026-03-29T01:00:00Z"));
  const syd = tz.localToUtc("Australia/Sydney", 2026, 4, 5, 2, 30, 0);
  assert.equal(syd.status, "ambiguous");
  assert.deepEqual(syd.candidates, [Z("2026-04-04T15:30:00Z"), Z("2026-04-04T16:30:00Z")]);
  assert.equal(tz.offsetMinutes("Asia/Kolkata", Z("2026-07-01T00:00:00Z")), 330);
  assert.equal(tz.offsetMinutes("Asia/Kathmandu", Z("2026-07-01T00:00:00Z")), 345);
  assert.equal(tz.offsetLabel(330), "UTC+05:30");
  assert.equal(tz.offsetLabel(-360), "UTC-06:00");
  assert.equal(tz.localToUtc("UTC", 2026, 2, 28, 23, 59, 59).utcMs, Z("2026-02-28T23:59:59Z"));
  assert.equal(tz.isDst("America/Chicago", Z("2026-07-01T12:00:00Z")), true);
  assert.equal(tz.isDst("America/Chicago", Z("2026-12-01T12:00:00Z")), false);
  assert.equal(tz.isDst("Australia/Sydney", Z("2026-01-15T00:00:00Z")), true);
  assert.equal(tz.isDst("Asia/Tokyo", Z("2026-07-01T00:00:00Z")), false);
});

test("timezone: convert across the date line", () => {
  // 10:30Z on 1 Jul 2026: Kiritimati (UTC+14) reads 00:30 on 2 Jul, Pago Pago (UTC-11) 23:30 on 30 Jun.
  const r = tz.convert("2026-07-01T10:30", "UTC", ["Pacific/Kiritimati", "Pacific/Pago_Pago", "America/Chicago"]);
  assert.equal(r.utc, "2026-07-01T10:30:00Z");
  assert.equal(r.rows[0].wall, "2026-07-02 00:30:00");
  assert.equal(r.rows[0].dayOffset, 1);
  assert.equal(r.rows[1].wall, "2026-06-30 23:30:00");
  assert.equal(r.rows[1].dayOffset, -1);
  assert.equal(r.rows[2].wall, "2026-07-01 05:30:00");
  assert.equal(r.rows[2].abbr, "CDT");
  // From Chicago in the repeated hour: the first instant, with the second given.
  const f = tz.convert("2026-11-01 01:30", "America/Chicago", ["UTC"]);
  assert.equal(f.status, "ambiguous");
  assert.equal(f.utc, "2026-11-01T06:30:00Z");
  assert.equal(f.alternativeUtc, "2026-11-01T07:30:00Z");
});

test("timezone: every zone in the suite's list is here and known", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "site", "tic-time.js"), "utf8");
  const block = src.slice(src.indexOf("var ZONES"), src.indexOf("];", src.indexOf("var ZONES")));
  const ids = [...block.matchAll(/\["([^"]+)",/g)].map((m) => m[1]);
  assert.ok(ids.length >= 20, "found the suite list");
  const mine = tz.SUITE_ZONES.map((z) => z[0]);
  ids.forEach((id) => assert.ok(mine.includes(id), id + " is in SUITE_ZONES"));
  tz.SUITE_ZONES.concat(tz.EXTRA_ZONES).forEach((z) => assert.ok(tz.validZone(z[0]), z[0]));
  tz.SITES.forEach((s) => assert.ok(tz.validZone(s.zone), s.zone));
});

test("timezone: rejects bad input", () => {
  assert.equal(tz.validZone("Mars/Olympus_Mons"), false);
  assert.equal(tz.validZone(""), false);
  assert.throws(() => tz.localToUtc("Mars/Olympus_Mons", 2026, 1, 1, 0, 0, 0), /time zone/);
  assert.throws(() => tz.localToUtc("UTC", 2026, 2, 29, 0, 0, 0), /28 days/);
  assert.throws(() => tz.localToUtc("UTC", 2026, 13, 1, 0, 0, 0));
  assert.throws(() => tz.localToUtc("UTC", 2026, 1, 1, 24, 0, 0));
  assert.throws(() => tz.parseLocal("26/10/2025 14:30"));
  assert.throws(() => tz.wallTime("UTC", NaN));
  assert.deepEqual(tz.parseLocal("2028-02-29T23:59"), { y: 2028, mo: 2, d: 29, h: 23, mi: 59, s: 0 });
});

// Evidence Capture. References: WHATWG URL Standard and RFC 3986 (scheme, user info, host, fragment); Internet
// Archive "Wayback Machine APIs" (availability API answer shape; 14-digit YYYYMMDDhhmmss UTC timestamps, shorter
// prefixes accepted); RFC 4180 (CSV quoting, CRLF); OWASP "CSV Injection" (leading = + - @ tab CR neutralised with
// an apostrophe); RFC 1918 / RFC 3927 / RFC 6598 private, link-local and shared address ranges.
// Worked examples by hand:
//   The availability API's documented example: {"archived_snapshots": {"closest": {"available": true,
//     "url": "http://web.archive.org/web/20130919044612/http://example.com/", "timestamp": "20130919044612",
//     "status": "200"}}} is 2013-09-19 04:46:12 UTC = Date.UTC(2013, 8, 19, 4, 46, 12); the capture link is given as
//     https.
//   Timestamp "2006" pads to 20060101000000 = Date.UTC(2006, 0, 1). 20240229 is a real day (2024 is a leap year);
//     20230229 is not. 2026-11-26 14:05:09 UTC formats as 20261126140509.
//   encodeURIComponent("https://example.com/a?b=1&c=2") = https%3A%2F%2Fexample.com%2Fa%3Fb%3D1%26c%3D2.
//   CSV: a,b -> "a,b"; say "hi" -> "say ""hi"""; =1+1 -> '=1+1; an empty value -> nothing.
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../site/lib/evidence-capture.js");

test("URL normalisation and validation", () => {
  const a = E.normaliseUrl("  Example.COM/Path?q=1#section ");
  assert.equal(a.ok, true);
  assert.equal(a.url, "https://example.com/Path?q=1", "host lower-cased, path and query kept, fragment dropped");
  assert.equal(a.notes.length, 2);
  assert.equal(E.normaliseUrl("http://example.com:80/").url, "http://example.com/", "default port dropped");
  assert.equal(E.normaliseUrl("example.com:8080/x").url, "https://example.com:8080/x", "host:port is not a scheme");
  assert.equal(E.normaliseUrl("https://example.com").url, "https://example.com/");
  assert.equal(E.normaliseUrl("https://example.com").notes.length, 0);
  assert.match(E.normaliseUrl("").error, /Enter/);
  assert.match(E.normaliseUrl("ftp://example.com/file").error, /http and https/);
  assert.match(E.normaliseUrl("javascript:alert(1)").error, /http and https/);
  assert.match(E.normaliseUrl("https://user:pw@example.com/").error, /password/);
  assert.match(E.normaliseUrl("http://localhost:3000/").error, /private or local/);
  assert.match(E.normaliseUrl("http://192.168.1.10/admin").error, /private or local/);
  assert.match(E.normaliseUrl("http://intranet/").error, /private or local/);
  assert.match(E.normaliseUrl("https://exa mple.com").error, /space/);
});

test("private hosts", () => {
  for (const h of ["10.1.2.3", "127.0.0.1", "172.16.0.1", "172.31.255.255", "192.168.0.1", "169.254.1.1", "100.64.0.1", "[::1]", "fe80::1", "fd00::1", "printer.local"]) {
    assert.equal(E.isPrivateHost(h), true, h);
  }
  for (const h of ["8.8.8.8", "172.32.0.1", "example.com", "2001:db8::1"]) assert.equal(E.isPrivateHost(h), false, h);
});

test("Wayback timestamps", () => {
  assert.equal(E.parseTimestamp("20130919044612"), Date.UTC(2013, 8, 19, 4, 46, 12));
  assert.equal(E.parseTimestamp("2006"), Date.UTC(2006, 0, 1));
  assert.equal(E.parseTimestamp("200607"), Date.UTC(2006, 6, 1));
  assert.equal(E.parseTimestamp("20240229"), Date.UTC(2024, 1, 29));
  assert.ok(Number.isNaN(E.parseTimestamp("20230229")), "not a leap year");
  assert.ok(Number.isNaN(E.parseTimestamp("20241301")), "month 13");
  assert.ok(Number.isNaN(E.parseTimestamp("20240101246000")), "hour 24");
  assert.ok(Number.isNaN(E.parseTimestamp("2024011")), "odd length");
  assert.ok(Number.isNaN(E.parseTimestamp("abc")));
  assert.equal(E.formatTimestamp(Date.UTC(2026, 10, 26, 14, 5, 9)), "20261126140509");
  assert.equal(E.formatTimestamp(NaN), "");
  assert.equal(E.utcText(Date.UTC(2026, 10, 26, 14, 5, 9)), "2026-11-26 14:05:09 UTC");
  const t = Date.UTC(2001, 2, 4, 5, 6, 7);
  assert.equal(E.parseTimestamp(E.formatTimestamp(t)), t, "round trip");
});

test("archive links", () => {
  const u = "https://example.com/a?b=1&c=2";
  assert.equal(E.availabilityUrl(u, Date.UTC(2006, 0, 1)),
    "https://archive.org/wayback/available?url=https%3A%2F%2Fexample.com%2Fa%3Fb%3D1%26c%3D2&timestamp=20060101000000");
  assert.equal(E.availabilityUrl(u), "https://archive.org/wayback/available?url=https%3A%2F%2Fexample.com%2Fa%3Fb%3D1%26c%3D2");
  assert.equal(E.savePageNowUrl(u), "https://web.archive.org/save/https://example.com/a?b=1&c=2");
  assert.equal(E.waybackCalendarUrl(u), "https://web.archive.org/web/*/https://example.com/a?b=1&c=2");
  assert.equal(E.waybackCaptureUrl(u, "2006"), "https://web.archive.org/web/2006/https://example.com/a?b=1&c=2");
  assert.equal(E.archiveTodayUrl(u), "https://archive.ph/?url=https%3A%2F%2Fexample.com%2Fa%3Fb%3D1%26c%3D2");
});

test("availability answers", () => {
  const found = E.parseAvailability({ url: "example.com", archived_snapshots: { closest: { status: "200", available: true,
    url: "http://web.archive.org/web/20130919044612/http://example.com/", timestamp: "20130919044612" } } });
  assert.equal(found.found, true);
  assert.equal(found.url, "https://web.archive.org/web/20130919044612/http://example.com/");
  assert.equal(found.timeMs, Date.UTC(2013, 8, 19, 4, 46, 12));
  assert.equal(found.status, "200");
  assert.deepEqual(E.parseAvailability({ url: "example.com/none", archived_snapshots: {} }), { found: false, askedUrl: "example.com/none" });
  assert.equal(E.parseAvailability({ archived_snapshots: { closest: { available: false, url: "x" } } }).found, false);
  assert.throws(() => E.parseAvailability(null), /no answer/);
});

test("Wayback capture addresses", () => {
  assert.deepEqual(E.parseWaybackUrl("https://web.archive.org/web/20130919044612/http://example.com/"),
    { timestamp: "20130919044612", timeMs: Date.UTC(2013, 8, 19, 4, 46, 12), original: "http://example.com/" });
  assert.equal(E.parseWaybackUrl("http://web.archive.org/web/20130919044612id_/http://example.com/").original, "http://example.com/");
  assert.equal(E.parseWaybackUrl("https://archive.ph/AbCdE"), null);
  assert.equal(E.parseWaybackUrl("https://web.archive.org/web/20131399000000/http://x.com/"), null, "month 13");
  assert.equal(E.archiveName("https://archive.ph/AbCdE"), "archive.today");
  assert.equal(E.archiveName("https://web.archive.org/web/2013/http://x.com/"), "the Internet Archive Wayback Machine");
  assert.equal(E.archiveName("https://ghostarchive.org/archive/abc"), "ghostarchive.org");
});

test("CSV escaping", () => {
  assert.equal(E.csvCell("a,b"), '"a,b"');
  assert.equal(E.csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(E.csvCell("line\nbreak"), '"line\nbreak"');
  assert.equal(E.csvCell(" padded"), '" padded"');
  assert.equal(E.csvCell("=1+1"), "'=1+1");
  assert.equal(E.csvCell("@SUM(A1)"), "'@SUM(A1)");
  assert.equal(E.csvCell("-5"), "'-5");
  assert.equal(E.csvCell("=1+1", false), "=1+1", "guard off");
  assert.equal(E.csvCell(null), "");
  assert.equal(E.csvCell(42), "42");
  assert.equal(E.toCsv([{ a: "x", b: "y,z" }, { a: null, b: "q" }], [["a", "A"], ["b", "B"]]), 'A,B\r\nx,"y,z"\r\n,q\r\n');
});

test("citation and log entries", () => {
  const e = E.makeEntry({ url: "http://example.com/", title: "Example Domain", askedMs: Date.UTC(2026, 10, 26, 14, 5, 9),
    captureUrl: "https://web.archive.org/web/20130919044612/http://example.com/", how: "Wayback availability check", note: "first" });
  assert.equal(e.captureTimestamp, "20130919044612");
  assert.equal(e.captureTimeMs, Date.UTC(2013, 8, 19, 4, 46, 12));
  assert.equal(e.archive, "the Internet Archive Wayback Machine");
  assert.equal(E.citation(e),
    "“Example Domain.” http://example.com/. Archived by the Internet Archive Wayback Machine, captured " +
    "2013-09-19 04:46:12 UTC: https://web.archive.org/web/20130919044612/http://example.com/. Checked 2026-11-26 14:05:09 UTC.");
  const none = E.makeEntry({ url: "https://example.org/", askedMs: Date.UTC(2026, 0, 1) });
  assert.equal(E.citation(none), "“Untitled page.” https://example.org/. No archived copy recorded. Checked 2026-01-01 00:00:00 UTC.");
  const at = E.makeEntry({ url: "https://example.org/", askedMs: Date.UTC(2026, 0, 1), captureUrl: "https://archive.ph/AbCdE",
    captureTimeMs: Date.UTC(2026, 0, 1, 0, 3) });
  assert.equal(at.archive, "archive.today");
  assert.equal(at.captureTimestamp, "20260101000300");
  const rows = E.exportRows([e]);
  assert.equal(rows[0].captureUtc, "2013-09-19 04:46:12 UTC");
  assert.equal(rows[0].askedUtc, "2026-11-26 14:05:09 UTC");
  const csv = E.toCsv(rows, E.LOG_COLUMNS);
  assert.ok(csv.startsWith("Time asked (UTC),Page URL,Title,Archive,"));
  assert.equal(csv.split("\r\n").length, 3, "header, one row, final CRLF");
});

test("stored log cleaning and time gaps", () => {
  const list = E.cleanLog([{ url: "https://a.example/", askedMs: 1, captureTimeMs: "x" }, { url: 5, askedMs: 2 }, null, { url: "b", askedMs: NaN }]);
  assert.equal(list.length, 1);
  assert.equal(list[0].captureTimeMs, null);
  assert.deepEqual(E.cleanLog("nope"), []);
  assert.equal(E.gapText((3 * 24 + 4) * 3600000), "3 days 4 h");
  assert.equal(E.gapText(-90 * 60000), "1 h 30 min");
  assert.equal(E.gapText(59.6 * 60000), "1 h");
  assert.equal(E.gapText(0), "0 min");
});

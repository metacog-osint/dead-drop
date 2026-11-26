/* Evidence capture: URL checks, Wayback Machine timestamps and links, the availability API's answer, a capture
   log's CSV and JSON, and a citation line. No DOM, no network.
   References:
   - URLs: WHATWG URL Standard (the URL parser browsers and Node share); RFC 3986 for scheme, authority and fragment.
     The fragment (after #) is never sent to a server, so it is dropped.
   - Wayback Machine: the availability API (archive.org/wayback/available?url=...&timestamp=...) answers with
     archived_snapshots.closest {available, url, timestamp, status}; Wayback timestamps are 14 digits,
     YYYYMMDDhhmmss, in UTC, and shorter prefixes (YYYY, YYYYMM, ...) are accepted by the Wayback Machine.
     Internet Archive developer documentation, "Wayback Machine APIs".
   - CSV: RFC 4180 (fields with a comma, double quote, CR or LF go in double quotes, quotes doubled; CRLF line
     ends). Cells that start with =, +, -, @, tab or CR get a leading apostrophe, so a spreadsheet does not run them
     as a formula (OWASP, "CSV Injection"). */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.DD = root.DD || {}).evidenceCapture = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var URL_ = typeof URL === "function" ? URL : null;

  function pad(n, w) { var s = String(n); while (s.length < w) s = "0" + s; return s; }

  /** True for hosts the Internet Archive cannot reach: localhost, single-label names, private, loopback and
   *  link-local IPv4 ranges (RFC 1918, RFC 3927), and IPv6 loopback, link-local and unique-local addresses. */
  function isPrivateHost(host) {
    var h = String(host || "").toLowerCase().replace(/^\[|\]$/g, "");
    if (!h) return true;
    if (h === "localhost" || /\.localhost$/.test(h) || /\.local$/.test(h) || /\.internal$/.test(h)) return true;
    var m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
    if (m) {
      var a = +m[1], b = +m[2];
      return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
    }
    if (h.indexOf(":") >= 0) return h === "::1" || /^fe[89ab]/.test(h) || /^f[cd]/.test(h) || h === "::";
    return h.indexOf(".") < 0;
  }

  /** Cleans a typed address into the form the archives are asked about: adds https:// when no scheme is given,
   *  allows only http and https, refuses addresses with a user name or password, refuses private hosts, drops the
   *  fragment. Host case and default ports are normalised by the URL parser; path and query are kept as given.
   *  Returns {ok: true, url, notes} or {ok: false, error}. */
  function normaliseUrl(input) {
    var s = String(input || "").trim();
    if (!s) return { ok: false, error: "Enter the address of the page." };
    if (/\s/.test(s)) return { ok: false, error: "The address has a space in it; check that it was copied whole." };
    var notes = [];
    if (!/^[a-z][a-z0-9+.-]*:/i.test(s) || /^[^:/]+:\d+(\/|$)/.test(s)) { s = "https://" + s.replace(/^\/+/, ""); notes.push("No scheme was given, so https:// was added."); }
    if (!URL_) return { ok: false, error: "This browser cannot parse addresses." };
    var u;
    try { u = new URL_(s); } catch (e) { return { ok: false, error: "That is not a web address." }; }
    if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false, error: "Only http and https pages can be archived." };
    if (u.username || u.password) return { ok: false, error: "The address has a user name or password in it; remove it before sending it to an archive." };
    if (isPrivateHost(u.hostname)) return { ok: false, error: "That is a private or local address; a public archive cannot reach it." };
    if (u.hash) { notes.push("The part after # was dropped: it is never sent to the site, so archives ignore it."); u.hash = ""; }
    return { ok: true, url: u.href, notes: notes };
  }

  /** Wayback timestamp (4 to 14 digits, UTC) to milliseconds; missing parts take their earliest value. NaN when
   *  the digits are not a real date and time. */
  function parseTimestamp(ts) {
    var s = String(ts === undefined || ts === null ? "" : ts).trim();
    if (!/^\d{4,14}$/.test(s) || s.length % 2) return NaN;
    var full = s + "00000101000000".slice(s.length);
    var y = +full.slice(0, 4), mo = +full.slice(4, 6), d = +full.slice(6, 8), h = +full.slice(8, 10), mi = +full.slice(10, 12), se = +full.slice(12, 14);
    if (mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || se > 59) return NaN;
    var t = Date.UTC(y, mo - 1, d, h, mi, se);
    return new Date(t).getUTCDate() === d ? t : NaN;
  }
  /** Milliseconds to a 14-digit Wayback timestamp in UTC. */
  function formatTimestamp(ms) {
    if (typeof ms !== "number" || !isFinite(ms)) return "";
    var d = new Date(ms);
    if (d.getUTCFullYear() < 1000 || d.getUTCFullYear() > 9999) return "";
    return pad(d.getUTCFullYear(), 4) + pad(d.getUTCMonth() + 1, 2) + pad(d.getUTCDate(), 2) +
      pad(d.getUTCHours(), 2) + pad(d.getUTCMinutes(), 2) + pad(d.getUTCSeconds(), 2);
  }
  /** "2026-11-26 14:05:09 UTC" */
  function utcText(ms) {
    if (typeof ms !== "number" || !isFinite(ms)) return "";
    return new Date(ms).toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
  }

  function availabilityUrl(url, timeMs) {
    var q = "https://archive.org/wayback/available?url=" + encodeURIComponent(url);
    var ts = formatTimestamp(timeMs);
    return ts ? q + "&timestamp=" + ts : q;
  }
  function savePageNowUrl(url) { return "https://web.archive.org/save/" + url; }
  function waybackCaptureUrl(url, ts) { return "https://web.archive.org/web/" + (ts || "") + "/" + url; }
  function waybackCalendarUrl(url) { return "https://web.archive.org/web/*/" + url; }
  /** archive.today's form, filled in with the address, for the user to submit there. */
  function archiveTodayUrl(url) { return "https://archive.ph/?url=" + encodeURIComponent(url); }

  /** The availability API's answer: {found: false} or {found: true, url, timestamp, timeMs, status}. The capture
   *  URL is given as https. */
  function parseAvailability(resp) {
    if (!resp || typeof resp !== "object") throw new Error("The Wayback Machine sent no answer.");
    var c = resp.archived_snapshots && resp.archived_snapshots.closest;
    if (!c || c.available === false || !c.url) return { found: false, askedUrl: resp.url || null };
    var t = parseTimestamp(c.timestamp);
    return { found: true, askedUrl: resp.url || null, url: String(c.url).replace(/^http:\/\//i, "https://"),
      timestamp: String(c.timestamp), timeMs: isFinite(t) ? t : null, status: c.status ? String(c.status) : null };
  }
  /** A Wayback capture address split into its timestamp and the original address, or null. */
  function parseWaybackUrl(s) {
    var m = /^https?:\/\/(?:web\.)?archive\.org\/web\/(\d{4,14})(?:[a-z]{2}_|\*)?\/(.+)$/i.exec(String(s || "").trim());
    if (!m) return null;
    var t = parseTimestamp(m[1]);
    return isFinite(t) ? { timestamp: m[1], timeMs: t, original: m[2] } : null;
  }

  function csvCell(v, guard) {
    var s = v === null || v === undefined ? "" : String(v);
    if (guard !== false && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  /** rows: objects; columns: [[key, heading], ...]. RFC 4180 text with CRLF line ends and a header line. */
  function toCsv(rows, columns, guard) {
    var lines = [columns.map(function (c) { return csvCell(c[1], guard); }).join(",")];
    (rows || []).forEach(function (r) { lines.push(columns.map(function (c) { return csvCell(r[c[0]], guard); }).join(",")); });
    return lines.join("\r\n") + "\r\n";
  }

  var LOG_COLUMNS = [["askedUtc", "Time asked (UTC)"], ["url", "Page URL"], ["title", "Title"], ["archive", "Archive"],
    ["captureUrl", "Archived copy URL"], ["captureTimestamp", "Archive timestamp"], ["captureUtc", "Archive time (UTC)"],
    ["how", "How recorded"], ["note", "Note"], ["citation", "Citation"]];

  /** A citation line: title, address, archived address, archive time in UTC. */
  function citation(e) {
    var t = e.title && String(e.title).trim() ? String(e.title).trim().replace(/\.$/, "") : "Untitled page";
    var s = "“" + t + ".” " + e.url + ".";
    if (e.captureUrl) {
      var when = e.captureTimeMs !== null && e.captureTimeMs !== undefined && isFinite(e.captureTimeMs) ? ", captured " + utcText(e.captureTimeMs) : "";
      s += " Archived by " + (e.archive || "the Internet Archive Wayback Machine") + when + ": " + e.captureUrl + ".";
    } else s += " No archived copy recorded.";
    if (isFinite(e.askedMs)) s += " Checked " + utcText(e.askedMs) + ".";
    return s;
  }

  /** Which archive a capture address belongs to, from its host. */
  function archiveName(captureUrl) {
    if (!captureUrl) return "";
    if (parseWaybackUrl(captureUrl)) return "the Internet Archive Wayback Machine";
    var m = /^https?:\/\/([^\/?#]+)/i.exec(String(captureUrl));
    var h = m ? m[1].toLowerCase() : "";
    return /^(www\.)?archive\.(ph|today|is|li|md|vn|fo)$/.test(h) ? "archive.today" : h || "an archive";
  }
  /** Builds a log entry from what the page knows; fills the Wayback timestamp from a Wayback capture address. */
  function makeEntry(o) {
    var w = o.captureUrl ? parseWaybackUrl(o.captureUrl) : null;
    var ts = o.captureTimestamp || (w ? w.timestamp : "");
    var tm = ts ? parseTimestamp(ts) : (isFinite(o.captureTimeMs) ? o.captureTimeMs : NaN);
    var e = { id: o.id || String(o.askedMs) + "-" + Math.floor(Math.random() * 1e6), url: o.url, title: o.title || "",
      archive: o.archive || archiveName(o.captureUrl),
      askedMs: o.askedMs, captureUrl: o.captureUrl || "", captureTimestamp: ts || (isFinite(tm) ? formatTimestamp(tm) : ""),
      captureTimeMs: isFinite(tm) ? tm : null, how: o.how || "", note: o.note || "" };
    return e;
  }
  /** Rows for export: the stored entry plus UTC text and the citation. */
  function exportRows(entries) {
    return (entries || []).map(function (e) {
      return { askedUtc: utcText(e.askedMs), url: e.url, title: e.title, archive: e.archive, captureUrl: e.captureUrl,
        captureTimestamp: e.captureTimestamp, captureUtc: e.captureTimeMs === null ? "" : utcText(e.captureTimeMs),
        how: e.how, note: e.note, citation: citation(e) };
    });
  }
  /** Keeps only well-formed entries read back from browser storage. */
  function cleanLog(list) {
    if (!Array.isArray(list)) return [];
    return list.filter(function (e) {
      return e && typeof e === "object" && typeof e.url === "string" && typeof e.askedMs === "number" && isFinite(e.askedMs);
    }).map(function (e) {
      return { id: String(e.id || e.askedMs), url: e.url, title: String(e.title || ""), archive: String(e.archive || ""),
        askedMs: e.askedMs, captureUrl: String(e.captureUrl || ""), captureTimestamp: String(e.captureTimestamp || ""),
        captureTimeMs: typeof e.captureTimeMs === "number" && isFinite(e.captureTimeMs) ? e.captureTimeMs : null,
        how: String(e.how || ""), note: String(e.note || "") };
    });
  }
  /** "3 days 4 h", the gap between two times, for "capture is ... before / after the time asked". */
  function gapText(ms) {
    var a = Math.abs(ms), d = Math.floor(a / 86400000), h = Math.floor((a % 86400000) / 3600000), m = Math.round((a % 3600000) / 60000);
    if (m === 60) { h++; m = 0; }
    if (d >= 1) return d + " day" + (d === 1 ? "" : "s") + (h ? " " + h + " h" : "");
    if (h >= 1) return h + " h" + (m ? " " + m + " min" : "");
    return m + " min";
  }

  return { isPrivateHost: isPrivateHost, normaliseUrl: normaliseUrl, parseTimestamp: parseTimestamp,
    formatTimestamp: formatTimestamp, utcText: utcText, availabilityUrl: availabilityUrl, savePageNowUrl: savePageNowUrl,
    waybackCaptureUrl: waybackCaptureUrl, waybackCalendarUrl: waybackCalendarUrl, archiveTodayUrl: archiveTodayUrl,
    parseAvailability: parseAvailability, parseWaybackUrl: parseWaybackUrl, csvCell: csvCell, toCsv: toCsv,
    LOG_COLUMNS: LOG_COLUMNS, archiveName: archiveName, citation: citation, makeEntry: makeEntry, exportRows: exportRows, cleanLog: cleanLog,
    gapText: gapText };
});

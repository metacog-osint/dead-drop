/* Read many timestamps, one per line, and give each as one UTC instant. Formats, each read strictly:
     ISO 8601 / RFC 3339       2025-10-26T14:30:00Z, 2025-10-26 14:30, 2025-10-26T14:30:00.250-05:00, 20251026T143000Z
     Unix time                 9 to 11 digits = seconds (1973 to 5138), 12 to 14 digits = milliseconds; decimals allowed
     Month names               26 Oct 2025 14:30 UTC, Oct 26, 2025 2:30 pm, Sun, 26 Oct 2025 14:30:00 +0000 (RFC 5322)
     Numeric dates             26/10/2025 14:30 or 10/26/2025 14:30: day-first or month-first as chosen; a reading
                               that is only possible one way (a first number over 12) is used and said so
     Military date-time group  261430ZOCT25 = day 26, 14:30, zone Z (UTC), October 2025; lettered zones A-Z without J
   A line with no zone of its own is read as a clock in the chosen source zone (IANA), through ./timezone.js, which
   also reports times that a clock change skips or repeats. A line that cannot be read is returned with the reason;
   it is never dropped. References: ISO 8601-1:2019; RFC 3339; RFC 5322 section 3.3; the military time-zone letters of
   ACP 121 / the US DoD (A = UTC+1 ... M = UTC+12, N = UTC-1 ... Y = UTC-12, Z = UTC). No DOM, no network. */
(function (root, factory) {
  var tz = (typeof module === "object" && module.exports) ? require("./timezone.js") : (root.DD && root.DD.timezone);
  var api = factory(tz);
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.DD = root.DD || {}).timestampBatch = api;
})(typeof self !== "undefined" ? self : this, function (tz) {
  "use strict";
  var MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
    january: 1, february: 2, march: 3, april: 4, june: 6, july: 7, august: 8, september: 9, october: 10,
    november: 11, december: 12 };

  /** Military zone letter to minutes east of UTC. J (the observer's local time) has no fixed offset. */
  function militaryOffset(letter) {
    var c = String(letter).toUpperCase();
    if (c === "Z") return 0;
    if (c === "J") return null;
    var code = c.charCodeAt(0);
    if (code >= 65 && code <= 73) return (code - 64) * 60;          // A-I: +1 to +9
    if (code >= 75 && code <= 77) return (code - 65) * 60;          // K-M: +10 to +12
    if (code >= 78 && code <= 89) return -(code - 77) * 60;         // N-Y: -1 to -12
    return null;
  }

  /** "Z", "UTC", "GMT", "+05:30", "-0500", "+05". Returns minutes east of UTC, or undefined when there is no zone. */
  function zoneText(s) {
    if (!s) return undefined;
    s = s.trim();
    if (/^(z|utc|gmt|ut)$/i.test(s)) return 0;
    var m = /^(?:(?:utc|gmt))?([+-])(\d{2}):?(\d{2})?$/i.exec(s);
    if (!m) return NaN;
    var h = +m[2], mi = m[3] ? +m[3] : 0;
    if (h > 14 || mi > 59) return NaN;
    return (m[1] === "-" ? -1 : 1) * (h * 60 + mi);
  }

  function hm(h, mi, s, ampm) {
    h = +h; mi = +mi; s = s ? +s : 0;
    if (ampm) {
      if (h < 1 || h > 12) throw new Error("With am or pm the hour must be 1 to 12.");
      var pm = /^p/i.test(ampm);
      h = (h % 12) + (pm ? 12 : 0);
    }
    return [h, mi, s];
  }

  function fourDigitYear(y) {
    if (y.length === 4) return +y;
    if (y.length === 2) { var n = +y; return n < 70 ? 2000 + n : 1900 + n; } // RFC 5322 section 4.3 window
    throw new Error("Year must have 2 or 4 digits.");
  }

  /** Build the instant from wall-clock fields and either an explicit offset or the source zone. */
  function finish(f, offset, sourceZone, kind, notes) {
    tz.checkWall(f.y, f.mo, f.d, f.h, f.mi, f.s);
    if (offset !== undefined) {
      if (isNaN(offset)) throw new Error("The zone at the end is not one this reads (use Z, UTC or an offset like -05:00).");
      var ms = Date.UTC(f.y, f.mo - 1, f.d, f.h, f.mi, f.s) + (f.frac || 0) - offset * 60000;
      return { ok: true, ms: ms, kind: kind, zoneUsed: tz.offsetLabel(offset), status: "ok", notes: notes };
    }
    var r = tz.localToUtc(sourceZone, f.y, f.mo, f.d, f.h, f.mi, f.s);
    if (r.note) notes.push(r.note);
    return { ok: true, ms: r.utcMs + (f.frac || 0), kind: kind, zoneUsed: sourceZone + " (source zone)", status: r.status, notes: notes };
  }

  /** Read one line. opts: { sourceZone: IANA name, order: "dmy" | "mdy" }. */
  function parseLine(line, opts) {
    opts = opts || {};
    var src = opts.sourceZone || "UTC";
    var order = opts.order === "mdy" ? "mdy" : "dmy";
    var s = String(line == null ? "" : line).trim();
    var notes = [];
    var m;
    try {
      if (!s) throw new Error("Empty line.");
      // Unix time.
      if ((m = /^(\d+)(\.\d+)?$/.exec(s))) {
        var digits = m[1].length, v = Number(s);
        if (digits >= 9 && digits <= 11) return { ok: true, ms: Math.round(v * 1000), kind: "Unix seconds", zoneUsed: "UTC", status: "ok", notes: notes };
        if (digits >= 12 && digits <= 14 && !m[2]) return { ok: true, ms: v, kind: "Unix milliseconds", zoneUsed: "UTC", status: "ok", notes: notes };
        throw new Error("A bare number is read as Unix time only with 9 to 11 digits (seconds) or 12 to 14 (milliseconds).");
      }
      // ISO 8601 extended and RFC 3339.
      if ((m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})([.,]\d+)?)?)?\s*([A-Za-z]+|[+-]\d{2}(?::?\d{2})?)?$/.exec(s))) {
        return finish({ y: +m[1], mo: +m[2], d: +m[3], h: m[4] ? +m[4] : 0, mi: m[5] ? +m[5] : 0, s: m[6] ? +m[6] : 0,
          frac: m[7] ? Math.round(parseFloat("0." + m[7].slice(1)) * 1000) : 0 },
          zoneText(m[8]), src, m[4] ? "ISO 8601" : "ISO 8601 date (midnight)", notes);
      }
      // ISO 8601 basic.
      if ((m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z|[+-]\d{4})?$/i.exec(s))) {
        return finish({ y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5], s: m[6] ? +m[6] : 0 }, zoneText(m[7]), src, "ISO 8601 basic", notes);
      }
      // Military date-time group: DDHHMM[SS]<letter>MONYY or MONYYYY.
      if ((m = /^(\d{2})(\d{2})(\d{2})(\d{2})?\s*([A-IK-Z])\s*([A-Za-z]{3})\s*(\d{2}|\d{4})$/i.exec(s))) {
        var mon = MONTHS[m[6].toLowerCase()];
        if (!mon) throw new Error("Unknown month " + m[6] + ".");
        var off = militaryOffset(m[5]);
        return finish({ y: fourDigitYear(m[7]), mo: mon, d: +m[1], h: +m[2], mi: +m[3], s: m[4] ? +m[4] : 0 },
          off, src, "Date-time group (zone " + m[5].toUpperCase() + ")", notes);
      }
      if (/^\d{6,8}\s*J\s*[A-Za-z]{3}/i.test(s)) throw new Error("Zone J means the writer's local time, which has no fixed offset. Choose the source zone and write the time without J.");
      // Month names, either order, optional weekday, optional time and zone.
      var t = s.replace(/^(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*\.?,?\s+/i, "");
      var TIME = "(?:[ ,T]+(\\d{1,2}):(\\d{2})(?::(\\d{2}))?\\s*(am|pm|a\\.m\\.|p\\.m\\.)?)?\\s*([A-Za-z]+|[+-]\\d{2}:?\\d{2})?";
      if ((m = new RegExp("^(\\d{1,2})\\s+([A-Za-z]{3,9})\\.?,?\\s+(\\d{4})" + TIME + "$", "i").exec(t)) ||
          (m = new RegExp("^([A-Za-z]{3,9})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})" + TIME + "$", "i").exec(t))) {
        var dayFirst = /^\d/.test(m[1]);
        var monthName = dayFirst ? m[2] : m[1], day = dayFirst ? m[1] : m[2];
        var mo = MONTHS[monthName.toLowerCase()];
        if (!mo) throw new Error("Unknown month " + monthName + ".");
        var c = hm(m[4] || 0, m[5] || 0, m[6], m[7]);
        return finish({ y: +m[3], mo: mo, d: +day, h: c[0], mi: c[1], s: c[2] }, zoneText(m[8]), src, "Month name", notes);
      }
      // Numeric dates with slashes, dots or dashes and a 4-digit year last.
      if ((m = new RegExp("^(\\d{1,2})[/.-](\\d{1,2})[/.-](\\d{4})" + TIME + "$", "i").exec(s))) {
        var a = +m[1], b = +m[2], useOrder = order;
        if (a > 12 && b <= 12) { useOrder = "dmy"; }
        else if (b > 12 && a <= 12) { useOrder = "mdy"; }
        else if (a > 12 && b > 12) throw new Error("Neither number can be a month.");
        var dd = useOrder === "dmy" ? a : b, mm = useOrder === "dmy" ? b : a;
        if (a <= 12 && b <= 12 && a !== b) notes.push("Read as " + (useOrder === "dmy" ? "day/month" : "month/day") + "; the other order is also a valid date.");
        else if (useOrder !== order) notes.push("Read as " + (useOrder === "dmy" ? "day/month" : "month/day") + ", the only possible order.");
        var c2 = hm(m[4] || 0, m[5] || 0, m[6], m[7]);
        return finish({ y: +m[3], mo: mm, d: dd, h: c2[0], mi: c2[1], s: c2[2] }, zoneText(m[8]), src,
          "Numeric date (" + (useOrder === "dmy" ? "day first" : "month first") + ")", notes);
      }
      throw new Error("Not a format this reads.");
    } catch (e) {
      return { ok: false, error: e.message, input: s };
    }
  }

  /** Read every line, convert each instant into each target zone, and sum up the set. */
  function convertAll(text, opts) {
    opts = opts || {};
    var targets = opts.targets && opts.targets.length ? opts.targets : ["UTC"];
    if (opts.sourceZone && !tz.validZone(opts.sourceZone)) throw new Error("Not a time zone name this browser knows: " + opts.sourceZone);
    targets.forEach(function (z) { if (!tz.validZone(z)) throw new Error("Not a time zone name this browser knows: " + z); });
    var lines = String(text || "").split(/\r?\n/);
    var rows = [];
    lines.forEach(function (ln, i) {
      if (!ln.trim()) return;
      var r = parseLine(ln, opts);
      r.line = i + 1;
      r.input = ln.trim();
      if (r.ok) {
        if (!isFinite(r.ms) || Math.abs(r.ms) > 8.64e15) { r.ok = false; r.error = "Outside the range of dates this can show."; }
        else {
          r.utc = tz.isoZ(r.ms);
          r.out = targets.map(function (z) { var d = tz.describe(z, r.ms); return d.wall + " " + d.abbr; });
        }
      }
      rows.push(r);
    });
    var good = rows.filter(function (r) { return r.ok; });
    var times = good.map(function (r) { return r.ms; });
    var span = times.length ? Math.max.apply(null, times) - Math.min.apply(null, times) : 0;
    return {
      targets: targets, rows: rows, read: good.length, failed: rows.length - good.length,
      flagged: good.filter(function (r) { return r.status !== "ok" || r.notes.length; }).length,
      earliest: times.length ? tz.isoZ(Math.min.apply(null, times)) : null,
      latest: times.length ? tz.isoZ(Math.max.apply(null, times)) : null,
      spanMs: span, spanText: spanText(span)
    };
  }

  function spanText(ms) {
    var m = Math.round(ms / 60000), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mi = m % 60;
    return (d ? d + " d " : "") + h + " h " + mi + " min";
  }

  return { parseLine: parseLine, convertAll: convertAll, militaryOffset: militaryOffset,
    zoneText: zoneText, spanText: spanText };
});

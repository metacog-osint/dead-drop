/* Time zone conversion with the IANA time zone database, through the browser's Intl API (ECMA-402).
   Reference: the IANA tz database (tz-link, "Theory and pragmatics of the tz code and data") for the zone rules;
   ECMA-402 Intl.DateTimeFormat for reading a zone's wall-clock time at an instant. Local times that a clock change
   skips or repeats are resolved the way RFC 9557 / TC39 Temporal's "compatible" option does: a repeated time takes the
   earlier instant, a skipped time is moved forward by the length of the gap; both cases are reported, never hidden.
   No DOM, no network. Under Node it needs full ICU (the default build). */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.DD = root.DD || {}).timezone = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var MIN = 60000, DAY = 86400000;
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  // The suite's zone list (site/tic-time.js, ZONES), copied so this file loads in Node without it. The test checks
  // that every zone in tic-time.js is here.
  var SUITE_ZONES = [
    ["UTC", "Zulu (UTC)"],
    ["America/New_York", "US Eastern"], ["America/Chicago", "US Central"], ["America/Denver", "US Mountain"],
    ["America/Phoenix", "Arizona"], ["America/Los_Angeles", "US Pacific"], ["America/Anchorage", "Alaska"],
    ["Pacific/Honolulu", "Hawaii"], ["Europe/London", "London"], ["Europe/Berlin", "Central Europe"],
    ["Europe/Kyiv", "Kyiv"], ["Europe/Moscow", "Moscow"], ["Asia/Jerusalem", "Israel"], ["Asia/Tehran", "Tehran"],
    ["Asia/Dubai", "Gulf (Dubai)"], ["Asia/Karachi", "Pakistan"], ["Asia/Kolkata", "India"],
    ["Asia/Shanghai", "China"], ["Asia/Taipei", "Taipei"], ["Asia/Seoul", "Korea"], ["Asia/Tokyo", "Japan"],
    ["Australia/Sydney", "Sydney"]
  ];
  // A few more zones worth having in a picker, beyond the suite's list.
  var EXTRA_ZONES = [
    ["Europe/Paris", "Paris"], ["America/Cayenne", "French Guiana"], ["Asia/Almaty", "Kazakhstan"],
    ["Asia/Yakutsk", "Yakutsk (Amur, Vostochny)"], ["Pacific/Auckland", "New Zealand"], ["Asia/Kathmandu", "Nepal"]
  ];

  // Launch sites and control centres, each with the IANA zone that holds its civil time.
  var SITES = [
    { label: "Cape Canaveral and Kennedy Space Center, Florida", zone: "America/New_York", launch: true },
    { label: "Vandenberg SFB, California", zone: "America/Los_Angeles", launch: true },
    { label: "Wallops, Virginia", zone: "America/New_York", launch: true },
    { label: "Starbase, Texas", zone: "America/Chicago", launch: true },
    { label: "Guiana Space Centre, Kourou", zone: "America/Cayenne", launch: true },
    { label: "Baikonur, Kazakhstan", zone: "Asia/Qyzylorda", launch: true,
      note: "IANA zone for Kyzylorda region; Kazakhstan moved to one zone, UTC+5, on 1 March 2024. Check that the city's own clock follows it." },
    { label: "Plesetsk, Russia", zone: "Europe/Moscow", launch: true },
    { label: "Vostochny, Russia", zone: "Asia/Yakutsk", launch: true },
    { label: "Jiuquan, Xichang, Taiyuan and Wenchang, China", zone: "Asia/Shanghai", launch: true },
    { label: "Satish Dhawan, Sriharikota, India", zone: "Asia/Kolkata", launch: true },
    { label: "Tanegashima, Japan", zone: "Asia/Tokyo", launch: true },
    { label: "Naro, South Korea", zone: "Asia/Seoul", launch: true },
    { label: "Mahia, New Zealand", zone: "Pacific/Auckland", launch: true },
    { label: "Washington, DC", zone: "America/New_York", launch: false },
    { label: "London", zone: "Europe/London", launch: false },
    { label: "Moscow", zone: "Europe/Moscow", launch: false },
    { label: "Beijing", zone: "Asia/Shanghai", launch: false }
  ];

  var cache = {};
  function partsFormatter(zone) {
    if (cache[zone]) return cache[zone];
    var f = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric",
      day: "numeric", hour: "numeric", minute: "numeric", second: "numeric", weekday: "short" });
    cache[zone] = f;
    return f;
  }

  /** True when this engine knows the IANA zone name. */
  function validZone(zone) {
    if (typeof zone !== "string" || !zone.trim()) return false;
    try { new Intl.DateTimeFormat("en-US", { timeZone: zone }); return true; } catch (e) { return false; }
  }
  function need(zone) {
    if (cache[zone]) return;
    if (!validZone(zone)) throw new Error("Not a time zone name this browser knows: " + zone);
  }
  function checkMs(ms) {
    if (typeof ms !== "number" || !isFinite(ms) || Math.abs(ms) > 8.64e15) throw new Error("Not a valid instant.");
  }

  /** The wall-clock reading in a zone at an instant (ms since 1970 UTC), with the zone's offset from UTC. */
  function wallTime(zone, ms) {
    var w = rawWall(zone, ms);
    w.abbr = abbreviation(zone, ms);
    return w;
  }
  function rawWall(zone, ms) {
    need(zone); checkMs(ms);
    var p = {};
    partsFormatter(zone).formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = x.value; });
    var hour = Number(p.hour) % 24; // some engines write midnight as 24 even with h23
    var w = { year: Number(p.year), month: Number(p.month), day: Number(p.day), hour: hour,
      minute: Number(p.minute), second: Number(p.second), weekday: p.weekday };
    // Offset = wall clock read as if it were UTC, minus the instant (whole seconds; zones are whole minutes since 1972).
    var asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
    w.offsetMinutes = Math.round((asUtc - Math.floor(ms / 1000) * 1000) / MIN);
    return w;
  }
  function offsetMinutes(zone, ms) { return rawWall(zone, ms).offsetMinutes; }

  function abbreviation(zone, ms) {
    try {
      var n = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "short" }).formatToParts(new Date(ms))
        .filter(function (x) { return x.type === "timeZoneName"; })[0];
      return n ? n.value : "";
    } catch (e) { return ""; }
  }

  /** "UTC+05:30", "UTC-06:00", "UTC+00:00". */
  function offsetLabel(min) {
    var s = min < 0 ? "-" : "+", a = Math.abs(min);
    return "UTC" + s + pad(Math.floor(a / 60)) + ":" + pad(a % 60);
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }

  function sameWall(w, y, mo, d, h, mi, s) {
    return w.year === y && w.month === mo && w.day === d && w.hour === h && w.minute === mi && w.second === s;
  }

  /** Validate a calendar date and clock time (month 1-12). */
  function checkWall(y, mo, d, h, mi, s) {
    if (![y, mo, d, h, mi, s].every(function (x) { return typeof x === "number" && isFinite(x) && Math.floor(x) === x; }))
      throw new Error("The date and time must be whole numbers.");
    if (mo < 1 || mo > 12) throw new Error("Month must be 1 to 12.");
    var dim = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    if (y < 1 || y > 9999) throw new Error("Year must be 1 to 9999.");
    if (d < 1 || d > dim) throw new Error("That month has " + dim + " days.");
    if (h < 0 || h > 23 || mi < 0 || mi > 59 || s < 0 || s > 59) throw new Error("Time must be 00:00:00 to 23:59:59.");
  }

  /** A local wall-clock time in a zone, to UTC. Returns
   *   { utcMs, status: "ok" | "ambiguous" | "skipped", candidates: [ms...], note }
   *  "ambiguous": the clock went back and showed this time twice; utcMs is the earlier, candidates has both.
   *  "skipped": the clock jumped forward over this time; utcMs moves it forward by the gap (Temporal "compatible"). */
  function localToUtc(zone, y, mo, d, h, mi, s) {
    s = s || 0;
    need(zone); checkWall(y, mo, d, h, mi, s);
    var guess = Date.UTC(y, mo - 1, d, h, mi, s);
    if (y < 100) guess = new Date(guess).setUTCFullYear(y); // Date.UTC maps years 0-99 to 1900-1999
    var offs = [];
    [-DAY, 0, DAY].forEach(function (dt) {
      var o = offsetMinutes(zone, guess + dt);
      if (offs.indexOf(o) < 0) offs.push(o);
    });
    var hits = [];
    offs.forEach(function (o) {
      var t = guess - o * MIN;
      if (sameWall(rawWall(zone, t), y, mo, d, h, mi, s) && hits.indexOf(t) < 0) hits.push(t);
    });
    hits.sort(function (a, b) { return a - b; });
    if (hits.length === 1) return { utcMs: hits[0], status: "ok", candidates: hits, note: "" };
    if (hits.length >= 2) {
      return { utcMs: hits[0], status: "ambiguous", candidates: hits,
        note: "The clocks went back, so this local time happened twice: first at " + isoZ(hits[0]) + " (" +
          offsetLabel(offsetMinutes(zone, hits[0])) + "), again at " + isoZ(hits[hits.length - 1]) + " (" +
          offsetLabel(offsetMinutes(zone, hits[hits.length - 1])) + "). The first is used." };
    }
    // Skipped: use the offset in force before the gap, which lands after it.
    var before = offsetMinutes(zone, guess - DAY);
    var t2 = guess - before * MIN;
    var after = offsetMinutes(zone, guess + DAY);
    return { utcMs: t2, status: "skipped", candidates: [],
      note: "The clocks went forward by " + Math.abs(after - before) + " minutes, so this local time never happened. " +
        "It is read as " + isoZ(t2) + ", which the local clock showed as " + wallString(wallTime(zone, t2)) + "." };
  }

  function isoZ(ms) { return new Date(ms).toISOString().replace(/\.000Z$/, "Z"); }
  function wallString(w, seconds) {
    return w.year + "-" + pad(w.month) + "-" + pad(w.day) + " " + pad(w.hour) + ":" + pad(w.minute) +
      (seconds === false ? "" : ":" + pad(w.second));
  }

  /** One instant as read in one zone: every field a page needs to show it. */
  function describe(zone, ms) {
    var w = wallTime(zone, ms);
    return {
      zone: zone,
      wall: wallString(w),
      date: w.weekday + " " + w.day + " " + MONTHS[w.month - 1] + " " + w.year,
      time: pad(w.hour) + ":" + pad(w.minute) + ":" + pad(w.second),
      abbr: w.abbr,
      offsetMinutes: w.offsetMinutes,
      offset: offsetLabel(w.offsetMinutes),
      dst: isDst(zone, ms),
      ymd: [w.year, w.month, w.day]
    };
  }

  /** Whether a zone is on daylight saving time: its offset is larger than the smaller of its January and July
   *  offsets that year. (A rule of the IANA data's shape; it reads a zone with no DST as false.) */
  function isDst(zone, ms) {
    var y = new Date(ms).getUTCFullYear();
    var jan = offsetMinutes(zone, Date.UTC(y, 0, 1)), jul = offsetMinutes(zone, Date.UTC(y, 6, 1));
    return offsetMinutes(zone, ms) > Math.min(jan, jul);
  }

  /** Whole calendar days from date a to date b, each [y, m, d]. */
  function dayDiff(a, b) {
    return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / DAY);
  }

  /** The next clock change in a zone after an instant, searched up to `days` ahead (default 400).
   *  Returns { atMs, fromMinutes, toMinutes } or null. */
  function nextTransition(zone, ms, days) {
    need(zone); checkMs(ms);
    var step = 6 * 3600000, end = ms + (days || 400) * DAY, o0 = offsetMinutes(zone, ms), t = ms;
    while (t < end) {
      var t1 = t + step, o1 = offsetMinutes(zone, t1);
      if (o1 !== o0) {
        var lo = t, hi = t1; // the change is in (lo, hi]; bisect to the minute
        while (hi - lo > MIN) {
          var mid = lo + Math.floor((hi - lo) / 2 / MIN) * MIN;
          if (mid <= lo) mid = lo + MIN;
          if (offsetMinutes(zone, mid) === o0) lo = mid; else hi = mid;
        }
        return { atMs: hi, fromMinutes: o0, toMinutes: o1 };
      }
      t = t1;
    }
    return null;
  }

  /** Parse "YYYY-MM-DDTHH:MM" or "YYYY-MM-DD HH:MM[:SS]" (a datetime-local value) into numbers. */
  function parseLocal(s) {
    var m = /^\s*(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*$/.exec(String(s || ""));
    if (!m) throw new Error("Write the date and time as YYYY-MM-DD HH:MM.");
    var v = { y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5], s: m[6] ? +m[6] : 0 };
    checkWall(v.y, v.mo, v.d, v.h, v.mi, v.s);
    return v;
  }

  /** The page's whole job: a local time in one zone, shown in many. */
  function convert(localString, fromZone, toZones) {
    var v = parseLocal(localString);
    var r = localToUtc(fromZone, v.y, v.mo, v.d, v.h, v.mi, v.s);
    var src = describe(fromZone, r.utcMs);
    return {
      utc: isoZ(r.utcMs), utcMs: r.utcMs, status: r.status, note: r.note,
      alternativeUtc: r.status === "ambiguous" ? isoZ(r.candidates[r.candidates.length - 1]) : null,
      source: src,
      rows: (toZones || []).map(function (z) {
        var item = typeof z === "string" ? { zone: z, label: z } : z;
        var d = describe(item.zone, r.utcMs);
        d.label = item.label || item.zone;
        d.dayOffset = dayDiff(src.ymd, d.ymd);
        if (item.note) d.note = item.note;
        if (item.launch !== undefined) d.launch = item.launch;
        return d;
      })
    };
  }

  return { validZone: validZone, wallTime: wallTime, offsetMinutes: offsetMinutes, offsetLabel: offsetLabel,
    localToUtc: localToUtc, describe: describe, isDst: isDst, dayDiff: dayDiff, nextTransition: nextTransition,
    parseLocal: parseLocal, convert: convert, isoZ: isoZ, wallString: wallString, checkWall: checkWall,
    SUITE_ZONES: SUITE_ZONES, EXTRA_ZONES: EXTRA_ZONES, SITES: SITES, MONTHS: MONTHS, WEEKDAYS: WEEKDAYS };
});

/* CSV rows to map points: parsing the CSV (quoted fields included), finding the latitude and longitude columns,
   reading coordinates written in decimal degrees or degrees, minutes and seconds, and the distance along the
   points in row order.
   References: RFC 4180 (Common Format and MIME Type for CSV Files): fields separated by commas, a field with a
   comma, quote or line break is wrapped in double quotes, and a quote inside one is written twice. Chris Veness,
   "Calculate distance, bearing and more between latitude/longitude points" (movable-type.co.uk): haversine
   distance, initial bearing theta = atan2(sin dLon cos lat2, cos lat1 sin lat2 - sin lat1 cos lat2 cos dLon), and
   the intermediate point a fraction f along a great circle (used to draw each leg as the path it measures).
   Sphere of radius 6371 km. Decimal degrees = degrees + minutes / 60 + seconds / 3600, negative for S and W. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.DD = root.DD || {}).csvMap = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var R_EARTH = 6371.0;   // km, mean Earth radius (IUGG)
  var D2R = Math.PI / 180;

  /** The separator: comma, semicolon or tab, whichever appears most in the first line (outside quotes). */
  function detectDelimiter(text) {
    var line = String(text || "").replace(/^﻿/, "").split(/\r\n|\n|\r/).filter(function (l) { return l.trim(); })[0] || "";
    var counts = { ",": 0, ";": 0, "\t": 0 }, q = false;
    for (var i = 0; i < line.length; i++) {
      var c = line.charAt(i);
      if (c === "\"") q = !q; else if (!q && counts.hasOwnProperty(c)) counts[c]++;
    }
    return counts[";"] > counts[","] && counts[";"] >= counts["\t"] ? ";" : counts["\t"] > counts[","] ? "\t" : ",";
  }

  /** RFC 4180 parsing into an array of rows, each an array of strings, with each row's line number. Unquoted
   *  fields are trimmed; blank lines are skipped. Throws on a quote that is never closed. */
  function parseCsv(text, delim) {
    var s = String(text || "").replace(/^﻿/, "");
    delim = delim || detectDelimiter(s);
    var rows = [], row = [], field = "", quoted = false, inQ = false, line = 1, rowLine = 1, i = 0, n = s.length;
    function endField() { row.push(quoted ? field : field.trim()); field = ""; quoted = false; }
    function endRow() {
      endField();
      if (row.length > 1 || row[0] !== "") rows.push({ line: rowLine, cells: row });
      row = [];
    }
    for (; i < n; i++) {
      var c = s.charAt(i);
      if (inQ) {
        if (c === "\"") {
          if (s.charAt(i + 1) === "\"") { field += "\""; i++; } else inQ = false;
        } else { if (c === "\n") line++; field += c; }
        continue;
      }
      if (c === "\"" && field.trim() === "") { inQ = true; quoted = true; field = ""; }
      else if (c === delim) endField();
      else if (c === "\r" || c === "\n") {
        if (c === "\r" && s.charAt(i + 1) === "\n") i++;
        endRow(); line++; rowLine = line;
      } else field += c;
    }
    if (inQ) throw new Error("A quoted field that starts on line " + rowLine + " is never closed.");
    endRow();
    return rows;
  }

  /** A latitude or longitude: decimal degrees ("-80.6", "80.6W", "W 80.6"), or degrees, minutes and seconds
   *  ("28°30'15\"N", "28 30 15 N", "28°30.25'N"). axis "lat" or "lon". Returns NaN when it cannot be read, is
   *  out of range, or has a hemisphere letter for the other axis. */
  function parseCoord(s, axis) {
    var t = String(s === undefined || s === null ? "" : s).trim().toUpperCase();
    if (!t) return NaN;
    var hemi = "", m = /^([NSEW])\s*(.*)$/.exec(t) || null;
    if (m) { hemi = m[1]; t = m[2]; }
    else { m = /^(.*?)\s*([NSEW])$/.exec(t); if (m) { hemi = m[2]; t = m[1]; } }
    if (hemi && (axis === "lat" ? "NS" : "EW").indexOf(hemi) < 0) return NaN;
    t = t.replace(/^(-?\d+),(\d+)$/, "$1.$2");   // a decimal comma, as in "28,5"
    var parts = t.replace(/[°º˚d'′’"″”m s]+/gi, " ").trim().split(/\s+/);
    if (!parts.length || parts.length > 3 || !parts.every(function (p) { return /^[+\-]?(\d+\.?\d*|\.\d+)$/.test(p); })) return NaN;
    var v = parts.map(Number);
    var neg = v[0] < 0 || /^-/.test(parts[0]);
    if (parts.length > 1 && ((v[1] < 0 || v[1] >= 60) || (parts.length > 2 && (v[2] < 0 || v[2] >= 60)))) return NaN;
    if (parts.length > 1 && /^[+\-]/.test(parts[1] + (parts[2] || ""))) return NaN;
    var mag = Math.abs(v[0]) + (v[1] || 0) / 60 + (v[2] || 0) / 3600;
    if (hemi && neg) return NaN;   // "-80.6W" is contradictory
    var val = (neg || hemi === "S" || hemi === "W") ? -mag : mag;
    if (Math.abs(val) > (axis === "lat" ? 90 : 180)) return NaN;
    return val;
  }

  var H_LAT = /^(lat|latitude|lat_?dd|decimal_?latitude|y)$/i;
  var H_LON = /^(lon|lng|long|longitude|lon_?dd|decimal_?longitude|x)$/i;
  var H_NAME = /^(name|title|label|site|place|location|id)$/i;
  var H_DESC = /^(desc|description|notes?|comments?|remarks?)$/i;
  function findIdx(cells, re) { for (var i = 0; i < cells.length; i++) if (re.test(String(cells[i]).trim())) return i; return -1; }

  /** Which columns hold latitude, longitude, name and description. A header row is used when it names latitude
   *  and longitude columns; otherwise the first pair of neighbouring columns where most rows read as latitude then
   *  longitude is taken (so name,lat,lon,description works as before). */
  function detectColumns(rows) {
    if (!rows.length) throw new Error("No rows to read.");
    var first = rows[0].cells;
    var la = findIdx(first, H_LAT), lo = findIdx(first, H_LON);
    if (la >= 0 && lo >= 0 && la !== lo) {
      return { header: true, names: first.slice(), lat: la, lon: lo, name: findIdx(first, H_NAME), desc: findIdx(first, H_DESC), guessed: false };
    }
    var width = rows.reduce(function (w, r) { return Math.max(w, r.cells.length); }, 0);
    var sample = rows.slice(0, 200), best = null;
    for (var i = 0; i + 1 < width; i++) {
      var ok = sample.filter(function (r) { return isFinite(parseCoord(r.cells[i], "lat")) && isFinite(parseCoord(r.cells[i + 1], "lon")); }).length;
      if (ok >= Math.max(1, sample.length * 0.5)) { best = i; break; }
    }
    if (best === null) throw new Error("No pair of latitude and longitude columns found. Add a header row naming them (lat, lon) or use name,lat,lon.");
    var firstIsHeader = !isFinite(parseCoord(first[best], "lat")) && !isFinite(parseCoord(first[best + 1], "lon")) && rows.length > 1;
    // lat,lon,name,description when the coordinates come first; otherwise name first, description after them.
    var nameCol = best === 0 ? (width > 2 ? 2 : -1) : 0;
    var descCol = best === 0 ? (width > 3 ? 3 : -1) : (width > best + 2 ? best + 2 : -1);
    return { header: firstIsHeader, names: firstIsHeader ? first.slice() : null, lat: best, lon: best + 1,
      name: nameCol, desc: descCol, guessed: true };
  }

  /** Points from CSV text. Returns {points, errors, columns, delimiter}. A row that cannot be read is listed in
   *  errors with its line number and the reason, never dropped silently. */
  function readPoints(text, delim) {
    var d = delim || detectDelimiter(text);
    var rows = parseCsv(text, d);
    if (!rows.length) throw new Error("There is no CSV text to read.");
    var cols = detectColumns(rows);
    var body = cols.header ? rows.slice(1) : rows;
    var points = [], errors = [];
    body.forEach(function (r) {
      var c = r.cells;
      var lat = parseCoord(c[cols.lat], "lat"), lon = parseCoord(c[cols.lon], "lon");
      if (!isFinite(lat) || !isFinite(lon)) {
        var why = !isFinite(lat) ? "latitude '" + (c[cols.lat] === undefined ? "" : c[cols.lat]) + "'" : "longitude '" + (c[cols.lon] === undefined ? "" : c[cols.lon]) + "'";
        errors.push({ line: r.line, reason: "Cannot read " + why + " (decimal degrees or D M S, latitude within ±90, longitude within ±180)." });
        return;
      }
      var extra = {};
      c.forEach(function (v, i) {
        if (i === cols.lat || i === cols.lon || i === cols.name || i === cols.desc || v === "") return;
        extra[cols.names && cols.names[i] ? cols.names[i] : "column " + (i + 1)] = v;
      });
      points.push({ line: r.line, name: cols.name >= 0 && c[cols.name] ? c[cols.name] : "Row " + r.line,
        lat: lat, lon: lon, description: cols.desc >= 0 ? (c[cols.desc] || "") : "", extra: extra });
    });
    return { points: points, errors: errors, columns: cols, delimiter: d };
  }

  function haversineKm(lat1, lon1, lat2, lon2) {
    var p1 = lat1 * D2R, p2 = lat2 * D2R, dp = (lat2 - lat1) * D2R, dl = (lon2 - lon1) * D2R;
    var a = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    a = Math.min(1, Math.max(0, a));
    return 2 * R_EARTH * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  function initialBearing(lat1, lon1, lat2, lon2) {
    var p1 = lat1 * D2R, p2 = lat2 * D2R, dl = (lon2 - lon1) * D2R;
    var y = Math.sin(dl) * Math.cos(p2), x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return ((Math.atan2(y, x) / D2R) + 360) % 360;
  }

  /** Each leg between consecutive points (row order): distance, initial bearing and running total. */
  function legs(points) {
    var out = [], total = 0;
    for (var i = 1; i < points.length; i++) {
      var a = points[i - 1], b = points[i];
      var d = haversineKm(a.lat, a.lon, b.lat, b.lon);
      total += d;
      out.push({ from: a.name, to: b.name, km: d, bearing: d > 0 ? initialBearing(a.lat, a.lon, b.lat, b.lon) : NaN, totalKm: total });
    }
    return { legs: out, totalKm: total };
  }

  /** [lat, lon] points along the great circle from a to b, about every stepKm, longitudes kept continuous so a
   *  leg across the 180° meridian is drawn the short way. */
  function greatCirclePath(a, b, stepKm) {
    var p1 = a.lat * D2R, l1 = a.lon * D2R, p2 = b.lat * D2R, l2 = b.lon * D2R;
    var d = haversineKm(a.lat, a.lon, b.lat, b.lon) / R_EARTH;
    var n = Math.max(1, Math.ceil(d * R_EARTH / (stepKm || 50)));
    var pts = [];
    for (var k = 0; k <= n; k++) {
      var f = k / n, lat, lon;
      if (d < 1e-12) { lat = a.lat; lon = a.lon; }
      else {
        var A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
        var x = A * Math.cos(p1) * Math.cos(l1) + B * Math.cos(p2) * Math.cos(l2);
        var y = A * Math.cos(p1) * Math.sin(l1) + B * Math.cos(p2) * Math.sin(l2);
        var z = A * Math.sin(p1) + B * Math.sin(p2);
        lat = Math.atan2(z, Math.sqrt(x * x + y * y)) / D2R;
        lon = Math.atan2(y, x) / D2R;
      }
      if (pts.length) { var prev = pts[pts.length - 1][1]; while (lon - prev > 180) lon -= 360; while (lon - prev < -180) lon += 360; }
      else { var start = a.lon; while (lon - start > 180) lon -= 360; while (lon - start < -180) lon += 360; }
      pts.push([lat, lon]);
    }
    return pts;
  }

  /** Points as an RFC 7946 GeoJSON FeatureCollection ([lon, lat] order). */
  function toGeoJSON(points) {
    return { type: "FeatureCollection", features: (points || []).map(function (p) {
      var props = { name: p.name, description: p.description, line: p.line };
      Object.keys(p.extra || {}).forEach(function (k) { props[k] = p.extra[k]; });
      return { type: "Feature", geometry: { type: "Point", coordinates: [p.lon, p.lat] }, properties: props };
    }) };
  }

  return { detectDelimiter: detectDelimiter, parseCsv: parseCsv, parseCoord: parseCoord, detectColumns: detectColumns,
    readPoints: readPoints, haversineKm: haversineKm, initialBearing: initialBearing, legs: legs,
    greatCirclePath: greatCirclePath, toGeoJSON: toGeoJSON, R_EARTH: R_EARTH };
});

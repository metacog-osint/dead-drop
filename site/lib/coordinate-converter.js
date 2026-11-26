/* Latitude and longitude between decimal degrees (DD), degrees-minutes-seconds (DMS) and degrees-decimal-minutes
   (DDM), and to the Universal Transverse Mercator grid (UTM) and the MGRS reference built on it. Reading an MGRS
   reference back is left to the mgrs library in the page.
   Rounding: a value is rounded once, in its smallest unit, before it is split into degrees, minutes and seconds,
   so 59.999 seconds shown to two places carries into the minutes (and degrees) instead of printing "60.00".
   UTM: the transverse Mercator series of Snyder, Map Projections: A Working Manual (USGS Professional Paper 1395,
   1987), pp. 60-64, eqs. 3-21 and 8-9 to 8-11, with the UTM constants of NGA/DMA TM 8358.2 (k0 = 0.9996, 500,000 m
   false easting, 10,000,000 m false northing south of the equator, 6-degree zones, the 32V and Svalbard exceptions)
   on the WGS 84 ellipsoid (a = 6,378,137 m, 1/f = 298.257223563). */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.DD = root.DD || {}).coordinateConverter = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var D2R = Math.PI / 180;
  var ELLIPSOIDS = {
    WGS84: { a: 6378137.0, e2: (1 / 298.257223563) * (2 - 1 / 298.257223563) },
    CLARKE1866: { a: 6378206.4, e2: 0.00676866 }     // Snyder's value, used in his worked examples
  };
  var BANDS = "CDEFGHJKLMNPQRSTUVWX";               // 8-degree latitude bands from 80 S; X is 12 degrees (72-84 N)

  function hemi(kind, negative) { return kind === "lat" ? (negative ? "S" : "N") : (negative ? "W" : "E"); }
  function checkKind(kind) { if (kind !== "lat" && kind !== "lon") throw new Error("kind must be \"lat\" or \"lon\"."); }
  function checkRange(dd, kind) {
    if (typeof dd !== "number" || !isFinite(dd)) throw new Error((kind === "lat" ? "Latitude" : "Longitude") + " must be a number.");
    var lim = kind === "lat" ? 90 : 180;
    if (dd < -lim || dd > lim) throw new Error((kind === "lat" ? "Latitude" : "Longitude") + " must be between -" + lim + " and " + lim + " degrees.");
  }
  function pad(n, w) { var s = String(n); while (s.length < w) s = "0" + s; return s; }
  function padFixed(x, places) {        // 5.2 -> "05.20" for places = 2
    var s = x.toFixed(places), i = s.indexOf(".");
    return (i === 1 || (i === -1 && s.length === 1)) ? "0" + s : s;
  }

  /** Decimal degrees to DMS, seconds to `places` decimals (default 2, about 0.3 m). */
  function toDMS(dd, kind, places) {
    checkKind(kind); checkRange(dd, kind);
    places = places === undefined ? 2 : places;
    var f = Math.pow(10, places);
    var units = Math.round(Math.abs(dd) * 3600 * f);       // whole units of 10^-places seconds
    var deg = Math.floor(units / (3600 * f));
    var rem = units - deg * 3600 * f;
    var min = Math.floor(rem / (60 * f));
    var sec = (rem - min * 60 * f) / f;
    var h = hemi(kind, dd < 0 && units > 0);
    return { deg: deg, min: min, sec: sec, hemi: h,
      text: deg + "° " + pad(min, 2) + "' " + padFixed(sec, places) + "\" " + h };
  }
  /** Decimal degrees to DDM, minutes to `places` decimals (default 4, about 0.2 m). */
  function toDDM(dd, kind, places) {
    checkKind(kind); checkRange(dd, kind);
    places = places === undefined ? 4 : places;
    var f = Math.pow(10, places);
    var units = Math.round(Math.abs(dd) * 60 * f);
    var deg = Math.floor(units / (60 * f));
    var min = (units - deg * 60 * f) / f;
    var h = hemi(kind, dd < 0 && units > 0);
    return { deg: deg, min: min, hemi: h, text: deg + "° " + padFixed(min, places) + "' " + h };
  }
  /** Decimal degrees to `places` decimals (default 6, about 0.1 m), signed and with the hemisphere letter. */
  function toDD(dd, kind, places) {
    checkKind(kind); checkRange(dd, kind);
    places = places === undefined ? 6 : places;
    var s = dd.toFixed(places);
    if (Number(s) === 0) s = (0).toFixed(places);
    return { value: Number(s), text: s + "°", hemiText: Math.abs(Number(s)).toFixed(places) + "° " + hemi(kind, Number(s) < 0) };
  }

  /** Reads one latitude or longitude written as DD, DDM or DMS, with a sign or a hemisphere letter (N S E W) at
   *  either end. Accepts °, ', ", the typographic primes and colons or spaces as separators. */
  function parseAngle(text, kind) {
    checkKind(kind);
    var label = kind === "lat" ? "Latitude" : "Longitude";
    var s = String(text === undefined || text === null ? "" : text).trim().toUpperCase();
    if (!s) throw new Error(label + " is empty.");
    var letter = null, m;
    if ((m = s.match(/^([NSEW])\s*(.*)$/))) { letter = m[1]; s = m[2]; }
    else if ((m = s.match(/^(.*?)\s*([NSEW])$/))) { letter = m[2]; s = m[1]; }
    if (letter && /[NSEW]/.test(s)) throw new Error(label + ": give one hemisphere letter only.");
    if (letter && kind === "lat" && "NS".indexOf(letter) < 0) throw new Error("Latitude takes N or S, not " + letter + ".");
    if (letter && kind === "lon" && "EW".indexOf(letter) < 0) throw new Error("Longitude takes E or W, not " + letter + ".");
    var sign = 1;
    s = s.trim();
    if (s[0] === "-" || s[0] === "+" || s[0] === "−") {
      if (letter) throw new Error(label + ": use a minus sign or a hemisphere letter, not both.");
      if (s[0] !== "+") sign = -1;
      s = s.slice(1).trim();
    }
    var parts = s.split(/[\s°º'"′″’”:]+/).filter(function (p) { return p !== ""; });
    if (parts.length < 1 || parts.length > 3) throw new Error(label + ": write degrees, degrees and minutes, or degrees, minutes and seconds.");
    var nums = parts.map(function (p) {
      if (!/^\d+(\.\d+)?$|^\.\d+$/.test(p)) throw new Error(label + ": \"" + p + "\" is not a number.");
      return Number(p);
    });
    for (var i = 0; i < nums.length - 1; i++) {
      if (nums[i] !== Math.floor(nums[i])) throw new Error(label + ": only the last part may have decimals.");
    }
    if (nums.length > 1 && nums[1] >= 60) throw new Error(label + ": minutes must be under 60.");
    if (nums.length > 2 && nums[2] >= 60) throw new Error(label + ": seconds must be under 60.");
    var dd = nums[0] + (nums.length > 1 ? nums[1] / 60 : 0) + (nums.length > 2 ? nums[2] / 3600 : 0);
    if (letter === "S" || letter === "W") sign = -1;
    dd = sign * dd;
    checkRange(dd, kind);
    return dd;
  }

  /** Transverse Mercator, Snyder eqs. 8-9 to 8-11 (and 3-21 for the meridian arc). Returns x (east of the central
   *  meridian) and y (north of the equator) in metres, before any false easting or northing, the point scale factor
   *  k, and the meridian arc M. */
  function tmForward(lat, lon, lon0, ell, k0) {
    ell = ell || ELLIPSOIDS.WGS84;
    k0 = k0 === undefined ? 0.9996 : k0;
    var a = ell.a, e2 = ell.e2, e4 = e2 * e2, e6 = e4 * e2, ep2 = e2 / (1 - e2);
    var phi = lat * D2R;
    var dl = ((lon - lon0 + 540) % 360 - 180) * D2R;
    var sin = Math.sin(phi), cos = Math.cos(phi), tan = Math.tan(phi);
    var N = a / Math.sqrt(1 - e2 * sin * sin);
    var T = tan * tan, C = ep2 * cos * cos, A = dl * cos;
    var M = a * ((1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * phi
      - (3 * e2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * Math.sin(2 * phi)
      + (15 * e4 / 256 + 45 * e6 / 1024) * Math.sin(4 * phi)
      - (35 * e6 / 3072) * Math.sin(6 * phi));
    var A2 = A * A, A3 = A2 * A, A4 = A3 * A, A5 = A4 * A, A6 = A5 * A;
    var x = k0 * N * (A + (1 - T + C) * A3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A5 / 120);
    var y = k0 * (M + N * tan * (A2 / 2 + (5 - T + 9 * C + 4 * C * C) * A4 / 24
      + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A6 / 720));
    var k = k0 * (1 + (1 + C) * A2 / 2 + (5 - 4 * T + 42 * C + 13 * C * C - 28 * ep2) * A4 / 24
      + (61 - 148 * T + 16 * T * T) * A6 / 720);
    return { x: x, y: y, k: k, M: M };
  }

  /** UTM zone number, with the Norway (32V) and Svalbard (31X-37X) exceptions. */
  function utmZone(lat, lon) {
    if (lon === 180) return 60;
    var z = Math.floor((lon + 180) / 6) + 1;
    if (lat >= 56 && lat < 64 && lon >= 3 && lon < 12) z = 32;
    if (lat >= 72 && lat < 84) {
      if (lon >= 0 && lon < 9) z = 31;
      else if (lon >= 9 && lon < 21) z = 33;
      else if (lon >= 21 && lon < 33) z = 35;
      else if (lon >= 33 && lon < 42) z = 37;
    }
    return z;
  }
  /** MGRS/UTM latitude band letter (C to X, no I or O). */
  function latBand(lat) {
    if (lat < -80 || lat > 84) return null;
    return BANDS[Math.min(19, Math.floor((lat + 80) / 8))];
  }
  /** UTM coordinates on WGS 84. Defined from 80 S to 84 N; nearer the poles the polar grid (UPS) is used instead. */
  function toUTM(lat, lon) {
    checkRange(lat, "lat"); checkRange(lon, "lon");
    if (lat < -80 || lat > 84) throw new Error("UTM covers 80° S to 84° N. Nearer the poles the Universal Polar Stereographic grid is used, which this tool does not give.");
    var zone = utmZone(lat, lon);
    var lon0 = (zone - 1) * 6 - 180 + 3;
    var t = tmForward(lat, lon, lon0, ELLIPSOIDS.WGS84, 0.9996);
    var south = lat < 0;
    var easting = 500000 + t.x, northing = t.y + (south ? 10000000 : 0);
    var band = latBand(lat);
    return { zone: zone, band: band, hemisphere: south ? "S" : "N", centralMeridian: lon0,
      easting: easting, northing: northing, scale: t.k,
      text: zone + (south ? "S" : "N") + " " + Math.round(easting) + " m E " + Math.round(northing) + " m N" };
  }

  /** MGRS reference from a UTM result (zone, band, easting, northing), WGS 84 lettering (TM 8358.1): the column
   *  letter of the 100 km square cycles A-H, J-R, S-Z with the zone number; the row letter runs A-V (no I or O)
   *  from the equator, starting at F in even-numbered zones. Coordinates within the square are truncated, never
   *  rounded, so the reference names the square the point is in. digits: 1 to 5 each way (5 = 1 m). */
  function toMGRS(u, digits) {
    digits = digits === undefined ? 5 : digits;
    if (!(digits >= 1 && digits <= 5 && digits === Math.floor(digits))) throw new Error("MGRS digits must be 1 to 5.");
    if (!u || !u.band) throw new Error("MGRS needs a UTM position between 80° S and 84° N.");
    var colSets = ["ABCDEFGH", "JKLMNPQR", "STUVWXYZ"];
    var ROWS = "ABCDEFGHJKLMNPQRSTUV";
    var e = Math.floor(u.easting), n = Math.floor(u.northing);
    var col = colSets[(u.zone - 1) % 3][Math.floor(e / 100000) - 1];
    var row = ROWS[(Math.floor(n / 100000) + (u.zone % 2 === 0 ? 5 : 0)) % 20];
    if (!col || !row) throw new Error("That easting or northing is outside a UTM zone.");
    var div = Math.pow(10, 5 - digits);
    var ee = pad(Math.floor((e % 100000) / div), digits), nn = pad(Math.floor((n % 100000) / div), digits);
    return { text: u.zone + u.band + col + row + ee + nn, spaced: u.zone + u.band + " " + col + row + " " + ee + " " + nn,
      square: col + row };
  }

  return { toDMS: toDMS, toDDM: toDDM, toDD: toDD, parseAngle: parseAngle, tmForward: tmForward,
    utmZone: utmZone, latBand: latBand, toUTM: toUTM, toMGRS: toMGRS, ELLIPSOIDS: ELLIPSOIDS };
});

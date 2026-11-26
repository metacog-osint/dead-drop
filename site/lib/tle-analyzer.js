/* Two-line element set (TLE) reading and the orbit figures that follow from it. No DOM, no network.
   Reference for the format: CelesTrak, "NORAD Two-Line Element Set Format" (T.S. Kelso), and Hoots & Roehrich,
   Spacetrack Report No. 3 (1980), which defines it: fixed columns, an implied leading decimal point on
   eccentricity and on the two exponent fields, a two-digit epoch year (57-99 means 1957-1999, 00-56 means
   2000-2056), and a modulo-10 checksum in column 69 where every digit counts its value, a minus sign counts 1, and
   everything else counts 0. Catalog numbers above 99999 use the Alpha-5 scheme (a leading letter, I and O skipped).
   Orbit figures: Vallado, Fundamentals of Astrodynamics and Applications, 4th ed., section 2.2 (Kepler's third law,
   n = sqrt(mu / a^3)) and section 2.3 (r_apogee = a (1 + e), r_perigee = a (1 - e)), with WGS 84 constants. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.DD = root.DD || {}).tleAnalyzer = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var MU = 398600.4418;        // km^3/s^2, Earth's gravitational parameter (WGS 84 / EGM96)
  var R_EQ = 6378.137;         // km, WGS 84 equatorial radius
  var DAY_MS = 86400000;
  var ALPHA5 = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // A = 10 ... Z = 33, I and O are not used

  /** The checksum digit a TLE line should carry in column 69: the sum of the digits in columns 1-68, plus 1 for
   *  every minus sign, modulo 10. */
  function checksum(line) {
    var s = 0;
    for (var i = 0; i < 68 && i < line.length; i++) {
      var c = line.charAt(i);
      if (c >= "0" && c <= "9") s += c.charCodeAt(0) - 48;
      else if (c === "-") s += 1;
    }
    return s % 10;
  }

  /** Catalog number from the five-character field, Alpha-5 included ("A0000" is 100000, "Z9999" is 339999). */
  function catalogNumber(field) {
    var f = String(field).trim();
    if (/^\d{1,5}$/.test(f)) return parseInt(f, 10);
    var m = /^([A-HJ-NP-Z])(\d{4})$/.exec(f);
    if (!m) throw new Error("The catalog number '" + f + "' is not a number or an Alpha-5 code.");
    return (ALPHA5.indexOf(m[1]) + 10) * 10000 + parseInt(m[2], 10);
  }

  /** An exponent field with an implied leading decimal point: " 12345-3" is 0.12345e-3, "-11606-4" is -0.11606e-4. */
  function impliedExponent(field) {
    var f = String(field).trim();
    if (f === "" ) return 0;
    var m = /^([+-]?)(\d{1,5})([+-]\d)$/.exec(f);
    if (!m) throw new Error("The field '" + f + "' is not in the TLE exponent form (for example 12345-3).");
    var v = parseFloat("0." + m[2]) * Math.pow(10, parseInt(m[3], 10));
    return m[1] === "-" ? -v : v;
  }

  /** Epoch year (two digits) and day of year with fraction (1.0 is 00:00 UTC on 1 January) to milliseconds UTC. */
  function epochToMs(yy, dayOfYear) {
    if (!(yy >= 0 && yy <= 99) || !(dayOfYear >= 1 && dayOfYear < 367)) throw new Error("The epoch is out of range.");
    var year = yy < 57 ? 2000 + yy : 1900 + yy;
    return Date.UTC(year, 0, 1) + (dayOfYear - 1) * DAY_MS;
  }

  function num(s, what) {
    var t = String(s).trim();
    if (t === "" || !isFinite(Number(t))) throw new Error(what + " is not a number ('" + t + "').");
    return Number(t);
  }

  /** Splits pasted text into element sets. Each set is an optional name line (a leading "0 " is dropped, as in
   *  Space-Track's three-line form) followed by line 1 and line 2. */
  function splitSets(text) {
    var lines = String(text || "").split(/\r?\n/).map(function (l) { return l.replace(/\s+$/, ""); })
      .filter(function (l) { return l.trim() !== ""; });
    var sets = [];
    for (var i = 0; i < lines.length; i++) {
      if (/^1 /.test(lines[i]) && i + 1 < lines.length && /^2 /.test(lines[i + 1])) {
        var prev = i > 0 ? lines[i - 1] : "";
        var name = (prev && !/^[12] /.test(prev)) ? prev.replace(/^0 /, "").trim() : "";
        sets.push({ name: name, line1: lines[i], line2: lines[i + 1] });
        i++;
      }
    }
    return sets;
  }

  /** Reads one element set. Returns every field, with checksum results and warnings; throws on text that is not
   *  a TLE at all. */
  function parse(line1, line2, name) {
    var l1 = String(line1 || "").replace(/\s+$/, "");
    var l2 = String(line2 || "").replace(/\s+$/, "");
    if (!/^1 /.test(l1) || !/^2 /.test(l2)) throw new Error("Line 1 must start with '1 ' and line 2 with '2 '.");
    if (l1.length < 68 || l2.length < 68) throw new Error("Each TLE line must be 69 characters long (68 without the checksum).");
    if (l1.length > 69 || l2.length > 69) throw new Error("A TLE line is longer than 69 characters; check for extra text.");
    var warnings = [];
    var sat1 = catalogNumber(l1.substring(2, 7));
    var sat2 = catalogNumber(l2.substring(2, 7));
    if (sat1 !== sat2) throw new Error("Line 1 is for catalog number " + sat1 + " but line 2 is for " + sat2 + ".");
    var ck = [l1, l2].map(function (l, i) {
      var given = l.length >= 69 ? l.charAt(68) : "";
      var want = checksum(l);
      var ok = given !== "" && Number(given) === want;
      if (given === "") warnings.push("Line " + (i + 1) + " has no checksum digit.");
      else if (!ok) warnings.push("Line " + (i + 1) + " checksum is " + given + " but the line adds up to " + want + ": a character was probably mistyped.");
      return { given: given, expected: want, ok: ok };
    });
    var yy = num(l1.substring(18, 20), "Epoch year");
    var day = num(l1.substring(20, 32), "Epoch day");
    var eccStr = l2.substring(26, 33).trim();
    if (!/^\d{1,7}$/.test(eccStr)) throw new Error("The eccentricity field '" + eccStr + "' should be up to seven digits.");
    var intl = l1.substring(9, 17).trim();
    var lyy = intl.length >= 2 && /^\d\d/.test(intl) ? parseInt(intl.substring(0, 2), 10) : NaN;
    var el = {
      name: (name || "").trim(),
      line1: l1, line2: l2,
      catalogNumber: sat1,
      classification: l1.charAt(7),
      intlDesignator: intl,
      launchYear: isFinite(lyy) ? (lyy < 57 ? 2000 + lyy : 1900 + lyy) : null,
      launchNumber: intl.length >= 5 ? parseInt(intl.substring(2, 5), 10) : null,
      launchPiece: intl.length > 5 ? intl.substring(5) : "",
      epochYear: yy < 57 ? 2000 + yy : 1900 + yy,
      epochDay: day,
      epochMs: epochToMs(yy, day),
      meanMotionDot: num(l1.substring(33, 43), "First derivative of mean motion"),     // rev/day^2, already divided by 2
      meanMotionDdot: impliedExponent(l1.substring(44, 52)),                          // rev/day^3, already divided by 6
      bstar: impliedExponent(l1.substring(53, 61)),                                   // 1 / Earth radii
      ephemerisType: l1.charAt(62).trim(),
      elementSetNumber: parseInt(l1.substring(64, 68), 10),
      inclinationDeg: num(l2.substring(8, 16), "Inclination"),
      raanDeg: num(l2.substring(17, 25), "Right ascension of the ascending node"),
      eccentricity: parseFloat("0." + eccStr),
      argPerigeeDeg: num(l2.substring(34, 42), "Argument of perigee"),
      meanAnomalyDeg: num(l2.substring(43, 51), "Mean anomaly"),
      meanMotionRevDay: num(l2.substring(52, 63), "Mean motion"),
      revNumber: parseInt(l2.substring(63, 68), 10),
      checksum: ck,
      warnings: warnings
    };
    if (el.inclinationDeg < 0 || el.inclinationDeg > 180) throw new Error("Inclination must be between 0 and 180 degrees.");
    if (!(el.meanMotionRevDay > 0)) throw new Error("Mean motion must be greater than zero.");
    return el;
  }

  /** Orbit size and shape from mean motion n (rev/day) and eccentricity e, by Kepler's third law. */
  function orbitFromMeanMotion(nRevDay, e) {
    if (!(nRevDay > 0)) throw new Error("Mean motion must be greater than zero.");
    e = e || 0;
    if (e < 0 || e >= 1) throw new Error("Eccentricity must be at least 0 and less than 1.");
    var nRadS = nRevDay * 2 * Math.PI / 86400;
    var a = Math.pow(MU / (nRadS * nRadS), 1 / 3);
    return {
      periodMin: 1440 / nRevDay,
      semiMajorAxisKm: a,
      apogeeRadiusKm: a * (1 + e),
      perigeeRadiusKm: a * (1 - e),
      apogeeAltKm: a * (1 + e) - R_EQ,          // above the equatorial radius, not above the ground below
      perigeeAltKm: a * (1 - e) - R_EQ,
      meanAltKm: a - R_EQ
    };
  }

  /** Days from the element set's epoch to the time nowMs (negative when the epoch is in the future). */
  function ageDays(epochMs, nowMs) { return (nowMs - epochMs) / DAY_MS; }

  var CLASSIFICATION = { U: "Unclassified", C: "Classified", S: "Secret" };

  return { parse: parse, splitSets: splitSets, checksum: checksum, catalogNumber: catalogNumber,
    impliedExponent: impliedExponent, epochToMs: epochToMs, orbitFromMeanMotion: orbitFromMeanMotion,
    ageDays: ageDays, CLASSIFICATION: CLASSIFICATION, MU: MU, R_EQ: R_EQ };
});

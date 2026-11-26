/* Launch window: the times a launch site passes under the plane of a target orbit, which is when a direct launch
   can enter that plane. References:
   - Greenwich mean sidereal time: Meeus, Astronomical Algorithms, 2nd ed., chapter 12, eq. 12.4:
     theta0 = 280.46061837 + 360.98564736629 (JD - 2451545.0) + 0.000387933 T^2 - T^3 / 38710000 degrees.
   - Plane geometry: Vallado, Fundamentals of Astrodynamics and Applications, 4th ed., launch windows: the site is in
     the orbit plane when its local sidereal time equals RAAN + delta-lambda (north-going pass) or
     RAAN + 180 - delta-lambda (south-going pass), with sin(delta-lambda) = tan(latitude) / tan(inclination).
   - Nodal regression from J2: Curtis, Orbital Mechanics for Engineering Students, section 4.7 (also Vallado,
     section 9.6): dRAAN/dt = -1.5 n J2 (R / p)^2 cos i, circular orbit here (p = a).
   No DOM, no network. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.DD = root.DD || {}).launchWindow = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var D2R = Math.PI / 180;
  var MU = 398600.4418;           // km^3/s^2 (WGS 84)
  var R_EQ = 6378.137;            // km (WGS 84)
  var J2 = 1.08262668e-3;         // Earth's second zonal harmonic (EGM96 / WGS 84)
  var SIDEREAL_RATE = 360.98564736629;  // degrees of GMST per day of UT (Meeus eq. 12.4)
  var MEAN_SUN_RATE = SIDEREAL_RATE - 360; // degrees per day the mean sun moves east in right ascension

  function norm360(a) { return ((a % 360) + 360) % 360; }
  function wrap180(a) { var x = norm360(a); return x > 180 ? x - 360 : x; }

  function julianDate(date) { return date.getTime() / 86400000 + 2440587.5; }

  /** Greenwich mean sidereal time, degrees 0 to 360 (Meeus eq. 12.4; UT1 taken as UTC, within 0.9 s). */
  function gmstDeg(date) {
    var jd = julianDate(date), d = jd - 2451545.0, T = d / 36525;
    return norm360(280.46061837 + SIDEREAL_RATE * d + 0.000387933 * T * T - T * T * T / 38710000);
  }

  /** Right ascension of the mean sun, degrees: the sidereal time minus the mean sun's Greenwich hour angle
   *  (15 degrees per hour of UT, measured from noon). */
  function meanSunRaDeg(date) {
    var utHours = (date.getTime() % 86400000 + 86400000) % 86400000 / 3600000;
    return norm360(gmstDeg(date) - (15 * utHours - 180));
  }

  /** Secular drift of the ascending node from J2, degrees per day, for a circular orbit. */
  function nodalRateDegPerDay(altKm, incDeg) {
    var a = R_EQ + altKm, n = Math.sqrt(MU / (a * a * a));  // rad/s
    return -1.5 * n * J2 * Math.pow(R_EQ / a, 2) * Math.cos(incDeg * D2R) * 86400 / D2R;
  }

  /** Where the site sits relative to the plane: for each pass, the angle along the equator from the ascending node
   *  to the site's meridian (delta-lambda, degrees), the argument of latitude and the inertial launch azimuth. */
  function planeGeometry(latDeg, incDeg) {
    if (![latDeg, incDeg].every(isFinite)) throw new Error("Latitude and inclination must be numbers.");
    if (latDeg < -90 || latDeg > 90) throw new Error("Latitude must be between -90 and 90 degrees.");
    if (incDeg < 0 || incDeg > 180) throw new Error("Inclination must be between 0 and 180 degrees.");
    var absLat = Math.abs(latDeg);
    if (absLat > 89.99) throw new Error("A launch window is not defined at a pole.");
    if (incDeg < absLat - 1e-9 || incDeg > 180 - absLat + 1e-9) {
      throw new Error("An inclination of " + incDeg + "° never passes over latitude " + latDeg +
        "°: the site is never in that plane, so there is no direct-launch window. Reachable: " +
        absLat.toFixed(2) + "° to " + (180 - absLat).toFixed(2) + "°.");
    }
    var sinI = Math.sin(incDeg * D2R), cosI = Math.cos(incDeg * D2R);
    if (sinI < 1e-12) throw new Error("An equatorial site lies in an equatorial orbit's plane all the time: every moment is a window.");
    var sinU = Math.max(-1, Math.min(1, Math.sin(latDeg * D2R) / sinI));
    var uN = Math.asin(sinU) / D2R;          // north-going pass, argument of latitude -90 to 90
    var uS = 180 - uN;                       // south-going pass
    var sinAz = Math.max(-1, Math.min(1, cosI / Math.cos(latDeg * D2R)));
    function pass(u, az) {
      var ur = u * D2R;
      return { argLatDeg: norm360(u), deltaLambdaDeg: norm360(Math.atan2(cosI * Math.sin(ur), Math.cos(ur)) / D2R),
        azimuthDeg: norm360(az) };
    }
    var north = pass(uN, Math.asin(sinAz) / D2R);
    var south = pass(uS, 180 - Math.asin(sinAz) / D2R);
    var single = Math.abs(wrap180(north.deltaLambdaDeg - south.deltaLambdaDeg)) < 1e-6;
    return { north: north, south: south, single: single };
  }

  /** opts: { latDeg, lonDeg, incDeg, altKm, start: Date, days, mode: "raan" | "ltan",
   *          raanDeg, raanEpoch: Date, useJ2 (raan mode), ltanHours (ltan mode, local mean time of the ascending node) }
   *  Returns { windows: [{ time: Date, pass: "north" | "south", azimuthDeg, lstDeg, raanDeg }], geometry, nodeRateDegPerDay }. */
  function windows(opts) {
    var o = opts || {};
    var lat = o.latDeg, lon = o.lonDeg, inc = o.incDeg, alt = o.altKm === undefined ? 400 : o.altKm;
    if (![lat, lon, inc, alt, o.days].every(isFinite)) throw new Error("Every input must be a number.");
    if (lon < -180 || lon > 360) throw new Error("Longitude must be between -180 and 180 degrees.");
    if (!(o.start instanceof Date) || isNaN(o.start.getTime())) throw new Error("The start time is not a valid date.");
    if (o.days < 1 / 24 || o.days > 366) throw new Error("Search between 1 hour and 366 days.");
    if (alt < 80) throw new Error("The orbit altitude must be at least 80 km.");
    var geom = planeGeometry(lat, inc);
    var raanAt, rate;
    if (o.mode === "ltan") {
      if (!isFinite(o.ltanHours) || o.ltanHours < 0 || o.ltanHours >= 24) throw new Error("The node time must be from 0 to under 24 hours.");
      // The ascending node keeps a fixed local mean solar time: RAAN = mean sun's RA + 15 (LTAN - 12).
      raanAt = function (t) { return norm360(meanSunRaDeg(t) + 15 * (o.ltanHours - 12)); };
      rate = MEAN_SUN_RATE;
    } else {
      if (!isFinite(o.raanDeg)) throw new Error("Enter the orbit's right ascension of the ascending node.");
      if (!(o.raanEpoch instanceof Date) || isNaN(o.raanEpoch.getTime())) throw new Error("The node epoch is not a valid date.");
      rate = o.useJ2 === false ? 0 : nodalRateDegPerDay(alt, inc);
      var t0 = o.raanEpoch.getTime();
      raanAt = function (t) { return norm360(o.raanDeg + rate * (t.getTime() - t0) / 86400000); };
    }
    var relRate = SIDEREAL_RATE - rate;   // degrees per day the site's meridian gains on the node
    var startMs = o.start.getTime(), endMs = startMs + o.days * 86400000;
    var out = [];
    var passes = geom.single ? [["north", geom.north]] : [["north", geom.north], ["south", geom.south]];
    passes.forEach(function (p) {
      var name = p[0], g = p[1];
      function f(ms) { var t = new Date(ms); return gmstDeg(t) + lon - raanAt(t) - g.deltaLambdaDeg; }
      var ms = startMs - 60000;   // start a minute early so a window exactly at the start is kept
      for (var guard = 0; guard < 1000; guard++) {
        // Next time f = 0 (mod 360) at or after ms, then two Newton steps for the small non-linear terms.
        var t = ms + norm360(-f(ms)) / relRate * 86400000;
        for (var k = 0; k < 3; k++) t -= wrap180(f(t)) / relRate * 86400000;
        if (t < startMs - 1000) { ms = t + 3600000; continue; }
        if (t > endMs) break;
        var lst = norm360(gmstDeg(new Date(t)) + lon);
        out.push({ time: new Date(Math.round(t)), pass: name, azimuthDeg: g.azimuthDeg, lstDeg: lst,
          raanDeg: raanAt(new Date(t)) });
        ms = t + 3600000;   // windows of one pass are about a day apart; skip past this one
      }
    });
    out.sort(function (a, b) { return a.time - b.time; });
    return { windows: out, geometry: geom, nodeRateDegPerDay: rate };
  }

  return { julianDate: julianDate, gmstDeg: gmstDeg, meanSunRaDeg: meanSunRaDeg, nodalRateDegPerDay: nodalRateDegPerDay,
    planeGeometry: planeGeometry, windows: windows, SIDEREAL_RATE: SIDEREAL_RATE, J2: J2 };
});

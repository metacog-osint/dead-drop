/* The Sun's position in the sky, and the times of sunrise, solar noon, sunset and twilight, for a place and an instant.
   Reference: Jean Meeus, Astronomical Algorithms, 2nd ed. (1998): chapter 25 (solar coordinates, low accuracy:
   geometric mean longitude L0, mean anomaly M, equation of centre C, apparent longitude with nutation and aberration,
   obliquity from eq. 22.2 corrected by 0.00256 cos(omega)), chapter 28 eq. 28.3 (equation of time), chapter 13
   (local horizontal coordinates) and chapter 15 (rising and setting, h0 = -0.8333 deg). The same algorithm, term for
   term, is the NOAA Global Monitoring Laboratory's Solar Calculator and its spreadsheets; the refraction correction
   is NOAA's. Accuracy: Meeus gives this method as good to about 0.01 deg in the Sun's position; NOAA gives its
   sunrise and sunset as good to about a minute between latitudes 72 S and 72 N, and to about ten minutes nearer the
   poles. Real refraction near the horizon varies with the weather and can move a sunrise by a minute or more.
   Times are taken as UTC in place of Terrestrial Time; the difference (about 69 s in 2026) moves the Sun by under
   0.001 deg. No DOM, no network. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.DD = root.DD || {}).sunPosition = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var D2R = Math.PI / 180, R2D = 180 / Math.PI, DAY = 86400000, MIN = 60000;
  var AU_KM = 149597870.7; // IAU 2012 Resolution B2, exact
  var H0 = { sunrise: -0.8333, civil: -6, nautical: -12, astronomical: -18 };

  function norm360(x) { x = x % 360; return x < 0 ? x + 360 : x; }
  function norm180(x) { x = norm360(x); return x >= 180 ? x - 360 : x; }
  function sin(d) { return Math.sin(d * D2R); }
  function cos(d) { return Math.cos(d * D2R); }

  /** Julian Day from milliseconds since 1970 UTC (JD 2440587.5 = 1970-01-01T00:00Z). */
  function julianDay(ms) { return ms / DAY + 2440587.5; }

  /** Meeus ch. 25 low-accuracy solar coordinates, and eq. 28.3 equation of time, for a Julian Day. Degrees. */
  function solarCoords(jd) {
    var T = (jd - 2451545.0) / 36525;                                        // eq. 25.1
    var L0 = norm360(280.46646 + T * (36000.76983 + T * 0.0003032));        // eq. 25.2
    var M = 357.52911 + T * (35999.05029 - 0.0001537 * T);                  // eq. 25.3
    var e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);             // eq. 25.4
    var C = sin(M) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
      sin(2 * M) * (0.019993 - 0.000101 * T) + sin(3 * M) * 0.000289;
    var trueLong = L0 + C, v = M + C;
    var R = 1.000001018 * (1 - e * e) / (1 + e * cos(v));                   // eq. 25.5, AU
    var omega = 125.04 - 1934.136 * T;
    var lambda = trueLong - 0.00569 - 0.00478 * sin(omega);                 // apparent longitude
    var eps0 = 23 + (26 + (21.448 - T * (46.8150 + T * (0.00059 - T * 0.001813))) / 60) / 60; // eq. 22.2
    var eps = eps0 + 0.00256 * cos(omega);
    var ra = norm360(Math.atan2(cos(eps) * sin(lambda), cos(lambda)) * R2D); // eq. 25.6 (apparent)
    var decl = Math.asin(sin(eps) * sin(lambda)) * R2D;                     // eq. 25.7 (apparent)
    var y = Math.pow(Math.tan(eps / 2 * D2R), 2);                           // eq. 28.3
    var E = y * sin(2 * L0) - 2 * e * sin(M) + 4 * e * y * sin(M) * cos(2 * L0) -
      0.5 * y * y * sin(4 * L0) - 1.25 * e * e * sin(2 * M);                 // radians
    return { T: T, L0: L0, M: norm360(M), e: e, C: C, trueLong: norm360(trueLong), trueAnomaly: norm360(v), R: R,
      omega: norm360(omega), lambda: norm360(lambda), eps0: eps0, eps: eps, ra: ra, decl: decl,
      eqTimeMin: E * R2D * 4 };
  }

  /** NOAA's atmospheric refraction, degrees, for a geometric (airless) elevation in degrees; standard atmosphere. */
  function refraction(elev) {
    if (elev > 85) return 0;
    var te = Math.tan(elev * D2R), arcsec;
    if (elev > 5) arcsec = 58.1 / te - 0.07 / Math.pow(te, 3) + 0.000086 / Math.pow(te, 5);
    else if (elev > -0.575) arcsec = 1735 + elev * (-518.2 + elev * (103.4 + elev * (-12.79 + elev * 0.711)));
    else arcsec = -20.772 / te;
    return arcsec / 3600;
  }

  function check(lat, lon) {
    if (![lat, lon].every(function (x) { return typeof x === "number" && isFinite(x); })) throw new Error("Latitude and longitude must be numbers.");
    if (lat < -90 || lat > 90) throw new Error("Latitude must be between -90 and 90 degrees.");
    if (lon < -180 || lon > 180) throw new Error("Longitude must be between -180 and 180 degrees (east positive).");
  }
  function checkMs(ms) {
    if (typeof ms !== "number" || !isFinite(ms)) throw new Error("Not a valid time.");
  }

  /** Where the Sun is seen from (lat, lon east positive) at an instant (ms UTC). Degrees; azimuth from true north,
   *  clockwise. elevation is with NOAA's refraction; geometricElevation is without it. */
  function position(ms, lat, lon) {
    check(lat, lon); checkMs(ms);
    var c = solarCoords(julianDay(ms));
    var utcMin = ((ms % DAY) + DAY) % DAY / MIN;
    var tst = utcMin + c.eqTimeMin + 4 * lon;                         // true solar time, minutes
    var H = norm180(tst / 4 - 180);                                  // hour angle, negative before noon
    var cz = sin(lat) * sin(c.decl) + cos(lat) * cos(c.decl) * cos(H);
    cz = Math.max(-1, Math.min(1, cz));
    var geo = 90 - Math.acos(cz) * R2D;
    var az;
    if (Math.abs(cos(lat)) < 1e-12) az = lat > 0 ? 180 : 0;           // at a pole every direction is south or north
    else az = norm360(Math.atan2(sin(H), cos(H) * sin(lat) - Math.tan(c.decl * D2R) * cos(lat)) * R2D + 180);
    var ref = refraction(geo);
    return {
      azimuth: az, elevation: geo + ref, geometricElevation: geo, refraction: ref, hourAngle: H,
      declination: c.decl, rightAscension: c.ra, eqTimeMin: c.eqTimeMin, distanceAU: c.R, distanceKm: c.R * AU_KM,
      subsolarLat: c.decl, subsolarLon: norm180((720 - utcMin - c.eqTimeMin) / 4),
      phase: phase(geo)
    };
  }

  /** Daylight or twilight, by the Sun's geometric elevation (the standard twilight definitions). */
  function phase(geo) {
    if (geo >= H0.sunrise) return "day";
    if (geo >= H0.civil) return "civil twilight";
    if (geo >= H0.nautical) return "nautical twilight";
    if (geo >= H0.astronomical) return "astronomical twilight";
    return "night";
  }

  /** UTC midnight that starts the local mean solar day containing ms at longitude lon (east positive). */
  function solarDayStart(ms, lon) { return Math.floor((ms + lon * 240000) / DAY) * DAY; }

  function noonOf(day0, lon) {
    var t = day0 + (720 - 4 * lon) * MIN;
    for (var i = 0; i < 3; i++) t = day0 + (720 - 4 * lon - solarCoords(julianDay(t)).eqTimeMin) * MIN;
    return t;
  }

  /** Rising (rise = true) or setting time for the Sun's centre at geometric altitude h0, within the solar day that
   *  starts at day0. Returns { ms } or { never: "above" | "below" }. Iterated on the declination and equation of
   *  time at the event itself (Meeus ch. 15; NOAA). */
  function crossing(day0, lat, lon, h0, rise) {
    var t = noonOf(day0, lon);
    for (var i = 0; i < 4; i++) {
      var c = solarCoords(julianDay(t));
      var cosH = (sin(h0) - sin(lat) * sin(c.decl)) / (cos(lat) * cos(c.decl));
      if (!isFinite(cosH) || cosH > 1) return { never: "below" };
      if (cosH < -1) return { never: "above" };
      var H = Math.acos(cosH) * R2D;
      t = day0 + (720 - 4 * (lon + (rise ? H : -H)) - c.eqTimeMin) * MIN;
    }
    return { ms: t };
  }

  /** Sunrise, solar noon, sunset and the three twilights for the local mean solar day (midnight to midnight at the
   *  place's longitude) that contains the instant ms. */
  function events(ms, lat, lon) {
    check(lat, lon); checkMs(ms);
    var day0 = solarDayStart(ms, lon);
    var noon = noonOf(day0, lon);
    var out = { dayStart: day0, solarNoon: noon, noonElevation: position(noon, lat, lon).elevation,
      noonAzimuth: position(noon, lat, lon).azimuth };
    Object.keys(H0).forEach(function (k) {
      var r = crossing(day0, lat, lon, H0[k], true), s = crossing(day0, lat, lon, H0[k], false);
      out[k] = { start: r.ms === undefined ? null : r.ms, end: s.ms === undefined ? null : s.ms,
        never: r.never || s.never || null };
    });
    var sr = out.sunrise;
    out.dayLengthMin = sr.never === "above" ? 1440 : sr.never === "below" ? 0 : (sr.end - sr.start) / MIN;
    return out;
  }

  /** "15 h 37 min", rounding to the minute without ever showing 60 min. */
  function hoursMinutes(min) {
    if (!isFinite(min)) return "–";
    var m = Math.round(min), h = Math.floor(m / 60);
    return h + " h " + (m - 60 * h) + " min";
  }

  /** 16-point compass name of an azimuth. */
  function compass(az) {
    var n = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
    return n[Math.round(norm360(az) / 22.5) % 16];
  }

  /** The Sun's position at each step through the solar day containing ms (default every hour). */
  function track(ms, lat, lon, stepMin) {
    check(lat, lon); checkMs(ms);
    stepMin = stepMin || 60;
    var day0 = solarDayStart(ms, lon), first = Math.ceil((day0 - lon * 240000) / (stepMin * MIN)) * stepMin * MIN;
    var rows = [];
    for (var t = first; t < day0 - lon * 240000 + DAY; t += stepMin * MIN) {
      var p = position(t, lat, lon);
      rows.push({ ms: t, azimuth: p.azimuth, elevation: p.elevation, phase: p.phase });
    }
    return rows;
  }

  return { julianDay: julianDay, solarCoords: solarCoords, refraction: refraction, position: position, events: events,
    track: track, phase: phase, compass: compass, hoursMinutes: hoursMinutes, solarDayStart: solarDayStart,
    H0: H0, AU_KM: AU_KM };
});

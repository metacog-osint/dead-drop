/* Where a satellite is in an observer's sky, whether sunlight reaches it, and whether the observer's sky is dark.
   No DOM, no network, no orbit propagator: the page passes in a function that gives the satellite's position and
   velocity (TEME frame, km and km/s, as SGP4 and satellite.js return them) for a time.
   References:
   - Sidereal time: Vallado, Fundamentals of Astrodynamics and Applications, 4th ed., section 3.5, eq. 3-45
     (IAU-82 GMST), the angle SGP4's TEME frame is turned through to reach the Earth-fixed frame (Vallado et al.,
     "Revisiting Spacetrack Report #3", AIAA 2006-6753). Polar motion and UT1 - UTC (under 0.9 s) are ignored.
   - Earth-fixed velocity: v_ECEF = R3(theta) v_TEME - omega x r_ECEF (Vallado section 3.7).
   - Geodetic and Earth-fixed coordinates on the WGS 84 ellipsoid: Vallado section 3.2 (eq. 3-7) and Algorithm 12.
   - Look angles (azimuth, elevation, range, range rate) in the observer's east-north-up frame: Vallado section 4.4.
   - Sun position: Vallado Algorithm 29 (accurate to about 0.01 degree from 1950 to 2050), mean-of-date frame,
     treated here as the TEME frame (the difference is under a few arcminutes).
   - Earth's shadow: cylindrical model (Vallado section 5.3) and the conical umbra and penumbra model by the Sun's
     and Earth's apparent discs (Montenbruck & Gill, Satellite Orbits, 2000, section 3.4.2). */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.DD = root.DD || {}).satelliteVisibility = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var A = 6378.137;                 // km, WGS 84 semi-major axis
  var F = 1 / 298.257223563;        // WGS 84 flattening
  var E2 = F * (2 - F);             // first eccentricity squared
  var OMEGA = 7.292115e-5;          // rad/s, WGS 84 Earth rotation rate
  var AU = 149597870.7;             // km
  var R_SUN = 696000;               // km, solar radius
  var D2R = Math.PI / 180;
  var TWO_PI = 2 * Math.PI;

  function finite3(v) { return v && isFinite(v.x) && isFinite(v.y) && isFinite(v.z); }
  function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
  function norm(a) { return Math.sqrt(dot(a, a)); }
  function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
  function wrap360(d) { d = d % 360; return d < 0 ? d + 360 : d; }

  /** Julian date from milliseconds since 1970-01-01T00:00Z (UTC, used as UT1). */
  function julianDate(ms) { return ms / 86400000 + 2440587.5; }

  /** Greenwich mean sidereal time, radians, IAU-82 (Vallado eq. 3-45). */
  function gmst(jd) {
    var T = (jd - 2451545.0) / 36525;
    var sec = 67310.54841 + (876600 * 3600 + 8640184.812866) * T + 0.093104 * T * T - 6.2e-6 * T * T * T;
    var rad = (sec % 86400) / 240 * D2R;
    return rad < 0 ? rad + TWO_PI : rad;
  }

  /** TEME position to Earth-fixed: a rotation about z through GMST. */
  function temeToEcef(r, theta) {
    var c = Math.cos(theta), s = Math.sin(theta);
    return { x: c * r.x + s * r.y, y: -s * r.x + c * r.y, z: r.z };
  }

  /** TEME velocity to Earth-fixed velocity, removing the Earth's rotation. */
  function temeToEcefVelocity(r, v, theta) {
    var re = temeToEcef(r, theta), vr = temeToEcef(v, theta);
    return { x: vr.x + OMEGA * re.y, y: vr.y - OMEGA * re.x, z: vr.z };
  }

  /** Geodetic latitude and longitude (degrees) and height above the ellipsoid (km) to Earth-fixed km. */
  function geodeticToEcef(latDeg, lonDeg, hKm) {
    if (![latDeg, lonDeg, hKm].every(isFinite)) throw new Error("Latitude, longitude and height must be numbers.");
    if (latDeg < -90 || latDeg > 90) throw new Error("Latitude must be between -90 and 90 degrees.");
    var p = latDeg * D2R, l = lonDeg * D2R, sp = Math.sin(p);
    var N = A / Math.sqrt(1 - E2 * sp * sp);
    return { x: (N + hKm) * Math.cos(p) * Math.cos(l), y: (N + hKm) * Math.cos(p) * Math.sin(l),
      z: (N * (1 - E2) + hKm) * sp };
  }

  /** Earth-fixed km to geodetic latitude, longitude (degrees, -180 to 180) and height (km), by iteration. */
  function ecefToGeodetic(r) {
    if (!finite3(r)) throw new Error("The position must have numeric x, y and z.");
    var p = Math.sqrt(r.x * r.x + r.y * r.y);
    var lon = Math.atan2(r.y, r.x);
    if (p < 1e-9) return { latDeg: r.z >= 0 ? 90 : -90, lonDeg: 0, hKm: Math.abs(r.z) - A * Math.sqrt(1 - E2) };
    var lat = Math.atan2(r.z, p * (1 - E2)), h = 0, N;
    for (var i = 0; i < 10; i++) {
      var s = Math.sin(lat);
      N = A / Math.sqrt(1 - E2 * s * s);
      h = p / Math.cos(lat) - N;
      var next = Math.atan2(r.z, p * (1 - E2 * N / (N + h)));
      if (Math.abs(next - lat) < 1e-12) { lat = next; break; }
      lat = next;
    }
    var s2 = Math.sin(lat);
    N = A / Math.sqrt(1 - E2 * s2 * s2);
    h = Math.abs(lat) < 1.4 ? p / Math.cos(lat) - N : r.z / s2 - N * (1 - E2);
    return { latDeg: lat / D2R, lonDeg: lon / D2R, hKm: h };
  }

  /** Look angles from an observer {latDeg, lonDeg, hKm} to an Earth-fixed position (and, if given, Earth-fixed
   *  velocity). Azimuth is clockwise from true north; elevation is the angle above the horizon plane that is
   *  square to the ellipsoid's normal. Range rate is positive when the distance is growing. */
  function lookAngles(observer, rEcef, vEcef) {
    if (!finite3(rEcef)) throw new Error("The satellite position must have numeric x, y and z.");
    var o = geodeticToEcef(observer.latDeg, observer.lonDeg, observer.hKm || 0);
    var d = sub(rEcef, o);
    var p = observer.latDeg * D2R, l = observer.lonDeg * D2R;
    var sp = Math.sin(p), cp = Math.cos(p), sl = Math.sin(l), cl = Math.cos(l);
    var e = -sl * d.x + cl * d.y;
    var n = -sp * cl * d.x - sp * sl * d.y + cp * d.z;
    var u = cp * cl * d.x + cp * sl * d.y + sp * d.z;
    var range = norm(d);
    if (range < 1e-9) throw new Error("The satellite and the observer are at the same point.");
    var out = { azDeg: wrap360(Math.atan2(e, n) / D2R), elDeg: Math.asin(Math.max(-1, Math.min(1, u / range))) / D2R,
      rangeKm: range, east: e, north: n, up: u };
    if (finite3(vEcef)) out.rangeRateKmS = dot(d, vEcef) / range;
    return out;
  }

  /** Sun position, km, mean-of-date equatorial frame (Vallado Algorithm 29). */
  function sunPosition(jd) {
    var T = (jd - 2451545.0) / 36525;
    var lm = 280.460 + 36000.771 * T;
    var M = (357.5291092 + 35999.05034 * T) * D2R;
    var lam = (lm + 1.914666471 * Math.sin(M) + 0.019994643 * Math.sin(2 * M)) * D2R;
    var r = (1.000140612 - 0.016708617 * Math.cos(M) - 0.000139589 * Math.cos(2 * M)) * AU;
    var eps = (23.439291 - 0.0130042 * T) * D2R;
    return { x: r * Math.cos(lam), y: r * Math.cos(eps) * Math.sin(lam), z: r * Math.sin(eps) * Math.sin(lam) };
  }

  /** Cylindrical shadow: the satellite is in shadow when it is on the night side and within one Earth radius
   *  of the Earth-Sun line. Returns "sunlit" or "umbra". */
  function shadowCylindrical(rSat, rSun) {
    if (!finite3(rSat) || !finite3(rSun)) throw new Error("Positions must have numeric x, y and z.");
    var sHat = { x: rSun.x / norm(rSun), y: rSun.y / norm(rSun), z: rSun.z / norm(rSun) };
    var along = dot(rSat, sHat);
    if (along >= 0) return "sunlit";
    var perp = Math.sqrt(Math.max(0, dot(rSat, rSat) - along * along));
    return perp > A ? "sunlit" : "umbra";
  }

  /** Conical shadow by apparent discs (Montenbruck & Gill 3.4.2). Returns {state, fraction}: state is "sunlit",
   *  "penumbra" (part of the Sun hidden) or "umbra" (all of it hidden); fraction is the share of the Sun's disc
   *  that is visible, 0 to 1. */
  function shadowConical(rSat, rSun) {
    if (!finite3(rSat) || !finite3(rSun)) throw new Error("Positions must have numeric x, y and z.");
    var toSun = sub(rSun, rSat);
    var dS = norm(toSun), dE = norm(rSat);
    if (dE <= A) return { state: "umbra", fraction: 0 };       // at or below the surface
    var a = Math.asin(Math.min(1, R_SUN / dS));                 // apparent radius of the Sun
    var b = Math.asin(Math.min(1, A / dE));                     // apparent radius of the Earth
    var c = Math.acos(Math.max(-1, Math.min(1, -dot(rSat, toSun) / (dE * dS)))); // separation of the two centres
    if (c >= a + b) return { state: "sunlit", fraction: 1 };
    if (c <= b - a) return { state: "umbra", fraction: 0 };
    if (c <= a - b) return { state: "penumbra", fraction: 1 - (b * b) / (a * a) }; // Earth wholly inside the Sun's disc
    var x = (c * c + a * a - b * b) / (2 * c);
    var y = Math.sqrt(Math.max(0, a * a - x * x));
    var area = a * a * Math.acos(Math.max(-1, Math.min(1, x / a))) +
      b * b * Math.acos(Math.max(-1, Math.min(1, (c - x) / b))) - c * y;
    return { state: "penumbra", fraction: Math.max(0, Math.min(1, 1 - area / (Math.PI * a * a))) };
  }

  /** Everything the pages show for one time. propagate(ms) returns {position, velocity} in TEME (km, km/s) or
   *  something falsy when the propagator fails. observer is {latDeg, lonDeg, hKm}. Returns null on failure. */
  function observe(propagate, ms, observer, opts) {
    opts = opts || {};
    var pv = propagate(ms);
    if (!pv || !finite3(pv.position)) return null;
    var jd = julianDate(ms), theta = gmst(jd);
    var rE = temeToEcef(pv.position, theta);
    var vE = finite3(pv.velocity) ? temeToEcefVelocity(pv.position, pv.velocity, theta) : null;
    var look = lookAngles(observer, rE, vE);
    var sunTeme = sunPosition(jd);
    var sunLook = lookAngles(observer, temeToEcef(sunTeme, theta));
    var sh = shadowConical(pv.position, sunTeme);
    var below = ecefToGeodetic(rE);
    var out = {
      ms: ms, azDeg: look.azDeg, elDeg: look.elDeg, rangeKm: look.rangeKm,
      rangeRateKmS: look.rangeRateKmS, subLatDeg: below.latDeg, subLonDeg: below.lonDeg, heightKm: below.hKm,
      speedKmS: finite3(pv.velocity) ? norm(pv.velocity) : NaN,
      sunElDeg: sunLook.elDeg, shadow: sh.state, sunFraction: sh.fraction,
      teme: pv.position, ecef: rE
    };
    var v = verdict(out.elDeg, sh.state, out.sunElDeg, opts.maskDeg || 0, opts.darkSunElDeg);
    out.visible = v.visible; out.reason = v.reason;
    return out;
  }

  /** Can the satellite be seen with the eye? Above the horizon mask, not in the umbra, and the observer's Sun at
   *  least 6 degrees below the horizon (end of civil twilight, a common rule; brightness is not modelled). */
  function verdict(satElDeg, shadowState, sunElDeg, maskDeg, darkSunElDeg) {
    var dark = isFinite(darkSunElDeg) ? darkSunElDeg : -6;
    var above = satElDeg >= (maskDeg || 0);
    var lit = shadowState !== "umbra";
    var skyDark = sunElDeg <= dark;
    var reason = !above ? "below the horizon" : !lit ? "in the Earth's shadow" : !skyDark ? "the sky is too bright" : "sunlit, in a dark sky";
    return { visible: above && lit && skyDark, aboveHorizon: above, sunlit: lit, skyDark: skyDark, reason: reason };
  }

  var COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  /** 16-point compass name for an azimuth in degrees. */
  function compass(azDeg) { return isFinite(azDeg) ? COMPASS[Math.round(wrap360(azDeg) / 22.5) % 16] : "–"; }

  /** Reads a "YYYY-MM-DDTHH:MM[:SS]" value from a datetime-local input as UTC milliseconds (NaN when malformed). */
  function parseUtcInput(s) {
    var m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)(?::(\d\d)(?:\.\d+)?)?$/.exec(String(s || "").trim());
    if (!m) return NaN;
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  }
  /** UTC milliseconds to the "YYYY-MM-DDTHH:MM:SS" form a datetime-local input takes. */
  function toUtcInput(ms) { return new Date(Math.floor(ms / 1000) * 1000).toISOString().slice(0, 19); }

  /** Places the pages offer as observer presets: latitude and longitude to about 0.01 degree (about 1 km). */
  var SITES = [
    { name: "Cape Canaveral SFS, SLC-40, Florida", lat: 28.56, lon: -80.58 },
    { name: "Kennedy Space Center, LC-39A, Florida", lat: 28.61, lon: -80.60 },
    { name: "Vandenberg SFB, SLC-4E, California", lat: 34.63, lon: -120.61 },
    { name: "Wallops Flight Facility, Virginia", lat: 37.83, lon: -75.49 },
    { name: "Pacific Spaceport Complex, Kodiak, Alaska", lat: 57.44, lon: -152.34 },
    { name: "Guiana Space Centre, Kourou", lat: 5.24, lon: -52.77 },
    { name: "Baikonur Cosmodrome, Kazakhstan", lat: 45.97, lon: 63.31 },
    { name: "Plesetsk Cosmodrome, Russia", lat: 62.93, lon: 40.58 },
    { name: "Jiuquan, China", lat: 40.96, lon: 100.29 },
    { name: "Xichang, China", lat: 28.25, lon: 102.03 },
    { name: "Wenchang, Hainan, China", lat: 19.61, lon: 110.95 },
    { name: "Tanegashima Space Center, Japan", lat: 30.40, lon: 130.97 },
    { name: "Uchinoura Space Center, Japan", lat: 31.25, lon: 131.08 },
    { name: "Satish Dhawan Space Centre, India", lat: 13.72, lon: 80.23 },
    { name: "Naro Space Center, South Korea", lat: 34.43, lon: 127.53 },
    { name: "New York City", lat: 40.71, lon: -74.01 },
    { name: "London", lat: 51.51, lon: -0.13 },
    { name: "Tokyo", lat: 35.68, lon: 139.77 }
  ];

  return { julianDate: julianDate, gmst: gmst, temeToEcef: temeToEcef, temeToEcefVelocity: temeToEcefVelocity,
    geodeticToEcef: geodeticToEcef, ecefToGeodetic: ecefToGeodetic, lookAngles: lookAngles, sunPosition: sunPosition,
    shadowCylindrical: shadowCylindrical, shadowConical: shadowConical, observe: observe, verdict: verdict,
    compass: compass, parseUtcInput: parseUtcInput, toUtcInput: toUtcInput, SITES: SITES,
    A: A, F: F, E2: E2, OMEGA: OMEGA, AU: AU, R_SUN: R_SUN };
});

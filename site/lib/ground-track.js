/* Ground track: the path traced on the Earth's surface by the point directly below a satellite. No DOM, no network,
   no orbit propagator: the caller passes propagate(ms), a function that returns {position, velocity} in the TEME
   frame (km, km/s, the frame SGP4 and satellite.js use) or something falsy when it fails, so the maths can be
   tested with made-up orbits.
   References:
   - Julian date and Greenwich mean sidereal time (GMST, the Earth's rotation angle used to turn the TEME frame into
     the Earth-fixed frame): Vallado, Fundamentals of Astrodynamics and Applications, 4th ed., section 3.5
     (IAU-82 GMST), worked in Example 3-5. UTC is used for UT1 (they differ by under 0.9 s, about 0.004 deg of
     rotation, under 0.5 km at the equator). Polar motion is ignored (tens of metres).
   - TEME to Earth-fixed by a single rotation about z through GMST: Vallado et al., "Revisiting Spacetrack Report #3",
     AIAA 2006-6753, appendix C.
   - Earth-fixed to geodetic latitude, longitude and height on the WGS 84 ellipsoid: Vallado chapter 3,
     Algorithm 12 (iteration on the geodetic latitude), worked in Example 3-3.
   - Splitting a track where it crosses the 180 deg meridian: a map draws a straight segment between the two
     longitudes, so a segment from 170 E to 170 W would otherwise be drawn the long way round, across the whole map.
     The crossing point is found by linear interpolation in latitude and longitude, which is how the map draws the
     segment anyway. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.DD = root.DD || {}).groundTrack = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var A = 6378.137;                 // km, WGS 84 semi-major axis
  var F = 1 / 298.257223563;        // WGS 84 flattening
  var E2 = F * (2 - F);             // first eccentricity squared
  var D2R = Math.PI / 180;
  var TWO_PI = 2 * Math.PI;

  function finite3(v) { return !!v && isFinite(v.x) && isFinite(v.y) && isFinite(v.z); }

  /** Julian date from milliseconds since 1970-01-01T00:00Z. JD 2440587.5 is that instant. */
  function julianDate(ms) {
    if (!isFinite(ms)) throw new Error("The time must be a number of milliseconds.");
    return ms / 86400000 + 2440587.5;
  }

  /** Greenwich mean sidereal time in radians, 0 to 2 pi, IAU-82 (Vallado section 3.5):
   *  GMST(s) = 67310.54841 + (876600 h + 8640184.812866 s) T + 0.093104 T^2 - 6.2e-6 T^3, T in Julian centuries
   *  of UT1 from J2000.0 (JD 2451545.0). */
  function gmst(jd) {
    if (!isFinite(jd)) throw new Error("The Julian date must be a number.");
    var T = (jd - 2451545.0) / 36525;
    var sec = 67310.54841 + (876600 * 3600 + 8640184.812866) * T + 0.093104 * T * T - 6.2e-6 * T * T * T;
    var rad = ((sec % 86400) / 240) * D2R;      // 240 seconds of time per degree
    return rad < 0 ? rad + TWO_PI : rad;
  }

  /** TEME (or any true-equator inertial frame) to Earth-fixed: rotate about z by -theta. */
  function inertialToEarthFixed(r, theta) {
    var c = Math.cos(theta), s = Math.sin(theta);
    return { x: c * r.x + s * r.y, y: -s * r.x + c * r.y, z: r.z };
  }

  /** Earth-fixed km to geodetic latitude and longitude (degrees, longitude -180 to 180) and height above the WGS 84
   *  ellipsoid (km). Vallado Algorithm 12. */
  function earthFixedToGeodetic(r) {
    if (!finite3(r)) throw new Error("The position must have numeric x, y and z.");
    var p = Math.sqrt(r.x * r.x + r.y * r.y);
    if (p < 1e-9) return { latDeg: r.z >= 0 ? 90 : -90, lonDeg: 0, hKm: Math.abs(r.z) - A * Math.sqrt(1 - E2) };
    var lon = Math.atan2(r.y, r.x);
    var lat = Math.atan2(r.z, p * (1 - E2)), N;
    for (var i = 0; i < 20; i++) {
      var s = Math.sin(lat);
      N = A / Math.sqrt(1 - E2 * s * s);
      var next = Math.atan2(r.z + N * E2 * s, p);
      if (Math.abs(next - lat) < 1e-13) { lat = next; break; }
      lat = next;
    }
    var sl = Math.sin(lat), cl = Math.cos(lat);
    N = A / Math.sqrt(1 - E2 * sl * sl);
    // Two forms of the height; the first loses precision near the poles, the second near the equator.
    var h = Math.abs(cl) > 0.1 ? p / cl - N : r.z / sl - N * (1 - E2);
    return { latDeg: lat / D2R, lonDeg: lon / D2R, hKm: h };
  }

  /** Inertial (TEME) position at time ms to the point below it: {latDeg, lonDeg, hKm}. */
  function subSatellitePoint(rTeme, ms) {
    if (!finite3(rTeme)) throw new Error("The position must have numeric x, y and z.");
    return earthFixedToGeodetic(inertialToEarthFixed(rTeme, gmst(julianDate(ms))));
  }

  /** Samples the ground track from startMs for durationS seconds every stepS seconds (the last sample lands on the
   *  end). Returns [{ms, latDeg, lonDeg, hKm}] with null where the propagator failed. maxPoints caps the work. */
  function track(propagate, startMs, durationS, stepS, maxPoints) {
    if (typeof propagate !== "function") throw new Error("propagate must be a function of time.");
    if (!isFinite(startMs)) throw new Error("The start time must be a number.");
    if (!(durationS > 0)) throw new Error("The duration must be greater than zero.");
    if (!(stepS > 0)) throw new Error("The step must be greater than zero.");
    var cap = maxPoints || 20000;
    var n = Math.ceil(durationS / stepS);
    if (n + 1 > cap) throw new Error("That would be " + (n + 1) + " points; make the step longer or the span shorter (at most " + cap + ").");
    var out = [];
    for (var i = 0; i <= n; i++) {
      var ms = startMs + Math.min(i * stepS, durationS) * 1000;
      var pv = propagate(ms);
      if (!pv || !finite3(pv.position)) { out.push(null); continue; }
      var g = subSatellitePoint(pv.position, ms);
      out.push({ ms: ms, latDeg: g.latDeg, lonDeg: g.lonDeg, hKm: g.hKm });
    }
    return out;
  }

  /** Splits a list of points ({latDeg, lonDeg} or [lat, lon]; null marks a gap) into polylines a map can draw:
   *  wherever consecutive longitudes jump by more than 180 deg the track has crossed the 180 deg meridian, so the
   *  line is ended at +/-180 and a new one started at -/+180, at the interpolated latitude. Returns [[[lat, lon]...]]. */
  function splitAntimeridian(points) {
    var lines = [], cur = [], prev = null;
    function ll(p) { return Array.isArray(p) ? [p[0], p[1]] : [p.latDeg, p.lonDeg]; }
    (points || []).forEach(function (p) {
      if (p === null || p === undefined) {
        if (cur.length > 1) lines.push(cur);
        cur = []; prev = null; return;
      }
      var q = ll(p);
      if (!isFinite(q[0]) || !isFinite(q[1])) throw new Error("Every point needs a numeric latitude and longitude.");
      if (prev) {
        var d = q[1] - prev[1];
        if (Math.abs(d) > 180) {
          var edge = d < 0 ? 180 : -180;              // eastward over 180 E (lon falls) or westward over 180 W
          var lon2 = q[1] + (d < 0 ? 360 : -360);       // the new longitude on the old side's numbering
          var f = (edge - prev[1]) / (lon2 - prev[1]);
          var lat = prev[0] + f * (q[0] - prev[0]);
          cur.push([lat, edge]);
          if (cur.length > 1) lines.push(cur);
          cur = [[lat, -edge]];
        }
      }
      cur.push(q);
      prev = q;
    });
    if (cur.length > 1) lines.push(cur);
    return lines;
  }

  /** Orbital period in minutes from mean motion in revolutions per day. */
  function periodMin(meanMotionRevDay) {
    if (!(meanMotionRevDay > 0)) throw new Error("Mean motion must be greater than zero.");
    return 1440 / meanMotionRevDay;
  }

  /** How far west the track moves between consecutive equator crossings: the Earth's turn in one orbit,
   *  360.9856 deg per day (sidereal rate) times the period. Ignores the drift of the orbit plane (nodal regression,
   *  under 0.1 deg per orbit for low orbits). */
  function westwardShiftDeg(periodMinutes) {
    if (!(periodMinutes > 0)) throw new Error("The period must be greater than zero.");
    return 360.98564736629 * periodMinutes / 1440;
  }

  /** Summary of a sampled track: highest and lowest height, the highest latitude reached north and south. */
  function summary(points) {
    var good = (points || []).filter(function (p) { return p; });
    if (!good.length) return null;
    var s = { points: good.length, minHKm: Infinity, maxHKm: -Infinity, maxLatDeg: -90, minLatDeg: 90 };
    good.forEach(function (p) {
      s.minHKm = Math.min(s.minHKm, p.hKm); s.maxHKm = Math.max(s.maxHKm, p.hKm);
      s.maxLatDeg = Math.max(s.maxLatDeg, p.latDeg); s.minLatDeg = Math.min(s.minLatDeg, p.latDeg);
    });
    return s;
  }

  return { julianDate: julianDate, gmst: gmst, inertialToEarthFixed: inertialToEarthFixed,
    earthFixedToGeodetic: earthFixedToGeodetic, subSatellitePoint: subSatellitePoint, track: track,
    splitAntimeridian: splitAntimeridian, periodMin: periodMin, westwardShiftDeg: westwardShiftDeg, summary: summary,
    A: A, F: F, E2: E2 };
});

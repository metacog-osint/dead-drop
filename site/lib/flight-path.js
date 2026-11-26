/* Ground track and minimum-energy ballistic figures for a point-to-point flight over a spherical, non-rotating
   Earth with no atmosphere.
   Ground track and end point: the destination point on a great circle (Chris Veness, "Calculate distance, bearing
   and more between latitude/longitude points", movable-type.co.uk), from distance-bearing.js.
   Minimum-energy trajectory: Bate, Mueller and White, Fundamentals of Astrodynamics (1971), chapter 6 (ballistic
   missile trajectories). For a free-flight range angle Psi (ground range / R), the burnout parameter
   Q = v^2 r / mu that just reaches that range, and the flight-path angle (above the local horizontal) that needs it, are
     Q = 2 sin(Psi/2) / (1 + sin(Psi/2)),   phi = (180 deg - Psi) / 4.
   The trajectory is a conic with a = r / (2 - Q) and e^2 = 1 + Q (Q - 2) cos^2 phi; the apogee radius is a (1 + e).
   Time of flight follows from Kepler's equation between burnout (true anomaly 180 deg - Psi/2) and the symmetric
   re-entry point. Burnout and re-entry are both taken at the surface (r = R). */
(function (root, factory) {
  var gc = (typeof module === "object" && module.exports) ? require("./distance-bearing.js") : root.DD.distanceBearing;
  var api = factory(gc);
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.DD = root.DD || {}).flightPath = api;
})(typeof self !== "undefined" ? self : this, function (gc) {
  "use strict";
  var MU = 398600.4418;          // km^3/s^2, Earth's gravitational parameter (WGS 84 / IERS)
  var R = gc.R_EARTH;            // km
  var D2R = Math.PI / 180;
  var MAX_KM = Math.PI * R;      // half way round the Earth

  /** Minimum-energy ballistic trajectory for a ground range, burnout and re-entry at the surface. */
  function minimumEnergy(rangeKm) {
    if (typeof rangeKm !== "number" || !isFinite(rangeKm) || rangeKm <= 0) throw new Error("Range must be a number above 0 km.");
    if (rangeKm > MAX_KM) throw new Error("Range must be at most " + Math.floor(MAX_KM) + " km (half way round the Earth).");
    var psi = rangeKm / R;
    var s = Math.sin(psi / 2);
    var Q = 2 * s / (1 + s);
    var phi = (Math.PI - psi) / 4;
    var a = R / (2 - Q);
    var e = Math.sqrt(Math.max(0, 1 + Q * (Q - 2) * Math.cos(phi) * Math.cos(phi)));
    var apogeeR = a * (1 + e);
    var v = Math.sqrt(Q * MU / R);
    // Time of flight: burnout at true anomaly nu = 180 deg - Psi/2, apogee at 180 deg, symmetric re-entry.
    var tof;
    if (e < 1e-12) tof = psi * Math.sqrt(R * R * R / MU);   // circular (Psi = 180 deg): a grazing orbit
    else {
      var nu = Math.PI - psi / 2;
      var cosE = (e + Math.cos(nu)) / (1 + e * Math.cos(nu));
      var E = Math.acos(Math.max(-1, Math.min(1, cosE)));
      tof = 2 * Math.sqrt(a * a * a / MU) * (Math.PI - (E - e * Math.sin(E)));
    }
    return {
      rangeAngleDeg: psi / D2R,
      Q: Q,
      flightPathAngleDeg: phi / D2R,
      burnoutSpeedKmS: v,
      semiMajorAxisKm: a,
      eccentricity: e,
      apogeeAltitudeKm: apogeeR - R,
      flightTimeMin: tof / 60
    };
  }

  /** Everything the page shows. flightTimeMin is optional (the analyst's own figure); when given, the average
   *  speed along the ground track is range / time. */
  function compute(lat, lon, azimuthDeg, rangeKm, flightTimeMin) {
    gc.checkPoint(lat, lon, "Launch point");
    if (typeof azimuthDeg !== "number" || !isFinite(azimuthDeg)) throw new Error("Azimuth must be a number of degrees.");
    var me = minimumEnergy(rangeKm);
    var az = gc.normBearing(azimuthDeg);
    var end = gc.destination(lat, lon, az, rangeKm);
    var out = {
      azimuthDeg: az,
      rangeKm: rangeKm,
      end: { lat: end.lat, lon: end.lon },
      arrivalBearingDeg: end.finalBearing,
      track: gc.track(lat, lon, az, rangeKm, Math.max(32, Math.ceil(rangeKm / 50))),
      minimumEnergy: me,
      averageGroundSpeedKmH: null
    };
    if (flightTimeMin !== undefined && flightTimeMin !== null && !(typeof flightTimeMin === "number" && isNaN(flightTimeMin))) {
      if (typeof flightTimeMin !== "number" || !isFinite(flightTimeMin) || flightTimeMin <= 0)
        throw new Error("Flight time must be a number of minutes above 0, or left empty.");
      out.averageGroundSpeedKmH = rangeKm / (flightTimeMin / 60);
    }
    return out;
  }

  return { compute: compute, minimumEnergy: minimumEnergy, MU: MU, MAX_KM: MAX_KM };
});

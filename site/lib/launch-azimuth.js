/* Launch azimuth: the compass heading a rocket flies at liftoff to put its payload into an orbit of a given
   inclination. Reference: Vallado, Fundamentals of Astrodynamics and Applications, 4th ed., launch-site geometry
   (cos i = cos(latitude) sin(azimuth), from the right spherical triangle formed by the equator, the orbit and the
   site's meridian; Napier's rules). The rotating-Earth correction subtracts the launch site's eastward speed from
   the orbital velocity vector (the velocity triangle), as in Curtis, Orbital Mechanics for Engineering Students,
   and in most launch texts. Destination points for the map use the spherical "destination point given distance and
   bearing" formula (Chris Veness, movable-type.co.uk, "Calculate distance, bearing and more between
   latitude/longitude points"). */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.DD = root.DD || {}).launchAzimuth = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var MU = 398600.4418;          // km^3/s^2, Earth's gravitational parameter (WGS 84)
  var R_EQ = 6378.137;           // km, equatorial radius (WGS 84)
  var E2 = 6.69437999014e-3;     // first eccentricity squared (WGS 84)
  var OMEGA = 7.292115e-5;       // rad/s, Earth's rotation rate (WGS 84)
  var D2R = Math.PI / 180;

  function norm360(a) { return ((a % 360) + 360) % 360; }

  /** The site's eastward speed from the Earth's rotation, km/s: omega times its distance from the axis,
   *  N cos(lat) on the WGS 84 ellipsoid (N, the prime-vertical radius of curvature). */
  function siteSpeedKms(latDeg) {
    var p = latDeg * D2R;
    var N = R_EQ / Math.sqrt(1 - E2 * Math.sin(p) * Math.sin(p));
    return OMEGA * N * Math.cos(p);
  }

  /** latDeg: launch site latitude (geodetic, north positive); incDeg: target inclination, 0 to 180 (over 90 is
   *  retrograde, moving westward); altKm: altitude of the circular orbit reached (sets the orbital speed used in the
   *  rotating-Earth correction). Returns the two azimuths that reach the inclination: the north-going launch (toward
   *  the orbit's northernmost point) and the south-going launch, each inertial and corrected for Earth's rotation. */
  function compute(latDeg, incDeg, altKm) {
    if (altKm === undefined || altKm === null) altKm = 400;
    if (![latDeg, incDeg, altKm].every(isFinite)) throw new Error("Every input must be a number.");
    if (latDeg < -90 || latDeg > 90) throw new Error("Latitude must be between -90 and 90 degrees.");
    if (incDeg < 0 || incDeg > 180) throw new Error("Inclination must be between 0 and 180 degrees.");
    if (altKm < 80) throw new Error("The orbit altitude must be at least 80 km.");
    if (Math.abs(latDeg) > 89.99) throw new Error("At a pole every direction is south (or north), so a launch azimuth is not defined.");
    var absLat = Math.abs(latDeg);
    var minInc = absLat, maxInc = 180 - absLat;
    // Small tolerance so that an inclination equal to the latitude (a due-east launch) is accepted despite rounding.
    if (incDeg < minInc - 1e-9 || incDeg > maxInc + 1e-9) {
      throw new Error("An inclination of " + incDeg + "° cannot be reached by a direct launch from latitude " +
        latDeg + "°: a direct launch reaches " + minInc.toFixed(2) + "° to " + maxInc.toFixed(2) +
        "°. Anything else needs a plane change after launch (a dogleg or an in-orbit burn).");
    }
    var sinAz = Math.cos(incDeg * D2R) / Math.cos(latDeg * D2R);
    sinAz = Math.max(-1, Math.min(1, sinAz));
    var azNorth = norm360(Math.asin(sinAz) / D2R);      // north-going: 0 to 90 (prograde) or 270 to 360 (retrograde)
    var azSouth = norm360(180 - Math.asin(sinAz) / D2R); // south-going: 90 to 180 (prograde) or 180 to 270 (retrograde)
    var v = Math.sqrt(MU / (R_EQ + altKm));             // circular orbital speed, km/s
    var vs = siteSpeedKms(latDeg);
    function rotating(az) {
      var a = az * D2R;
      var vn = v * Math.cos(a), ve = v * Math.sin(a) - vs;
      return { azimuthDeg: norm360(Math.atan2(ve, vn) / D2R), groundSpeedNeededKms: Math.sqrt(vn * vn + ve * ve) };
    }
    var rn = rotating(azNorth), rs = rotating(azSouth);
    return {
      inertialNorthDeg: azNorth,
      inertialSouthDeg: azSouth,
      rotatingNorthDeg: rn.azimuthDeg,
      rotatingSouthDeg: rs.azimuthDeg,
      orbitalSpeedKms: v,
      siteSpeedKms: vs,
      // The part of the site's speed that lies along the orbit: the "free" speed Earth's rotation gives.
      rotationGainKms: vs * sinAz,
      // Speed the vehicle must add relative to the ground (ideal: no gravity, drag or steering losses).
      groundSpeedNeededKms: rn.groundSpeedNeededKms,
      minInclinationDeg: minInc,
      maxInclinationDeg: maxInc,
      retrograde: incDeg > 90,
      dueEastOrWest: Math.abs(Math.abs(sinAz) - 1) < 1e-12
    };
  }

  /** Point reached from (lat, lon) along a great circle at the given initial bearing and distance (sphere). */
  function destination(latDeg, lonDeg, bearingDeg, distKm, radiusKm) {
    var R = radiusKm || 6371.0;
    var d = distKm / R, p1 = latDeg * D2R, l1 = lonDeg * D2R, b = bearingDeg * D2R;
    var p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
    var l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
    return [p2 / D2R, ((l2 / D2R + 540) % 360) - 180];
  }

  /** Points along the great circle, for drawing an initial heading on a map. */
  function headingLine(latDeg, lonDeg, bearingDeg, distKm, steps) {
    var n = steps || 24, pts = [];
    for (var k = 0; k <= n; k++) pts.push(destination(latDeg, lonDeg, bearingDeg, distKm * k / n));
    return pts;
  }

  var COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  function compass(az) { return COMPASS[Math.round(norm360(az) / 22.5) % 16]; }

  return { compute: compute, siteSpeedKms: siteSpeedKms, destination: destination, headingLine: headingLine,
    compass: compass, MU: MU, R_EQ: R_EQ, OMEGA: OMEGA };
});

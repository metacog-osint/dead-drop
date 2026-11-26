/* Eclipse length for a circular orbit, from the beta angle, with a cylindrical Earth shadow.
   References:
   - Eclipse fraction (cylindrical shadow, circular orbit): Gilmore (ed.), Spacecraft Thermal Control Handbook,
     Vol. I, 2nd ed., chapter 2 (orbital environment); the same shadow geometry is in Vallado, Fundamentals of
     Astrodynamics and Applications, 4th ed., chapter 5 (eclipses, cylindrical shadow model):
       beta* = asin(R / r)                                eclipses happen only when |beta| < beta*
       f     = (1 / 180 deg) * acos( sqrt(h^2 + 2 R h) / (r cos beta) )   fraction of each orbit in shadow
   - Beta angle from the orbit and the Sun (same handbook, chapter 2): with the orbit normal
       n = (sin i sin RAAN, -sin i cos RAAN, cos i) and the Sun direction s = (cos L, sin L cos eps, sin L sin eps),
       beta = asin(n . s)
   - Sun's ecliptic longitude L and obliquity eps: the Astronomical Almanac's low-precision formulae (good to about
     0.01 deg from 1950 to 2050), as given in Meeus, Astronomical Algorithms, 2nd ed., chapter 25.
   - Period: Kepler's third law, T = 2 pi sqrt(r^3 / mu). */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.DD = root.DD || {}).eclipsePrediction = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var R_EARTH = 6378.137;      // km, WGS 84 equatorial radius: the radius of the shadow cylinder
  var MU = 398600.4418;        // km^3/s^2, Earth's gravitational parameter
  var D2R = Math.PI / 180;

  function periodSeconds(radiusKm) { return 2 * Math.PI * Math.sqrt(Math.pow(radiusKm, 3) / MU); }

  /** Beta angle (deg) above which a circular orbit of this altitude sees no eclipse. */
  function criticalBetaDeg(altitudeKm) { return Math.asin(R_EARTH / (R_EARTH + altitudeKm)) / D2R; }

  /** Fraction (0 to 1) of each orbit spent in the cylindrical shadow. */
  function eclipseFraction(altitudeKm, betaDeg) {
    var r = R_EARTH + altitudeKm;
    var cb = Math.cos(Math.abs(betaDeg) * D2R);
    if (Math.abs(betaDeg) >= criticalBetaDeg(altitudeKm)) return 0;
    var x = Math.sqrt(altitudeKm * altitudeKm + 2 * R_EARTH * altitudeKm) / (r * cb);
    return Math.acos(Math.min(1, x)) / Math.PI;
  }

  function check(altitudeKm, betaDeg) {
    if (!isFinite(altitudeKm) || !isFinite(betaDeg)) throw new Error("Every input must be a number.");
    if (altitudeKm <= 0) throw new Error("Altitude must be above zero.");
    if (altitudeKm > 1e6) throw new Error("Altitude must be under 1,000,000 km.");
    if (betaDeg < -90 || betaDeg > 90) throw new Error("Beta angle must be between -90 and 90 degrees.");
  }

  /** Every figure the page shows for one altitude and beta angle. */
  function compute(altitudeKm, betaDeg) {
    check(altitudeKm, betaDeg);
    var r = R_EARTH + altitudeKm;
    var T = periodSeconds(r);
    var f = eclipseFraction(altitudeKm, betaDeg);
    var fMax = eclipseFraction(altitudeKm, 0);
    return {
      radiusKm: r,
      periodMin: T / 60,
      criticalBetaDeg: criticalBetaDeg(altitudeKm),
      hasEclipse: f > 0,
      eclipseFraction: f,
      eclipseMin: f * T / 60,
      sunlitMin: (1 - f) * T / 60,
      maxEclipseMin: fMax * T / 60       // the longest eclipse this altitude can have, at beta = 0
    };
  }

  /** Rows of eclipse length against beta angle, every stepDeg from 0 up to the critical beta. */
  function table(altitudeKm, stepDeg) {
    check(altitudeKm, 0);
    stepDeg = stepDeg || 10;
    var T = periodSeconds(R_EARTH + altitudeKm) / 60, bc = criticalBetaDeg(altitudeKm), rows = [];
    for (var b = 0; b < bc; b += stepDeg) {
      var f = eclipseFraction(altitudeKm, b);
      rows.push({ betaDeg: b, eclipseFraction: f, eclipseMin: f * T });
    }
    rows.push({ betaDeg: bc, eclipseFraction: 0, eclipseMin: 0 });
    return rows;
  }

  /** Sun's apparent ecliptic longitude and the obliquity, degrees, for a Date (UTC). */
  function sunEcliptic(date) {
    var jd = date.getTime() / 86400000 + 2440587.5;
    var n = jd - 2451545.0;
    var L = 280.460 + 0.9856474 * n;
    var g = (357.528 + 0.9856003 * n) * D2R;
    var lon = L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g);
    lon = ((lon % 360) + 360) % 360;
    return { longitudeDeg: lon, obliquityDeg: 23.439 - 0.0000004 * n, julianDate: jd };
  }

  /** Beta angle (deg): positive when the Sun is on the side of the orbit's north pole (the orbit normal). */
  function betaAngle(inclinationDeg, raanDeg, date) {
    if (![inclinationDeg, raanDeg].every(isFinite)) throw new Error("Inclination and RAAN must be numbers.");
    if (inclinationDeg < 0 || inclinationDeg > 180) throw new Error("Inclination must be between 0 and 180 degrees.");
    if (!(date instanceof Date) || isNaN(date.getTime())) throw new Error("Enter a valid date and time (UTC).");
    var s = sunEcliptic(date);
    var i = inclinationDeg * D2R, O = raanDeg * D2R, L = s.longitudeDeg * D2R, e = s.obliquityDeg * D2R;
    var x = Math.cos(L) * Math.sin(i) * Math.sin(O) - Math.sin(L) * Math.cos(e) * Math.sin(i) * Math.cos(O) +
      Math.sin(L) * Math.sin(e) * Math.cos(i);
    return Math.asin(Math.max(-1, Math.min(1, x))) / D2R;
  }

  return { compute: compute, table: table, eclipseFraction: eclipseFraction, criticalBetaDeg: criticalBetaDeg,
    betaAngle: betaAngle, sunEcliptic: sunEcliptic, periodSeconds: periodSeconds, R_EARTH: R_EARTH, MU: MU };
});

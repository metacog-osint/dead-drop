/* Orbital lifetime from atmospheric drag: a rough estimate. References:
   - Density: the exponential atmosphere table in Vallado, Fundamentals of Astrodynamics and Applications, 4th ed.,
     chapter 8 (Table 8-4), built from CIRA-72 for average solar activity: rho = rho0 * exp(-(h - h0) / H) within each
     band. It has no solar cycle, no day-night bulge and no storms in it.
   - Decay: Gauss's form of the variation of parameters for a drag force along the velocity (Vallado chapter 9):
       da/dt = 2 a^2 v f / mu,  de/dt = 2 (e + cos nu) f / v,  f = -(1/2) rho v^2 F / B,  B = m / (Cd A)
     averaged over one orbit (over the mean anomaly) and stepped forward in time (midpoint method). For a circular
     orbit this is da/dt = -rho F sqrt(mu a) / B.
   - Rotating atmosphere: King-Hele, Satellite Orbits in an Atmosphere: Theory and Applications (1987), the factor
     F = (1 - r_p w cos i / v_p)^2 for an atmosphere turning with the Earth, taken at perigee.
   The answer is only as good as the density, and real density at 300 to 600 km swings by several times over the
   solar cycle and in geomagnetic storms; see the page's method notes. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.DD = root.DD || {}).orbitalDecay = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var MU = 3.986004418e14;     // m^3/s^2
  var R_EARTH = 6378137;       // m, WGS 84 equatorial radius (altitudes in the density table are above it)
  var OMEGA = 7.292115e-5;     // rad/s, Earth's rotation rate
  var D2R = Math.PI / 180;
  var END_ALT_KM = 120;        // the estimate ends when the whole orbit (its apogee) is below this altitude
  var MAX_YEARS = 200;

  // Vallado Table 8-4: base altitude h0 (km), nominal density rho0 (kg/m^3), scale height H (km).
  var TABLE = [
    [0, 1.225, 7.249], [25, 3.899e-2, 6.349], [30, 1.774e-2, 6.682], [40, 3.972e-3, 7.554],
    [50, 1.057e-3, 8.382], [60, 3.206e-4, 7.714], [70, 8.770e-5, 6.549], [80, 1.905e-5, 5.799],
    [90, 3.396e-6, 5.382], [100, 5.297e-7, 5.877], [110, 9.661e-8, 7.263], [120, 2.438e-8, 9.473],
    [130, 8.484e-9, 12.636], [140, 3.845e-9, 16.149], [150, 2.070e-9, 22.523], [180, 5.464e-10, 29.740],
    [200, 2.789e-10, 37.105], [250, 7.248e-11, 45.546], [300, 2.418e-11, 53.628], [350, 9.518e-12, 53.298],
    [400, 3.725e-12, 58.515], [450, 1.585e-12, 60.828], [500, 6.967e-13, 63.822], [600, 1.454e-13, 71.835],
    [700, 3.614e-14, 88.667], [800, 1.170e-14, 124.64], [900, 5.245e-15, 181.05], [1000, 3.019e-15, 268.00]
  ];

  /** Density (kg/m^3) at an altitude (km) from the table; the 1000 km band is used above 1000 km. */
  function density(altKm) {
    if (!isFinite(altKm)) return NaN;
    var h = Math.max(0, altKm), row = TABLE[0];
    for (var k = TABLE.length - 1; k >= 0; k--) { if (h >= TABLE[k][0]) { row = TABLE[k]; break; } }
    return row[1] * Math.exp(-(h - row[0]) / row[2]);
  }

  /** King-Hele's rotating-atmosphere factor at perigee radius rp (m), semi-major axis a (m), inclination (deg). */
  function rotationFactor(rp, a, inclinationDeg) {
    var vp = Math.sqrt(MU * (2 / rp - 1 / a));
    var x = 1 - rp * OMEGA * Math.cos(inclinationDeg * D2R) / vp;
    return x * x;
  }

  /** Orbit-averaged da/dt (m/s) and de/dt (1/s) for semi-major axis a (m), eccentricity e. The average is a sum
   *  over equal steps of eccentric anomaly, weighted by the time spent in each: 72 steps for near-circular orbits,
   *  240 (1.5 deg each) where the drag is bunched up near perigee. */
  function rates(a, e, B, F, scale) {
    var sumA = 0, sumE = 0, n = e < 1e-6 ? 1 : (e < 0.05 ? 72 : 240);
    for (var k = 0; k < n; k++) {
      var E = 2 * Math.PI * (k + 0.5) / n, cE = Math.cos(E);
      var w = 1 - e * cE;                                 // dM / dE: weights the average by time spent
      var r = a * w;
      var v = Math.sqrt(MU * (2 / r - 1 / a));
      var rho = density((r - R_EARTH) / 1000) * scale;
      var f = -0.5 * rho * v * v * F / B;                 // drag acceleration along the velocity, m/s^2
      var cosNu = (cE - e) / w;
      sumA += w * (2 * a * a * v * f / MU);
      sumE += w * (2 * (e + cosNu) * f / v);
    }
    return { da: sumA / n, de: e < 1e-6 ? 0 : sumE / n };
  }

  /** p: {perigeeKm, apogeeKm, inclinationDeg, massKg, areaM2, cd, densityScale (default 1)}.
   *  Returns the lifetime and a profile of the decay. */
  function estimate(p) {
    var hp = p.perigeeKm, ha = p.apogeeKm, inc = p.inclinationDeg === undefined ? 0 : p.inclinationDeg;
    var scale = p.densityScale === undefined ? 1 : p.densityScale;
    if (![hp, ha, inc, p.massKg, p.areaM2, p.cd, scale].every(isFinite)) throw new Error("Every input must be a number.");
    if (hp < 100) throw new Error("Perigee must be at least 100 km; below that the object is already re-entering.");
    if (ha < hp) throw new Error("Apogee must be at or above perigee.");
    if (ha > 100000) throw new Error("Apogee must be under 100,000 km.");
    if (inc < 0 || inc > 180) throw new Error("Inclination must be between 0 and 180 degrees.");
    if (!(p.massKg > 0) || !(p.areaM2 > 0) || !(p.cd > 0)) throw new Error("Mass, area and drag coefficient must be above zero.");
    if (!(scale > 0)) throw new Error("The density scale must be above zero.");
    var B = p.massKg / (p.cd * p.areaM2);                 // ballistic coefficient, kg/m^2
    var a = R_EARTH + 1000 * (hp + ha) / 2, e = (ha - hp) / (2 * (R_EARTH / 1000) + hp + ha);
    var t = 0, tMax = MAX_YEARS * 365.25 * 86400, maxDt = 30 * 86400;
    var F0 = rotationFactor(a * (1 - e), a, inc);
    var r0 = rates(a, e, B, F0, scale);
    var first = { daKmPerDay: r0.da * 86.4, perigeeKmPerDay: (r0.da * (1 - e) - a * r0.de) * 86.4 };
    var profile = [], nextMark = Math.floor((a - R_EARTH) / 1000 / 50) * 50;
    if (nextMark >= (a - R_EARTH) / 1000) nextMark -= 50;
    function row(tt, aa, ee) {
      return { tDays: tt / 86400, meanAltKm: (aa - R_EARTH) / 1000, perigeeKm: (aa * (1 - ee) - R_EARTH) / 1000,
        apogeeKm: (aa * (1 + ee) - R_EARTH) / 1000, periodMin: 2 * Math.PI * Math.sqrt(aa * aa * aa / MU) / 60 };
    }
    profile.push(row(0, a, e));
    var steps = 0, reentered = false;
    while (t < tMax && steps < 200000) {
      var apoKm = (a * (1 + e) - R_EARTH) / 1000;
      if (apoKm <= END_ALT_KM) { reentered = true; break; }
      var F = rotationFactor(a * (1 - e), a, inc);
      var k1 = rates(a, e, B, F, scale);
      // Step so that the apogee moves by at most 0.5 km plus 0.5 % of its height, and no more than 30 days.
      var dApo = Math.abs(k1.da * (1 + e) + a * k1.de) + 1e-30;
      var dt = Math.min(maxDt, (500 + 5 * apoKm) / dApo);
      var am = a + 0.5 * dt * k1.da, em = Math.max(0, e + 0.5 * dt * k1.de);
      var k2 = rates(am, em, B, rotationFactor(am * (1 - em), am, inc), scale);
      var aN = a + dt * k2.da, eN = Math.max(0, e + dt * k2.de);
      // Mark each 50 km of mean altitude lost, interpolated in time.
      var altN = (aN - R_EARTH) / 1000, alt = (a - R_EARTH) / 1000;
      while (nextMark > END_ALT_KM && altN <= nextMark && alt > nextMark) {
        var frac = (alt - nextMark) / (alt - altN);
        profile.push(row(t + frac * dt, a + frac * (aN - a), e + frac * (eN - e)));
        nextMark -= 50;
      }
      a = aN; e = eN; t += dt; steps++;
    }
    profile.push(row(t, a, e));
    return {
      ballisticCoefficient: B,
      semiMajorAxisKm: (R_EARTH + 1000 * (hp + ha) / 2) / 1000,
      eccentricity: (ha - hp) / (2 * (R_EARTH / 1000) + hp + ha),
      periodMin: profile[0].periodMin,
      densityAtPerigee: density(hp) * scale,
      rotationFactor: F0,
      initialDecay: first,                 // km/day of semi-major axis and of perigee altitude (negative: falling)
      reentered: reentered,
      lifetimeDays: reentered ? t / 86400 : null,
      beyondYears: reentered ? null : MAX_YEARS,
      profile: profile
    };
  }

  return { estimate: estimate, density: density, rotationFactor: rotationFactor, rates: rates, TABLE: TABLE,
    MU: MU, R_EARTH: R_EARTH, END_ALT_KM: END_ALT_KM, MAX_YEARS: MAX_YEARS };
});

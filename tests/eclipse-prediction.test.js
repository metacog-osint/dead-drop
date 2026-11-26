// Eclipse Prediction Calculator. References: Gilmore (ed.), Spacecraft Thermal Control Handbook, Vol. I, 2nd ed.,
// chapter 2, cylindrical-shadow eclipse fraction for a circular orbit,
//   f = (1/180 deg) acos( sqrt(h^2 + 2Rh) / (r cos beta) ),  no eclipse when |beta| >= beta* = asin(R/r),
// the same geometry as Vallado, Fundamentals of Astrodynamics and Applications, 4th ed., chapter 5; the Sun's
// longitude from the Astronomical Almanac low-precision formulae in Meeus, Astronomical Algorithms, chapter 25.
// Worked example by hand (R = 6378.137 km, mu = 398600.4418 km^3/s^2): h = 550 km, r = 6928.137 km
//   T = 2 pi sqrt(6928.137^3 / mu) = 2 pi * 913.389 s = 5738.98 s = 95.650 min
//   beta* = asin(6378.137 / 6928.137) = asin(0.920614) = 67.016 deg
//   beta = 0:  f = beta*/180 = 0.372311, eclipse = 35.611 min (sqrt(h^2+2Rh)/r = cos(beta*))
//   beta = 30: sqrt(550^2 + 2*6378.137*550) = 2705.264; r cos 30 = 5999.943; ratio 0.450881;
//              acos = 63.1998 deg; f = 0.351110; eclipse = 33.583 min
// Sun: Meeus example 25.a, 1992 Oct 13 0h (JD 2448908.5): n = -2636.5, L = 201.8007, g = 278.9928 deg,
//   lambda = 201.8007 + 1.915 sin g + 0.020 sin 2g = 199.903 deg (Meeus's fuller method: 199.909 deg),
//   eps = 23.439 - 0.0000004 n = 23.4401 deg.
// Beta on that date: i = 51.6, RAAN = 0 gives beta = asin(sin L * sin(eps - i)) = asin(0.160661) = 9.245 deg;
//   i = 90, RAAN = 90 gives beta = asin(cos L) = asin(cos 199.903 deg) = asin(-0.94027) = -70.097 deg.
// GEO: beta* = asin(6378.137/42164.137) = 8.701 deg; T = 1436.07 min; longest eclipse 8.701/180 * 1436.07 = 69.4 min.
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../site/lib/eclipse-prediction.js");

const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);

test("eclipse: 550 km circular orbit, beta 0 and 30 deg", () => {
  const r0 = E.compute(550, 0);
  near(r0.periodMin, 95.650, 0.002, "period");
  near(r0.criticalBetaDeg, 67.016, 0.002, "critical beta");
  near(r0.eclipseFraction, 0.372311, 2e-5, "fraction at beta 0");
  near(r0.eclipseMin, 35.611, 0.003, "eclipse at beta 0");
  assert.equal(r0.hasEclipse, true);
  const r30 = E.compute(550, 30);
  near(r30.eclipseFraction, 0.351110, 3e-5, "fraction at beta 30");
  near(r30.eclipseMin, 33.583, 0.004, "eclipse at beta 30");
  near(r30.sunlitMin + r30.eclipseMin, r30.periodMin, 1e-9, "sunlit + eclipse = period");
  near(r30.maxEclipseMin, r0.eclipseMin, 1e-9, "max eclipse is at beta 0");
});

test("eclipse: beta 0 fraction equals beta*/180 for any altitude", () => {
  for (const h of [300, 1200, 20200, 35786]) {
    near(E.eclipseFraction(h, 0), E.criticalBetaDeg(h) / 180, 1e-9, `h=${h}`);
  }
  // Geostationary at an equinox: beta* = asin(6378.137/42164.137) = 8.701 deg, eclipse 69.4 min of 1436.1 min.
  const g = E.compute(35786, 0);
  near(g.criticalBetaDeg, 8.701, 0.002, "GEO critical beta");
  near(g.eclipseMin, 69.4, 0.2, "GEO longest eclipse");
});

test("eclipse: none at or above the critical beta; symmetric in sign", () => {
  const bc = E.criticalBetaDeg(550);
  assert.equal(E.eclipseFraction(550, bc), 0);
  assert.equal(E.eclipseFraction(550, bc + 0.1), 0);
  assert.equal(E.compute(550, 80).hasEclipse, false);
  assert.ok(E.eclipseFraction(550, bc - 0.5) > 0);
  near(E.eclipseFraction(550, -30), E.eclipseFraction(550, 30), 1e-12, "sign");
});

test("eclipse: table runs from beta 0 to the critical beta", () => {
  const rows = E.table(550, 10);
  assert.equal(rows[0].betaDeg, 0);
  near(rows[3].eclipseMin, 33.583, 0.004, "beta 30 row");
  assert.equal(rows[rows.length - 1].eclipseMin, 0);
  near(rows[rows.length - 1].betaDeg, 67.016, 0.002, "last row");
});

test("sun longitude: Meeus example 25.a", () => {
  const s = E.sunEcliptic(new Date(Date.UTC(1992, 9, 13, 0, 0, 0)));
  near(s.julianDate, 2448908.5, 1e-6, "JD");
  near(s.longitudeDeg, 199.903, 0.002, "hand value");
  near(s.longitudeDeg, 199.909, 0.01, "Meeus's value");
  near(s.obliquityDeg, 23.4401, 0.0001, "obliquity");
});

test("beta angle from inclination, RAAN and date", () => {
  const d = new Date(Date.UTC(1992, 9, 13, 0, 0, 0));
  near(E.betaAngle(51.6, 0, d), 9.245, 0.01, "i 51.6, RAAN 0");
  near(E.betaAngle(90, 90, d), -70.097, 0.01, "i 90, RAAN 90");
  // An equatorial orbit's beta is the Sun's declination with the sign of the orbit normal (north).
  near(E.betaAngle(0, 123, d), Math.asin(Math.sin(199.903 * Math.PI / 180) * Math.sin(23.4401 * Math.PI / 180)) * 180 / Math.PI, 0.01, "i 0");
});

test("eclipse: rejects bad input", () => {
  assert.throws(() => E.compute(0, 10));
  assert.throws(() => E.compute(550, 91));
  assert.throws(() => E.compute(550, NaN));
  assert.throws(() => E.betaAngle(200, 0, new Date()));
  assert.throws(() => E.betaAngle(51.6, 0, new Date("not a date")));
});

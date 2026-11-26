// Flight Path Analyzer. References:
//  - Ground track and end point: Chris Veness, "Calculate distance, bearing and more between latitude/longitude
//    points", movable-type.co.uk, destination point (sphere, R = 6371 km). Veness's example: from 53 19 14 N,
//    001 43 47 W on 096 01 18 for 124.8 km the end point is 53 11 18 N, 000 08 00 E.
//  - Minimum-energy ballistic trajectory: Bate, Mueller and White, Fundamentals of Astrodynamics, ch. 6:
//    Q = 2 sin(Psi/2) / (1 + sin(Psi/2)), phi = (180 - Psi) / 4, a = r / (2 - Q), e^2 = 1 + Q (Q - 2) cos^2 phi,
//    apogee radius a (1 + e); and the free-flight range equation cos(Psi/2) = (1 - Q cos^2 phi) / sqrt(1 + Q (Q - 2) cos^2 phi).
//    mu = 398600.4418 km^3/s^2, r = R = 6371 km.
// Worked example by hand, Psi = 90 deg (range pi R / 2 = 10,007.5 km): sin 45 = sqrt2/2, so
//   Q = sqrt2 / (1 + sqrt2/2) = 2 sqrt2 - 2 = 0.828427; phi = 22.5 deg; a = R / (4 - 2 sqrt2) = R (2 + sqrt2) / 4 = 0.853553 R;
//   cos^2 22.5 = (2 + sqrt2) / 4 = 0.853553, e^2 = 1 - 0.828427 * 1.171573 * 0.853553 = 0.171573, e = sqrt2 - 1 = 0.414214;
//   apogee radius = R (2 + sqrt2) sqrt2 / 4 = R (1 + sqrt2) / 2, so apogee altitude = R (sqrt2 - 1) / 2 = 1319.48 km.
//   Burnout speed sqrt(Q mu / R) = sqrt(0.828427 * 398600.4418 / 6371) = 7.199 km/s.
// Worked example by hand, 1000 km: Psi = 1000 / 6371 = 0.156961 rad = 8.9932 deg, sin(Psi/2) = 0.078400,
//   Q = 0.156800 / 1.078400 = 0.145401, phi = (180 - 8.9932) / 4 = 42.7517 deg, a = 6371 / 1.854599 = 3435.24 km,
//   cos^2 phi = 0.539200, e^2 = 1 - 0.145401 * 1.854599 * 0.539200 = 0.854599, e = 0.924445, apogee altitude
//   3435.24 * 1.924445 - 6371 = 239.9 km. (On every minimum-energy path e^2 = 1 - Q; here 1 - 0.145401 = 0.854599.)
//   Flat-Earth check: a 45 deg shot rises to a quarter of its range, so short ranges tend to range / 4.
// Limit Psi = 180 deg: Q = 1, phi = 0, e = 0, a grazing circular orbit; flight time is half the period at the
//   surface, pi sqrt(R^3 / mu) = 2530.4 s = 42.17 min.
// The old tool's "maximum altitude" was range / 10: 100 km for 1000 km, where the minimum-energy figure is 240 km.
const test = require("node:test");
const assert = require("node:assert/strict");
const fp = require("../site/lib/flight-path.js");

const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);
const dms = (d, m, s) => d + m / 60 + s / 3600;
const R = 6371;

test("minimum energy, Psi = 90 deg, closed form", () => {
  const m = fp.minimumEnergy(Math.PI * R / 2);
  near(m.Q, 2 * Math.SQRT2 - 2, 1e-12, "Q");
  near(m.flightPathAngleDeg, 22.5, 1e-9, "flight-path angle");
  near(m.eccentricity, Math.SQRT2 - 1, 1e-12, "eccentricity");
  near(m.semiMajorAxisKm, R * (2 + Math.SQRT2) / 4, 1e-9, "semi-major axis");
  near(m.apogeeAltitudeKm, 1319.48, 0.01, "apogee altitude");
  near(m.burnoutSpeedKmS, 7.199, 0.001, "burnout speed");
});

test("minimum energy, 1000 km by hand, and the flat-Earth limit", () => {
  const m = fp.minimumEnergy(1000);
  near(m.rangeAngleDeg, 8.9932, 1e-4, "range angle");
  near(m.Q, 0.145401, 1e-6, "Q");
  near(m.flightPathAngleDeg, 42.7517, 1e-4, "flight-path angle");
  near(m.semiMajorAxisKm, 3435.24, 0.01, "semi-major axis");
  near(m.eccentricity, 0.924445, 1e-6, "eccentricity");
  near(m.apogeeAltitudeKm, 239.9, 0.1, "apogee altitude");
  near(m.eccentricity ** 2, 1 - m.Q, 1e-12, "e^2 = 1 - Q");
  // Short ranges tend to the flat-Earth 45 deg result: apex = range / 4.
  const s = fp.minimumEnergy(10);
  near(s.apogeeAltitudeKm / 10, 0.25, 0.001, "flat-Earth quarter");
  near(s.flightPathAngleDeg, 45, 0.03, "flat-Earth 45 deg");
});

test("minimum energy satisfies the free-flight range equation (BMW ch. 6)", () => {
  for (const km of [300, 1000, 3000, 8000, 12000, 18000]) {
    const m = fp.minimumEnergy(km);
    const c2 = Math.cos(m.flightPathAngleDeg * Math.PI / 180) ** 2;
    const lhs = Math.cos(km / R / 2);
    const rhs = (1 - m.Q * c2) / Math.sqrt(1 + m.Q * (m.Q - 2) * c2);
    near(lhs, rhs, 1e-12, `range equation at ${km} km`);
    // Burnout and re-entry at r = R lie on the conic: r = a (1 - e^2) / (1 + e cos nu), nu = 180 - Psi/2.
    const nu = Math.PI - km / R / 2;
    near(m.semiMajorAxisKm * (1 - m.eccentricity ** 2) / (1 + m.eccentricity * Math.cos(nu)), R, 1e-6, "burnout on the conic");
  }
});

test("flight time: half way round is half a grazing orbit; it grows with range", () => {
  near(fp.minimumEnergy(Math.PI * R).flightTimeMin, 42.17, 0.01, "Psi = 180");
  near(fp.minimumEnergy(Math.PI * R).apogeeAltitudeKm, 0, 1e-6, "no apogee above the surface");
  let prev = 0;
  for (const km of [100, 1000, 5000, 10000, 15000, 20000]) {
    const t = fp.minimumEnergy(km).flightTimeMin;
    assert.ok(t > prev, `time rises at ${km} km`);
    prev = t;
  }
});

test("ground track: Veness destination example and arrival bearing", () => {
  const r = fp.compute(dms(53, 19, 14), -dms(1, 43, 47), dms(96, 1, 18), 124.8, 2);
  near(r.end.lat, dms(53, 11, 18), 1 / 3600, "end lat");
  near(r.end.lon, dms(0, 8, 0), 1 / 3600, "end lon");
  near(r.averageGroundSpeedKmH, 124.8 * 30, 1e-9, "range / time");
  const last = r.track[r.track.length - 1];
  near(last[0], r.end.lat, 1e-9, "track ends at the end point");
  // Due east from 60 N for a quarter circle: equator, 90 deg east, arriving on 150 deg.
  const q = fp.compute(60, 0, 90, Math.PI * R / 2);
  near(q.end.lat, 0, 1e-9, "equator");
  near(q.end.lon, 90, 1e-9, "longitude");
  near(q.arrivalBearingDeg, 150, 1e-9, "arrival bearing");
  assert.equal(q.averageGroundSpeedKmH, null);
});

test("bad input is rejected", () => {
  assert.throws(() => fp.compute(28.5, -80.6, 90, 0), /Range/);
  assert.throws(() => fp.compute(28.5, -80.6, 90, 20100), /half way/);
  assert.throws(() => fp.compute(95, -80.6, 90, 500), /latitude/);
  assert.throws(() => fp.compute(28.5, -80.6, NaN, 500), /Azimuth/);
  assert.throws(() => fp.compute(28.5, -80.6, 90, 500, -3), /Flight time/);
  assert.throws(() => fp.compute(28.5, -80.6, 90, 500, 0), /Flight time/);
  assert.equal(fp.compute(28.5, -80.6, 90, 500, NaN).averageGroundSpeedKmH, null);
});

// Orbital Decay Estimator. References: the exponential atmosphere table (from CIRA-72) in Vallado, Fundamentals of
// Astrodynamics and Applications, 4th ed., chapter 8, Table 8-4; Gauss's variational equations for drag (Vallado
// chapter 9), which for a circular orbit give da/dt = -rho F sqrt(mu a) / B, B = m / (Cd A); King-Hele, Satellite
// Orbits in an Atmosphere (1987), rotating-atmosphere factor F = (1 - r w cos i / v)^2.
// Worked examples by hand (R = 6378.137 km, mu = 3.986004418e14 m^3/s^2, w = 7.292115e-5 rad/s):
//   Density at 420 km: 3.725e-12 * exp(-20/58.515) = 3.725e-12 * 0.710495 = 2.64659e-12 kg/m^3.
//   F for a circular equatorial orbit at 400 km: r w / v = 6778.137 * 7.292115e-5 / 7.66855 = 0.0644544,
//     F = 0.9355456^2 = 0.875246.
//   Polar orbit (cos i = 0, so F = 1), B = 100 kg/m^2 (m = 100 kg, A = 1 m^2, Cd = 1), circular at 450 km:
//     da/dt = 1.585e-12 * sqrt(3.986004418e14 * 6.828137e6) / 100 = 1.585e-14 * 5.216990e10 = 8.26893e-4 m/s
//           = 71.44 m/day.
//   Within one band of the table the circular decay integrates in closed form (sqrt(mu a) taken at the band's
//   middle):  t = H / (rho0 sqrt(mu a) / B) * (exp((h_top - h0)/H) - 1)
//     450 -> 400 km (h0 400, rho0 3.725e-12, H 58.515 km, a = 6803.137 km, sqrt(mu a) = 5.207431e10):
//       58515 / 1.939768e-3 * (e^0.854482 - 1) = 3.016599e7 * 1.350157 s = 471.40 days
//     400 -> 350 km (h0 350, rho0 9.518e-12, H 53.298 km, a = 6753.137 km, sqrt(mu a) = 5.188259e10):
//       53298 / 4.938185e-3 * (e^0.938122 - 1) = 1.079303e7 * 1.555178 s = 194.27 days
const test = require("node:test");
const assert = require("node:assert/strict");
const D = require("../site/lib/orbital-decay.js");

const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);
const rel = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol * Math.abs(b), `${what}: ${a} vs ${b}`);
const polar450 = { perigeeKm: 450, apogeeKm: 450, inclinationDeg: 90, massKg: 100, areaM2: 1, cd: 1 };

test("density: Vallado Table 8-4 values and in-band exponential", () => {
  assert.equal(D.density(400), 3.725e-12);
  assert.equal(D.density(0), 1.225);
  rel(D.density(420), 2.64659e-12, 1e-4, "420 km");
  // The bands join up: the 400 km band carried to 450 km gives the 450 km row (1.585e-12).
  rel(3.725e-12 * Math.exp(-50 / 58.515), D.density(450), 0.002, "continuity at 450");
  assert.ok(D.density(1500) < D.density(1000));
});

test("rotating atmosphere factor", () => {
  near(D.rotationFactor(6778137, 6778137, 0), 0.875246, 1e-5, "equatorial at 400 km");
  near(D.rotationFactor(6778137, 6778137, 90), 1, 1e-12, "polar");
  assert.ok(D.rotationFactor(6778137, 6778137, 180) > 1, "retrograde meets the air head-on, more drag");
});

test("decay rate at the start: 450 km circular, B = 100 kg/m^2", () => {
  const r = D.estimate(polar450);
  near(r.ballisticCoefficient, 100, 1e-12, "B");
  near(r.initialDecay.daKmPerDay, -0.07144, 0.00002, "da/dt");
  near(r.initialDecay.perigeeKmPerDay, -0.07144, 0.00002, "circular: perigee falls with a");
});

test("decay time across table bands matches the closed form", () => {
  const r = D.estimate(polar450);
  const at = (alt) => r.profile.find((x) => Math.abs(x.meanAltKm - alt) < 1e-6).tDays;
  rel(at(400), 471.40, 0.003, "450 -> 400 km");
  rel(at(350) - at(400), 194.27, 0.003, "400 -> 350 km");
  assert.equal(r.reentered, true);
  assert.ok(r.lifetimeDays > at(350));
});

test("lifetime scales inversely with density", () => {
  const base = D.estimate(polar450).lifetimeDays;
  rel(D.estimate({ ...polar450, densityScale: 2 }).lifetimeDays, base / 2, 0.01, "double density");
  rel(D.estimate({ ...polar450, densityScale: 0.5 }).lifetimeDays, base * 2, 0.01, "half density");
  // Doubling the mass doubles B and so the lifetime.
  rel(D.estimate({ ...polar450, massKg: 200 }).lifetimeDays, base * 2, 0.01, "double mass");
});

test("elliptical orbit: circularises and outlives a circular orbit at its perigee", () => {
  const ell = D.estimate({ perigeeKm: 400, apogeeKm: 800, inclinationDeg: 51.6, massKg: 100, areaM2: 1, cd: 2.2 });
  const circ = D.estimate({ perigeeKm: 400, apogeeKm: 400, inclinationDeg: 51.6, massKg: 100, areaM2: 1, cd: 2.2 });
  assert.ok(ell.lifetimeDays > circ.lifetimeDays);
  for (let k = 1; k < ell.profile.length; k++) {
    const p0 = ell.profile[k - 1], p1 = ell.profile[k];
    assert.ok(p1.apogeeKm - p1.perigeeKm <= p0.apogeeKm - p0.perigeeKm + 1e-6, "apogee falls faster than perigee");
  }
  // Eccentricity from perigee and apogee: (800 - 400) / (2 * 6378.137 + 1200) = 0.028661.
  near(ell.eccentricity, 0.028661, 1e-6, "e");
  near(ell.semiMajorAxisKm, 6978.137, 1e-9, "a");
});

test("high orbits report a lower bound instead of a date", () => {
  const r = D.estimate({ perigeeKm: 1000, apogeeKm: 1000, inclinationDeg: 98, massKg: 100, areaM2: 1, cd: 2.2 });
  assert.equal(r.reentered, false);
  assert.equal(r.lifetimeDays, null);
  assert.equal(r.beyondYears, 200);
});

test("decay: rejects bad input", () => {
  assert.throws(() => D.estimate({ ...polar450, perigeeKm: 90 }));
  assert.throws(() => D.estimate({ ...polar450, apogeeKm: 300 }));
  assert.throws(() => D.estimate({ ...polar450, massKg: 0 }));
  assert.throws(() => D.estimate({ ...polar450, areaM2: -1 }));
  assert.throws(() => D.estimate({ ...polar450, cd: NaN }));
  assert.throws(() => D.estimate({ ...polar450, inclinationDeg: 200 }));
  assert.throws(() => D.estimate({ ...polar450, densityScale: 0 }));
});

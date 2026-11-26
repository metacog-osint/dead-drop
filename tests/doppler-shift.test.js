// Doppler Shift Calculator. References: Rappaport, Wireless Communications, 2nd ed., section 5.2.1 (first-order
// Doppler shift, f_d = (v / lambda) cos(theta), positive for an approaching source); Vallado, Fundamentals of
// Astrodynamics and Applications, 4th ed., chapter 4 (range rate, positive when receding), so delta_f = -f rho_dot / c;
// Curtis, Orbital Mechanics for Engineering Students, section 2.6 (circular speed v = sqrt(mu / r)); Wertz & Larson,
// SMAD 3rd ed., section 5.2 (sin(eta) = (R / r) cos(el)).
// Worked examples, by hand (c = 299,792.458 km/s, mu = 398,600.4418 km^3/s^2, R = 6,371 km):
//   137.5 MHz, 7.5 km/s straight at the receiver: 137.5e6 * 7.5 / 299792.458 = +3,439.88 Hz (received high).
//   At 60 deg the shift halves (cos 60 = 0.5): +1,719.94 Hz; at 90 deg it is 0; at 180 deg it is -3,439.88 Hz.
//   Circular orbit at 550 km: r = 6,921 km, mu / r = 57.59290, v = 7.58900 km/s, period 2 pi sqrt(r^3 / mu) = 95.50 min.
//   Line-of-sight speed at the horizon on an overhead pass: v R / r = 7.58900 * 0.920532 = 6.98591 km/s,
//   which at 437.5 MHz is 437.5e6 * 6.98591 / 299792.458 = 10,194.8 Hz. At 30 deg elevation: 6.98591 * cos 30 =
//   6.04998 km/s, 8,829.0 Hz. Earth-rotation allowance at the equator: 7.292115e-5 * 6371 = 0.464581 km/s, so the
//   bound is 7.45049 km/s, 10,872.8 Hz. The old page's "maximum" used the full 7.589 km/s (11,075 Hz at 437.5 MHz).
//   Geostationary altitude 35,786 km: v = 3.07492 km/s inertial, but v R / r = 0.464699 km/s and the bound is
//   0.929280 km/s; a geostationary satellite barely moves relative to the ground, so the full orbital speed is wrong.
const test = require("node:test");
const assert = require("node:assert/strict");
const { shiftHz, compute, circular } = require("../site/lib/doppler-shift.js");

const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);

test("doppler: sign convention, approaching raises the frequency", () => {
  near(compute(137.5, 7.5, 0).shiftHz, 3439.88, 0.01, "approaching");
  near(compute(137.5, 7.5, 0).rangeRateKmS, -7.5, 1e-12, "range rate negative when closing");
  near(compute(137.5, 7.5, 180).shiftHz, -3439.88, 0.01, "receding");
  near(compute(137.5, 7.5, 60).shiftHz, 1719.94, 0.01, "60 deg");
  assert.equal(compute(137.5, 7.5, 90).shiftHz, 0);
  near(compute(137.5, 7.5, 0).receivedMHz, 137.50343988, 1e-8, "received frequency");
  near(shiftHz(137.5, 7.5), -3439.88, 0.01, "positive range rate lowers the frequency");
});

test("doppler: circular orbit, 550 km", () => {
  const r = circular(437.5, 550, 30, 0);
  near(r.orbitalSpeedKmS, 7.58900, 0.00001, "orbital speed");
  near(r.periodMin, 95.50, 0.01, "period");
  near(r.losMaxKmS, 6.98591, 0.00001, "line-of-sight speed at the horizon");
  near(r.losMaxShiftHz, 10194.8, 0.1, "largest shift, non-rotating Earth");
  near(r.losAtElevationKmS, 6.04998, 0.00001, "30 deg elevation");
  near(r.shiftAtElevationHz, 8829.0, 0.1, "shift at 30 deg");
  near(r.rotationKmS, 0.464581, 0.000001, "equatorial rotation speed");
  near(r.boundShiftHz, 10872.8, 0.1, "upper bound with rotation");
  near(circular(437.5, 550, 90).losAtElevationKmS, 0, 1e-12, "overhead: no line-of-sight motion");
  near(circular(437.5, 550, null, 60).rotationKmS, 0.232290, 0.000001, "rotation at 60 deg latitude");
});

test("doppler: geostationary altitude is not its full orbital speed", () => {
  const r = circular(437.5, 35786);
  near(r.orbitalSpeedKmS, 3.07492, 0.00001, "inertial speed");
  near(r.losMaxKmS, 0.464699, 0.000001, "v R / r");
  near(r.boundKmS, 0.929280, 0.000001, "bound");
  assert.ok(r.boundShiftHz < 0.31 * compute(437.5, 3.07492, 0).shiftHz);
});

test("doppler: rejects bad input", () => {
  assert.throws(() => compute(0, 7.5, 0));
  assert.throws(() => compute(137.5, -1, 0));
  assert.throws(() => compute(137.5, 300000, 0));
  assert.throws(() => compute(137.5, NaN, 0));
  assert.throws(() => circular(437.5, 0));
  assert.throws(() => circular(437.5, 550, 95));
  assert.throws(() => circular(437.5, 550, null, 91));
});

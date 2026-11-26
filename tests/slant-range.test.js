// Slant Range Calculator. Reference: Wertz & Larson, Space Mission Analysis and Design, 3rd ed., section 5.2:
// range = R_sat sin(lambda) / cos(el), with sin(eta) = (R_obs / R_sat) cos(el) and lambda = 90 - el - eta.
// Worked example computed by hand from those equations (R = 6371 km): h = 550 km, el = 45 deg
//   eta = asin(6371/6921 * 0.70711) = 40.611 deg, lambda = 4.389 deg,
//   range = 6921 * sin(4.389 deg) / cos(45 deg) = 749.2 km.
// Overhead (el = 90) the range is the altitude; at the horizon it is sqrt(R_sat^2 - R_obs^2).
const test = require("node:test");
const assert = require("node:assert/strict");
const { compute } = require("../site/lib/slant-range.js");

const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);

test("slant range: SMAD worked example, 550 km at 45 deg", () => {
  const r = compute(550, 45, 0);
  near(r.nadirAngleDeg, 40.611, 0.002, "nadir angle");
  near(r.centralAngleDeg, 4.389, 0.002, "central angle");
  near(r.slantRangeKm, 749.2, 0.2, "range");
  // SMAD's sine-rule form gives the same range as the law of cosines.
  const lam = r.centralAngleDeg * Math.PI / 180;
  near(r.slantRangeKm, 6921 * Math.sin(lam) / Math.cos(45 * Math.PI / 180), 1e-6, "sine-rule form");
});

test("slant range: limits overhead and at the horizon", () => {
  near(compute(550, 90, 0).slantRangeKm, 550, 1e-6, "overhead");
  const h = compute(35786, 0, 0);
  near(h.slantRangeKm, Math.sqrt(42157 ** 2 - 6371 ** 2), 1e-6, "horizon");
  near(h.slantRangeKm, h.horizonRangeKm, 1e-6, "horizon field");
  // GEO round trip at the sub-satellite point: 2 * 35786 / c = 238.7 ms.
  near(compute(35786, 90, 0).roundTripDelayMs, 238.74, 0.01, "GEO round trip");
});

test("slant range: rejects impossible inputs", () => {
  assert.throws(() => compute(550, 95, 0));
  assert.throws(() => compute(550, -1, 0));
  assert.throws(() => compute(1, 45, 2));
});

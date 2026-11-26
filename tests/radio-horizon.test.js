// Radio horizon, line of sight, Fresnel zone and Earth bulge. References: ITU-R P.453 and P.834 (effective Earth
// radius factor k = 4/3 for radio), ITU-R P.452 and P.526 (effective-Earth path profiles), ITU-R P.530 and P.526
// (first Fresnel zone, r1 = 17.3 sqrt(d1 d2 / (f d)), d in km, f in GHz, r in m). R = 6,371,000 m; a = k R.
// Hand calculations:
//   Rule coefficient C = sqrt(2 k R) / 1000:  k = 4/3: sqrt(16,989,333) = 4121.8 m -> 4.1218 (the 4.12 sqrt(h) rule);
//     k = 7/6: sqrt(14,865,667) = 3855.6 -> 3.8556;  k = 1: sqrt(12,742,000) = 3569.6 -> 3.5696.
//   Horizon, h = 10 m, k = 4/3: sqrt(2 * 8,494,666.7 * 10) = sqrt(169,893,333) = 13,034.3 m (rule: 4.12 * 3.1623 = 13.03 km).
//   Horizon, h = 100 m: k = 4/3: 41,218.1 m;  k = 7/6: sqrt(1,486,566,667) = 38,556.0 m;  k = 1: sqrt(1,274,200,000) = 35,695.9 m.
//   Horizon, h = 30 m, k = 4/3: sqrt(509,680,000) = 22,576.1 m. Max line of sight 30 m to 10 m: 22,576.1 + 13,034.3 = 35,610.4 m.
//   At 40 km apart, B needs (40,000 - 22,576.1)^2 / (2 a) = 17,423.9^2 / 16,989,333 = 303,592,516 / 16,989,333 = 17.870 m to see A.
//   At 30 km apart (h1 = 30, h2 = 10): c(x) = 30 - 20 x / D - x (D - x) / (2 a); dc/dx = 0 at
//     x = D/2 - a (h2 - h1) / D = 15,000 + 8,494,666.7 * 20 / 30,000 = 20,663.1 m;
//     c = 30 - 20 * 0.688770 - 20,663.1 * 9,336.9 / 16,989,333 = 30 - 13.7754 - 11.3559 = 4.8687 m.
//   Fresnel, 10 km path, mid-point, 2.4 GHz: lambda = 299,792,458 / 2.4e9 = 0.1249135 m;
//     r1 = sqrt(0.1249135 * 5000 * 5000 / 10,000) = sqrt(312.284) = 17.6716 m (the rounded 17.32 rule gives
//     17.32 * sqrt(25 / 24) = 17.677 m). Second zone sqrt(2) larger: 24.991 m.
//   Bulge, mid-path, k = 4/3: 10 km: 5000 * 5000 / 16,989,333 = 1.4715 m (d1 d2 / (12.742 k) = 25 / 16.989);
//     50 km: 625e6 / 16,989,333 = 36.788 m.
//   Fresnel clearance, h1 = h2 = 30 m, 30 km, 2.4 GHz, k = 4/3: both the bulge and r1 peak at mid-path, so the least
//     margin is there: bulge = 225e6 / 16,989,333 = 13.2436 m, line clearance 30 - 13.2436 = 16.7564 m;
//     r1 = sqrt(0.1249135 * 7500) = 30.6081 m, 0.6 r1 = 18.3649 m; margin 16.7564 - 18.3649 = -1.6085 m (in sight,
//     but not 60 % clear).
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("../site/lib/radio-horizon.js");

const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);

test("horizon: rule coefficients and distances", () => {
  near(H.ruleCoefficient(4 / 3), 4.1218, 1e-4, "C, k = 4/3");
  near(H.ruleCoefficient(7 / 6), 3.8556, 1e-4, "C, k = 7/6");
  near(H.ruleCoefficient(1), 3.5696, 1e-4, "C, k = 1");
  near(H.horizonKm(10, 4 / 3), 13.0343, 1e-4, "10 m, radio");
  near(H.horizonKm(10, 4 / 3), 4.12 * Math.sqrt(10), 0.01, "10 m against the 4.12 sqrt(h) rule");
  near(H.horizonKm(100, 4 / 3), 41.2181, 1e-4, "100 m, radio");
  near(H.horizonKm(100, 7 / 6), 38.5560, 1e-4, "100 m, optical");
  near(H.horizonKm(100, 1), 35.6959, 1e-4, "100 m, geometric");
  near(H.horizonKm(0, 4 / 3), 0, 0, "on the ground");
  near(H.maxLosKm(30, 10, 4 / 3), 35.6104, 1e-4, "30 m to 10 m");
});

test("fresnel zone and bulge", () => {
  near(H.fresnelRadiusM(5, 5, 2.4), 17.6716, 1e-4, "r1, 10 km, 2.4 GHz");
  near(H.fresnelRadiusM(5, 5, 2.4, 2), 24.991, 1e-3, "r2");
  near(H.fresnelRadiusM(0, 10, 2.4), 0, 0, "zero at the antenna");
  near(H.bulgeM(5, 5, 4 / 3), 1.4715, 1e-4, "bulge 10 km");
  near(H.bulgeM(25, 25, 4 / 3), 36.788, 1e-3, "bulge 50 km");
  near(H.bulgeM(5, 5, 1), 1.4715 * 4 / 3, 1e-4, "bulge scales as 1 / k");
});

test("path: can they see each other", () => {
  const far = H.path(30, 10, 40, 4 / 3);
  assert.equal(far.visible, false, "40 km is beyond 35.61 km");
  near(far.heightNeededAtBM, 17.870, 1e-3, "height needed at B");
  near(far.extraHeightAtBM, 7.870, 1e-3, "extra height at B");
  const ok = H.path(30, 10, 30, 4 / 3);
  assert.equal(ok.visible, true);
  near(ok.minClearanceM, 4.8687, 1e-3, "least clearance");
  near(ok.minClearanceAtKm, 20.6631, 1e-3, "where");
  near(ok.heightNeededAtBM, 3.2441, 1e-4, "B needs (30,000 - 22,576.1)^2 / (2 a) = 3.2441 m");
  near(ok.extraHeightAtBM, 0, 0, "B at 10 m is already high enough");
});

test("path: exactly at the horizon sum the clearance is zero", () => {
  const D = H.maxLosKm(30, 10, 4 / 3);
  const p = H.path(30, 10, D, 4 / 3);
  near(p.minClearanceM, 0, 1e-6, "tangent");
  near(p.minClearanceAtKm, 22.5761, 1e-3, "touches at A's horizon");
});

test("path: 60 % Fresnel clearance", () => {
  const p = H.path(30, 30, 30, 4 / 3, 2.4);
  assert.equal(p.visible, true);
  assert.equal(p.fresnel60Clear, false);
  near(p.fresnelMarginM, -1.6085, 1e-3, "margin at mid-path");
  near(p.fresnelMarginAtKm, 15, 1e-3, "worst at mid-path");
  near(p.midFresnelM, 30.6081, 1e-3, "r1 at mid-path");
  assert.ok(p.heightForFresnelAtBM > 30, "B must go higher");
  const q = H.path(30, p.heightForFresnelAtBM, 30, 4 / 3, 2.4);
  near(q.fresnelMarginM, 0, 1e-6, "just clear at that height");
  const pt = H.atPoint(30, 30, 30, 15, 4 / 3, 2.4);
  near(pt.bulgeM, 13.2436, 1e-4, "bulge");
  near(pt.sightLineM, 16.7564, 1e-4, "line height above the surface");
  near(pt.fresnel60M, 18.3649, 1e-4, "0.6 r1");
  near(pt.chordHeightM, 30, 1e-9, "chord height");
});

test("bad input", () => {
  assert.throws(() => H.horizonKm(-1, 4 / 3), /zero or more/);
  assert.throws(() => H.horizonKm(NaN, 4 / 3), /number/);
  assert.throws(() => H.horizonKm(10, 0), /k must/);
  assert.throws(() => H.fresnelRadiusM(5, 5, 0), /Frequency/);
  assert.throws(() => H.fresnelRadiusM(0, 0, 1), /longer than 0/);
  assert.throws(() => H.fresnelRadiusM(5, 5, 1, 1.5), /whole number/);
  assert.throws(() => H.path(10, 10, 0, 4 / 3), /more than 0 km/);
  assert.throws(() => H.atPoint(10, 10, 10, 11, 4 / 3), /on the path/);
});

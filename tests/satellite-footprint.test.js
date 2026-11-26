// Satellite Footprint Calculator. Reference: Wertz & Larson, Space Mission Analysis and Design, 3rd ed.,
// section 5.2: sin(rho) = R/(R+h), sin(eta) = sin(rho) cos(el), lambda = 90 - el - eta, D = R sin(lambda)/sin(eta),
// cap area = 2 pi R^2 (1 - cos lambda).
// Worked example by hand (R = 6371 km): h = 550 km, el = 5 deg
//   sin(rho) = 6371/6921 = 0.920532, rho = 67.004 deg
//   sin(eta) = 0.920532 * cos(5 deg) = 0.920532 * 0.996195 = 0.917029, eta = 66.4955 deg
//   lambda = 90 - 5 - 66.4955 = 18.5045 deg = 0.322965 rad
//   footprint radius = 6371 * 0.322965 = 2057.6 km
//   D = 6371 * sin(18.5045 deg) / 0.917029 = 6371 * 0.317379 / 0.917029 = 2205.0 km
//   cap area = 2 pi 6371^2 (1 - 0.948299) = 255.032e6 * 0.051701 = 13.186e6 km^2, 2.585 % of the Earth
// GEO at 0 deg: cos(lambda) = sin(rho) = R/(R+h), so the fraction is (1 - 6371/42157)/2 = 42.44 %, the usual
// "a geostationary satellite sees about 42 % of the Earth".
const test = require("node:test");
const assert = require("node:assert/strict");
const { compute } = require("../site/lib/satellite-footprint.js");

const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);

test("footprint: SMAD geometry, 550 km at 5 deg", () => {
  const r = compute(550, 5);
  near(r.earthAngularRadiusDeg, 67.004, 0.002, "rho");
  near(r.nadirAngleDeg, 66.4955, 0.002, "eta");
  near(r.centralAngleDeg, 18.5045, 0.002, "lambda");
  near(r.footprintRadiusKm, 2057.6, 0.3, "radius");
  near(r.footprintDiameterKm, 4115.2, 0.6, "diameter");
  near(r.edgeSlantRangeKm, 2205.0, 0.3, "edge slant range");
  near(r.areaKm2 / 1e6, 13.186, 0.005, "cap area");
  near(r.fractionOfEarth * 100, 2.585, 0.002, "fraction");
});

test("footprint: law-of-cosines slant range agrees with SMAD's sine-rule form", () => {
  const r = compute(1200, 10);
  const lam = r.centralAngleDeg * Math.PI / 180, eta = r.nadirAngleDeg * Math.PI / 180;
  near(r.edgeSlantRangeKm, 6371 * Math.sin(lam) / Math.sin(eta), 1e-6, "D");
});

test("footprint: geostationary at 0 deg sees 42.44 % of the Earth", () => {
  const r = compute(35786, 0);
  near(r.fractionOfEarth, (1 - 6371 / 42157) / 2, 1e-9, "fraction");
  near(r.fractionOfEarth * 100, 42.44, 0.01, "percent");
  near(r.centralAngleDeg, 90 - r.earthAngularRadiusDeg, 1e-9, "lambda = 90 - rho at the horizon");
  // At 0 deg elevation the edge range is the horizon distance sqrt(Rs^2 - R^2).
  near(r.edgeSlantRangeKm, Math.sqrt(42157 ** 2 - 6371 ** 2), 1e-6, "horizon range");
});

test("footprint: higher minimum elevation shrinks the footprint", () => {
  assert.ok(compute(550, 10).footprintRadiusKm < compute(550, 5).footprintRadiusKm);
  assert.ok(compute(550, 89.9).footprintRadiusKm < 1);
});

test("footprint: rejects bad input", () => {
  assert.throws(() => compute(550, -1));
  assert.throws(() => compute(550, 90));
  assert.throws(() => compute(0, 5));
  assert.throws(() => compute(-10, 5));
  assert.throws(() => compute(NaN, 5));
  assert.throws(() => compute(550, "x"));
});

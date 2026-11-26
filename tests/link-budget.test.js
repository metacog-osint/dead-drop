// Link Budget Calculator. Reference: ITU-R Recommendation P.525, section 2.2 (point-to-point links):
//   L_bf = 20 log10(4 pi d / lambda) = 32.45 + 20 log10 f(MHz) + 20 log10 d(km).
// The constant by hand: 4 pi * 1e9 / 299,792,458 = 41.9169, and 20 log10(41.9169) = 32.4478 dB (P.525 rounds it to 32.4).
// Worked example, by hand (the page's default inputs): f = 437.5 MHz, d = 2,000 km
//   20 log10(2000) = 66.0206, 20 log10(437.5) = 52.8196, so L_fs = 66.0206 + 52.8196 + 32.4478 = 151.288 dB.
//   EIRP = 30 dBm + 2 dBi - 1 dB = 31 dBm (1 dBW, 1.259 W).
//   P_rx = 31 - 151.288 - 3 (other) + 15 - 2 = -110.288 dBm; margin over -110 dBm sensitivity = -0.288 dB.
//   Zero-margin range = 2000 * 10^(-0.288 / 20) = 2000 * 0.96740 = 1934.8 km.
// Second check: 1 GHz over 1 km is 32.4478 + 60 + 0 = 92.45 dB; doubling the distance adds 20 log10 2 = 6.0206 dB.
const test = require("node:test");
const assert = require("node:assert/strict");
const { fspl, compute, marginClass, FSPL_CONST_DB } = require("../site/lib/link-budget.js");

const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);

const base = {
  txPowerDbm: 30, txGainDbi: 2, txLossDb: 1, rxGainDbi: 15, rxLossDb: 2, rxSensitivityDbm: -110,
  freqMHz: 437.5, distanceKm: 2000, otherLossDb: 3
};

test("free-space loss: P.525 constant and spot values", () => {
  near(FSPL_CONST_DB, 32.4478, 0.0005, "constant");
  near(fspl(1000, 1), 92.4478, 0.0005, "1 GHz, 1 km");
  near(fspl(1000, 2) - fspl(1000, 1), 6.0206, 0.0001, "6 dB per doubling of distance");
  near(fspl(2000, 1) - fspl(1000, 1), 6.0206, 0.0001, "6 dB per doubling of frequency");
});

test("link budget: worked example, 437.5 MHz over 2,000 km", () => {
  const r = compute(base);
  near(r.fsplDb, 151.288, 0.001, "free-space loss");
  near(r.eirpDbm, 31, 1e-9, "EIRP dBm");
  near(r.eirpDbw, 1, 1e-9, "EIRP dBW");
  near(r.eirpW, 1.2589, 0.0001, "EIRP W");
  near(r.rxPowerDbm, -110.288, 0.001, "received power");
  near(r.marginDb, -0.288, 0.001, "margin");
  near(r.zeroMarginRangeKm, 1934.8, 0.1, "zero-margin range");
  near(r.wavelengthM, 0.68524, 0.00001, "wavelength 299792458 / 437.5e6");
  assert.equal(r.marginClass, "below");
});

test("link budget: margin classes are the stated rule of thumb", () => {
  assert.equal(marginClass(-0.1), "below");
  assert.equal(marginClass(0), "thin");
  assert.equal(marginClass(5.99), "thin");
  assert.equal(marginClass(6), "planned");
  // 10 dB more transmit power gives 9.712 dB margin.
  near(compute({ ...base, txPowerDbm: 40 }).marginDb, 9.712, 0.001, "plus 10 dB");
});

test("link budget: rejects bad input instead of returning nonsense", () => {
  // The old page accepted distance 0, which gave an infinite margin and an "Excellent" link.
  assert.throws(() => compute({ ...base, distanceKm: 0 }));
  assert.throws(() => compute({ ...base, distanceKm: -5 }));
  assert.throws(() => compute({ ...base, freqMHz: 0 }));
  assert.throws(() => compute({ ...base, txPowerDbm: NaN }));
  assert.throws(() => compute({ ...base, rxLossDb: -2 }));
  assert.throws(() => fspl(Infinity, 1));
});

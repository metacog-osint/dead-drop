// Light Pollution Map. References: P. Cinzano, "Night sky photometry with Sky Quality Meter", ISTIL Internal Report 9
// (2005): L [cd/m^2] = 10.8e4 * 10^(-0.4 m) for a sky brightness m in mag/arcsec^2. F. Falchi et al., Science Advances
// 2, e1600377 (2016): natural zenith sky 22.0 mag/arcsec^2, about 174 ucd/m^2. J. E. Bortle, Sky & Telescope,
// Feb 2001: classes 1-9 with naked-eye limiting magnitude (NELM) ranges 7.6-8.0, 7.1-7.5, 6.6-7.0, 6.1-6.5, 5.6-6.0,
// 5.1-5.5, 4.6-5.0, 4.1-4.5, 4.0 or brighter.
// Worked examples by hand:
//   m = 22.0: 10^(-8.8) = 10^0.2 * 10^-9 = 1.584893e-9; x 1.08e5 = 1.711685e-4 cd/m^2 = 171.17 ucd/m^2
//     (Falchi's 174 ucd/m^2 is within 2 %).
//   m = 18.0: 10^(-7.2) = 10^0.8 * 10^-8 = 6.309573e-8; x 1.08e5 = 6.81434e-3 cd/m^2 = 6.814 mcd/m^2.
//     Ratio to natural: 10^(0.4 * 4) = 10^1.6 = 39.811; artificial light adds 3,881 % of natural.
//   L = 1 mcd/m^2: m = -2.5 log10(1e-3 / 1.08e5) = -2.5 * (log10 9.259259 - 9) = -2.5 * (0.966576 - 9) = 20.0836.
//   A 1-magnitude step is a factor 10^0.4 = 2.5119 in luminance.
const test = require("node:test");
const assert = require("node:assert/strict");
const LP = require("../site/lib/light-pollution.js");

const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);

test("light pollution: SQM to luminance, Cinzano's conversion", () => {
  near(LP.sqmToCdm2(22.0) * 1e6, 171.17, 0.01, "natural sky in ucd/m2");
  near(LP.sqmToCdm2(22.0) * 1e6, 174, 174 * 0.02, "agrees with Falchi's 174 ucd/m2 to 2 %");
  near(LP.sqmToCdm2(18.0) * 1e3, 6.814, 0.001, "suburban sky in mcd/m2");
  near(LP.sqmToCdm2(17) / LP.sqmToCdm2(18), 2.5119, 0.0001, "one magnitude step");
  near(LP.sqmToCdm2(0), 1.08e5, 1e-6, "zero point");
});

test("light pollution: luminance back to SQM", () => {
  near(LP.cdm2ToSqm(1e-3), 20.0836, 0.0001, "1 mcd/m2");
  [16, 19.5, 21.7, 22.0].forEach((m) => near(LP.cdm2ToSqm(LP.sqmToCdm2(m)), m, 1e-9, "round trip " + m));
});

test("light pollution: ratio to the natural sky", () => {
  const r = LP.fromSqm(18.0);
  near(r.ratioToNatural, 39.811, 0.001, "18.0 against 22.0");
  near(r.artificialPctOfNatural, 3881.1, 0.1, "artificial share");
  assert.equal(LP.ratioToNatural(22.0), 1);
  assert.ok(LP.fromSqm(22.2).artificialPctOfNatural < 0, "a reading darker than 22.0 has no artificial share");
  near(LP.ratioToNatural(21.0, 21.6), Math.pow(10, 0.24), 1e-12, "other natural reference");
});

test("light pollution: Bortle class from limiting magnitude", () => {
  assert.equal(LP.bortleFromNelm(8.0).cls, 1);
  assert.equal(LP.bortleFromNelm(7.6).cls, 1);
  assert.equal(LP.bortleFromNelm(7.55).cls, 2, "between Bortle's ranges goes to the brighter class");
  assert.equal(LP.bortleFromNelm(7.1).cls, 2);
  assert.equal(LP.bortleFromNelm(6.8).cls, 3);
  assert.equal(LP.bortleFromNelm(6.4).cls, 4);
  assert.equal(LP.bortleFromNelm(5.8).cls, 5);
  assert.equal(LP.bortleFromNelm(5.5).cls, 6);
  assert.equal(LP.bortleFromNelm(5.0).cls, 7);
  assert.equal(LP.bortleFromNelm(4.5).cls, 8);
  assert.equal(LP.bortleFromNelm(4.0).cls, 9);
  assert.equal(LP.bortleFromNelm(2.0).cls, 9);
  assert.equal(LP.bortleFromNelm(6.4).name, "Rural/suburban transition");
  assert.equal(LP.BORTLE.length, 9);
});

test("light pollution: bad input and saved-site cleaning", () => {
  assert.throws(() => LP.sqmToCdm2(NaN));
  assert.throws(() => LP.sqmToCdm2(-1));
  assert.throws(() => LP.cdm2ToSqm(0));
  assert.throws(() => LP.bortleFromNelm(9.5));
  assert.throws(() => LP.checkLatLon(91, 0));
  assert.deepEqual(LP.checkLatLon(10, 190), { lat: 10, lon: -170 });
  const cleaned = LP.cleanSites([
    { name: "Good", lat: 45, lon: -100, savedUtc: "2026-11-26T03:00:00Z" },
    { name: "", lat: 1, lon: 1 }, { name: "Bad lat", lat: 95, lon: 0 }, null, { name: "Wrap", lat: 0, lon: 181 }
  ]);
  assert.equal(cleaned.length, 2);
  assert.equal(cleaned[1].lon, -179);
  assert.deepEqual(LP.cleanSites("nonsense"), []);
});

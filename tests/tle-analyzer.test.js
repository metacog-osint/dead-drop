// TLE Analyzer. References: CelesTrak, "NORAD Two-Line Element Set Format" (column layout, checksum rule, epoch
// year rule, implied decimal points); Hoots & Roehrich, Spacetrack Report No. 3 (1980); Vallado, Fundamentals of
// Astrodynamics and Applications, 4th ed., sections 2.2-2.3 (n = sqrt(mu / a^3), r_a = a(1 + e), r_p = a(1 - e)).
// Worked examples:
// 1. The ISS element set used as the example in CelesTrak's format notes and many textbooks:
//      1 25544U 98067A   08264.51782528 -.00002182  00000-0 -11606-4 0  2927
//      2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.72125391563537
//    Checksums: both lines add up to 7 (mod 10), matching the last digit.
//    Epoch 08264.51782528: 2008 (08 < 57), day 264 of a leap year is 20 September (31+29+31+30+31+30+31+31 = 244
//    days to the end of August, + 20); 0.51782528 day = 12.4278 h = 12:25:40.104 UTC.
//    BSTAR "-11606-4" = -0.11606e-4. Period 1440 / 15.72125391 = 91.5957 min.
//    a = (mu / n^2)^(1/3), n = 15.72125391 * 2 pi / 86400 = 1.14328e-3 rad/s, mu = 398600.4418 km^3/s^2:
//    a = 6730.96 km; perigee altitude a(1 - 0.0006703) - 6378.137 = 348.31 km, apogee 357.34 km.
// 2. Vallado's SGP4 verification set, satellite 00005 (Vanguard 1), from "Revisiting Spacetrack Report #3":
//      1 00005U 58002B   00179.78495062  .00000023  00000-0  28098-4 0  4753
//      2 00005  34.2682 348.7242 1859667 331.7664  19.3264 10.82419157413667
//    Checksums 3 and 7. Epoch 2000 day 179.78495062 = 27 June 2000 18:50:19.734 UTC.
//    e = 0.1859667; n = 10.82419157 rev/day gives a = 8632.53 km, perigee 649.03 km, apogee 3859.76 km.
// 3. Geostationary check: n = 1.00273791 rev/day (one sidereal day) gives a = 42164.17 km, altitude 35786.03 km,
//    the textbook geostationary radius.
// Alpha-5 catalog numbers: "A0000" = 100000, "E1234" = 141234, "Z9999" = 339999 (I and O are skipped).
const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../site/lib/tle-analyzer.js");

const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);
const ISS = ["ISS (ZARYA)",
  "1 25544U 98067A   08264.51782528 -.00002182  00000-0 -11606-4 0  2927",
  "2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.72125391563537"];
const V5 = ["1 00005U 58002B   00179.78495062  .00000023  00000-0  28098-4 0  4753",
  "2 00005  34.2682 348.7242 1859667 331.7664  19.3264 10.82419157413667"];

test("TLE: checksum rule on the ISS and 00005 lines", () => {
  assert.equal(T.checksum(ISS[1]), 7);
  assert.equal(T.checksum(ISS[2]), 7);
  assert.equal(T.checksum(V5[0]), 3);
  assert.equal(T.checksum(V5[1]), 7);
});

test("TLE: ISS example fields and epoch", () => {
  const e = T.parse(ISS[1], ISS[2], ISS[0]);
  assert.equal(e.name, "ISS (ZARYA)");
  assert.equal(e.catalogNumber, 25544);
  assert.equal(e.classification, "U");
  assert.equal(e.intlDesignator, "98067A");
  assert.equal(e.launchYear, 1998);
  assert.equal(e.launchNumber, 67);
  assert.equal(e.launchPiece, "A");
  assert.equal(e.epochYear, 2008);
  near(e.epochMs, Date.UTC(2008, 8, 20, 12, 25, 40, 104), 1, "epoch");
  near(e.meanMotionDot, -0.00002182, 1e-12, "ndot/2");
  assert.equal(e.meanMotionDdot, 0);
  near(e.bstar, -0.11606e-4, 1e-15, "BSTAR");
  assert.equal(e.elementSetNumber, 292);
  near(e.inclinationDeg, 51.6416, 1e-9, "inclination");
  near(e.raanDeg, 247.4627, 1e-9, "RAAN");
  near(e.eccentricity, 0.0006703, 1e-12, "eccentricity");
  near(e.argPerigeeDeg, 130.536, 1e-9, "arg of perigee");
  near(e.meanAnomalyDeg, 325.0288, 1e-9, "mean anomaly");
  near(e.meanMotionRevDay, 15.72125391, 1e-9, "mean motion");
  assert.equal(e.revNumber, 56353);
  assert.ok(e.checksum.every((c) => c.ok));
  assert.deepEqual(e.warnings, []);
});

test("TLE: ISS orbit size from Kepler's third law", () => {
  const o = T.orbitFromMeanMotion(15.72125391, 0.0006703);
  near(o.periodMin, 91.5957, 1e-4, "period");
  near(o.semiMajorAxisKm, 6730.96, 0.01, "a");
  near(o.perigeeAltKm, 348.31, 0.01, "perigee");
  near(o.apogeeAltKm, 357.34, 0.01, "apogee");
  // The old tool's constant (8681663.653) gave a = 32.7 km and an altitude of about -6345 km; the real orbit is ~350 km.
  assert.ok(o.meanAltKm > 340 && o.meanAltKm < 360);
});

test("TLE: Vallado 00005 (20th-century launch year, eccentric orbit)", () => {
  const e = T.parse(V5[0], V5[1]);
  assert.equal(e.catalogNumber, 5);
  assert.equal(e.launchYear, 1958);
  assert.equal(e.epochYear, 2000);
  near(e.epochMs, Date.UTC(2000, 5, 27, 18, 50, 19, 734), 1, "epoch");
  near(e.bstar, 0.28098e-4, 1e-15, "BSTAR");
  const o = T.orbitFromMeanMotion(e.meanMotionRevDay, e.eccentricity);
  near(o.semiMajorAxisKm, 8632.53, 0.01, "a");
  near(o.perigeeAltKm, 649.03, 0.01, "perigee");
  near(o.apogeeAltKm, 3859.76, 0.01, "apogee");
});

test("TLE: geostationary mean motion gives the geostationary radius", () => {
  const o = T.orbitFromMeanMotion(1.00273791, 0);
  near(o.semiMajorAxisKm, 42164.17, 0.01, "a");
  near(o.meanAltKm, 35786.03, 0.01, "altitude");
});

test("TLE: epoch year rule and day-of-year fraction", () => {
  assert.equal(T.epochToMs(57, 1), Date.UTC(1957, 0, 1));
  assert.equal(T.epochToMs(56, 1), Date.UTC(2056, 0, 1));
  assert.equal(T.epochToMs(24, 1.5), Date.UTC(2024, 0, 1, 12));
  assert.equal(T.epochToMs(24, 366), Date.UTC(2024, 11, 31));   // 2024 is a leap year
  assert.throws(() => T.epochToMs(24, 0.5));
});

test("TLE: Alpha-5 catalog numbers and exponent fields", () => {
  assert.equal(T.catalogNumber("A0000"), 100000);
  assert.equal(T.catalogNumber("E1234"), 141234);
  assert.equal(T.catalogNumber("Z9999"), 339999);
  assert.equal(T.catalogNumber("    5"), 5);
  assert.throws(() => T.catalogNumber("I0000"));
  assert.throws(() => T.catalogNumber("O0000"));
  near(T.impliedExponent(" 12345-3"), 0.12345e-3, 1e-18, "12345-3");
  near(T.impliedExponent("-11606-4"), -0.11606e-4, 1e-18, "-11606-4");
  assert.equal(T.impliedExponent(" 00000-0"), 0);
  assert.equal(T.impliedExponent(" 00000+0"), 0);
  assert.throws(() => T.impliedExponent("1.2e-4"));
});

test("TLE: splitting pasted text, with and without names, several sets", () => {
  assert.equal(T.splitSets(ISS.join("\n")).length, 1);
  assert.equal(T.splitSets(ISS.join("\n"))[0].name, "ISS (ZARYA)");
  assert.equal(T.splitSets(V5.join("\r\n"))[0].name, "");
  const two = T.splitSets(["0 ISS (ZARYA)", ISS[1], ISS[2], "", "VANGUARD 1", V5[0], V5[1]].join("\n"));
  assert.equal(two.length, 2);
  assert.equal(two[0].name, "ISS (ZARYA)");
  assert.equal(two[1].name, "VANGUARD 1");
  assert.equal(T.splitSets("no element set here").length, 0);
});

test("TLE: a mistyped character fails the checksum, with a warning", () => {
  const bad = ISS[2].replace("51.6416", "51.6417");
  const e = T.parse(ISS[1], bad);
  assert.equal(e.checksum[1].ok, false);
  assert.equal(e.checksum[1].expected, 8);
  assert.equal(e.warnings.length, 1);
});

test("TLE: rejects text that is not an element set", () => {
  assert.throws(() => T.parse("hello", "world"));
  assert.throws(() => T.parse(ISS[2], ISS[1]));                       // lines swapped
  assert.throws(() => T.parse(ISS[1].slice(0, 60), ISS[2]));          // too short
  assert.throws(() => T.parse(ISS[1], V5[1]));                        // two different satellites
  assert.throws(() => T.parse(ISS[1], ISS[2].replace("15.72125391", " 0.00000000")));
  assert.throws(() => T.orbitFromMeanMotion(0, 0));
  assert.throws(() => T.orbitFromMeanMotion(15, 1));
});

test("TLE: age in days", () => {
  near(T.ageDays(Date.UTC(2024, 0, 1), Date.UTC(2024, 0, 8, 12)), 7.5, 1e-12, "age");
  assert.ok(T.ageDays(Date.UTC(2024, 0, 2), Date.UTC(2024, 0, 1)) < 0);
});

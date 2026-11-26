// Distance and Bearing Calculator. Reference: Chris Veness, "Calculate distance, bearing and more between
// latitude/longitude points", movable-type.co.uk (haversine distance, initial and final bearing, midpoint,
// destination point), spherical Earth R = 6371 km.
// Worked example, Veness's own: Land's End 50 03 59 N, 005 42 53 W to John o' Groats 58 38 38 N, 003 04 12 W:
//   distance 968.9 km, initial bearing 009 07 11, final bearing 011 16 31, midpoint 54 21 44 N, 004 31 50 W.
// Hand check on the bearing formula, Baghdad (35 N, 45 E) to Osaka (35 N, 135 E), dLon = 90 deg:
//   y = sin 90 cos 35 = 0.819152, x = cos 35 sin 35 - sin 35 cos 35 cos 90 = 0.469846,
//   theta = atan2(0.819152, 0.469846) = 60.162 deg; by symmetry the final bearing is 180 - 60.162 = 119.838 deg.
//   cos c = sin^2 35 + cos^2 35 cos 90 = 0.328990, c = 70.792 deg = 1.235563 rad, distance = 6371 c = 7871.8 km.
//   Midpoint: on the meridian halfway, 90 E; latitude atan(tan 35 / cos 45) = 44.719 N.
// Veness's destination example: from 53 19 14 N, 001 43 47 W on 096 01 18 for 124.8 km reaches 53 11 18 N, 000 08 00 E.
const test = require("node:test");
const assert = require("node:assert/strict");
const gc = require("../site/lib/distance-bearing.js");

const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);
const dms = (d, m, s) => d + m / 60 + s / 3600;
const SEC = 1 / 3600;

test("Veness worked example: Land's End to John o' Groats", () => {
  const r = gc.compute(dms(50, 3, 59), -dms(5, 42, 53), dms(58, 38, 38), -dms(3, 4, 12));
  near(r.distanceKm, 968.9, 0.05, "distance");
  near(r.initialBearing, dms(9, 7, 11), 1 * SEC, "initial bearing");
  near(r.finalBearing, dms(11, 16, 31), 1 * SEC, "final bearing");
  near(r.midpoint.lat, dms(54, 21, 44), 1 * SEC, "midpoint lat");
  near(r.midpoint.lon, -dms(4, 31, 50), 1 * SEC, "midpoint lon");
  near(r.distanceNm, 968.9 / 1.852, 0.05, "nautical miles");
  near(r.distanceMi, 968.9 / 1.609344, 0.05, "statute miles");
  assert.equal(r.initialCardinal, "N");
  assert.equal(r.finalCardinal, "NNE");
});

test("hand check: Baghdad to Osaka bearings, distance and midpoint", () => {
  const r = gc.compute(35, 45, 35, 135);
  near(r.initialBearing, 60.162, 0.001, "initial");
  near(r.finalBearing, 119.838, 0.001, "final");
  near(r.distanceKm, 7871.8, 0.1, "distance");
  near(r.midpoint.lat, 44.719, 0.001, "midpoint lat");
  near(r.midpoint.lon, 90, 1e-9, "midpoint lon");
  assert.equal(r.initialCardinal, "ENE");
  assert.equal(r.finalCardinal, "ESE");
});

test("destination point: Veness's example", () => {
  const p = gc.destination(dms(53, 19, 14), -dms(1, 43, 47), dms(96, 1, 18), 124.8);
  near(p.lat, dms(53, 11, 18), 1 * SEC, "lat");
  near(p.lon, dms(0, 8, 0), 1 * SEC, "lon");
  // Going back the measured distance on the reverse of the final bearing returns to the start.
  const back = gc.destination(p.lat, p.lon, p.finalBearing + 180, 124.8);
  near(back.lat, dms(53, 19, 14), 1e-9, "round trip lat");
  near(back.lon, -dms(1, 43, 47), 1e-9, "round trip lon");
});

test("simple cases: due north along a meridian, quarter of the equator", () => {
  // One degree of latitude on a 6371 km sphere is 6371 * pi / 180 = 111.195 km.
  const r = gc.compute(0, 0, 1, 0);
  near(r.distanceKm, 111.195, 0.001, "one degree");
  near(r.initialBearing, 0, 1e-9, "north");
  const q = gc.compute(0, 0, 0, 90);
  near(q.distanceKm, 6371 * Math.PI / 2, 1e-6, "quarter equator");
  near(q.initialBearing, 90, 1e-9, "east");
  near(q.finalBearing, 90, 1e-9, "east on arrival");
});

test("antimeridian: midpoint and destination longitudes stay in -180..180", () => {
  const r = gc.compute(0, 170, 0, -170);
  near(r.distanceKm, 6371 * 20 * Math.PI / 180, 1e-6, "20 degrees across the antimeridian");
  near(r.initialBearing, 90, 1e-9, "east");
  near(Math.abs(r.midpoint.lon), 180, 1e-9, "midpoint on the antimeridian");
  const p = gc.destination(0, 175, 90, 6371 * 10 * Math.PI / 180);
  near(p.lon, -175, 1e-9, "destination wraps");
  // A drawn track is continuous: no step bigger than a few degrees.
  const t = gc.track(0, 175, 90, 6371 * 10 * Math.PI / 180, 10);
  for (let i = 1; i < t.length; i++) assert.ok(Math.abs(t[i][1] - t[i - 1][1]) < 2, "continuous track");
  near(t[t.length - 1][1], 185, 1e-9, "unwrapped end longitude");
});

test("unwrap and normalisers", () => {
  assert.deepEqual(gc.unwrap([170, 179, -179, -170]), [170, 179, 181, 190]);
  assert.equal(gc.normLon(190), -170);
  assert.equal(gc.normLon(-190), 170);
  assert.equal(gc.normBearing(-10), 350);
  assert.equal(gc.normBearing(360), 0);
  assert.equal(gc.cardinal(348.75), "N");
  assert.equal(gc.cardinal(348.74), "NNW");
});

test("same point and antipodes: no bearing is reported", () => {
  const s = gc.compute(10, 20, 10, 20);
  assert.equal(s.distanceKm, 0);
  assert.equal(s.initialBearing, null);
  assert.ok(s.note);
  const a = gc.compute(10, 20, -10, -160);
  near(a.distanceKm, Math.PI * 6371, 1e-3, "half the circumference");
  assert.equal(a.initialBearing, null);
  assert.equal(a.midpoint, null);
});

test("bad input is rejected", () => {
  assert.throws(() => gc.compute(91, 0, 0, 0), /latitude/);
  assert.throws(() => gc.compute(0, 0, 0, 181), /longitude/);
  assert.throws(() => gc.compute(NaN, 0, 0, 0), /numbers/);
  assert.throws(() => gc.compute("10", 0, 0, 0), /numbers/);
});

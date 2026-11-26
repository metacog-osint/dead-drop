// Bearing and Distance Overlay. Reference: Chris Veness, "Calculate distance, bearing and more between
// latitude/longitude points", movable-type.co.uk, destination point on a sphere (R = 6371 km):
//   lat2 = asin(sin lat1 cos d + cos lat1 sin d cos theta), lon2 = lon1 + atan2(sin theta sin d cos lat1, cos d - sin lat1 sin lat2).
// Worked example, Veness's own: from 53 19 14 N, 001 43 47 W on bearing 096 01 18 for 124.8 km the end point is
//   53 11 18 N, 000 08 00 E.
// Hand checks for a ring of radius 1000 km about (0, 0): the angular radius is 1000 / 6371 = 0.156961 rad = 8.9932 deg,
//   so the vertex due north is at 8.9932 N, 0 E and the vertex due east at 0 N, 8.9932 E.
// A ring of 1500 km (13.49 deg) about 80 N encloses the North Pole, which is only 10 deg (1112 km) away; a ring of
//   1000 km (8.99 deg) about the same centre does not.
const test = require("node:test");
const assert = require("node:assert/strict");
const ov = require("../site/lib/bearing-overlay.js");
const gc = require("../site/lib/distance-bearing.js");

const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);
const dms = (d, m, s) => d + m / 60 + s / 3600;

test("bearing line: Veness destination example", () => {
  const b = ov.bearingLine(dms(53, 19, 14), -dms(1, 43, 47), dms(96, 1, 18), 124.8);
  near(b.end.lat, dms(53, 11, 18), 1 / 3600, "end lat");
  near(b.end.lon, dms(0, 8, 0), 1 / 3600, "end lon");
  // The last sampled point is the end point, and every sample lies on the line at the right distance.
  const last = b.points[b.points.length - 1];
  near(last[0], b.end.lat, 1e-9, "last sample lat");
  near(gc.normLon(last[1]), b.end.lon, 1e-9, "last sample lon");
  const mid = b.points[Math.floor(b.points.length / 2)];
  near(gc.initialBearing(dms(53, 19, 14), -dms(1, 43, 47), mid[0], mid[1]), dms(96, 1, 18), 1e-6, "sample on the line");
});

test("bearing line bends as a great circle: due east from 60 N", () => {
  // A great circle leaving 60 N due east does not follow the parallel: its highest point is where it starts,
  // and after 90 deg of arc (10,007.5 km) it crosses the equator 90 deg further east. Its highest point is at
  // 60 N, so it is inclined 60 deg to the equator and crosses it on bearing 90 + 60 = 150 deg.
  const b = ov.bearingLine(60, 0, 90, 6371 * Math.PI / 2);
  near(b.end.lat, 0, 1e-9, "on the equator");
  near(b.end.lon, 90, 1e-9, "90 deg east");
  near(b.finalBearing, 150, 1e-9, "arrival bearing");
  for (const p of b.points) assert.ok(p[0] <= 60 + 1e-9, "never north of the start");
});

test("ring: every vertex is at the radius, compass vertices by hand", () => {
  const r = ov.ring(0, 0, 1000, 36);
  assert.equal(r.pole, null);
  assert.equal(r.ring.length, 37);
  near(r.ring[0][0], 8.9932, 1e-4, "north vertex lat");
  near(r.ring[0][1], 0, 1e-9, "north vertex lon");
  near(r.ring[9][0], 0, 1e-9, "east vertex lat");
  near(r.ring[9][1], 8.9932, 1e-4, "east vertex lon");
  for (const p of r.ring) near(gc.distanceKm(0, 0, p[0], p[1]), 1000, 1e-6, "radius");
  near(r.ring[36][0], r.ring[0][0], 1e-9, "closed lat");
  near(r.ring[36][1], r.ring[0][1], 1e-9, "closed lon");
});

test("ring across the antimeridian stays continuous", () => {
  const r = ov.ring(0, 179, 500, 72);
  for (let i = 1; i < r.ring.length; i++) assert.ok(Math.abs(r.ring[i][1] - r.ring[i - 1][1]) < 2, "no jump");
  const lons = r.ring.map((p) => p[1]);
  near(Math.max(...lons), 179 + 500 / 6371 * 180 / Math.PI, 1e-6, "east edge past 180");
});

test("ring around a pole is closed through the pole", () => {
  assert.equal(ov.enclosedPole(80, 0, 1500), "N");
  assert.equal(ov.enclosedPole(80, 0, 1000), null);
  assert.equal(ov.enclosedPole(-85, 30, 600), "S");
  const r = ov.ring(80, 0, 1500, 90);
  assert.equal(r.pole, "N");
  const body = r.ring.slice(0, 91);
  near(Math.abs(body[90][1] - body[0][1]), 360, 1e-6, "outline goes all the way round");
  assert.equal(r.ring[91][0], 90);
  assert.equal(r.ring[92][0], 90);
  for (const p of body) near(gc.distanceKm(80, 0, p[0], p[1]), 1500, 1e-6, "radius");
});

test("bad input is rejected", () => {
  assert.throws(() => ov.ring(0, 0, 0), /above 0/);
  assert.throws(() => ov.ring(0, 0, -5), /above 0/);
  assert.throws(() => ov.ring(0, 0, 20016), /half way/);
  assert.throws(() => ov.ring(95, 0, 100), /latitude/);
  assert.throws(() => ov.bearingLine(0, 0, NaN, 100), /Bearing/);
  assert.throws(() => ov.bearingLine(0, 200, 10, 100), /longitude/);
  // Bearings outside 0-360 are taken modulo 360.
  near(ov.bearingLine(0, 0, -90, 100).bearing, 270, 1e-12, "negative bearing");
});

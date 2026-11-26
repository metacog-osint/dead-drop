// Multi-Satellite Tracker. References: Vallado, Fundamentals of Astrodynamics and Applications, 4th ed., section 3.5
// (GMST; the angle used by ../site/lib/ground-track.js, which has its own Vallado-example tests) and
// Chris Veness, "Calculate distance, bearing and more between latitude/longitude points" (haversine; worked example
// Land's End 50 03 59 N 005 42 53 W to John o' Groats 58 38 38 N 003 04 12 W: 968.9 km with R = 6371 km).
// Hand-worked checks with a made-up propagator: a circular equatorial orbit of radius 7000 km and period 90 min,
// started at the Vallado Example 3-5 instant (20 Aug 1992 12:14 UT1, GMST 152.578787810 deg) with its inertial
// angle equal to GMST, so the point beneath it starts at latitude 0, longitude 0.
// - Inertial speed: 2 pi 7000 / 5400 s = 8.14487 km/s.
// - Ground speed: the point beneath moves east at (n - w) R, with n = 2 pi / 5400 = 1.1635528e-3 rad/s and the
//   Earth's rate w = 7.2921159e-5 rad/s: (1.0906317e-3)(6371) = 6.94841 km/s.
// - The point beneath moves east at 360/90 - 360.98565/1440 = 3.749316 deg of longitude a minute; an hour back it
//   was at -224.959 deg, i.e. 135.041 deg E, so the past hour's trail crosses 180 once (two lines, 61 points plus 2
//   at the crossing); the next 30 min reach 112.48 deg E with no crossing (one line, 31 points).
const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../site/lib/multi-satellite.js");

const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);
const D2R = Math.PI / 180;
const T0 = Date.UTC(1992, 7, 20, 12, 14, 0);
const R = 7000, P = 5400, N = 2 * Math.PI / P, A0 = 152.578787810 * D2R;
const prop = (ms) => {
  const a = A0 + N * (ms - T0) / 1000;
  return { position: { x: R * Math.cos(a), y: R * Math.sin(a), z: 0 },
    velocity: { x: -N * R * Math.sin(a), y: N * R * Math.cos(a), z: 0 } };
};

test("haversine: Veness worked example", () => {
  const dms = (d, m, s) => d + m / 60 + s / 3600;
  near(M.surfaceDistanceKm(dms(50, 3, 59), -dms(5, 42, 53), dms(58, 38, 38), -dms(3, 4, 12)), 968.9, 0.05, "Land's End to John o' Groats");
  near(M.surfaceDistanceKm(0, 0, 0, 1), 6371 * D2R, 1e-9, "one degree on the equator");
});

test("position of a made-up circular orbit", () => {
  const p = M.position(prop, T0);
  near(p.latDeg, 0, 1e-9, "lat"); near(p.lonDeg, 0, 1e-5, "lon"); near(p.hKm, 621.863, 1e-6, "height");
  near(p.speedKmS, 8.14487, 1e-5, "inertial speed");
  near(p.groundSpeedKmS, 6.94841, 1e-4, "ground speed");
  assert.equal(M.position(() => null, T0), null);
});

test("trail behind and ahead, split at 180", () => {
  const t = M.trail(prop, T0, 60, 30, 60);
  assert.equal(t.past.length, 2);
  assert.equal(t.past[0].length + t.past[1].length, 63);
  near(t.past[0][0][1], 135.041, 1e-3, "an hour back");
  const lastPast = t.past[1][t.past[1].length - 1];
  near(lastPast[1], 0, 1e-5, "trail ends at now");
  assert.equal(t.ahead.length, 1);
  assert.equal(t.ahead[0].length, 31);
  near(t.ahead[0][30][1], 112.4795, 1e-3, "30 min ahead");
  assert.deepEqual(M.trail(prop, T0, 0, 0), { past: [], ahead: [] });
  assert.throws(() => M.trail(prop, T0, -1, 10));
});

test("tracked list: newer element sets replace older, duplicates are skipped", () => {
  const a = { catalogNumber: 25544, epochMs: 100 }, b = { catalogNumber: 20580, epochMs: 50 };
  let r = M.merge([], [a, b]);
  assert.equal(r.added, 2); assert.equal(r.list.length, 2);
  r = M.merge(r.list, [{ catalogNumber: 25544, epochMs: 90 }]);
  assert.equal(r.skipped, 1); assert.equal(r.list[0].epochMs, 100);
  r = M.merge(r.list, [{ catalogNumber: 25544, epochMs: 200 }, null, { catalogNumber: NaN, epochMs: 1 }]);
  assert.equal(r.replaced, 1); assert.equal(r.skipped, 2); assert.equal(r.list[0].epochMs, 200); assert.equal(r.list.length, 2);
});

test("colours: the first eight differ, then repeat", () => {
  const c = Array.from({ length: 8 }, (_, i) => M.colour(i));
  assert.equal(new Set(c).size, 8);
  assert.equal(M.colour(8), M.colour(0));
  assert.equal(M.colour(-1), M.colour(7));
  assert.deepEqual(M.PRESETS.map((p) => p.catalogNumber), [25544, 20580, 48274]);
});

// Satellite Coverage Planner. References: Wertz & Larson, Space Mission Analysis and Design, 3rd ed., section 5.2
// (sin eta = (R / (R + h)) cos el, lambda = 90 - el - eta; tan el = (cos lambda - R/(R + h)) / sin lambda) and
// section 7.2 (percent coverage, maximum gap, mean revisit); Chris Veness, "Calculate distance, bearing and more
// between latitude/longitude points" (destination point; worked example 53 19 14 N 001 43 47 W, bearing
// 096 01 18, 124.8 km: 53 11 18 N 000 08 00 E).
// Hand-worked with R = 6371 km:
// - GEO (h = 35786 km), el 0: sin eta = 6371/42157 = 0.151126 -> eta = 8.6922 deg, lambda = 81.3078 deg,
//   circle radius 6371 * 1.419093 rad = 9041.0 km.   el 10: sin eta = 0.151126 * 0.984808 = 0.148830,
//   eta = 8.5591, lambda = 71.4409 deg, radius 7943.9 km.
// - 500 km, el 10: sin eta = (6371/6871)(0.984808) = 0.913144, eta = 65.9435, lambda = 14.0565 deg,
//   radius 1563.0 km, edge slant range sqrt(6371^2 + 6871^2 - 2(6371)(6871) cos 14.0565) = 1694.57 km.
// - Windows: a 500 km circular equatorial orbit over a target on the equator. The ground point's central angle from
//   the target changes at n - w = sqrt(398600.4418 / 6871^3) - 7.2921159e-5 = 1.1085083e-3 - 0.0729212e-3 =
//   1.0355872e-3 rad/s, so each window lasts 2 (14.0565 deg)(pi/180) / 1.0355872e-3 = 473.804 s and recurs every
//   2 pi / 1.0355872e-3 = 6067.268 s. Over -3000 s to 15201.805 s (three recurrences) there are 3 windows, 1421.41 s
//   covered (7.809 %), gaps between windows of 6067.268 - 473.804 = 5593.464 s (the longest), mean revisit 6067.268 s.
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../site/lib/satellite-coverage.js");
const P = require("../site/lib/satellite-passes.js");

const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);
const D2R = Math.PI / 180;

test("coverage geometry: hand-worked SMAD section 5.2", () => {
  let g = S.geometry(35786, 0);
  near(g.nadirAngleDeg, 8.6922, 1e-4, "GEO eta"); near(g.centralAngleDeg, 81.3078, 1e-4, "GEO lambda");
  near(g.radiusKm, 9041.0, 0.1, "GEO radius");
  g = S.geometry(35786, 10);
  near(g.nadirAngleDeg, 8.5591, 1e-4, "GEO eta at 10"); near(g.centralAngleDeg, 71.4409, 1e-4, "GEO lambda at 10");
  near(g.radiusKm, 7943.9, 0.1, "GEO radius at 10");
  g = S.geometry(500, 10);
  near(g.nadirAngleDeg, 65.9435, 1e-4, "LEO eta"); near(g.centralAngleDeg, 14.0565, 1e-4, "LEO lambda");
  near(g.radiusKm, 1563.0, 0.1, "LEO radius"); near(g.edgeSlantRangeKm, 1694.57, 0.01, "LEO slant");
  // The reverse formula gives back the elevation at the edge, 90 overhead and 0 at the horizon.
  near(S.elevationAt(500, 14.056535), 10, 1e-5, "elevation at the edge");
  near(S.elevationAt(500, 0), 90, 1e-12, "overhead");
  near(S.elevationAt(500, S.geometry(500, 0).centralAngleDeg), 0, 1e-9, "horizon");
});

test("destination point and circle: Veness worked example", () => {
  const d = S.destination(53 + 19 / 60 + 14 / 3600, -(1 + 43 / 60 + 47 / 3600), 96 + 1 / 60 + 18 / 3600, 124.8 / 6371 / D2R);
  near(d[0], 53 + 11 / 60 + 18 / 3600, 1 / 3600, "latitude"); near(d[1], 8 / 60, 1 / 3600, "longitude");
  const c = S.circle(10, 20, 5, 4);
  assert.equal(c.length, 5);
  near(c[0][0], 15, 1e-9, "north point"); near(c[0][1], 20, 1e-9, "north point lon");
  near(c[2][0], 5, 1e-9, "south point"); near(c[4][0], 15, 1e-9, "closed");
  // GEO at 10 deg seen from 38 N: 38 + 71.44 > 90, so the circle holds the North Pole and closes along 90 N.
  const g = S.circle(38, -77, 71.4409, 180);
  assert.equal(g.length, 183);
  assert.deepEqual(g.slice(-2).map((p) => p[0]), [90, 90]);
  near(Math.abs(g[180][1] - g[0][1]), 360, 1e-6, "longitudes run once round");
  // A circle across 180: longitudes stay continuous (no jump of more than 180 between neighbours).
  const w = S.circle(0, 179, 10, 90);
  for (let i = 1; i < w.length; i++) assert.ok(Math.abs(w[i][1] - w[i - 1][1]) < 180);
});

test("coverage statistics: hand-worked windows", () => {
  const s = S.stats([{ startMs: 1000, endMs: 3000 }, { startMs: 2500, endMs: 4000 }, { startMs: 7000, endMs: 8000 }], 0, 10000);
  assert.equal(s.count, 2);                         // the first two overlap: 1000-4000
  near(s.coveredS, 4, 1e-12, "covered"); near(s.fraction, 0.4, 1e-12, "fraction");
  near(s.longestGapS, 3, 1e-12, "longest gap");     // 4000-7000
  near(s.meanGapS, 3, 1e-12, "mean gap"); near(s.meanRevisitS, 6, 1e-12, "revisit 1000 -> 7000");
  near(s.meanWindowS, 2, 1e-12, "mean window");
  const none = S.stats([], 0, 5000);
  assert.equal(none.count, 0); near(none.longestGapS, 5, 1e-12, "all gap"); assert.ok(Number.isNaN(none.meanRevisitS));
  // Windows past the period's ends are clipped.
  near(S.stats([{ startMs: -500, endMs: 500 }], 0, 1000).coveredS, 0.5, 1e-12, "clipped");
});

test("windows from a made-up orbit, found with satellite-passes.js", () => {
  const rate = Math.sqrt(398600.4418 / 6871 ** 3) - 7.2921159e-5;   // rad/s
  const look = (ms) => {
    let lam = (rate * ms / 1000) % (2 * Math.PI);
    if (lam < 0) lam += 2 * Math.PI;
    lam = Math.min(lam, 2 * Math.PI - lam);
    return { elDeg: S.elevationAt(500, lam / D2R), azDeg: 90 };
  };
  const from = -3000e3, to = from + 3 * 6067.268e3;
  const passes = P.findPasses(look, from, to, { stepS: 30, maskDeg: 10, tolS: 0.001 });
  assert.equal(passes.length, 3);
  passes.forEach((p) => near(p.durationS, 473.804, 0.01, "window length"));
  near(passes[1].riseMs / 1000, 6067.268 - 236.902, 0.01, "second rise");
  const s = S.stats(passes.map((p) => ({ startMs: p.riseMs, endMs: p.setMs })), from, to);
  near(s.coveredS, 1421.41, 0.03, "covered"); near(s.fraction, 0.07809, 1e-5, "fraction");
  near(s.longestGapS, 5593.464, 0.02, "longest gap"); near(s.meanRevisitS, 6067.268, 0.01, "revisit");
});

test("bad input", () => {
  assert.throws(() => S.geometry(0, 10));
  assert.throws(() => S.geometry(500, 90));
  assert.throws(() => S.geometry(500, -1));
  assert.throws(() => S.geometry(NaN, 10));
  assert.throws(() => S.elevationAt(-1, 10));
  assert.throws(() => S.circle(95, 0, 10));
  assert.throws(() => S.circle(0, 0, 0));
  assert.throws(() => S.stats([], 10, 10));
  assert.throws(() => S.stats([{ startMs: 5, endMs: 1 }], 0, 10));
});

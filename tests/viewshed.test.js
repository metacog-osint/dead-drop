// Viewshed line of sight. References: effective Earth radius k R with k = 4/3 (ITU-R P.453 / P.834 standard
// atmosphere, used for path profiles in ITU-R P.452 and P.526); great-circle geometry from Chris Veness,
// "Calculate distance, bearing and more between latitude/longitude points" (movable-type.co.uk), R = 6,371 km.
// Synthetic terrain, worked by hand:
//   k R = 4/3 * 6,371,000 = 8,494,666.7 m, so 2 k R = 16,989,333 m.
//   Smooth sea-level Earth, eye 2 m: horizon = sqrt(2 k R * 2) = sqrt(33,978,667) = 5,829.1 m (the rule of thumb
//   4.12 sqrt(2) km = 5.83 km). Eye 2 m and target 10 m: 5,829.1 + sqrt(169,893,333) = 5,829.1 + 13,034.3 = 18,863.4 m.
//   Ridge: ground 100 m everywhere except 110 m at 5 km; eye 2 m, target 2 m above ground at 10 km.
//     No curvature: sight line at 5 km is 102 m, clearance 102 - 110 = -8 m. The target must clear the ridge: slope
//     (110 - 102) / 5000 = 0.0016, so the sight line must reach 102 + 16 = 118 m at 10 km: 18 m above ground, 16 m more.
//     k = 4/3: drop at 5 km = 25e6 / 16,989,333 = 1.4715 m, at 10 km 1e8 / 16,989,333 = 5.8860 m. Ridge 108.5285, target 96.1140,
//     sight line at 5 km (102 + 96.1140) / 2 = 99.0570, clearance -9.4715 m (= -8 - the mid-path bulge 1.4715).
//     Slope (108.5285 - 102) / 5000 = 0.0013057, needed top 115.0570, extra 115.0570 - 96.1140 = 18.943 m.
//   One degree of latitude along a meridian: 6,371,000 * pi / 180 = 111,194.9 m.
const test = require("node:test");
const assert = require("node:assert/strict");
const V = require("../site/lib/viewshed.js");

const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);
const flat = (D, n, h) => ({ distM: Array.from({ length: n + 1 }, (_, i) => D * i / n), groundM: Array(n + 1).fill(h || 0) });

test("viewshed: horizon distances, 4/3 Earth", () => {
  near(V.horizonM(2), 5829.1, 0.2, "2 m eye");
  near(V.horizonM(2) + V.horizonM(10), 18863.4, 0.3, "2 m to 10 m");
  near(V.horizonM(2, 1), Math.sqrt(2 * 6371000 * 2 + 4), 1e-6, "geometric");
  near(V.dropM(10000, 4 / 3), 5.8860, 1e-4, "drop at 10 km");
  near(V.dropM(10000, 1), 7.848, 0.001, "geometric drop at 10 km");
});

test("viewshed: smooth Earth, line of sight ends at the horizon", () => {
  assert.equal(V.lineOfSight(flat(5700, 100), 2, 0).visible, true, "5.7 km");
  assert.equal(V.lineOfSight(flat(6000, 100), 2, 0).visible, false, "6.0 km");
  assert.equal(V.lineOfSight(flat(18500, 200), 2, 10).visible, true, "18.5 km");
  assert.equal(V.lineOfSight(flat(19300, 200), 2, 10).visible, false, "19.3 km");
  // With no refraction (k = 1) the geometric horizon for 2 m is 5,048 m, so 5.7 km is hidden.
  assert.equal(V.lineOfSight(flat(5700, 100), 2, 0, { k: 1 }).visible, false, "k = 1");
  assert.equal(V.lineOfSight(flat(50000, 100), 2, 0, { k: Infinity }).visible, true, "flat Earth");
});

test("viewshed: synthetic ridge", () => {
  const p = flat(10000, 10, 100);
  p.groundM[5] = 110;
  const a = V.lineOfSight(p, 2, 2, { k: Infinity });
  assert.equal(a.visible, false);
  near(a.minClearanceM, -8, 1e-9, "clearance, no curvature");
  near(a.extraTargetHeightM, 16, 1e-9, "extra height, no curvature");
  assert.equal(a.obstructionAtM, 5000);
  near(a.lookAngleDeg, 0, 1e-12, "level look");
  const b = V.lineOfSight(p, 2, 2);
  near(b.minClearanceM, -9.4715, 1e-3, "clearance, 4/3 Earth");
  near(b.extraTargetHeightM, 18.943, 1e-3, "extra height, 4/3 Earth");
  // Raise the target by exactly that and it just clears.
  const c = V.lineOfSight(p, 2, 2 + 18.943 + 0.001);
  assert.equal(c.visible, true);
  near(c.minClearanceM, 0, 0.01, "grazing");
  // A higher observer sees over: eye at 100 + 30 m.
  assert.equal(V.lineOfSight(p, 30, 2).visible, true);
});

test("viewshed: great-circle profile points", () => {
  near(V.distanceM({ lat: 0, lon: 0 }, { lat: 1, lon: 0 }), 111194.9, 0.1, "1 deg of latitude");
  const pts = V.profilePoints({ lat: 0, lon: 0 }, { lat: 0, lon: 10 }, 4);
  assert.equal(pts.length, 5);
  near(pts[2].lat, 0, 1e-9, "midpoint lat");
  near(pts[2].lon, 5, 1e-9, "midpoint lon");
  near(pts[4].distM, 10 * 111194.9, 1, "end distance");
  near(V.bearingDeg({ lat: 0, lon: 0 }, { lat: 0, lon: 10 }), 90, 1e-9, "due east");
  near(V.bearingDeg({ lat: 10, lon: 0 }, { lat: 0, lon: 0 }), 180, 1e-9, "due south");
});

test("viewshed: rejects bad input and bad service replies", () => {
  assert.throws(() => V.lineOfSight({ distM: [0, 1], groundM: [0] }, 2, 2));
  assert.throws(() => V.lineOfSight({ distM: [0, 2, 1], groundM: [0, 0, 0] }, 2, 2));
  assert.throws(() => V.lineOfSight({ distM: [5, 6], groundM: [0, 0] }, 2, 2));
  assert.throws(() => V.lineOfSight(flat(100, 2), -1, 2));
  assert.throws(() => V.lineOfSight(flat(100, 2), 2, 2, { k: 0 }));
  assert.throws(() => V.profilePoints({ lat: 95, lon: 0 }, { lat: 0, lon: 0 }, 10));
  assert.throws(() => V.profilePoints({ lat: 0, lon: 0 }, { lat: 0, lon: 1 }, 1));
  assert.deepEqual(V.parseElevations({ results: [{ elevation: 12 }, { elevation: 0 }] }, 2), [12, 0]);
  assert.throws(() => V.parseElevations({}, 2), /no results/);
  assert.throws(() => V.parseElevations({ results: [{ elevation: 1 }] }, 2), /1 heights for 2/);
  assert.throws(() => V.parseElevations({ results: [{ elevation: null }, { elevation: -32768 }] }, 2), /point 1/);
});

// Satellite Pass Predictor. Reference: the root-bracketing search for rise and set (Vallado, Fundamentals of
// Astrodynamics and Applications, 4th ed., section 11.4; Montenbruck & Pfleger, Astronomy on the Personal Computer,
// section 3.3), tested on made-up orbits whose answers are known in closed form.
// Worked examples, by hand:
// 1. Elevation el(t) = 40 sin(2 pi t / 6000 s) - 20 deg. It is above 0 while sin > 0.5, i.e. from t = 500 s to
//    t = 2500 s in each 6000 s cycle, peaking at t = 1500 s at 20 deg. With a 10 deg mask it must exceed
//    sin = 0.75: asin(0.75) = 0.848062 rad, t = 0.848062 / (2 pi) * 6000 = 809.84 s, set at 3000 - 809.84 = 2190.16 s.
// 2. A circular equatorial orbit 500 km up (r = 6878.137 km) over an observer on the equator. The satellite is on the
//    horizon when the Earth-central angle to it is acos(R / r) = acos(6378.137 / 6878.137) = 21.9813 deg. It moves
//    at n = sqrt(mu / r^3) = 1.106783e-3 rad/s against the Earth turning at 7.292116e-5 rad/s, so the half pass is
//    0.383646 rad / (1.106783e-3 - 7.29212e-5) = 371.08 s and the pass lasts 742.16 s, peaking at 90 deg.
//    The synthetic propagator puts the satellite over 0 N 0 E at J2000.0 (Greenwich at right ascension
//    280.46061837 deg) and is run through the real look-angle code (satellite-visibility.js).
const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../site/lib/satellite-passes.js");
const V = require("../site/lib/satellite-visibility.js");

const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);
const D2R = Math.PI / 180;
const sine = (t) => ({ elDeg: 40 * Math.sin(2 * Math.PI * (t / 1000) / 6000) - 20, azDeg: (t / 1000 / 10) % 360 });

test("passes: synthetic sine elevation, horizon mask 0", () => {
  const ps = P.findPasses(sine, 0, 12000 * 1000, { stepS: 30 });
  assert.equal(ps.length, 2);
  near(ps[0].riseMs / 1000, 500, 0.5, "rise 1");
  near(ps[0].setMs / 1000, 2500, 0.5, "set 1");
  near(ps[0].peakMs / 1000, 1500, 1, "peak time 1");
  near(ps[0].peakElDeg, 20, 1e-4, "peak el 1");
  near(ps[0].durationS, 2000, 1, "duration");
  near(ps[0].riseAzDeg, 50, 0.1, "rise az");
  near(ps[1].riseMs / 1000, 6500, 0.5, "rise 2");
  assert.equal(ps[0].startsInProgress, false);
  assert.equal(ps[0].endsInProgress, false);
});

test("passes: mask and minimum peak", () => {
  const ps = P.findPasses(sine, 0, 6000 * 1000, { stepS: 60, maskDeg: 10 });
  assert.equal(ps.length, 1);
  near(ps[0].riseMs / 1000, 809.84, 0.5, "rise above 10");
  near(ps[0].setMs / 1000, 2190.16, 0.5, "set below 10");
  assert.equal(P.findPasses(sine, 0, 12000 * 1000, { minPeakDeg: 25 }).length, 0);
  assert.equal(P.findPasses(sine, 0, 12000 * 1000, { minPeakDeg: 19 }).length, 2);
});

test("passes: a pass already up at the start, or still up at the end", () => {
  const ps = P.findPasses(sine, 1000 * 1000, 2000 * 1000, { stepS: 30 });
  assert.equal(ps.length, 1);
  assert.equal(ps[0].startsInProgress, true);
  assert.equal(ps[0].endsInProgress, true);
  assert.equal(ps[0].riseMs, 1000 * 1000);
  assert.equal(ps[0].setMs, 2000 * 1000);
  near(ps[0].peakMs / 1000, 1500, 1, "peak inside window");
});

test("passes: a propagator failure ends the pass and is skipped", () => {
  const broken = (t) => (t > 1800 * 1000 && t < 4000 * 1000 ? null : sine(t));
  const ps = P.findPasses(broken, 0, 12000 * 1000, { stepS: 30 });
  assert.equal(ps.length, 2);
  assert.equal(ps[0].endsInProgress, true);
  near(ps[1].riseMs / 1000, 6500, 0.5, "next pass found");
});

test("passes: circular equatorial orbit through the real look-angle code", () => {
  const mu = 398600.4418, r = 6878.137, n = Math.sqrt(mu / (r * r * r));
  const t0 = Date.UTC(2000, 0, 1, 12);
  const th0 = 280.46061837 * D2R;
  const prop = (ms) => {
    const u = th0 + n * (ms - t0) / 1000;
    return { position: { x: r * Math.cos(u), y: r * Math.sin(u), z: 0 },
      velocity: { x: -r * n * Math.sin(u), y: r * n * Math.cos(u), z: 0 } };
  };
  const obs = { latDeg: 0, lonDeg: 0, hKm: 0 };
  const look = (ms) => V.observe(prop, ms, obs);
  const ps = P.findPasses(look, t0 - 1500 * 1000, t0 + 1500 * 1000, { stepS: 30 });
  assert.equal(ps.length, 1);
  near((ps[0].riseMs - t0) / 1000, -371.08, 1, "rise");
  near((ps[0].setMs - t0) / 1000, 371.08, 1, "set");
  near(ps[0].durationS, 742.16, 1.5, "duration");
  near(ps[0].peakElDeg, 90, 0.05, "peak elevation");
  near((ps[0].peakMs - t0) / 1000, 0, 1, "peak time");
  near(ps[0].riseAzDeg, 270, 0.01, "rises in the west (prograde, eastward)");
  near(ps[0].setAzDeg, 90, 0.01, "sets in the east");
});

test("passes: samples and the visible part of a pass", () => {
  const look = (t) => Object.assign(sine(t), { visible: t >= 1000 * 1000 && t <= 1200 * 1000 });
  const pass = P.findPasses(look, 0, 6000 * 1000)[0];
  const s = P.samplePass(look, pass, 60);
  assert.ok(s.length >= 33 && s.length <= 35);
  near(s[s.length - 1].elDeg, 0, 0.01, "last sample at set");
  const w = P.visibleWindow(look, { riseMs: 500 * 1000, setMs: 2500 * 1000 }, 100);
  assert.equal(w.firstMs, 1000 * 1000);
  assert.equal(w.lastMs, 1200 * 1000);
  assert.equal(P.visibleWindow(sine, pass, 60), null);
});

test("passes: rejects bad input", () => {
  assert.throws(() => P.findPasses(null, 0, 1000));
  assert.throws(() => P.findPasses(sine, 1000, 0));
  assert.throws(() => P.findPasses(sine, 0, NaN));
  assert.equal(P.findPasses(() => null, 0, 6000 * 1000).length, 0);
});

// Launch Window Calculator. References: Meeus, Astronomical Algorithms, 2nd ed., chapter 12 (eq. 12.4) for Greenwich
// mean sidereal time; Vallado, Fundamentals of Astrodynamics and Applications, 4th ed., launch windows
// (LST = RAAN + delta-lambda for the north-going pass, RAAN + 180 - delta-lambda for the south-going pass,
// sin(delta-lambda) = tan(lat) / tan(i)); Curtis, Orbital Mechanics for Engineering Students, section 4.7, for the
// J2 nodal regression dRAAN/dt = -1.5 n J2 (R/a)^2 cos i.
// Worked examples:
//   Meeus example 12.a: 1987 April 10, 0h UT -> GMST 13h10m46.3668s = 197.693195 deg.
//   Meeus example 12.b: 1987 April 10, 19h21m00s UT -> GMST 8h34m57.0896s = 128.7378734 deg.
//   So a site at lat 0, lon 0 (delta-lambda 0 north-going, 180 south-going) under an orbit with RAAN 197.693195 deg
//   (no drift) has a north-going window at 1987-04-10 00:00:00 UT and a south-going one 180 / 360.98564736629 days
//   later, 11h58m02.05s; with RAAN 128.7378734 the north-going window is at 19:21:00 UT.
//   Cape Canaveral, lat 28.5 deg, i = 51.6 deg: sin(dl) = tan 28.5 / tan 51.6 = 0.542956 / 1.261686 = 0.430341
//   -> dl = 25.4892 deg. North-to-south gap = (180 - 2 dl) / 360.98564736629 days = 30,880.6 s; the two gaps sum to a
//   sidereal day, 86,164.09 s.
//   ISS-like drift, 420 km, 51.64 deg: n = sqrt(mu / a^3) = 1.12638e-3 rad/s, a = 6798.137 km,
//   dRAAN/dt = -1.5 * 1.12638e-3 * 1.08262668e-3 * (6378.137 / 6798.137)^2 * cos 51.64 deg = -4.9466 deg/day;
//   same-pass windows then repeat every 360 / (360.98565 + 4.94664) days = 84,999.3 s (23 h 36 min 39 s).
//   Sun-synchronous orbit from Vandenberg (lat 34.632, lon -120.611), i = 97.8 deg, ascending node at 22:30 local mean
//   time: dl = asin(tan 34.632 / tan 97.8) = -5.4289 deg. The north-going window is at local mean time
//   22.5 + dl/15 = 22.13807 h, UT = LMT - lon/15 = 06:10:43.7; the south-going one at 22.5 + 12 + (-dl)/15 = 10.86193 h
//   (mod 24), UT 18:54:09.6. The same times every day.
//   Reference value for the J2 rate: a sun-synchronous orbit at 700 km has i = 98.19 deg (Wertz & Larson, SMAD 3rd ed.,
//   chapter 6, sun-synchronous orbits), where the node must advance 360 / 365.2422 = 0.98565 deg/day.
const test = require("node:test");
const assert = require("node:assert/strict");
const W = require("../site/lib/launch-window.js");

const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);
const utc = (s) => new Date(s);
const secs = (d) => d.getTime() / 1000;

test("sidereal time: Meeus examples 12.a and 12.b", () => {
  near(W.gmstDeg(utc("1987-04-10T00:00:00Z")), 197.693195, 1e-5, "12.a");
  near(W.gmstDeg(utc("1987-04-10T19:21:00Z")), 128.7378734, 1e-5, "12.b");
  near(W.julianDate(utc("2000-01-01T12:00:00Z")), 2451545.0, 1e-9, "J2000 epoch");
  near(W.meanSunRaDeg(utc("2000-01-01T12:00:00Z")), 280.46061837, 1e-6, "mean sun at J2000 noon");
  near(W.SIDEREAL_RATE, 360.98564736629, 0, "sidereal rate");
  // A sidereal day: GMST returns to the same value after 360 / 360.98564736629 days = 86164.0905 s.
  const t0 = utc("2026-01-01T00:00:00Z");
  near(W.gmstDeg(new Date(t0.getTime() + 86164090.5)), W.gmstDeg(t0), 1e-5, "sidereal day");
});

test("windows: equator site under Meeus's sidereal times", () => {
  const base = { latDeg: 0, lonDeg: 0, incDeg: 51.6, altKm: 400, days: 1, mode: "raan", raanEpoch: utc("1987-04-10T00:00:00Z"), useJ2: false };
  let r = W.windows({ ...base, raanDeg: 197.693195, start: utc("1987-04-10T00:00:00Z") });
  assert.equal(r.windows[0].pass, "north");
  near(secs(r.windows[0].time), secs(utc("1987-04-10T00:00:00Z")), 0.1, "north-going at 0h");
  const south = r.windows.find((w) => w.pass === "south");
  near(secs(south.time) - secs(utc("1987-04-10T00:00:00Z")), 11 * 3600 + 58 * 60 + 2.05, 0.1, "south-going 11h58m02s later");
  r = W.windows({ ...base, raanDeg: 128.7378734, start: utc("1987-04-10T00:00:00Z") });
  const north = r.windows.find((w) => w.pass === "north");
  near(secs(north.time), secs(utc("1987-04-10T19:21:00Z")), 0.1, "north-going at 19:21:00");
});

test("windows: twice a day from Cape Canaveral, gaps sum to a sidereal day", () => {
  const g = W.planeGeometry(28.5, 51.6);
  near(g.north.deltaLambdaDeg, 25.4892, 1e-4, "delta-lambda");
  near(g.south.deltaLambdaDeg, 180 - 25.4892, 1e-4, "south-going delta-lambda");
  assert.equal(g.single, false);
  const r = W.windows({ latDeg: 28.5, lonDeg: -80.6, incDeg: 51.6, altKm: 400, start: utc("2026-12-01T00:00:00Z"),
    days: 10, mode: "raan", raanDeg: 100, raanEpoch: utc("2026-12-01T00:00:00Z"), useJ2: false });
  assert.ok(r.windows.length >= 20 && r.windows.length <= 22, `count ${r.windows.length}`);
  for (let k = 1; k < r.windows.length; k++) assert.notEqual(r.windows[k].pass, r.windows[k - 1].pass, "passes alternate");
  const i = r.windows.findIndex((w) => w.pass === "north");
  const gap1 = secs(r.windows[i + 1].time) - secs(r.windows[i].time);
  const gap2 = secs(r.windows[i + 2].time) - secs(r.windows[i + 1].time);
  near(gap1, 30880.6, 1, "north to south");
  near(gap1 + gap2, 86164.09, 1, "sidereal day");
});

test("windows: J2 drift shortens the repeat to 84,999 s for an ISS-like orbit", () => {
  near(W.nodalRateDegPerDay(420, 51.64), -4.9466, 1e-3, "ISS nodal rate");
  near(W.nodalRateDegPerDay(700, 98.19), 360 / 365.2422, 0.003, "sun-synchronous at 700 km");
  const r = W.windows({ latDeg: 28.5, lonDeg: -80.6, incDeg: 51.64, altKm: 420, start: utc("2026-12-01T00:00:00Z"),
    days: 3, mode: "raan", raanDeg: 200, raanEpoch: utc("2026-11-30T00:00:00Z"), useJ2: true });
  const n = r.windows.filter((w) => w.pass === "north");
  near(secs(n[1].time) - secs(n[0].time), 84999.3, 1, "repeat with drift");
});

test("windows: sun-synchronous by node time, same local time every day", () => {
  const r = W.windows({ latDeg: 34.632, lonDeg: -120.611, incDeg: 97.8, altKm: 600, start: utc("2026-12-01T00:00:00Z"),
    days: 2, mode: "ltan", ltanHours: 22.5 });
  const n = r.windows.filter((w) => w.pass === "north"), s = r.windows.filter((w) => w.pass === "south");
  assert.equal(n.length, 2); assert.equal(s.length, 2);
  near(secs(n[0].time), secs(utc("2026-12-01T06:10:43.7Z")), 1, "north-going UT");
  near(secs(s[0].time), secs(utc("2026-12-01T18:54:09.6Z")), 1, "south-going UT");
  near(secs(n[1].time) - secs(n[0].time), 86400, 1, "one solar day apart");
  near(s[0].azimuthDeg, 180 - Math.asin(Math.cos(97.8 * Math.PI / 180) / Math.cos(34.632 * Math.PI / 180)) * 180 / Math.PI, 1e-9, "south azimuth");
});

test("windows: one window a day when the inclination equals the latitude; none when below", () => {
  const g = W.planeGeometry(28.5, 28.5);
  assert.equal(g.single, true);
  near(g.north.deltaLambdaDeg, 90, 1e-6, "site at the orbit's northernmost point");
  const r = W.windows({ latDeg: 28.5, lonDeg: 0, incDeg: 28.5, altKm: 400, start: utc("2026-12-01T00:00:00Z"),
    days: 1, mode: "raan", raanDeg: 0, raanEpoch: utc("2026-12-01T00:00:00Z"), useJ2: false });
  assert.ok(r.windows.length >= 1 && r.windows.length <= 2);
  assert.throws(() => W.planeGeometry(28.5, 20), /never passes over/);
  assert.throws(() => W.planeGeometry(0, 0), /every moment/);
});

test("windows: bad input is refused", () => {
  const ok = { latDeg: 28.5, lonDeg: -80.6, incDeg: 51.6, altKm: 400, start: utc("2026-12-01T00:00:00Z"), days: 1,
    mode: "raan", raanDeg: 10, raanEpoch: utc("2026-12-01T00:00:00Z") };
  assert.doesNotThrow(() => W.windows(ok));
  assert.throws(() => W.windows({ ...ok, start: new Date("nonsense") }));
  assert.throws(() => W.windows({ ...ok, days: 0 }));
  assert.throws(() => W.windows({ ...ok, days: 400 }));
  assert.throws(() => W.windows({ ...ok, raanDeg: NaN }));
  assert.throws(() => W.windows({ ...ok, mode: "ltan", ltanHours: 25 }));
  assert.throws(() => W.windows({ ...ok, latDeg: 95 }));
  assert.throws(() => W.windows({ ...ok, altKm: 10 }));
});

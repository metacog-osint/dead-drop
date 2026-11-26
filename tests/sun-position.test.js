// Sun position. Reference: Meeus, Astronomical Algorithms, 2nd ed., chapter 25 (low-accuracy solar coordinates),
// the method of the NOAA Solar Calculator. Worked example, Meeus Example 25.a, 1992 October 13.0 TD (JDE 2448908.5):
//   T = -0.072183436, L0 = 201.80720 deg, M = 278.99397 deg, e = 0.016711668, C = -1.89732 deg,
//   true longitude = 199.90988 deg, R = 0.99766 AU, omega = 264.65 deg, apparent longitude = 199.90895 deg,
//   eps0 = 23 deg 26' 24.83" = 23.44023 deg, eps = 23.43999 deg,
//   apparent RA = -161.61917 deg = 198.38083 deg (13h 13m 31.4s), apparent declination = -7.78507 deg (-7 deg 47' 06").
// Meeus Example 28.b, same date, equation of time by eq. 28.3: E = +0.059825 rad = 13.71 min (13 m 42.7 s).
// Hand calculations (sunrise geometry, Meeus eq. 15.1 with h0 = -0.8333 deg; cos H0 = (sin h0 - sin lat sin dec) /
// (cos lat cos dec)); day length = 2 H0 / 15 hours:
//   lat 0, dec 0 (March equinox):        cos H0 = sin(-0.8333) = -0.014538, H0 = 90.833 deg, day = 12 h 06.7 min.
//   lat 45 N, dec 23.436 (June solstice): cos H0 = (-0.014538 - 0.70711 * 0.39770) / (0.70711 * 0.91752) = -0.45590,
//                                         H0 = 117.123 deg, day = 15 h 37.0 min.
//   lat 80 N, June solstice: tan 80 * tan 23.44 = 2.46 > 1, so the Sun never sets; Dec solstice: never rises.
// Equinox and solstice instants 2026 (US Naval Observatory): March equinox 20 Mar 14:46 UTC (declination 0),
// June solstice 21 Jun 08:24 UTC. At the solstice the declination equals the true obliquity: eq. 22.2 at
// T = 0.2647 gives eps0 = 23 deg 26' 21.448" - 46.815" * 0.2647 = 23 deg 26' 09.06" = 23.4359 deg; nutation in
// obliquity, 9.2" cos(omega) with omega = 125.04 - 1934.136 T = 333.1 deg, adds 8.2" = 0.0023 deg: 23.4381 deg.
// Refraction at geometric elevation 0: NOAA's formula gives 1735" = 28.9'; Saemundsson's (Meeus eq. 16.4),
// 1.02 / tan(0 + 10.3 / 5.11) = 28.98', agrees within 0.1'.
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../site/lib/sun-position.js");

const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);
const jdToMs = (jd) => (jd - 2440587.5) * 86400000;
const Z = (s) => Date.parse(s);

test("sun: Meeus Example 25.a, 1992 Oct 13.0", () => {
  const c = S.solarCoords(2448908.5);
  near(c.T, -0.072183436, 1e-9, "T");
  near(c.L0, 201.80720, 1e-5, "L0");
  near(c.M, 278.99397, 1e-5, "M");
  near(c.e, 0.016711668, 1e-9, "e");
  near(c.C, -1.89732, 1e-5, "C");
  near(c.trueLong, 199.90988, 1e-5, "true longitude");
  near(c.R, 0.99766, 1e-5, "R");
  near(c.omega, 264.65, 0.01, "omega");
  near(c.lambda, 199.90895, 1e-5, "apparent longitude");
  near(c.eps0, 23.44023, 1e-5, "eps0");
  near(c.eps, 23.43999, 1e-5, "eps");
  near(c.ra, 198.38083, 1e-4, "RA");
  near(c.decl, -7.78507, 1e-4, "declination");
  near(c.eqTimeMin, 13.71, 0.01, "equation of time");
  near(S.julianDay(jdToMs(2448908.5)), 2448908.5, 1e-9, "JD round trip");
  near(S.julianDay(0), 2440587.5, 0, "Unix epoch");
});

test("sun: equinox and solstice declinations, 2026", () => {
  near(S.position(Z("2026-03-20T14:46:00Z"), 0, 0).declination, 0, 0.01, "March equinox");
  near(S.position(Z("2026-06-21T08:24:00Z"), 0, 0).declination, 23.4381, 0.001, "June solstice");
  near(S.position(Z("2026-06-21T08:24:00Z"), 0, 0).subsolarLat, 23.4381, 0.001, "subsolar latitude");
});

test("sun: day lengths from the sunrise geometry", () => {
  const eq = S.events(Z("2026-03-20T12:00:00Z"), 0, 0);
  near(eq.dayLengthMin, 726.7, 1.0, "equator at equinox");
  const sol = S.events(Z("2026-06-21T12:00:00Z"), 45, 0);
  near(sol.dayLengthMin, 937.0, 1.0, "45 N at June solstice");
  // Sunrise and sunset straddle solar noon, which is 12:00 minus the equation of time (-1.7 min on 21 June).
  near((sol.sunrise.start + sol.sunrise.end) / 2, sol.solarNoon, 60000, "noon midway");
  near(sol.solarNoon, Z("2026-06-21T12:01:42Z"), 30000, "solar noon at Greenwich");
  // Noon elevation at 45 N on the solstice: 90 - 45 + 23.438 = 68.438 deg, plus about 0.006 deg of refraction.
  near(sol.noonElevation, 68.44, 0.01, "noon elevation");
  near(sol.noonAzimuth, 180, 0.5, "noon azimuth due south");
  assert.ok(sol.civil.start < sol.sunrise.start && sol.nautical.start < sol.civil.start && sol.astronomical.start < sol.nautical.start);
  assert.equal(S.hoursMinutes(937.0), "15 h 37 min");
  assert.equal(S.hoursMinutes(59.6), "1 h 0 min");
});

test("sun: polar day and polar night", () => {
  const mid = S.events(Z("2026-06-21T12:00:00Z"), 80, 15);
  assert.equal(mid.sunrise.never, "above");
  assert.equal(mid.dayLengthMin, 1440);
  const dark = S.events(Z("2026-12-21T12:00:00Z"), 80, 15);
  assert.equal(dark.sunrise.never, "below");
  assert.equal(dark.dayLengthMin, 0);
  // The Sun's lowest geometric elevation at midnight is -(90 - lat - dec). At 45 N in June that is
  // -(90 - 45 - 23.44) = -21.56 deg, below -18, so astronomical twilight ends. At 50 N it is -16.56 deg, never
  // reaching -18: astronomical twilight lasts all night.
  assert.equal(S.events(Z("2026-06-21T12:00:00Z"), 50, 0).astronomical.never, "above");
  assert.ok(S.events(Z("2026-06-21T12:00:00Z"), 45, 0).astronomical.start !== null);
});

test("sun: refraction, azimuth convention and phases", () => {
  near(S.refraction(0) * 3600, 1735, 1e-9, "NOAA at 0");
  near(S.refraction(0) * 60, 28.98, 0.1, "Saemundsson at 0");
  assert.equal(S.refraction(89), 0);
  // At Greenwich at 06:00 UTC on the March equinox the Sun is rising due east; at 18:00 setting due west.
  near(S.position(Z("2026-03-20T06:07:30Z"), 0, 0).azimuth, 90, 0.5, "rising in the east");
  near(S.position(Z("2026-03-20T18:07:30Z"), 0, 0).azimuth, 270, 0.5, "setting in the west");
  assert.equal(S.compass(359), "N");
  assert.equal(S.compass(202.5), "SSW");
  assert.deepEqual([0, -3, -9, -15, -30].map(S.phase), ["day", "civil twilight", "nautical twilight", "astronomical twilight", "night"]);
  assert.equal(S.track(Z("2026-06-21T12:00:00Z"), 45, 0).length, 24);
});

test("sun: rejects bad input", () => {
  assert.throws(() => S.position(Date.now(), 91, 0));
  assert.throws(() => S.position(Date.now(), 0, 181));
  assert.throws(() => S.position(NaN, 0, 0));
  assert.throws(() => S.events(Date.now(), "a", 0));
});

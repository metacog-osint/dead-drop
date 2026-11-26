// Shadow chronolocation. Method: shadow length L of a vertical object of height h on level ground gives the Sun's
// apparent elevation e = atan(h / L); the shadow points away from the Sun (Sun azimuth = shadow azimuth + 180).
// Worked practice: Bellingcat's chronolocation guides. Sun: NOAA Solar Calculator spreadsheet formulas (Meeus ch. 25),
// worked by hand below: T = (JD - 2451545) / 36525; L0, M, e, C, apparent longitude, obliquity, declination
// dec = asin(sin eps sin lambda), equation of time E (eq. 28.3, minutes); refraction (NOAA, e > 5 deg)
// 58.1"/tan e - 0.07"/tan^3 e + 0.000086"/tan^5 e; hour angle from cos H = (sin e_geo - sin lat sin dec) /
// (cos lat cos dec); time (minutes UTC) = 720 - 4 lon - E -+ 4 H (morning minus, afternoon plus), iterated once on
// dec and E at the time found.
// Case 1: lat 0, lon 0, 2026-03-20 (JD 2461119.5 at 0h UTC), h = L, so e = 45 deg apparent.
//   Refraction at geometric 44.98387 deg: tan = 0.999437, 58.133" - 0.070" = 58.06" = 0.01613 deg, so
//   e_geo = 44.98387 deg, sin e_geo = 0.706909.
//   Morning, at 09:07 UTC (T = 0.2621459): dec = -0.09068 deg, E = -7.4685 min; cos H = 0.706909 / cos(dec) =
//     0.706909, H = 45.01606 deg; t = 720 + 7.4685 - 180.0642 = 547.4043 min = 09:07:24.3 UTC.
//   Afternoon, at 15:07 UTC: dec = +0.00816 deg, E = -7.3944 min, H = 45.01613 deg;
//     t = 720 + 7.3944 + 180.0645 = 907.4589 min = 15:07:27.5 UTC.
//   Solar noon: E = -7.4315 min, t = 727.4315 min = 12:07:25.9 UTC, midway between the two (within 2 s).
//   Sensitivity: on the equator with dec near 0, e = 90 - |H|, and H runs at 360 deg per day = 0.25 deg/min; the
//     refraction slope there, d(R)/de = -(2 * 58.1 - 6 * 0.07)" per radian = -0.00056, barely changes that:
//     0.25 * 0.99944 = 0.24986 deg/min, so 4.002 minutes per degree of elevation.
//   5 % ratio error: atan(1.05) = 46.39718 deg, atan(0.95) = 43.53120 deg: +1.39718 and -1.46880 deg, at
//     4.002 min/deg about +5.59 and -5.88 minutes on the morning side (a shorter shadow means a higher Sun, later in
//     the morning, earlier in the afternoon).
// Case 2: lat 40 N, lon 0, 2026-06-21 (JD 2461212.5), h = L.
//   Morning: dec = 23.43813, E = -1.7943 min, cos H = (0.706909 - 0.642788 * 0.397760) / (0.766044 * 0.917493) =
//     0.642016, H = 50.05768 deg, t = 720 + 1.7943 - 200.2307 = 521.5636 min = 08:41:33.8 UTC;
//     Sun azimuth (NOAA: atan2(sin H, cos H sin lat - tan dec cos lat) + 180) = 96.00 deg, shadow toward 276.00 deg.
//   Afternoon: dec = 23.43784, E = -1.8548 min, H = 50.05747 deg, t = 922.0847 min = 15:22:05.1 UTC;
//     Sun azimuth 264.00 deg, shadow toward 84.00 deg.
// Case 3: lat 40 N, 2026-03-20, shadow due north (0 deg): the Sun is due south at solar noon, 12:07:25.9 UTC (E as in
//   case 1; E does not depend on latitude). Azimuth rate at transit: H cos(dec) / sin(zenith distance) =
//   0.25 deg/min / sin 40 = 0.38893 deg/min, so 2.571 minutes per degree of azimuth.
// Case 4: lat 40 N, 2026-12-21: dec = -23.4373, noon elevation 90 - 40 - 23.4373 = 26.563 deg geometric (+0.032 deg
//   refraction), so a 45 deg Sun (h = L) never happens.
// Case 5: lat 10 N, 2026-06-21, dec 23.438: the Sun passes north of the zenith, and in the morning its azimuth climbs
//   from 66.18 deg at sunrise (cos A = sin dec / cos lat = 0.39776 / 0.98481) to a greatest value at
//   sin A = cos dec / cos lat = 0.91749 / 0.98481 = 0.93164, A = 68.69 deg, then swings back through north. So a Sun
//   azimuth of 68.0 deg (shadow 248.0 deg) happens twice in the morning, and 69.0 deg (shadow 249.0 deg) never.
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../site/lib/shadow-chronolocation.js");

const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);
const at = (iso) => Date.parse(iso);
const SEC = 1000;

test("shadow: elevation from height and length, azimuth from shadow direction", () => {
  near(C.elevationFromShadow(1, 1), 45, 1e-12, "h = L");
  near(C.elevationFromShadow(Math.sqrt(3), 1), 60, 1e-12, "h = sqrt(3) L");
  near(C.shadowPerHeight(45), 1, 1e-12, "45 deg");
  near(C.sunAzimuthFromShadow(276), 96, 1e-12, "west-pointing shadow");
  near(C.sunAzimuthFromShadow(0), 180, 1e-12, "north-pointing shadow");
  near(C.sunAzimuthFromShadow(360), 180, 1e-12, "360 is north");
});

test("chronolocation: equator, March equinox, the morning and afternoon pair", () => {
  const r = C.solve({ lat: 0, lon: 0, date: "2026-03-20", heightM: 2, shadowM: 2 });
  assert.equal(r.elevationMatches.length, 2);
  const [am, pm] = r.elevationMatches;
  near(am.ms, at("2026-03-20T09:07:24.3Z"), 2 * SEC, "morning");
  near(pm.ms, at("2026-03-20T15:07:27.5Z"), 2 * SEC, "afternoon");
  assert.equal(am.rising, true); assert.equal(pm.rising, false);
  near(r.window.solarNoon, at("2026-03-20T12:07:25.9Z"), 2 * SEC, "solar noon");
  near((am.ms + pm.ms) / 2, r.window.solarNoon, 2 * SEC, "symmetric about noon");
  near(am.elevation, 45, 1e-4, "matched elevation");
  near(am.minPerDegree, 4.002, 0.005, "minutes per degree");
  near(am.ratioPlus5.shiftMin, 5.59, 0.03, "ratio +5 %, morning");
  near(am.ratioMinus5.shiftMin, -5.88, 0.03, "ratio -5 %, morning");
  near(pm.ratioPlus5.shiftMin, -5.59, 0.03, "ratio +5 %, afternoon");
  near(r.elevation5pct.high, 46.39718, 1e-5, "atan 1.05");
  near(r.elevation5pct.low, 43.53120, 1e-5, "atan 0.95");
});

test("chronolocation: 40 N, June solstice, azimuth picks one of the pair", () => {
  const both = C.solve({ lat: 40, lon: 0, date: "2026-06-21", heightM: 10, shadowM: 10 });
  const [am, pm] = both.elevationMatches;
  near(am.ms, at("2026-06-21T08:41:33.8Z"), 2 * SEC, "morning");
  near(pm.ms, at("2026-06-21T15:22:05.1Z"), 2 * SEC, "afternoon");
  near(am.azimuth, 96.00, 0.01, "morning azimuth");
  near(pm.azimuth, 264.00, 0.01, "afternoon azimuth");
  const r = C.solve({ lat: 40, lon: 0, date: "2026-06-21", heightM: 10, shadowM: 10, shadowAzimuth: 276 });
  near(r.best.ms, at("2026-06-21T08:41:33.8Z"), 2 * SEC, "best is the morning");
  near(r.best.azimuthResidual, 0, 0.01, "azimuth agrees");
  assert.equal(r.best.agrees, true);
  assert.equal(r.azimuthMatches.length, 1);
  near(r.azimuthMatches[0].ms, at("2026-06-21T08:41:33.8Z"), 10 * SEC, "azimuth alone gives the same time");
  near(r.azimuthMatches[0].elevationResidual, 0, 0.01, "and the same elevation");
  const pmOnly = C.solve({ lat: 40, lon: 0, date: "2026-06-21", heightM: 10, shadowM: 10, shadowAzimuth: 84 });
  near(pmOnly.best.ms, at("2026-06-21T15:22:05.1Z"), 2 * SEC, "best is the afternoon");
  const wrong = C.solve({ lat: 40, lon: 0, date: "2026-06-21", heightM: 10, shadowM: 10, shadowAzimuth: 180 });
  assert.equal(wrong.best.agrees, false, "a shadow pointing south at 40 N in June disagrees");
});

test("chronolocation: azimuth only, shadow due north at solar noon", () => {
  const r = C.solve({ lat: 40, lon: 0, date: "2026-03-20", shadowAzimuth: 0 });
  assert.equal(r.elevationMatches.length, 0);
  assert.equal(r.azimuthMatches.length, 1);
  near(r.azimuthMatches[0].ms, at("2026-03-20T12:07:25.9Z"), 2 * SEC, "solar noon");
  near(r.azimuthMatches[0].minPerDegree, 2.571, 0.005, "minutes per degree of azimuth");
});

test("chronolocation: no match when the Sun never gets that high", () => {
  const r = C.solve({ lat: 40, lon: 0, date: "2026-12-21", heightM: 1, shadowM: 1 });
  assert.equal(r.elevationMatches.length, 0);
  near(r.maxElevation, 26.595, 0.01, "noon elevation with refraction");
  assert.match(r.notes[0], /never climbs/);
});

test("chronolocation: tropics, the azimuth turns back", () => {
  const two = C.solve({ lat: 10, lon: 0, date: "2026-06-21", shadowAzimuth: 248 });
  assert.equal(two.azimuthMatches.length, 2, "azimuth 68.0 twice");
  two.azimuthMatches.forEach((m) => assert.ok(m.ms < two.window.solarNoon, "both in the morning"));
  const none = C.solve({ lat: 10, lon: 0, date: "2026-06-21", shadowAzimuth: 249 });
  assert.equal(none.azimuthMatches.length, 0, "azimuth 69.0 never");
});

test("chronolocation: the solar day follows the longitude", () => {
  const w = C.dayWindow("2026-06-21", 35, 139.7);
  near(w.startMs, at("2026-06-21T00:00:00Z") - 139.7 * 240000, 0, "local mean midnight");
  assert.ok(w.solarNoon > w.startMs && w.solarNoon < w.endMs);
  const r = C.solve({ lat: 35.68, lon: 139.7, date: "2026-06-21", heightM: 1, shadowM: 1 });
  assert.equal(r.elevationMatches.length, 2, "Tokyo, two times on the local day");
  // Solar noon at 139.7 E is near 02:43 UTC; a 45 deg morning Sun (H about 50 deg, 3 h 22 min earlier) falls on 20 June UTC.
  assert.ok(r.elevationMatches[0].ms < at("2026-06-21T00:00:00Z"), "morning is on the previous UTC date");
});

test("bad input", () => {
  assert.throws(() => C.elevationFromShadow(0, 1), /height/);
  assert.throws(() => C.elevationFromShadow(1, 0), /length/);
  assert.throws(() => C.sunAzimuthFromShadow(400), /0 to 360/);
  assert.throws(() => C.solve({ lat: 0, lon: 0, date: "2026-03-20" }), /Give the object/);
  assert.throws(() => C.solve({ lat: 0, lon: 0, date: "2026-02-30", heightM: 1, shadowM: 1 }), /Not a real date/);
  assert.throws(() => C.solve({ lat: 0, lon: 0, date: "20 March", heightM: 1, shadowM: 1 }), /YYYY-MM-DD/);
  assert.throws(() => C.solve({ lat: 95, lon: 0, date: "2026-03-20", heightM: 1, shadowM: 1 }), /Latitude/);
  assert.throws(() => C.solve({ lat: 0, lon: 0, date: "2026-03-20", heightM: 1 }), /length/);
});

// Launch Weather Dashboard. References: NOAA Space Weather Scales (SWPC): G1..G5 = Kp 5, 6, 7, 8 (including 9-), 9;
// S1..S5 = >=10 MeV proton flux of 10, 100, 1e3, 1e4, 1e5 pfu; R1..R5 = 0.1-0.8 nm X-ray flux of 1e-5 (M1), 5e-5 (M5),
// 1e-4 (X1), 1e-3 (X10), 2e-3 W/m^2 (X20). Flare class letters are decades from 1e-8 W/m^2 (A) up to 1e-4 (X).
// WMO code table 4677 as used by Open-Meteo (95 thunderstorm, 96 and 99 thunderstorm with hail). 1 kt = 1.852 km/h.
// Worked examples by hand:
//   Kp 4.67 is 5- (14 thirds), which NOAA counts as Kp 5: G1. Kp 8.67 is 9-: G4 (NOAA puts 9- in G4). Kp 9.00: G5.
//   Kp 3.33 is 3+: "unsettled" (no storm).
//   2.3e-5 W/m^2 / 1e-5 = 2.3, so M2.3 and R1; 1.2e-4 / 1e-4 = 1.2, so X1.2 and R3; 3.4e-7 / 1e-7 = B3.4, R0.
//   100 pfu is exactly S2; 9.99 pfu is S0.
//   SWPC time "2026-11-26 12:34:56.789" is UTC: Date.UTC(2026, 10, 26, 12, 34, 56, 789).
//   50 km/h / 1.852 = 26.998 kt.
//   Hourly series at 00:00, 01:00, 02:00 UTC: 01:29 picks 01:00 (index 1); 01:31 picks 02:00; 02:31 is outside (-1).
const test = require("node:test");
const assert = require("node:assert/strict");
const W = require("../site/lib/launch-weather.js");

const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);

test("Kp to NOAA G scale, thirds and words", () => {
  assert.equal(W.gScaleFromKp(4.33), 0);
  assert.equal(W.gScaleFromKp(4.67), 1);
  assert.equal(W.gScaleFromKp(5.33), 1);
  assert.equal(W.gScaleFromKp(5.67), 2);
  assert.equal(W.gScaleFromKp(6.67), 3);
  assert.equal(W.gScaleFromKp(7.67), 4);
  assert.equal(W.gScaleFromKp(8.67), 4, "9- is G4");
  assert.equal(W.gScaleFromKp(9), 5);
  assert.equal(W.kpText(4.67), "5-");
  assert.equal(W.kpText(5), "5");
  assert.equal(W.kpText(5.33), "5+");
  assert.equal(W.kpText(0.33), "0+");
  assert.equal(W.kpActivity(3.33), "unsettled");
  assert.equal(W.kpActivity(2), "quiet");
  assert.equal(W.kpActivity(4), "active");
  assert.equal(W.kpActivity(6), "G2 (moderate) storm");
  assert.equal(W.gScaleFromKp(NaN), null);
  assert.equal(W.kpText(12), "");
});

test("proton flux to S scale, X-ray flux to R scale and flare class", () => {
  assert.equal(W.sScaleFromProtonFlux(9.99), 0);
  assert.equal(W.sScaleFromProtonFlux(10), 1);
  assert.equal(W.sScaleFromProtonFlux(100), 2);
  assert.equal(W.sScaleFromProtonFlux(1e3), 3);
  assert.equal(W.sScaleFromProtonFlux(1e4), 4);
  assert.equal(W.sScaleFromProtonFlux(1e5), 5);
  assert.equal(W.sScaleFromProtonFlux(-1), null);
  assert.equal(W.rScaleFromXray(9.9e-6), 0);
  assert.equal(W.rScaleFromXray(1e-5), 1);
  assert.equal(W.rScaleFromXray(5e-5), 2);
  assert.equal(W.rScaleFromXray(1e-4), 3);
  assert.equal(W.rScaleFromXray(1e-3), 4);
  assert.equal(W.rScaleFromXray(2e-3), 5);
  assert.equal(W.flareClass(2.3e-5), "M2.3");
  assert.equal(W.flareClass(1.2e-4), "X1.2");
  assert.equal(W.flareClass(3.4e-7), "B3.4");
  assert.equal(W.flareClass(5e-9), "A0.5");
  assert.equal(W.flareClass(0), "");
});

test("SWPC times are UTC; products parse", () => {
  assert.equal(W.parseSwpcTime("2026-11-26 12:34:56.789"), Date.UTC(2026, 10, 26, 12, 34, 56, 789));
  assert.equal(W.parseSwpcTime("2026-11-26T03:00:00Z"), Date.UTC(2026, 10, 26, 3, 0, 0));
  assert.ok(Number.isNaN(W.parseSwpcTime("26/11/2026")));
  const kpRows = [["time_tag", "Kp", "a_running", "station_count"],
    ["2026-11-26 03:00:00.000", "5.33", "56", "8"], ["2026-11-26 00:00:00.000", "2.00", "7", "8"]];
  assert.deepEqual(W.latestKp(kpRows), { timeMs: Date.UTC(2026, 10, 26, 3), kp: 5.33 });
  assert.deepEqual(W.latestKp([{ time_tag: "2026-11-26T06:00:00", Kp: 1.67 }]), { timeMs: Date.UTC(2026, 10, 26, 6), kp: 1.67 });
  assert.equal(W.latestKp([]), null);
  const protons = [
    { time_tag: "2026-11-26T10:00:00Z", flux: 0.4, energy: ">=10 MeV" },
    { time_tag: "2026-11-26T10:05:00Z", flux: 120, energy: ">=1 MeV" },
    { time_tag: "2026-11-26T10:05:00Z", flux: 0.5, energy: ">=10 MeV" }];
  assert.deepEqual(W.latestProtons10(protons), { timeMs: Date.UTC(2026, 10, 26, 10, 5), flux: 0.5 }, "only the >=10 MeV channel");
  const xr = [{ time_tag: "2026-11-26T10:05:00Z", flux: 2.3e-5, energy: "0.1-0.8nm" },
    { time_tag: "2026-11-26T10:05:00Z", flux: 4e-6, energy: "0.05-0.4nm" }];
  assert.equal(W.latestXrayLong(xr).flux, 2.3e-5);
  const scales = W.parseScales({
    "-1": { DateStamp: "2026-11-25", G: { Scale: "1" }, S: { Scale: "0" }, R: { Scale: "2" } },
    "0": { DateStamp: "2026-11-26", G: { Scale: "0" }, S: { Scale: "0" }, R: { Scale: "0" } },
    "1": { DateStamp: "2026-11-26", G: { Scale: "2" }, S: { Scale: null, Prob: "5" }, R: { Scale: null, MinorProb: "35", MajorProb: "10" } },
    "2": { DateStamp: "2026-11-27", G: { Scale: "0" }, S: { Prob: "1" }, R: { MinorProb: "30", MajorProb: "5" } } });
  assert.deepEqual(scales.past24h, { date: "2026-11-25", G: 1, S: 0, R: 2 });
  assert.equal(scales.days.length, 2);
  assert.deepEqual(scales.days[0], { date: "2026-11-26", G: 2, sProb: 5, rMinorProb: 35, rMajorProb: 10 });
  const alerts = W.parseAlerts([
    { product_id: "K05W", issue_datetime: "2026-11-26 01:00:00.000", message: "Space Weather Message Code: WARK05\r\nSerial Number: 1\r\nWARNING: Geomagnetic K-index of 5 expected" },
    { product_id: "K04A", issue_datetime: "2026-11-26 03:00:00.000", message: "ALERT: Geomagnetic K-index of 4" }]);
  assert.equal(alerts[0].productId, "K04A", "newest first");
  assert.equal(alerts[1].title, "WARNING: Geomagnetic K-index of 5 expected");
});

test("forecast hour picking and unit conversion", () => {
  near(W.kmhToKnots(50), 26.998, 0.001, "50 km/h");
  const t0 = Date.UTC(2026, 10, 26, 0) / 1000;
  const times = [t0, t0 + 3600, t0 + 7200];
  assert.equal(W.hourIndex(times, (t0 + 3600 + 29 * 60) * 1000), 1);
  assert.equal(W.hourIndex(times, (t0 + 3600 + 31 * 60) * 1000), 2);
  assert.equal(W.hourIndex(times, (t0 + 7200 + 31 * 60) * 1000), -1);
  assert.equal(W.hourIndex([], 0), -1);
  const resp = { hourly: { time: times, wind_speed_10m: [5, 12, 31], wind_gusts_10m: [8, 18, 40], wind_direction_10m: [90, 100, 110],
    wind_speed_250hPa: [60, 80, 105], temperature_2m: [20, 21, 22], precipitation_probability: [0, 10, 70], weather_code: [1, 3, 95] } };
  const v = W.forecastAt(resp, (t0 + 7200) * 1000);
  assert.equal(v.windKt, 31);
  assert.equal(v.weatherCode, 95);
  assert.equal(W.forecastAt(resp, (t0 + 99999) * 1000), null);
  assert.equal(W.waveAt({ hourly: { time: times, wave_height: [1, 2.5, 3.2] } }, t0 * 1000), 1);
  assert.equal(W.wmoText(96), "Thunderstorm with slight hail");
  assert.equal(W.wmoText(42), "Code 42");
});

test("screening: limits, levels and categories", () => {
  const calm = { windKt: 12, upperWindKt: 60, precipProb: 10, weatherCode: 1 };
  assert.equal(W.screen(calm, undefined, { gNow: 0, sNow: 0, gForecast: 0 }, "general").level, "ok");
  const stormy = { windKt: 31, upperWindKt: 105, precipProb: 70, weatherCode: 95 };
  const r = W.screen(stormy, 3.2, { gNow: 0, sNow: 0, gForecast: null }, "general");
  assert.equal(r.level, "over");
  const by = Object.fromEntries(r.checks.map(c => [c.id, c.level]));
  assert.deepEqual(by, { "surface-wind": "over", thunder: "over", "upper-wind": "watch", precip: "watch", waves: "watch", "g-scale": "ok", "s-scale": "ok" });
  // 30 kt is not "in excess of 30 kt"; 30.1 is.
  assert.equal(W.screen({ windKt: 30 }, undefined, null, "general").checks[0].level, "ok");
  assert.equal(W.screen({ windKt: 30.1 }, undefined, null, "general").checks[0].level, "over");
  // G2 forecast: a watch for a constellation batch (limit G2), nothing for a general payload (limit G4).
  const g2 = { gNow: 0, sNow: 0, gForecast: 2 };
  assert.equal(W.screen(calm, undefined, g2, "constellation").level, "watch");
  assert.equal(W.screen(calm, undefined, g2, "general").level, "ok");
  // S1 now: a watch for a crewed launch only.
  const s1 = { gNow: 0, sNow: 1, gForecast: null };
  assert.equal(W.screen(calm, undefined, s1, "crewed").level, "watch");
  assert.equal(W.screen(calm, undefined, s1, "general").level, "ok");
  // Edited limits apply; bad ones fall back to the defaults.
  assert.equal(W.screen({ windKt: 25 }, undefined, null, "general", { surfaceWindKt: 20 }).level, "over");
  assert.equal(W.screen({ windKt: 25 }, undefined, null, "general", { surfaceWindKt: NaN }).level, "ok");
  // No data at all: not checked.
  assert.equal(W.screen(null, undefined, null, "general").level, "none");
});

test("space weather for a launch day, LL2 mapping and UTC inputs", () => {
  const swx = { kp: { kp: 4.67 }, protons: { flux: 12 },
    scales: { days: [{ date: "2026-11-27", G: 3 }, { date: "2026-11-28", G: 1 }] } };
  assert.deepEqual(W.spaceWeatherFor(swx, Date.UTC(2026, 10, 27, 23, 59)), { gNow: 1, sNow: 1, gForecast: 3, forecastDate: "2026-11-27" });
  assert.equal(W.spaceWeatherFor(swx, Date.UTC(2026, 11, 5)).gForecast, null, "beyond the three forecast days");
  const l = W.mapLL2Launch({ id: "abc", name: "Falcon 9 Block 5 | Starlink Group 10-5", net: "2026-11-27T05:00:00Z",
    rocket: { configuration: { name: "Falcon 9" } }, mission: { name: "Starlink Group 10-5", type: "Communications" },
    pad: { name: "Space Launch Complex 40", latitude: "28.56194122", longitude: "-80.57735736", location: { name: "Cape Canaveral SFS, FL, USA", country_code: "USA" } },
    probability: 90 });
  assert.equal(l.category, "constellation");
  assert.equal(l.netMs, Date.UTC(2026, 10, 27, 5));
  near(l.lat, 28.5619, 1e-4, "lat from string");
  assert.equal(l.weatherProbability, 90);
  assert.equal(W.classifyMission({ name: "Soyuz 2.1a | Soyuz MS-29", mission: { type: "Human Exploration" } }), "crewed");
  assert.equal(W.classifyMission({ name: "Long March 3B | Beidou", mission: { type: "Navigation" } }), "general");
  assert.equal(W.mapLL2Launch({ pad: { latitude: null } }).netMs, null);
  assert.equal(W.parseUtcInput("2026-11-26T14:30"), Date.UTC(2026, 10, 26, 14, 30));
  assert.ok(Number.isNaN(W.parseUtcInput("2026-11-26 14:30")));
  assert.equal(W.toUtcInput(Date.UTC(2026, 10, 26, 14, 30)), "2026-11-26T14:30");
  assert.ok(!/allorigins/.test(JSON.stringify(W.URLS)) && W.URLS.kp.startsWith("https://services.swpc.noaa.gov/"), "no proxy");
});

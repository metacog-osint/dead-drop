// Past Weather. References: WMO No. 306 Manual on Codes, FM 15 METAR / FM 16 SPECI (code table 4678 for present
// weather); FAA AIM 7-1 for US forms (statute miles, A altimeter in hundredths of inHg, CLR); FMH-1 chapter 12 for the
// remarks T group and SLP; 14 CFR 1.1 for ceiling; Magnus formula with Alduchov and Eskridge (1996) constants
// (a 17.625, b 243.04 deg C, c 6.1094 hPa); NWS wind chill (2001) and heat index (Rothfusz, SR 90-23) formulas.
// Worked examples by hand:
//   KFAR 151753Z 31015G25KT 1 1/2SM -SN BR BKN008 OVC015 M12/M15 A3002 RMK AO2 SLP215 T11221150
//     wind from 310 at 15 kt gusting 25; visibility 1.5 SM x 1,609.344 = 2,414.016 m; light snow, mist; ceiling is
//     the lowest broken layer, 008 x 100 = 800 ft; -12 / -15 deg C; 30.02 inHg x 33.8639 = 1,016.594 hPa;
//     SLP215: 21.5 < 50 so 1,021.5 hPa; T11221150: -12.2 / -15.0 deg C.
//   UUEE 261451Z 18012G18MPS 0800 R24L/1200U +TSRA FG VV002 22/21 Q1009
//     12 m/s / 0.514444 = 23.326 kt, 18 m/s = 34.989 kt; 800 m; RVR 1,200 m rising; thunderstorm with heavy rain (intensity applies to the rain), fog;
//     vertical visibility 200 ft is the ceiling; 1,009 hPa / 33.8639 = 29.796 inHg.
//   EGLL 261120Z AUTO 24008KT 200V280 9999 NCD 12/07 Q1018 NOSIG: 10 km or more; 1,018 / 33.8639 = 30.0615 inHg.
//   SLP982: 98.2 >= 50 so 900 + 98.2 = 998.2 hPa.
//   RH, T 20, Td 10 deg C: es(20) = 6.1094 exp(352.5 / 263.04) = 6.1094 x 3.81946 = 23.334 hPa;
//     es(10) = 6.1094 exp(176.25 / 253.04) = 6.1094 x 2.00681 = 12.260 hPa; RH = 52.54 %.
//   Heat index (NWS chart): 90 F 60 % -> 100 F (Rothfusz 99.68); 96 F 65 % -> 121 (121.03); 90 F 100 % -> 132
//     (131.64); 100 F 40 % -> 109 (109.26). 100 F 10 %: Rothfusz 94.75, minus (13 - 10)/4 x sqrt((17 - 5)/17) = 0.630,
//     94.12. 84 F 90 %: 98.04 plus (90 - 85)/10 x (87 - 84)/5 = 0.30, 98.34. 70 F 50 %: simple form
//     0.5 (70 + 61 + 2 x 1.2 + 50 x 0.094) = 69.05, average with 70 = 69.525 (under 80, so kept).
//   Wind chill (NWS chart): 0 F 15 mph -> -19 (-19.40); 5 F 10 mph -> -10 (-9.74); -10 F 30 mph -> -39 (-39.45);
//     40 F 5 mph -> 36 (36.47). -10 C (14 F) with 20 kt (23.0156 mph, 23.0156^0.16 = 1.65167):
//     35.74 + 8.701 - 59.047 + 9.885 = -4.721 F = -20.40 C.
//   Hourly times 00:00, 01:00, 02:00 UTC: 01:29 picks 01:00; 01:30 is a tie, the earlier (01:00); 01:31 picks 02:00;
//     02:31 is beyond a 30-minute limit (-1).
//   Open-Meteo window for 2023-01-15 06:00 UTC +/- 12 h: 2023-01-14 18:00 to 2023-01-15 18:00, so start_date
//     2023-01-14 and end_date 2023-01-15.
const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../site/lib/past-weather.js");

const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);

test("METAR, US form: wind, statute-mile visibility, weather, ceiling, temperature, altimeter, remarks", () => {
  const r = P.decodeMetar("METAR KFAR 151753Z 31015G25KT 1 1/2SM -SN BR BKN008 OVC015 M12/M15 A3002 RMK AO2 SLP215 P0000 T11221150=");
  assert.equal(r.type, "METAR");
  assert.equal(r.station, "KFAR");
  assert.deepEqual([r.day, r.hour, r.minute], [15, 17, 53]);
  assert.equal(r.wind.directionDeg, 310);
  assert.equal(r.wind.speedKt, 15);
  assert.equal(r.wind.gustKt, 25);
  near(r.visibility.miles, 1.5, 1e-9, "miles");
  near(r.visibility.metres, 2414.016, 1e-6, "metres");
  assert.deepEqual(r.weather.map((w) => w.text), ["light snow", "mist"]);
  assert.equal(r.clouds.length, 2);
  assert.equal(r.clouds[0].baseFt, 800);
  assert.equal(r.ceilingFt, 800);
  assert.equal(r.temperatureC, -12);
  assert.equal(r.dewPointC, -15);
  near(r.altimeter.inHg, 30.02, 1e-9, "inHg");
  near(r.altimeter.hPa, 1016.594, 0.001, "hPa");
  near(r.seaLevelPressureHpa, 1021.5, 1e-9, "SLP");
  near(r.precise.temperatureC, -12.2, 1e-9, "T group temperature");
  near(r.precise.dewPointC, -15.0, 1e-9, "T group dew point");
  assert.match(r.stationType, /precipitation discriminator/);
  assert.equal(r.remarks, "AO2 SLP215 P0000 T11221150");
  assert.deepEqual(r.unparsed, []);
  assert.equal(P.windText(r.wind), "from 310° (NW) at 15 kt, gusting 25 kt");
});

test("METAR, international form: m/s wind, metres, RVR, thunderstorm, vertical visibility, QNH", () => {
  const r = P.decodeMetar("SPECI UUEE 261451Z 18012G18MPS 0800 R24L/1200U +TSRA FG VV002 22/21 Q1009");
  assert.equal(r.type, "SPECI");
  near(r.wind.speedKt, 23.326, 0.001, "12 m/s");
  near(r.wind.gustKt, 34.989, 0.001, "18 m/s");
  assert.equal(r.visibility.metres, 800);
  assert.equal(r.rvr[0].runway, "24L");
  assert.equal(r.rvr[0].value, 1200);
  assert.equal(r.rvr[0].unit, "m");
  assert.equal(r.rvr[0].tendency, "rising");
  assert.deepEqual(r.weather.map((w) => w.text), ["thunderstorm with heavy rain", "fog"]);
  assert.equal(r.verticalVisibilityFt, 200);
  assert.equal(r.ceilingFt, 200);
  assert.equal(r.altimeter.hPa, 1009);
  near(r.altimeter.inHg, 29.796, 0.001, "inHg");
});

test("METAR: variable wind sector, 9999, NCD, trend; CAVOK; calm; P6SM and CLR; missing groups", () => {
  const a = P.decodeMetar("METAR EGLL 261120Z AUTO 24008KT 200V280 9999 NCD 12/07 Q1018 NOSIG");
  assert.equal(a.auto, true);
  assert.equal(a.wind.varFromDeg, 200);
  assert.equal(a.wind.varToDeg, 280);
  assert.equal(a.visibility.moreThan, true);
  assert.equal(P.visibilityText(a.visibility), "10 km or more");
  assert.equal(a.clouds[0].cover, "NCD");
  assert.equal(a.ceilingFt, null);
  near(a.altimeter.inHg, 30.0615, 0.0001, "Q1018");
  assert.equal(a.trend, "NOSIG");

  const b = P.decodeMetar("LFPG 261200Z VRB02KT CAVOK 25/12 Q1020");
  assert.equal(b.cavok, true);
  assert.equal(b.wind.variable, true);
  assert.equal(P.windText(b.wind), "variable at 2 kt");

  const c = P.decodeMetar("KDEN 261953Z 00000KT P6SM CLR 30/M02 A3015 RMK AO2 SLP982");
  assert.equal(P.windText(c.wind), "calm");
  assert.equal(c.visibility.moreThan, true);
  assert.equal(c.visibility.miles, 6);
  assert.equal(c.dewPointC, -2);
  near(c.seaLevelPressureHpa, 998.2, 1e-9, "SLP982");

  const d = P.decodeMetar("KXYZ 261953Z /////KT M1/4SM FZFG VV001 M01/ A2992 RMK XYZ");
  assert.equal(P.windText(d.wind), "missing");
  assert.equal(d.visibility.lessThan, true);
  assert.equal(d.visibility.miles, 0.25);
  assert.equal(d.weather[0].text, "freezing fog");
  assert.equal(d.temperatureC, -1);
  assert.equal(d.dewPointC, null);
  assert.equal(d.ceilingFt, 100);

  const e = P.decodeMetar("KABC 261953Z 27010KT 10SM VCSH -SHRA FEW040CB SCT250 RERA 15/10 A2990");
  assert.deepEqual(e.weather.map((w) => w.text), ["showers in the vicinity", "light showers of rain"]);
  assert.equal(e.clouds[0].type, "cumulonimbus");
  assert.equal(e.ceilingFt, null, "FEW and SCT are not a ceiling");
  assert.deepEqual(e.unparsed, ["RERA"], "recent weather is kept, not guessed");
  assert.equal(P.weatherText("+FC"), "tornado or waterspout");
});

test("METAR: bad input", () => {
  assert.throws(() => P.decodeMetar(""), /No METAR/);
  assert.throws(() => P.decodeMetar("hello world"), /station/);
});

test("METAR day and time resolved against a reference time", () => {
  assert.equal(P.metarTimeMs(31, 23, 53, Date.UTC(2023, 1, 1, 0, 10)), Date.UTC(2023, 0, 31, 23, 53));
  assert.equal(P.metarTimeMs(1, 0, 53, Date.UTC(2023, 0, 31, 23, 0)), Date.UTC(2023, 1, 1, 0, 53));
  assert.equal(P.metarTimeMs(15, 17, 53, Date.UTC(2023, 0, 15, 18)), Date.UTC(2023, 0, 15, 17, 53));
  assert.equal(P.metarTimeMs(NaN, 1, 1, 0), null);
});

test("relative humidity from Magnus", () => {
  near(P.saturationVapourPressure(0), 6.1094, 1e-12, "es(0)");
  near(P.saturationVapourPressure(20), 23.334, 0.001, "es(20)");
  near(P.relativeHumidity(20, 10), 52.54, 0.01, "RH 20/10");
  near(P.relativeHumidity(-5, -5), 100, 1e-9, "saturated");
  assert.equal(P.relativeHumidity(20, null), null);
});

test("heat index against the NWS chart and the adjustments", () => {
  near(P.heatIndexF(90, 60), 99.68, 0.01, "90/60");
  assert.equal(Math.round(P.heatIndexF(90, 60)), 100);
  assert.equal(Math.round(P.heatIndexF(96, 65)), 121);
  assert.equal(Math.round(P.heatIndexF(90, 100)), 132);
  assert.equal(Math.round(P.heatIndexF(100, 40)), 109);
  near(P.heatIndexF(100, 10), 94.12, 0.01, "low RH adjustment");
  near(P.heatIndexF(84, 90), 98.34, 0.01, "high RH adjustment");
  near(P.heatIndexF(70, 50), 69.525, 1e-9, "simple form below 80 F");
  assert.equal(P.heatIndexF(90, 120), null);
});

test("wind chill against the NWS chart, limits, and the C / knot wrapper", () => {
  assert.equal(Math.round(P.windChillF(0, 15)), -19);
  assert.equal(Math.round(P.windChillF(5, 10)), -10);
  assert.equal(Math.round(P.windChillF(-10, 30)), -39);
  assert.equal(Math.round(P.windChillF(40, 5)), 36);
  assert.equal(P.windChillF(51, 20), null, "above 50 F");
  assert.equal(P.windChillF(20, 3), null, "3 mph or less");
  const f = P.feelsLike(-10, 20, 80);
  near(f.windChillF, -4.721, 0.001, "wind chill F");
  near(f.windChillC, -20.40, 0.01, "wind chill C");
  assert.equal(f.heatIndexF, null);
  const h = P.feelsLike(P.fToC(90), 5, 60);
  near(h.heatIndexF, 99.68, 0.01, "heat index via C");
  assert.equal(h.windChillF, null);
});

test("nearest-hour picker", () => {
  const H = 3600000, t0 = Date.UTC(2023, 0, 15);
  const times = [t0, t0 + H, t0 + 2 * H];
  assert.equal(P.nearestIndex(times, t0 + 89 * 60000), 1);
  assert.equal(P.nearestIndex(times, t0 + 90 * 60000), 1, "a tie goes to the earlier");
  assert.equal(P.nearestIndex(times, t0 + 91 * 60000), 2);
  assert.equal(P.nearestIndex(times, t0 + 151 * 60000, 30 * 60000), -1);
  assert.equal(P.nearestIndex(times, t0 + 150 * 60000, 30 * 60000), 2);
  assert.equal(P.nearestIndex([], t0), -1);
  assert.equal(P.nearestIndex(times, NaN), -1);
});

test("Open-Meteo URL", () => {
  const u = P.openMeteoUrl({ lat: 46.8772, lon: -96.7898, timeMs: Date.UTC(2023, 0, 15, 6) });
  assert.ok(u.startsWith("https://archive-api.open-meteo.com/v1/archive?"));
  assert.match(u, /latitude=46\.8772&longitude=-96\.7898/);
  assert.match(u, /start_date=2023-01-14&end_date=2023-01-15/);
  assert.match(u, /models=era5/);
  assert.match(u, /wind_speed_unit=kn/);
  assert.match(u, /timeformat=unixtime/);
  assert.match(u, /hourly=temperature_2m,dew_point_2m,/);
  const v = P.openMeteoUrl({ lat: 0, lon: 0, timeMs: Date.UTC(2023, 0, 15, 18) });
  assert.match(v, /start_date=2023-01-15&end_date=2023-01-16/);
  assert.throws(() => P.openMeteoUrl({ lat: 91, lon: 0, timeMs: Date.UTC(2023, 0, 1) }), /Latitude/);
  assert.throws(() => P.openMeteoUrl({ lat: 0, lon: 0, timeMs: Date.UTC(1939, 11, 31) }), /1940/);
  assert.throws(() => P.openMeteoUrl({ lat: 0, lon: 0, timeMs: NaN }), /time/);
});

test("IEM URL and station identifiers", () => {
  assert.deepEqual(P.normaliseStation(" kfar "), { typed: "KFAR", iem: "FAR" });
  assert.deepEqual(P.normaliseStation("EGLL"), { typed: "EGLL", iem: "EGLL" });
  assert.deepEqual(P.normaliseStation("KFAR", true), { typed: "KFAR", iem: "KFAR" });
  assert.throws(() => P.normaliseStation("K-FA"), /identifier/);
  const u = P.iemUrl({ station: "KFAR", startMs: Date.UTC(2023, 0, 15, 3), endMs: Date.UTC(2023, 0, 15, 9, 30) });
  assert.ok(u.startsWith("https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py?station=FAR&data=metar&"));
  assert.match(u, /year1=2023&month1=1&day1=15&hour1=3&minute1=0&year2=2023&month2=1&day2=15&hour2=9&minute2=30/);
  assert.match(u, /tz=Etc%2FUTC&format=onlycomma/);
  assert.match(u, /report_type=3&report_type=4/);
  assert.throws(() => P.iemUrl({ station: "KFAR", startMs: 10, endMs: 5 }), /range/);
});

test("IEM CSV parsing", () => {
  const csv = [
    "station,valid,lon,lat,elevation,metar",
    "FAR,2023-01-15 06:53,-96.8158,46.9253,274.0,KFAR 150653Z 31012KT 10SM CLR M20/M24 A3040 RMK AO2 T12001244",
    "FAR,2023-01-15 05:53,-96.8158,46.9253,274.0,KFAR 150553Z 30010KT 10SM CLR M21/M25 A3041",
    "FAR,2023-01-15 06:10,-96.8158,46.9253,274.0,M",
    ""
  ].join("\r\n");
  const rows = P.parseIemCsv(csv);
  assert.equal(rows.length, 2, "missing report dropped");
  assert.equal(rows[0].validMs, Date.UTC(2023, 0, 15, 5, 53), "sorted by time");
  assert.equal(rows[1].metar.slice(0, 4), "KFAR");
  assert.equal(rows[0].lat, 46.9253);
  assert.equal(rows[0].elevationM, 274);
  assert.deepEqual(P.parseIemCsv(""), []);
  assert.throws(() => P.parseIemCsv("ERROR: Unknown station"), /did not send METAR/);
  assert.deepEqual(P.parseCsvLine('a,"b, c","d ""e"""'), ["a", "b, c", 'd "e"']);
});

test("Open-Meteo response parsing and unit conversion", () => {
  const t0 = Date.UTC(2023, 0, 15) / 1000;
  const resp = { latitude: 46.875, longitude: -96.75, elevation: 274,
    hourly_units: { wind_speed_10m: "km/h", wind_gusts_10m: "km/h" },
    hourly: { time: [t0, t0 + 3600], temperature_2m: [-20.1, -20.6], dew_point_2m: [-24, null],
      wind_speed_10m: [18.52, 37.04], wind_gusts_10m: [27.78, null], pressure_msl: [1030.2, 1030.5] } };
  const p = P.parseOpenMeteo(resp);
  assert.equal(p.gridLat, 46.875);
  assert.equal(p.rows.length, 2);
  assert.equal(p.rows[0].timeMs, Date.UTC(2023, 0, 15));
  near(p.rows[0].windKt, 10, 1e-9, "18.52 km/h");
  near(p.rows[0].gustKt, 15, 1e-9, "27.78 km/h");
  near(p.rows[1].windKt, 20, 1e-9, "37.04 km/h");
  assert.equal(p.rows[1].dewPointC, null);
  assert.equal(p.rows[0].cloudCover, null, "absent column is null");
  assert.throws(() => P.parseOpenMeteo({ error: true, reason: "Parameter out of range" }), /out of range/);
  assert.throws(() => P.parseOpenMeteo({}), /no hourly/);
  assert.throws(() => P.parseOpenMeteo({ hourly: { time: [] }, hourly_units: { wind_speed_10m: "furlongs" } }), /wind unit/);
});

test("UTC input round trip", () => {
  assert.equal(P.parseUtcInput("2023-01-15T06:30"), Date.UTC(2023, 0, 15, 6, 30));
  assert.equal(P.toUtcInput(Date.UTC(2023, 0, 15, 6, 30)), "2023-01-15T06:30");
  assert.ok(Number.isNaN(P.parseUtcInput("15/01/2023")));
});

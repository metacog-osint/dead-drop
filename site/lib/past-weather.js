/* Past weather: builds requests for two free archives, reads their answers, picks the hour nearest a moment, decodes
   METAR reports and works out a few derived values. No DOM, no network.
   References:
   - METAR code form: WMO No. 306, Manual on Codes, Volume I.1, FM 15 METAR / FM 16 SPECI, with code tables 4678
     (present weather) and 0500 / 4377 (cloud and visibility); FAA Aeronautical Information Manual 7-1 (Key to
     Aerodrome Forecast and Aviation Routine Weather Report) for the US forms (statute miles, A altimeter, CLR).
   - Remarks: Federal Meteorological Handbook No. 1 (FMH-1), chapter 12: the T group (temperature and dew point in
     tenths of a degree) and SLP (sea-level pressure, last three digits in tenths of a hectopascal).
   - Ceiling: 14 CFR 1.1, the lowest broken or overcast layer, or the vertical visibility into an obscuration.
   - Relative humidity: Magnus formula, es(T) = 6.1094 exp(17.625 T / (T + 243.04)) hPa over water, constants from
     Alduchov and Eskridge (1996), "Improved Magnus form approximation of saturation vapor pressure", Journal of
     Applied Meteorology 35, 601-609. RH = 100 es(Td) / es(T).
   - Wind chill: NWS wind chill temperature index (2001), WC = 35.74 + 0.6215 T - 35.75 V^0.16 + 0.4275 T V^0.16,
     T in deg F, V the 10 m wind in mph; defined for T <= 50 deg F and V > 3 mph.
   - Heat index: NWS Technical Attachment SR 90-23 (Rothfusz, 1990) regression with the adjustments in the NWS
     Weather Prediction Center's heat index equation page; Steadman's simple form first, used when its average with
     T is under 80 deg F.
   - Units: 1 kt = 1.852 km/h exactly; 1 statute mile = 1,609.344 m exactly; 1 inHg = 33.8639 hPa (at 0 deg C,
     standard gravity). */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.DD = root.DD || {}).pastWeather = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var KMH_PER_KT = 1.852;
  var MS_PER_KT = 1852 / 3600;            // 0.514444 m/s
  var M_PER_SM = 1609.344;
  var MPH_PER_KT = 1852 / 1609.344;       // 1.150779
  var HPA_PER_INHG = 33.8639;
  var HOUR = 3600000;
  var ERA5_START_MS = Date.UTC(1940, 0, 1);

  function isNum(x) { return typeof x === "number" && isFinite(x); }
  function num(x) { return isNum(x) ? x : null; }
  function cToF(c) { return isNum(c) ? c * 9 / 5 + 32 : null; }
  function fToC(f) { return isNum(f) ? (f - 32) * 5 / 9 : null; }
  function pad(n, w) { var s = String(n); while (s.length < (w || 2)) s = "0" + s; return s; }
  function isoDate(ms) { return new Date(ms).toISOString().slice(0, 10); }
  function parseUtcInput(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?Z?$/.exec(String(s || "").trim());
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], m[6] ? +m[6] : 0) : NaN;
  }
  function toUtcInput(ms) { return new Date(ms).toISOString().slice(0, 16); }
  function checkPoint(lat, lon) {
    if (!isNum(lat) || !isNum(lon)) throw new Error("Enter a latitude and a longitude in decimal degrees.");
    if (lat < -90 || lat > 90) throw new Error("Latitude must be between -90 and 90 degrees.");
    if (lon < -180 || lon > 180) throw new Error("Longitude must be between -180 and 180 degrees.");
  }

  // ---- Requests ----------------------------------------------------------------------------------------------
  var OM_HOURLY = ["temperature_2m", "dew_point_2m", "relative_humidity_2m", "precipitation", "rain", "snowfall",
    "cloud_cover", "cloud_cover_low", "cloud_cover_mid", "cloud_cover_high", "pressure_msl", "surface_pressure",
    "wind_speed_10m", "wind_direction_10m", "wind_gusts_10m", "weather_code"];

  /** Open-Meteo Historical Weather API (ERA5 reanalysis), the UTC days covering timeMs +/- hoursEitherSide. */
  function openMeteoUrl(opts) {
    var o = opts || {};
    checkPoint(o.lat, o.lon);
    if (!isNum(o.timeMs)) throw new Error("Enter the time (UTC).");
    if (o.timeMs < ERA5_START_MS) throw new Error("ERA5 starts on 1 January 1940.");
    var h = isNum(o.hoursEitherSide) ? Math.max(0, Math.min(72, o.hoursEitherSide)) : 12;
    var q = [
      "latitude=" + o.lat.toFixed(4), "longitude=" + o.lon.toFixed(4),
      "start_date=" + isoDate(o.timeMs - h * HOUR), "end_date=" + isoDate(o.timeMs + h * HOUR),
      "hourly=" + OM_HOURLY.join(","), "models=" + (o.model || "era5"),
      "wind_speed_unit=kn", "timezone=GMT", "timeformat=unixtime"
    ];
    return "https://archive-api.open-meteo.com/v1/archive?" + q.join("&");
  }

  /** A station identifier for IEM: 3 or 4 letters and digits. A 4-letter identifier starting with K (the
   *  contiguous US ICAO prefix) is sent without the K, the way IEM lists US stations (KFAR is FAR). */
  function normaliseStation(s, keepAsTyped) {
    var id = String(s || "").trim().toUpperCase();
    if (!/^[A-Z0-9]{3,4}$/.test(id)) throw new Error("A station identifier is 3 or 4 letters or digits, e.g. KFAR or EGLL.");
    var iem = !keepAsTyped && id.length === 4 && id.charAt(0) === "K" && /^K[A-Z0-9]{3}$/.test(id) ? id.slice(1) : id;
    return { typed: id, iem: iem };
  }
  /** Iowa Environmental Mesonet ASOS/METAR download, raw METARs from startMs to endMs (UTC), routine and specials. */
  function iemUrl(opts) {
    var o = opts || {};
    var st = normaliseStation(o.station, o.keepAsTyped);
    if (!isNum(o.startMs) || !isNum(o.endMs) || o.endMs <= o.startMs) throw new Error("The time range is not valid.");
    var a = new Date(o.startMs), b = new Date(o.endMs);
    var q = ["station=" + encodeURIComponent(st.iem), "data=metar",
      "year1=" + a.getUTCFullYear(), "month1=" + (a.getUTCMonth() + 1), "day1=" + a.getUTCDate(),
      "hour1=" + a.getUTCHours(), "minute1=" + a.getUTCMinutes(),
      "year2=" + b.getUTCFullYear(), "month2=" + (b.getUTCMonth() + 1), "day2=" + b.getUTCDate(),
      "hour2=" + b.getUTCHours(), "minute2=" + b.getUTCMinutes(),
      "tz=Etc%2FUTC", "format=onlycomma", "latlon=yes", "elev=yes", "missing=M", "trace=T", "direct=no",
      "report_type=3", "report_type=4"];
    return "https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py?" + q.join("&");
  }

  // ---- Responses ---------------------------------------------------------------------------------------------
  function parseCsvLine(line) {
    var out = [], cur = "", q = false;
    for (var i = 0; i < line.length; i++) {
      var c = line.charAt(i);
      if (q) {
        if (c === '"' && line.charAt(i + 1) === '"') { cur += '"'; i++; }
        else if (c === '"') q = false;
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ",") { out.push(cur); cur = ""; }
      else cur += c;
    }
    out.push(cur);
    return out;
  }
  /** IEM "onlycomma" CSV: a header line naming the columns (station, valid, metar, and lon, lat, elevation when
   *  asked), then one line per report, times in UTC as "YYYY-MM-DD hh:mm". */
  function parseIemCsv(text) {
    var lines = String(text || "").split(/\r?\n/).filter(function (l) { return l.trim() && l.charAt(0) !== "#"; });
    if (!lines.length) return [];
    var head = parseCsvLine(lines[0]).map(function (h) { return h.trim().toLowerCase(); });
    var iV = head.indexOf("valid"), iM = head.indexOf("metar"), iS = head.indexOf("station");
    if (iV < 0 || iM < 0) throw new Error("The archive did not send METAR data: " + lines[0].slice(0, 120));
    var iLat = head.indexOf("lat"), iLon = head.indexOf("lon"), iE = head.indexOf("elevation");
    var out = [];
    for (var k = 1; k < lines.length; k++) {
      var c = parseCsvLine(lines[k]);
      var t = parseUtcInput(c[iV]);
      var metar = (c[iM] || "").trim();
      if (!isFinite(t) || !metar || metar === "M") continue;
      var f = function (i) { if (i < 0) return null; var v = Number(c[i]); return c[i] !== "" && c[i] !== "M" && isFinite(v) ? v : null; };
      out.push({ station: iS >= 0 ? c[iS] : "", validMs: t, metar: metar, lat: f(iLat), lon: f(iLon), elevationM: f(iE) });
    }
    out.sort(function (x, y) { return x.validMs - y.validMs; });
    return out;
  }

  var SPEED_TO_KT = { "kn": 1, "kt": 1, "km/h": 1 / KMH_PER_KT, "m/s": 1 / MS_PER_KT, "mp/h": 1 / MPH_PER_KT, "mph": 1 / MPH_PER_KT };
  /** Open-Meteo hourly answer (timeformat=unixtime) to rows, wind converted to knots whatever unit came back. */
  function parseOpenMeteo(resp) {
    if (!resp || typeof resp !== "object") throw new Error("No answer from Open-Meteo.");
    if (resp.error) throw new Error("Open-Meteo: " + (resp.reason || "error"));
    var h = resp.hourly, u = resp.hourly_units || {};
    if (!h || !Array.isArray(h.time)) throw new Error("Open-Meteo sent no hourly data.");
    var wf = SPEED_TO_KT[String(u.wind_speed_10m || "kn").toLowerCase()];
    if (!wf) throw new Error("Unexpected wind unit from Open-Meteo: " + u.wind_speed_10m);
    var gf = SPEED_TO_KT[String(u.wind_gusts_10m || u.wind_speed_10m || "kn").toLowerCase()] || wf;
    var col = function (k, i) { return h[k] ? num(h[k][i]) : null; };
    var rows = h.time.map(function (s, i) {
      var w = col("wind_speed_10m", i), g = col("wind_gusts_10m", i);
      return { timeMs: s * 1000, temperatureC: col("temperature_2m", i), dewPointC: col("dew_point_2m", i),
        relativeHumidity: col("relative_humidity_2m", i), precipitationMm: col("precipitation", i), rainMm: col("rain", i),
        snowfallCm: col("snowfall", i), cloudCover: col("cloud_cover", i), cloudLow: col("cloud_cover_low", i),
        cloudMid: col("cloud_cover_mid", i), cloudHigh: col("cloud_cover_high", i), pressureMslHpa: col("pressure_msl", i),
        surfacePressureHpa: col("surface_pressure", i), windKt: w === null ? null : w * wf,
        windDirDeg: col("wind_direction_10m", i), gustKt: g === null ? null : g * gf, weatherCode: col("weather_code", i) };
    });
    return { gridLat: num(resp.latitude), gridLon: num(resp.longitude), elevationM: num(resp.elevation), rows: rows };
  }

  /** Index of the time nearest tMs (ties go to the earlier one), or -1 when the list is empty or the nearest is
   *  further than maxGapMs away. times must be in ascending order. */
  function nearestIndex(timesMs, tMs, maxGapMs) {
    if (!Array.isArray(timesMs) || !timesMs.length || !isNum(tMs)) return -1;
    var best = -1, bestD = Infinity;
    for (var i = 0; i < timesMs.length; i++) {
      if (!isNum(timesMs[i])) continue;
      var d = Math.abs(timesMs[i] - tMs);
      if (d < bestD) { bestD = d; best = i; }
    }
    if (best < 0) return -1;
    return isNum(maxGapMs) && bestD > maxGapMs ? -1 : best;
  }

  // ---- Derived values ----------------------------------------------------------------------------------------
  var MAGNUS_A = 17.625, MAGNUS_B = 243.04, MAGNUS_C = 6.1094;
  function saturationVapourPressure(tC) { return isNum(tC) ? MAGNUS_C * Math.exp(MAGNUS_A * tC / (tC + MAGNUS_B)) : null; }
  /** Relative humidity in percent from temperature and dew point in deg C (Magnus, Alduchov and Eskridge). */
  function relativeHumidity(tC, tdC) {
    if (!isNum(tC) || !isNum(tdC)) return null;
    return 100 * saturationVapourPressure(tdC) / saturationVapourPressure(tC);
  }
  /** NWS wind chill in deg F from deg F and the 10 m wind in mph; null outside T <= 50 F and V > 3 mph. */
  function windChillF(tF, vMph) {
    if (!isNum(tF) || !isNum(vMph) || tF > 50 || vMph <= 3) return null;
    var p = Math.pow(vMph, 0.16);
    return 35.74 + 0.6215 * tF - 35.75 * p + 0.4275 * tF * p;
  }
  /** NWS heat index in deg F from deg F and relative humidity in percent. */
  function heatIndexF(tF, rh) {
    if (!isNum(tF) || !isNum(rh) || rh < 0 || rh > 100) return null;
    var simple = 0.5 * (tF + 61 + (tF - 68) * 1.2 + rh * 0.094);
    if ((simple + tF) / 2 < 80) return (simple + tF) / 2;
    var T = tF, R = rh;
    var hi = -42.379 + 2.04901523 * T + 10.14333127 * R - 0.22475541 * T * R - 0.00683783 * T * T -
      0.05481717 * R * R + 0.00122874 * T * T * R + 0.00085282 * T * R * R - 0.00000199 * T * T * R * R;
    if (R < 13 && T >= 80 && T <= 112) hi -= ((13 - R) / 4) * Math.sqrt((17 - Math.abs(T - 95)) / 17);
    else if (R > 85 && T >= 80 && T <= 87) hi += ((R - 85) / 10) * ((87 - T) / 5);
    return hi;
  }
  /** Feels-like figures from deg C, wind in knots and RH: wind chill and heat index, each null where it does not
   *  apply (the heat index is shown only from 80 deg F, where the NWS chart starts). */
  function feelsLike(tC, windKt, rh) {
    var tF = cToF(tC), wc = windChillF(tF, isNum(windKt) ? windKt * MPH_PER_KT : NaN);
    var hi = isNum(tF) && tF >= 80 ? heatIndexF(tF, rh) : null;
    return { windChillC: wc === null ? null : fToC(wc), windChillF: wc, heatIndexC: hi === null ? null : fToC(hi), heatIndexF: hi };
  }

  // ---- METAR decoding ----------------------------------------------------------------------------------------
  var WX = {
    "-": "light", "+": "heavy", "VC": "in the vicinity",
    MI: "shallow", PR: "partial", BC: "patches of", DR: "low drifting", BL: "blowing", SH: "showers of", TS: "thunderstorm",
    FZ: "freezing",
    DZ: "drizzle", RA: "rain", SN: "snow", SG: "snow grains", IC: "ice crystals", PL: "ice pellets", GR: "hail",
    GS: "small hail or snow pellets", UP: "unknown precipitation",
    BR: "mist", FG: "fog", FU: "smoke", VA: "volcanic ash", DU: "widespread dust", SA: "sand", HZ: "haze", PY: "spray",
    PO: "dust or sand whirls", SQ: "squalls", FC: "funnel cloud", SS: "sandstorm", DS: "duststorm"
  };
  var COVER = { FEW: "few (1 to 2 oktas)", SCT: "scattered (3 to 4 oktas)", BKN: "broken (5 to 7 oktas)", OVC: "overcast (8 oktas)" };
  var WX_RE = /^(-|\+|VC)?(MI|PR|BC|DR|BL|SH|TS|FZ)?((?:DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PY|PO|SQ|FC|SS|DS)*)$/;

  function weatherText(code) {
    var m = WX_RE.exec(code);
    if (!m || (!m[2] && !m[3])) return null;
    if (code === "+FC") return "tornado or waterspout";
    var phen = [];
    for (var i = 0; i < m[3].length; i += 2) phen.push(WX[m[3].substr(i, 2)]);
    // Intensity qualifies the precipitation (FAA AIM 7-1: +TSRA is a thunderstorm with heavy rain).
    var inten = m[1] === "-" || m[1] === "+" ? WX[m[1]] + " " : "";
    var words = [];
    if (m[2] === "SH" && phen.length) words.push(inten + "showers of " + phen.join(" and "));
    else if (m[2] === "TS") words.push("thunderstorm" + (phen.length ? " with " + inten + phen.join(" and ") : ""));
    else if (m[2] === "SH") words.push("showers");
    else { if (inten) words.push(inten.trim()); if (m[2]) words.push(WX[m[2]]); if (phen.length) words.push(phen.join(" and ")); }
    if (m[1] === "VC") words.push("in the vicinity");
    return words.join(" ");
  }
  function signedTemp(s) {
    if (!s || /\//.test(s)) return null;
    return s.charAt(0) === "M" ? -Number(s.slice(1)) : Number(s);
  }
  function speedToKt(v, unit) { return unit === "MPS" ? v / MS_PER_KT : unit === "KMH" ? v / KMH_PER_KT : v; }
  function fraction(s) {
    var m = /^(\d+)\/(\d+)$/.exec(s);
    return m && +m[2] ? +m[1] / +m[2] : (/^\d+$/.test(s) ? +s : NaN);
  }

  /** Decodes the main groups of a METAR or SPECI. Unrecognised groups are kept in `unparsed`, never guessed. */
  function decodeMetar(text) {
    var raw = String(text || "").replace(/\s+/g, " ").trim().replace(/=$/, "").trim();
    if (!raw) throw new Error("No METAR text.");
    var parts = raw.split(" ");
    var rmkAt = parts.indexOf("RMK");
    var body = rmkAt >= 0 ? parts.slice(0, rmkAt) : parts.slice();
    var remarks = rmkAt >= 0 ? parts.slice(rmkAt + 1) : [];
    var r = { raw: raw, type: "METAR", station: null, day: null, hour: null, minute: null, auto: false, correction: false,
      nil: false, wind: null, visibility: null, cavok: false, rvr: [], weather: [], clouds: [], verticalVisibilityFt: null,
      ceilingFt: null, temperatureC: null, dewPointC: null, altimeter: null, trend: null, remarks: remarks.join(" "),
      precise: null, seaLevelPressureHpa: null, stationType: null, unparsed: [] };
    var i = 0;
    if (body[i] === "METAR" || body[i] === "SPECI") r.type = body[i++];
    if (body[i] === "COR") { r.correction = true; i++; }
    if (/^[A-Z][A-Z0-9]{3}$/.test(body[i] || "")) r.station = body[i++];
    else throw new Error("No station identifier (4 letters, e.g. KFAR) at the start of the report.");
    var tm = /^(\d{2})(\d{2})(\d{2})Z$/.exec(body[i] || "");
    if (tm) { r.day = +tm[1]; r.hour = +tm[2]; r.minute = +tm[3]; i++; }
    for (; i < body.length; i++) {
      var g = body[i], m;
      if (g === "AUTO") { r.auto = true; continue; }
      if (g === "COR") { r.correction = true; continue; }
      if (g === "NIL") { r.nil = true; continue; }
      if (g === "NOSIG" || g === "BECMG" || g === "TEMPO") { r.trend = body.slice(i).join(" "); break; }
      if (!r.wind && (m = /^(\d{3}|VRB|\/\/\/)(P?)(\d{2,3}|\/\/)(?:G(P?)(\d{2,3}))?(KT|MPS|KMH)$/.exec(g))) {
        var unit = m[6], sp = m[3] === "//" ? null : +m[3], gu = m[5] ? +m[5] : null;
        r.wind = { raw: g, unit: unit, directionDeg: /^\d{3}$/.test(m[1]) ? +m[1] : null, variable: m[1] === "VRB",
          speedKt: sp === null ? null : speedToKt(sp, unit), gustKt: gu === null ? null : speedToKt(gu, unit),
          aboveSpeed: m[2] === "P", calm: sp === 0 && m[1] === "000", varFromDeg: null, varToDeg: null };
        continue;
      }
      if (r.wind && (m = /^(\d{3})V(\d{3})$/.exec(g))) { r.wind.varFromDeg = +m[1]; r.wind.varToDeg = +m[2]; continue; }
      if (g === "CAVOK") { r.cavok = true; r.visibility = { raw: g, metres: 10000, moreThan: true, lessThan: false }; continue; }
      if (!r.visibility && (m = /^(\d{4})(NDV)?$/.exec(g))) {
        var vm = +m[1];
        r.visibility = { raw: g, metres: vm === 9999 ? 10000 : vm === 0 ? 50 : vm, moreThan: vm === 9999, lessThan: vm === 0 };
        continue;
      }
      if (r.visibility && !r.visibility.minimum && (m = /^(\d{4})(N|NE|E|SE|S|SW|W|NW)$/.exec(g))) {
        r.visibility.minimum = { metres: +m[1], direction: m[2] }; continue;
      }
      if (!r.visibility && /^\d$/.test(g) && /^M?\d\/\d{1,2}SM$/.test(body[i + 1] || "")) {
        var frac = /^(M?)(\d\/\d{1,2})SM$/.exec(body[i + 1]);
        var miles = +g + fraction(frac[2]);
        r.visibility = { raw: g + " " + body[i + 1], miles: miles, metres: miles * M_PER_SM, moreThan: false, lessThan: frac[1] === "M" };
        i++; continue;
      }
      if (!r.visibility && (m = /^([PM]?)(\d+(?:\/\d+)?)SM$/.exec(g))) {
        var mi = fraction(m[2]);
        if (isFinite(mi)) { r.visibility = { raw: g, miles: mi, metres: mi * M_PER_SM, moreThan: m[1] === "P", lessThan: m[1] === "M" }; continue; }
      }
      if ((m = /^R(\d{2}[LCR]?)\/([PM]?)(\d{4})(?:V([PM]?)(\d{4}))?(FT)?(?:\/?([UDN]))?$/.exec(g))) {
        r.rvr.push({ raw: g, runway: m[1], value: +m[3], upTo: m[5] ? +m[5] : null, unit: m[6] ? "ft" : "m",
          moreThan: m[2] === "P", lessThan: m[2] === "M", tendency: m[7] ? { U: "rising", D: "falling", N: "no change" }[m[7]] : null });
        continue;
      }
      if (g === "NSW") { r.weather.push({ raw: g, text: "no significant weather (ended)" }); continue; }
      if (/^(-|\+|VC)?[A-Z]{2,8}$/.test(g) && weatherText(g)) { r.weather.push({ raw: g, text: weatherText(g) }); continue; }
      if (/^(SKC|CLR|NSC|NCD)$/.test(g)) {
        r.clouds.push({ raw: g, cover: g, text: { SKC: "sky clear", CLR: "no cloud below 12,000 ft (automated)",
          NSC: "no significant cloud", NCD: "no cloud detected (automated)" }[g], baseFt: null, type: null });
        continue;
      }
      if ((m = /^(FEW|SCT|BKN|OVC)(\d{3}|\/\/\/)(CB|TCU|\/\/\/)?$/.exec(g))) {
        r.clouds.push({ raw: g, cover: m[1], text: COVER[m[1]], baseFt: m[2] === "///" ? null : +m[2] * 100,
          type: m[3] === "CB" ? "cumulonimbus" : m[3] === "TCU" ? "towering cumulus" : null });
        continue;
      }
      if ((m = /^VV(\d{3}|\/\/\/)$/.exec(g))) { r.verticalVisibilityFt = m[1] === "///" ? null : +m[1] * 100; continue; }
      if ((m = /^(M?\d{2}|\/\/)\/(M?\d{2}|\/\/)?$/.exec(g))) {
        r.temperatureC = signedTemp(m[1]); r.dewPointC = signedTemp(m[2]); continue;
      }
      // Altimeter setting: A in hundredths of an inch of mercury (US), Q (QNH) in whole hectopascals. The first one
      // given is used; a second (some stations send both) is kept in `also`.
      if ((m = /^([AQ])(\d{4})$/.exec(g))) {
        var alt = m[1] === "A" ? { raw: g, unit: "inHg", inHg: +m[2] / 100, hPa: +m[2] / 100 * HPA_PER_INHG }
          : { raw: g, unit: "hPa", hPa: +m[2], inHg: +m[2] / HPA_PER_INHG };
        if (!r.altimeter) r.altimeter = alt; else r.altimeter.also = g;
        continue;
      }
      r.unparsed.push(g);
    }
    var ceil = r.clouds.filter(function (c) { return (c.cover === "BKN" || c.cover === "OVC") && c.baseFt !== null; })
      .map(function (c) { return c.baseFt; });
    if (r.verticalVisibilityFt !== null) ceil.push(r.verticalVisibilityFt);
    r.ceilingFt = ceil.length ? Math.min.apply(null, ceil) : null;
    remarks.forEach(function (g) {
      var m;
      if ((m = /^T([01])(\d{3})([01])(\d{3})$/.exec(g))) {
        r.precise = { temperatureC: (m[1] === "1" ? -1 : 1) * +m[2] / 10, dewPointC: (m[3] === "1" ? -1 : 1) * +m[4] / 10 };
      } else if ((m = /^SLP(\d{3})$/.exec(g))) {
        var p = +m[1] / 10;
        r.seaLevelPressureHpa = p >= 50 ? 900 + p : 1000 + p;
      } else if (g === "AO1" || g === "AO2") {
        r.stationType = g === "AO2" ? "automated, with a precipitation discriminator (rain or snow)" : "automated, without a precipitation discriminator";
      }
    });
    return r;
  }

  /** The UTC time of a METAR's day/hour/minute: of the candidates in the month of refMs, the month before and the
   *  month after, the one nearest refMs. */
  function metarTimeMs(day, hour, minute, refMs) {
    if (![day, hour, minute, refMs].every(isNum)) return null;
    var ref = new Date(refMs), best = null;
    [-1, 0, 1].forEach(function (k) {
      var y = ref.getUTCFullYear(), mo = ref.getUTCMonth() + k;
      var t = Date.UTC(y, mo, day, hour, minute);
      if (new Date(t).getUTCDate() !== day) return;          // e.g. day 31 in a 30-day month
      if (best === null || Math.abs(t - refMs) < Math.abs(best - refMs)) best = t;
    });
    return best;
  }

  /** One-line summary of the decoded fields that matter most. */
  function compass(deg) {
    if (!isNum(deg)) return "";
    var pts = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
    return pts[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
  }
  function windText(w) {
    if (!w) return null;
    if (w.speedKt === null) return "missing";
    if (w.calm || w.speedKt === 0) return "calm";
    var dir = w.variable ? "variable" : w.directionDeg !== null ? "from " + pad(w.directionDeg, 3) + "° (" + compass(w.directionDeg) + ")" : "direction missing";
    var s = dir + " at " + (w.aboveSpeed ? "over " : "") + Math.round(w.speedKt) + " kt";
    if (w.gustKt !== null) s += ", gusting " + Math.round(w.gustKt) + " kt";
    if (w.varFromDeg !== null) s += ", varying " + pad(w.varFromDeg, 3) + "° to " + pad(w.varToDeg, 3) + "°";
    return s;
  }
  function visibilityText(v) {
    if (!v) return null;
    if (v.raw === "CAVOK") return "10 km or more, no cloud below 5,000 ft or the highest minimum sector altitude, no significant weather (CAVOK)";
    var s;
    if (v.miles !== undefined) {
      s = (v.moreThan ? "more than " : v.lessThan ? "less than " : "") + (+v.miles.toFixed(2)) + " statute mile" + (v.miles === 1 ? "" : "s") +
        " (" + (v.metres >= 5000 ? (v.metres / 1000).toFixed(1) + " km" : Math.round(v.metres) + " m") + ")";
    } else {
      s = v.moreThan ? "10 km or more" : v.lessThan ? "less than 50 m" : v.metres >= 5000 ? (v.metres / 1000).toFixed(0) + " km" : v.metres + " m";
    }
    if (v.minimum) s += "; lowest " + v.minimum.metres + " m to the " + v.minimum.direction;
    return s;
  }

  return { KMH_PER_KT: KMH_PER_KT, MS_PER_KT: MS_PER_KT, M_PER_SM: M_PER_SM, MPH_PER_KT: MPH_PER_KT,
    HPA_PER_INHG: HPA_PER_INHG, ERA5_START_MS: ERA5_START_MS, MAGNUS: { a: MAGNUS_A, b: MAGNUS_B, c: MAGNUS_C },
    cToF: cToF, fToC: fToC, parseUtcInput: parseUtcInput, toUtcInput: toUtcInput, checkPoint: checkPoint,
    openMeteoUrl: openMeteoUrl, normaliseStation: normaliseStation, iemUrl: iemUrl, parseCsvLine: parseCsvLine,
    parseIemCsv: parseIemCsv, parseOpenMeteo: parseOpenMeteo, nearestIndex: nearestIndex,
    saturationVapourPressure: saturationVapourPressure, relativeHumidity: relativeHumidity, windChillF: windChillF,
    heatIndexF: heatIndexF, feelsLike: feelsLike, weatherText: weatherText, decodeMetar: decodeMetar,
    metarTimeMs: metarTimeMs, compass: compass, windText: windText, visibilityText: visibilityText };
});

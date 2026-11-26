/* Launch weather: reads public forecasts and space-weather measurements and screens a launch time against a few
   indicative limits. It is a screening aid, never a launch decision: real launch weather calls are made by the range
   weather officers against the vehicle's own launch commit criteria, with lightning detection, field mills, radar,
   balloon wind profiles and cloud observations that a weather model cannot give.
   References:
   - NOAA Space Weather Scales (SWPC, adopted 1999): G1 to G5 are Kp 5, 6, 7, 8 (including 9-) and 9; S1 to S5 are
     >=10 MeV proton flux of 10, 100, 1,000, 10,000 and 100,000 pfu; R1 to R5 are GOES 0.1-0.8 nm X-ray peaks of
     M1 (1e-5 W/m^2), M5, X1 (1e-4), X10 and X20.
   - Solar flare classes A, B, C, M, X: decades of 0.1-0.8 nm X-ray flux from 1e-8 W/m^2 (NOAA/SWPC).
   - WMO code table 4677 (present weather), the subset Open-Meteo uses for weather_code.
   - Lightning Launch Commit Criteria (NASA and the US Space Force ranges; Krider et al., "Natural and triggered
     lightning launch commit criteria", AMS Conference on Aviation, Range and Aerospace Meteorology, 2006) and NASA's
     Falcon 9 / Crew Dragon launch weather criteria fact sheet (sustained wind at the 162 ft level of the pad above
     30 knots): used only to name what the screening stands in for.
   - 1 knot = 1.852 km/h exactly (international nautical mile, 1,852 m).
   No DOM, no network. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.DD = root.DD || {}).launchWeather = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var KMH_PER_KNOT = 1.852;
  var SCALE_WORDS = ["none", "minor", "moderate", "strong", "severe", "extreme"];

  var WMO = {
    0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast", 45: "Fog", 48: "Depositing rime fog",
    51: "Light drizzle", 53: "Moderate drizzle", 55: "Dense drizzle", 56: "Light freezing drizzle", 57: "Dense freezing drizzle",
    61: "Slight rain", 63: "Moderate rain", 65: "Heavy rain", 66: "Light freezing rain", 67: "Heavy freezing rain",
    71: "Slight snow", 73: "Moderate snow", 75: "Heavy snow", 77: "Snow grains",
    80: "Slight rain showers", 81: "Moderate rain showers", 82: "Violent rain showers",
    85: "Slight snow showers", 86: "Heavy snow showers",
    95: "Thunderstorm", 96: "Thunderstorm with slight hail", 99: "Thunderstorm with heavy hail"
  };
  function wmoText(code) { return Object.prototype.hasOwnProperty.call(WMO, code) ? WMO[code] : "Code " + code; }
  function isThunder(code) { return code === 95 || code === 96 || code === 99; }
  function kmhToKnots(kmh) { return kmh / KMH_PER_KNOT; }

  // Kp comes in thirds: 4.67 is "5-", 5.00 is "5", 5.33 is "5+".
  function kpThirds(kp) { return Math.round(kp * 3); }
  function kpText(kp) {
    if (typeof kp !== "number" || !isFinite(kp) || kp < 0 || kp > 9) return "";
    var n = kpThirds(kp), level = Math.round(n / 3), rest = n - 3 * level;
    return String(level) + (rest < 0 ? "-" : rest > 0 ? "+" : "");
  }
  /** NOAA G level for a planetary Kp. 5-, 5 and 5+ count as Kp 5 (G1); NOAA puts 9- in G4 and only 9 in G5. */
  function gScaleFromKp(kp) {
    if (typeof kp !== "number" || !isFinite(kp)) return null;
    var n = kpThirds(kp);
    if (n >= 27) return 5;
    if (n >= 23) return 4;
    if (n >= 20) return 3;
    if (n >= 17) return 2;
    if (n >= 14) return 1;
    return 0;
  }
  /** Words SWPC uses in its forecast discussions below storm level: quiet (Kp 0 to 2), unsettled (3), active (4). */
  function kpActivity(kp) {
    var g = gScaleFromKp(kp);
    if (g === null) return "";
    if (g > 0) return "G" + g + " (" + SCALE_WORDS[g] + ") storm";
    var level = Math.round(kpThirds(kp) / 3);
    return level <= 2 ? "quiet" : level === 3 ? "unsettled" : "active";
  }
  /** NOAA S level from the >=10 MeV integral proton flux in pfu (particles / (cm^2 s sr)). */
  function sScaleFromProtonFlux(pfu) {
    if (typeof pfu !== "number" || !isFinite(pfu) || pfu < 0) return null;
    return pfu >= 1e5 ? 5 : pfu >= 1e4 ? 4 : pfu >= 1e3 ? 3 : pfu >= 100 ? 2 : pfu >= 10 ? 1 : 0;
  }
  /** NOAA R level from the GOES 0.1-0.8 nm X-ray flux in W/m^2. */
  function rScaleFromXray(flux) {
    if (typeof flux !== "number" || !isFinite(flux) || flux < 0) return null;
    return flux >= 2e-3 ? 5 : flux >= 1e-3 ? 4 : flux >= 1e-4 ? 3 : flux >= 5e-5 ? 2 : flux >= 1e-5 ? 1 : 0;
  }
  /** Flare class from the 0.1-0.8 nm flux: 2.3e-5 W/m^2 is M2.3. */
  function flareClass(flux) {
    if (typeof flux !== "number" || !isFinite(flux) || flux <= 0) return "";
    var classes = [["X", 1e-4], ["M", 1e-5], ["C", 1e-6], ["B", 1e-7], ["A", 1e-8]];
    for (var i = 0; i < classes.length; i++) {
      if (flux >= classes[i][1] || i === classes.length - 1) return classes[i][0] + (flux / classes[i][1]).toFixed(1);
    }
    return "";
  }

  /** SWPC time stamps ("2026-11-26 12:00:00.000", or ISO with or without Z) are UTC. Returns ms or NaN. */
  function parseSwpcTime(s) {
    if (typeof s !== "string") return NaN;
    var m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]00:?00)?$/.exec(s.trim());
    if (!m) return NaN;
    var ms = m[7] ? Math.round(Number("0." + m[7]) * 1000) : 0;
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], m[6] ? +m[6] : 0, ms);
  }
  function num(x) { if (x === null || x === undefined || x === "") return null; var v = Number(x); return isFinite(v) ? v : null; }

  /** Latest planetary Kp from products/noaa-planetary-k-index.json (array of rows with a header row, or of objects). */
  function latestKp(json) {
    if (!Array.isArray(json) || !json.length) return null;
    var rows = [], head = Array.isArray(json[0]) ? json[0] : null;
    var ti = head ? head.indexOf("time_tag") : -1, ki = head ? head.indexOf("Kp") : -1;
    json.forEach(function (r, i) {
      if (head && i === 0) return;
      var t, k;
      if (Array.isArray(r)) { t = parseSwpcTime(r[ti]); k = num(r[ki]); }
      else if (r && typeof r === "object") { t = parseSwpcTime(r.time_tag); k = num(r.Kp !== undefined ? r.Kp : r.kp_index); }
      if (isFinite(t) && k !== null) rows.push({ timeMs: t, kp: k });
    });
    rows.sort(function (a, b) { return a.timeMs - b.timeMs; });
    return rows.length ? rows[rows.length - 1] : null;
  }
  /** Latest value of one GOES channel from json/goes/primary/*.json (objects with time_tag, flux, energy). */
  function latestChannel(json, energy) {
    if (!Array.isArray(json)) return null;
    var best = null;
    json.forEach(function (r) {
      if (!r || r.energy !== energy) return;
      var t = parseSwpcTime(r.time_tag), f = num(r.flux);
      if (isFinite(t) && f !== null && (!best || t > best.timeMs)) best = { timeMs: t, flux: f };
    });
    return best;
  }
  function latestProtons10(json) { return latestChannel(json, ">=10 MeV"); }
  function latestXrayLong(json) { return latestChannel(json, "0.1-0.8nm"); }

  /** products/noaa-scales.json: "-1" the past 24 h maximum, "0" the latest observed, "1" to "3" the next three UTC
   *  days, with a predicted G level and probabilities (percent) of S1 or more, of R1-R2 and of R3 or more. */
  function parseScales(json) {
    if (!json || typeof json !== "object") return null;
    function obs(e) {
      if (!e) return null;
      return { date: e.DateStamp || null, G: num(e.G && e.G.Scale), S: num(e.S && e.S.Scale), R: num(e.R && e.R.Scale) };
    }
    var days = ["1", "2", "3"].map(function (k) {
      var e = json[k];
      if (!e) return null;
      return { date: e.DateStamp || null, G: num(e.G && e.G.Scale), sProb: num(e.S && e.S.Prob),
        rMinorProb: num(e.R && e.R.MinorProb), rMajorProb: num(e.R && e.R.MajorProb) };
    }).filter(Boolean);
    return { past24h: obs(json["-1"]), latest: obs(json["0"]), days: days };
  }
  /** products/alerts.json: newest first, each with its UTC time and the first ALERT/WARNING/WATCH/SUMMARY line. */
  function parseAlerts(json) {
    if (!Array.isArray(json)) return [];
    return json.map(function (a) {
      var text = String(a && a.message || "").replace(/\r/g, "");
      var title = "";
      text.split("\n").some(function (line) {
        if (/^(ALERT|WARNING|WATCH|SUMMARY|EXTENDED WARNING|CANCEL[A-Z ]*)\s*:/.test(line.trim())) { title = line.trim(); return true; }
        return false;
      });
      return { timeMs: parseSwpcTime(a && a.issue_datetime), productId: a && a.product_id || "", title: title, message: text.trim() };
    }).filter(function (a) { return isFinite(a.timeMs); }).sort(function (a, b) { return b.timeMs - a.timeMs; });
  }

  var CATEGORIES = { general: "General payload", constellation: "Constellation batch (released in a low orbit)", crewed: "Crewed" };
  /** A first guess at the launch's category from its Launch Library 2 record; the page lets the reader change it. */
  function classifyMission(raw) {
    var name = String(raw && raw.name || ""), mission = raw && raw.mission || {};
    var type = String(mission.type || "");
    if (/^(Human Exploration|Tourism)$/i.test(type) || /\b(Crew-\d|Soyuz MS|Shenzhou|Axiom|Ax-\d|Polaris|Boe-CFT|Starliner|Gaganyaan)\b/i.test(name)) return "crewed";
    if (/\b(Starlink|Kuiper|OneWeb|Qianfan|Guowang|SpaceSail)\b/i.test(name + " " + (mission.name || ""))) return "constellation";
    return "general";
  }
  /** One Launch Library 2 launch reduced to what the page uses. */
  function mapLL2Launch(raw) {
    var pad = raw && raw.pad || {}, loc = pad.location || {};
    var conf = raw && raw.rocket && raw.rocket.configuration;
    var netMs = Date.parse(raw && raw.net);
    var lat = pad.latitude === null || pad.latitude === undefined || pad.latitude === "" ? NaN : Number(pad.latitude);
    var lon = pad.longitude === null || pad.longitude === undefined || pad.longitude === "" ? NaN : Number(pad.longitude);
    return {
      id: "ll2:" + (raw && raw.id), source: "ll2", name: raw && raw.name || "Unnamed launch",
      netMs: isFinite(netMs) ? netMs : null, vehicle: conf && (conf.full_name || conf.name) || "",
      padName: pad.name || "", siteName: loc.name || "", countryCode: loc.country_code || "",
      lat: lat, lon: lon, category: classifyMission(raw),
      weatherProbability: raw && typeof raw.probability === "number" && raw.probability >= 0 ? raw.probability : null,
      recovery: null
    };
  }

  /** Index of the hourly step nearest tMs, or -1 when tMs lies outside the series by more than half an hour. */
  function hourIndex(timesSec, tMs) {
    if (!Array.isArray(timesSec) || !timesSec.length || !isFinite(tMs)) return -1;
    var t = tMs / 1000, best = -1, bestD = Infinity;
    timesSec.forEach(function (s, i) { var d = Math.abs(s - t); if (d < bestD) { bestD = d; best = i; } });
    return bestD <= 1800 ? best : -1;
  }
  /** The forecast values at the launch hour from an Open-Meteo hourly response (wind in knots, timeformat=unixtime). */
  function forecastAt(resp, tMs) {
    var h = resp && resp.hourly;
    if (!h) return null;
    var i = hourIndex(h.time, tMs);
    if (i < 0) return null;
    var pick = function (k) { return h[k] ? num(h[k][i]) : null; };
    return { timeMs: h.time[i] * 1000, windKt: pick("wind_speed_10m"), gustKt: pick("wind_gusts_10m"),
      windDirDeg: pick("wind_direction_10m"), upperWindKt: pick("wind_speed_250hPa"), temperatureC: pick("temperature_2m"),
      precipProb: pick("precipitation_probability"), weatherCode: pick("weather_code") };
  }
  function waveAt(resp, tMs) {
    var h = resp && resp.hourly;
    if (!h) return null;
    var i = hourIndex(h.time, tMs);
    return i < 0 ? null : num(h.wave_height && h.wave_height[i]);
  }

  function coord(x) { return (Math.round(x * 1e4) / 1e4).toFixed(4); }
  var URLS = {
    ll2: function (fromMs, toMs) {
      return "https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=50&ordering=net&net__gte=" +
        new Date(fromMs).toISOString() + "&net__lte=" + new Date(toMs).toISOString();
    },
    forecast: function (lat, lon) {
      return "https://api.open-meteo.com/v1/forecast?latitude=" + coord(lat) + "&longitude=" + coord(lon) +
        "&hourly=temperature_2m,precipitation_probability,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m,wind_speed_250hPa" +
        "&wind_speed_unit=kn&timeformat=unixtime&forecast_days=16";
    },
    marine: function (lat, lon) {
      return "https://marine-api.open-meteo.com/v1/marine?latitude=" + coord(lat) + "&longitude=" + coord(lon) +
        "&hourly=wave_height&timeformat=unixtime";
    },
    kp: "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json",
    scales: "https://services.swpc.noaa.gov/products/noaa-scales.json",
    alerts: "https://services.swpc.noaa.gov/products/alerts.json",
    protons: "https://services.swpc.noaa.gov/json/goes/primary/integral-protons-6-hour.json",
    xrays: "https://services.swpc.noaa.gov/json/goes/primary/xrays-6-hour.json"
  };

  /* The limits. Only the surface wind figure comes from a published vehicle criterion, and even it is applied to a
     different height here; every other figure is made up for this tool as a prompt to look closer. */
  var DEFAULT_LIMITS = { surfaceWindKt: 30, upperWindKt: 100, precipProb: 60, waveM: 3,
    gGeneral: 4, gConstellation: 2, sGeneral: 3, sCrewed: 1 };

  /** The space-weather levels that apply to a launch: G and S now, and the predicted G for the launch's UTC day
   *  when it is one of the three forecast days. */
  function spaceWeatherFor(swx, tMs) {
    if (!swx) return null;
    var date = isFinite(tMs) ? new Date(tMs).toISOString().slice(0, 10) : null;
    var day = null;
    if (swx.scales && date) swx.scales.days.forEach(function (d) { if (d.date === date) day = d; });
    return { gNow: swx.kp ? gScaleFromKp(swx.kp.kp) : null, sNow: swx.protons ? sScaleFromProtonFlux(swx.protons.flux) : null,
      gForecast: day ? day.G : null, forecastDate: day ? day.date : null };
  }

  /** Screens one launch. wx: forecastAt(...) or null; waveM: number or null (only when a recovery point is set);
   *  sw: spaceWeatherFor(...) or null. Each check has level "ok", "watch", "over" or "none" (no data). */
  function screen(wx, waveM, sw, category, limits) {
    var L = {};
    Object.keys(DEFAULT_LIMITS).forEach(function (k) {
      L[k] = limits && typeof limits[k] === "number" && isFinite(limits[k]) ? limits[k] : DEFAULT_LIMITS[k];
    });
    var checks = [];
    function add(id, label, value, unit, limitText, level, basis) {
      checks.push({ id: id, label: label, value: value, unit: unit, limit: limitText, level: value === null || value === undefined ? "none" : level, basis: basis });
    }
    var w = wx || {};
    add("surface-wind", "Surface wind (10 m, sustained)", w.windKt, "kt", "over " + L.surfaceWindKt + " kt",
      w.windKt > L.surfaceWindKt ? "over" : "ok",
      "Published for one vehicle: NASA's Falcon 9 / Crew Dragon criteria limit sustained wind at the 162 ft (49 m) level of the pad to 30 kt. The model's 10 m wind is usually lower than the wind at 49 m, so this check is indicative.");
    add("thunder", "Thunderstorm in the forecast", w.weatherCode === null || w.weatherCode === undefined ? null : (isThunder(w.weatherCode) ? "yes" : "no"), "",
      "any", isThunder(w.weatherCode) ? "over" : "ok",
      "Stands in for the Lightning Launch Commit Criteria (no launch within 10 nautical miles of lightning for 30 minutes, nor through or near thunderstorm anvils and debris clouds). The real rules use observed lightning, field mills and cloud types; a model's thunderstorm code is only a hint.");
    add("upper-wind", "Upper wind (250 hPa, about 34,000 ft)", w.upperWindKt, "kt", "at or over " + L.upperWindKt + " kt",
      w.upperWindKt >= L.upperWindKt ? "watch" : "ok",
      "Indicative, made up for this tool. Real upper-level limits are about wind shear and vehicle loads, judged from balloon profiles, not one speed.");
    add("precip", "Chance of precipitation", w.precipProb, "%", "at or over " + L.precipProb + " %",
      w.precipProb >= L.precipProb ? "watch" : "ok",
      "Indicative, made up for this tool. Rain is not itself a launch rule, but the cloud rules (thick cloud layers, disturbed weather) often come with it.");
    if (waveM !== undefined) {
      add("waves", "Wave height at the recovery point", waveM, "m", "at or over " + L.waveM + " m",
        waveM >= L.waveM ? "watch" : "ok",
        "Indicative, made up for this tool. Recovery ship and droneship sea-state limits are not published.");
    }
    var s = sw || {};
    var gLimit = category === "constellation" ? L.gConstellation : L.gGeneral;
    var gVal = s.gNow === null || s.gNow === undefined ? s.gForecast : (s.gForecast === null || s.gForecast === undefined ? s.gNow : Math.max(s.gNow, s.gForecast));
    add("g-scale", "Geomagnetic storm level (now, or forecast for the launch day)", gVal === null || gVal === undefined ? null : "G" + gVal, "",
      "G" + gLimit + " or higher", gVal >= gLimit ? "watch" : "ok",
      category === "constellation"
        ? "Indicative, made up for this tool. Storms heat and expand the upper atmosphere and raise drag; in February 2022 a G1 to G2 storm brought down most of a Starlink batch released at about 210 km."
        : "Indicative, made up for this tool. NOAA lists satellite surface charging, orientation problems and higher drag among G3 to G5 effects.");
    var sLimit = category === "crewed" ? L.sCrewed : L.sGeneral;
    add("s-scale", "Solar radiation storm level (now)", s.sNow === null || s.sNow === undefined ? null : "S" + s.sNow, "",
      "S" + sLimit + " or higher", s.sNow >= sLimit ? "watch" : "ok",
      category === "crewed"
        ? "Indicative, made up for this tool. Crewed missions watch any radiation storm; NOAA recommends astronauts avoid radiation exposure (for example on spacewalks) from S3."
        : "Indicative, made up for this tool. NOAA lists single-event upsets and noise in imaging systems among S3 effects on satellites.");
    var level = "none";
    if (checks.some(function (c) { return c.level === "over"; })) level = "over";
    else if (checks.some(function (c) { return c.level === "watch"; })) level = "watch";
    else if (checks.some(function (c) { return c.level === "ok"; })) level = "ok";
    return { level: level, checks: checks };
  }
  var LEVEL_TEXT = { over: "Over an indicative limit", watch: "Worth a closer look", ok: "Nothing flagged", none: "Not checked" };

  /** A "YYYY-MM-DDTHH:MM" input read as UTC; NaN when malformed. */
  function parseUtcInput(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(s || "").trim());
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], m[6] ? +m[6] : 0) : NaN;
  }
  function toUtcInput(ms) { return new Date(ms).toISOString().slice(0, 16); }

  return { KMH_PER_KNOT: KMH_PER_KNOT, SCALE_WORDS: SCALE_WORDS, WMO: WMO, wmoText: wmoText, isThunder: isThunder,
    kmhToKnots: kmhToKnots, kpText: kpText, gScaleFromKp: gScaleFromKp, kpActivity: kpActivity,
    sScaleFromProtonFlux: sScaleFromProtonFlux, rScaleFromXray: rScaleFromXray, flareClass: flareClass,
    parseSwpcTime: parseSwpcTime, latestKp: latestKp, latestProtons10: latestProtons10, latestXrayLong: latestXrayLong,
    parseScales: parseScales, parseAlerts: parseAlerts, CATEGORIES: CATEGORIES, classifyMission: classifyMission,
    mapLL2Launch: mapLL2Launch, hourIndex: hourIndex, forecastAt: forecastAt, waveAt: waveAt, URLS: URLS,
    DEFAULT_LIMITS: DEFAULT_LIMITS, spaceWeatherFor: spaceWeatherFor, screen: screen, LEVEL_TEXT: LEVEL_TEXT,
    parseUtcInput: parseUtcInput, toUtcInput: toUtcInput };
});

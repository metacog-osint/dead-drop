/* Past Weather page. Requests, parsing, METAR decoding and derived values are in ../lib/past-weather.js (tested in
   tests/past-weather.test.js); the WMO weather words come from ../lib/launch-weather.js and the grid-point distance
   from ../lib/distance-bearing.js. Network, only when a button is pressed: Open-Meteo archive API, Iowa
   Environmental Mesonet ASOS download. */
(function () {
  "use strict";
  var KEY = "past-weather";
  var P = DD.pastWeather, LW = DD.launchWeather, DB = DD.distanceBearing;
  var HOUR = 3600000;
  var era5 = null, metar = null, pasted = null;

  function f1(x) { return TB.fix(x, 1); }
  function tempText(c) { return c === null || c === undefined ? "–" : f1(c) + " °C (" + f1(P.cToF(c)) + " °F)"; }
  function pct(x) { return x === null || x === undefined ? "–" : TB.fix(x, 0) + " %"; }
  function windRow(dir, kt, gust) {
    if (kt === null || kt === undefined) return "–";
    var s = (dir === null ? "" : "from " + TB.fix(dir, 0) + "° (" + P.compass(dir) + ") ") + TB.fix(kt, 0) + " kt";
    return s + (gust !== null && gust !== undefined ? ", gusts " + TB.fix(gust, 0) + " kt" : "");
  }
  function offsetText(ms) {
    var m = Math.round(Math.abs(ms) / 60000);
    if (m === 0) return "at the time asked";
    var h = Math.floor(m / 60), mm = m % 60;
    return (h ? h + " h " : "") + mm + " min " + (ms < 0 ? "before" : "after") + " the time asked";
  }
  function setScroll(wrapId, btnId, n) {
    TB.$(wrapId).classList.remove("all");
    TB.$(btnId).hidden = n <= 10;
    TB.$(btnId).textContent = "Show all";
  }
  function toggleScroll(wrapId, btnId) {
    var on = TB.$(wrapId).classList.toggle("all");
    TB.$(btnId).textContent = on ? "Show fewer" : "Show all";
  }
  function inputs() {
    return { lat: TB.num("lat"), lon: TB.num("lon"), timeMs: P.parseUtcInput(TB.$("when").value),
      hours: Number(TB.$("window").value) || 6, station: TB.$("station").value.trim(), asTyped: TB.$("asTyped").checked };
  }
  function saveInputs() {
    var i = inputs();
    TB.save(KEY, { lat: i.lat, lon: i.lon, when: TB.$("when").value, window: TB.$("window").value, station: i.station, asTyped: i.asTyped });
  }
  function checkTime(t) {
    if (!isFinite(t)) throw new Error("Enter the date and time (UTC).");
    if (t > Date.now()) throw new Error("That time is in the future; this page looks up past weather only.");
  }

  // ---- ERA5 ----
  function getEra5() {
    TB.message("msg", "");
    var i = inputs(), url;
    try { checkTime(i.timeMs); url = P.openMeteoUrl({ lat: i.lat, lon: i.lon, timeMs: i.timeMs, hoursEitherSide: i.hours }); }
    catch (e) { return TB.message("msg", e.message, "error"); }
    saveInputs();
    var btn = TB.$("getEra5");
    btn.disabled = true;
    TB.message("msg", "Asking Open-Meteo…", "info");
    fetch(url).then(function (r) {
      return r.json().catch(function () { throw new Error("Open-Meteo answered " + r.status + "."); });
    }).then(function (d) {
      var p = P.parseOpenMeteo(d);
      era5 = { input: i, url: url, grid: p, fetchedMs: Date.now() };
      var lagDays = (Date.now() - i.timeMs) / 86400000;
      TB.message("msg", lagDays < 6 ? "ERA5 runs about five days behind real time, so hours this recent may be empty." : "", "info");
      renderEra5();
    }).catch(function (e) {
      TB.message("msg", "Open-Meteo did not answer: " + e.message, "error");
    }).then(function () { btn.disabled = false; });
  }

  function renderEra5() {
    var E = era5, i = E.input, rows = E.grid.rows;
    var lo = i.timeMs - i.hours * HOUR, hi = i.timeMs + i.hours * HOUR;
    var win = rows.filter(function (r) { return r.timeMs >= lo && r.timeMs <= hi; });
    var k = P.nearestIndex(rows.map(function (r) { return r.timeMs; }), i.timeMs, HOUR);
    var r = k >= 0 ? rows[k] : null;
    var hasData = r && r.temperatureC !== null;
    var dist = E.grid.gridLat !== null ? DB.distanceKm(i.lat, i.lon, E.grid.gridLat, E.grid.gridLon) : null;
    TB.$("era5Moment").textContent = r
      ? "Hour used: " + TB.time(r.timeMs) + ", " + offsetText(r.timeMs - i.timeMs) + ". Grid point " +
        TB.fix(E.grid.gridLat, 3) + ", " + TB.fix(E.grid.gridLon, 3) + (dist !== null ? ", " + TB.fix(dist, 1) + " km from your point" : "") +
        (E.grid.elevationM !== null ? ", elevation " + TB.fix(E.grid.elevationM, 0) + " m" : "") + "."
      : "No hour within an hour of your time came back.";
    if (!hasData) {
      TB.results("era5", [{ k: "Reanalysis", v: "No data for this hour yet", cls: "warn" }]);
    } else {
      var rh = P.relativeHumidity(r.temperatureC, r.dewPointC), fl = P.feelsLike(r.temperatureC, r.windKt, rh);
      var items = [
        { k: "Temperature (2 m)", v: tempText(r.temperatureC) },
        { k: "Dew point (2 m)", v: tempText(r.dewPointC) },
        { k: "Relative humidity (Magnus)", v: pct(rh), title: "Worked out here from temperature and dew point" },
        { k: "Relative humidity (Open-Meteo)", v: pct(r.relativeHumidity) },
        { k: "Wind (10 m)", v: windRow(r.windDirDeg, r.windKt, r.gustKt) },
        { k: "Cloud cover", v: pct(r.cloudCover), title: "Share of the sky covered, all levels" },
        { k: "Cloud low / mid / high", v: pct(r.cloudLow) + " / " + pct(r.cloudMid) + " / " + pct(r.cloudHigh) },
        { k: "Precipitation, hour before", v: TB.fix(r.precipitationMm, 1), u: "mm" },
        { k: "Snowfall, hour before", v: TB.fix(r.snowfallCm, 2), u: "cm" },
        { k: "Sea-level pressure", v: TB.fix(r.pressureMslHpa, 1), u: "hPa (" + TB.fix(r.pressureMslHpa / P.HPA_PER_INHG, 2) + " inHg)" },
        { k: "Surface pressure", v: TB.fix(r.surfacePressureHpa, 1), u: "hPa" },
        { k: "Weather (model code)", v: r.weatherCode === null ? "–" : LW.wmoText(r.weatherCode), title: "WMO code " + r.weatherCode + ", worked out from model cloud and precipitation" }
      ];
      if (fl.windChillF !== null) items.push({ k: "Wind chill", v: tempText(fl.windChillC) });
      if (fl.heatIndexF !== null) items.push({ k: "Heat index", v: tempText(fl.heatIndexC), cls: fl.heatIndexF >= 103 ? "warn" : null });
      TB.results("era5", items);
    }
    TB.table("era5Hours", ["Hour", "Temp °C", "Dew pt °C", "RH %", "Wind", "Cloud %", "Precip mm", "MSL hPa", "Weather"],
      win.map(function (x) {
        return [TB.time(x.timeMs), f1(x.temperatureC), f1(x.dewPointC), TB.fix(P.relativeHumidity(x.temperatureC, x.dewPointC), 0),
          windRow(x.windDirDeg, x.windKt, x.gustKt), TB.fix(x.cloudCover, 0), TB.fix(x.precipitationMm, 1),
          TB.fix(x.pressureMslHpa, 1), x.weatherCode === null ? "–" : LW.wmoText(x.weatherCode)];
      }));
    setScroll("era5Wrap", "era5All", win.length);
  }

  // ---- METAR ----
  function getMetar() {
    TB.message("metarMsg", "");
    TB.$("metarLink").hidden = true;
    var i = inputs(), url;
    try {
      checkTime(i.timeMs);
      url = P.iemUrl({ station: i.station, keepAsTyped: i.asTyped, startMs: i.timeMs - i.hours * HOUR, endMs: i.timeMs + i.hours * HOUR });
    } catch (e) { return TB.message("metarMsg", e.message, "error"); }
    saveInputs();
    var btn = TB.$("getMetar");
    btn.disabled = true;
    TB.message("metarMsg", "Asking the Iowa Environmental Mesonet…", "info");
    fetch(url).then(function (r) {
      if (!r.ok) throw new Error("it answered " + r.status);
      return r.text();
    }).then(function (txt) {
      var list = P.parseIemCsv(txt);
      metar = { input: i, url: url, list: list, fetchedMs: Date.now() };
      TB.message("metarMsg", list.length ? "" : "No reports for that station in the window. Check the identifier, or try a wider window.", "info");
      renderMetar();
    }).catch(function (e) {
      TB.message("metarMsg", "The Mesonet could not be read from this page (" + e.message + "). Open the request yourself and paste a report into the decoder.", "error");
      var p = TB.$("metarLink");
      TB.clear(p);
      p.appendChild(TB.el("a", { href: url, target: "_blank", rel: "noopener", text: "Open the Mesonet request in a new tab" }));
      p.hidden = false;
    }).then(function () { btn.disabled = false; });
  }

  function decodedItems(d) {
    var clouds = d.clouds.length ? d.clouds.map(function (c) {
      return c.baseFt !== null ? c.cover + " at " + c.baseFt.toLocaleString("en-US") + " ft" + (c.type ? " (" + c.type + ")" : "") : c.text;
    }).join("; ") : (d.cavok ? "none below 5,000 ft" : d.verticalVisibilityFt !== null ? "sky hidden (vertical visibility " +
      d.verticalVisibilityFt.toLocaleString("en-US") + " ft)" : "–");
    var t = d.precise ? d.precise.temperatureC : d.temperatureC, td = d.precise ? d.precise.dewPointC : d.dewPointC;
    var rh = P.relativeHumidity(t, td), fl = P.feelsLike(t, d.wind ? d.wind.speedKt : null, rh);
    var items = [
      { k: "Station", v: d.station + (d.auto ? " (automated report)" : "") },
      { k: "Wind", v: P.windText(d.wind) || "–" },
      { k: "Visibility", v: P.visibilityText(d.visibility) || "–" },
      { k: "Weather", v: d.weather.length ? d.weather.map(function (w) { return w.text; }).join(", ") : "none reported" },
      { k: "Cloud", v: clouds },
      { k: "Ceiling", v: d.ceilingFt !== null ? d.ceilingFt.toLocaleString("en-US") : "none", u: d.ceilingFt !== null ? "ft above the airport" : "" },
      { k: "Temperature", v: tempText(t), title: d.precise ? "From the remarks T group, to a tenth of a degree" : null },
      { k: "Dew point", v: tempText(td) },
      { k: "Relative humidity (Magnus)", v: pct(rh) },
      { k: "Altimeter setting", v: d.altimeter ? TB.fix(d.altimeter.inHg, 2) + " inHg / " + TB.fix(d.altimeter.hPa, 1) + " hPa" : "–",
        title: d.altimeter ? "As sent: " + d.altimeter.raw : null }
    ];
    if (d.seaLevelPressureHpa !== null) items.push({ k: "Sea-level pressure (remarks)", v: TB.fix(d.seaLevelPressureHpa, 1), u: "hPa" });
    if (fl.windChillF !== null) items.push({ k: "Wind chill", v: tempText(fl.windChillC) });
    if (fl.heatIndexF !== null) items.push({ k: "Heat index", v: tempText(fl.heatIndexC), cls: fl.heatIndexF >= 103 ? "warn" : null });
    return items;
  }
  function extraNodes(d) {
    var bits = [];
    if (d.rvr.length) bits.push("Runway visual range: " + d.rvr.map(function (x) {
      return "runway " + x.runway + " " + (x.moreThan ? "more than " : x.lessThan ? "less than " : "") + x.value +
        (x.upTo ? " to " + x.upTo : "") + " " + x.unit + (x.tendency ? ", " + x.tendency : "");
    }).join("; ") + ".");
    if (d.stationType) bits.push("Station: " + d.stationType + ".");
    if (d.trend) bits.push("Trend as sent: " + d.trend + ".");
    if (d.unparsed.length) bits.push("Not decoded here: " + d.unparsed.join(" ") + ".");
    if (d.remarks) bits.push("Remarks as sent: " + d.remarks);
    return bits.map(function (b) { return TB.el("p", { class: "small", text: b }); });
  }
  function showDecoded(d, momentText) {
    TB.$("metarMoment").textContent = momentText;
    TB.$("metarRaw").textContent = d.raw;
    TB.results("metarDecoded", decodedItems(d));
    var ex = TB.$("metarExtra");
    TB.clear(ex);
    extraNodes(d).forEach(function (n) { ex.appendChild(n); });
  }

  function renderMetar() {
    var M = metar, i = M.input, list = M.list;
    var k = P.nearestIndex(list.map(function (x) { return x.validMs; }), i.timeMs);
    if (k >= 0) {
      var x = list[k], d;
      try { d = P.decodeMetar(x.metar); } catch (e) { d = null; }
      M.nearest = { validUtc: new Date(x.validMs).toISOString(), raw: x.metar, decoded: d };
      if (d) showDecoded(d, "Report nearest your time: " + TB.time(x.validMs) + ", " + offsetText(x.validMs - i.timeMs) +
        (x.lat !== null ? ". Station at " + TB.fix(x.lat, 4) + ", " + TB.fix(x.lon, 4) +
          (isFinite(i.lat) && isFinite(i.lon) ? ", " + TB.fix(DB.distanceKm(i.lat, i.lon, x.lat, x.lon), 1) + " km from your point" : "") : "") + ".");
      else {
        TB.$("metarMoment").textContent = "The report nearest your time (" + TB.time(x.validMs) + ") could not be decoded; here it is as sent.";
        TB.$("metarRaw").textContent = x.metar;
        TB.clear(TB.$("metarDecoded"));
        TB.clear(TB.$("metarExtra"));
      }
    } else {
      TB.$("metarMoment").textContent = "";
      TB.$("metarRaw").textContent = "";
      TB.clear(TB.$("metarDecoded"));
      TB.clear(TB.$("metarExtra"));
    }
    TB.table("metarList", ["Time", "Report", ""], list.map(function (x) {
      var b = TB.el("button", { type: "button", text: "Decode" });
      b.addEventListener("click", function () {
        try { showDecoded(P.decodeMetar(x.metar), "Report at " + TB.time(x.validMs) + ", " + offsetText(x.validMs - i.timeMs) + "."); }
        catch (e) { TB.message("metarMsg", e.message, "error"); }
      });
      return [TB.time(x.validMs), TB.el("span", { class: "mono", text: x.metar }), b];
    }));
    setScroll("metarWrap", "metarAll", list.length);
  }

  function decodePasted() {
    TB.message("msg", "");
    var txt = TB.$("paste").value.trim();
    if (!txt) return TB.message("msg", "Paste a METAR or SPECI first.", "error");
    try {
      var d = P.decodeMetar(txt.split(/\r?\n/)[0]);
      var ref = P.parseUtcInput(TB.$("when").value);
      var t = P.metarTimeMs(d.day, d.hour, d.minute, isFinite(ref) ? ref : Date.now());
      pasted = d;
      showDecoded(d, "Pasted report" + (t !== null ? ", day " + d.day + " at " + String(d.hour).padStart(2, "0") + ":" +
        String(d.minute).padStart(2, "0") + " UTC (taken as " + TB.time(t) + ", the nearest such day to your time)" : "") + ".");
    } catch (e) { TB.message("msg", e.message, "error"); }
  }

  function copy() {
    if (!era5 && !metar && !pasted) return TB.message("msg", "Get or decode something first.", "info");
    var out = { askedUtc: isFinite(inputs().timeMs) ? new Date(inputs().timeMs).toISOString() : null, lat: inputs().lat, lon: inputs().lon };
    if (era5) {
      var k = P.nearestIndex(era5.grid.rows.map(function (r) { return r.timeMs; }), era5.input.timeMs, HOUR);
      var r = k >= 0 ? era5.grid.rows[k] : null;
      out.era5 = { source: "Open-Meteo Historical Weather API, ERA5 (CC BY 4.0); a reanalysis grid value, not an observation",
        request: era5.url, gridLat: era5.grid.gridLat, gridLon: era5.grid.gridLon, gridElevationM: era5.grid.elevationM,
        hourUtc: r ? new Date(r.timeMs).toISOString() : null, values: r,
        relativeHumidityMagnus: r ? P.relativeHumidity(r.temperatureC, r.dewPointC) : null };
    }
    if (metar) out.metar = { source: "Iowa Environmental Mesonet ASOS archive", request: metar.url, nearest: metar.nearest || null,
      reports: metar.list.map(function (x) { return { validUtc: new Date(x.validMs).toISOString(), raw: x.metar }; }) };
    if (pasted) out.pastedMetar = pasted;
    TB.copyJSON(out).then(function () { TB.message("msg", "Copied.", "info"); },
      function () { TB.message("msg", "This browser would not let the page use the clipboard.", "error"); });
  }

  TB.ready(function () {
    var s = TB.load(KEY) || {};
    if (isFinite(s.lat)) TB.$("lat").value = s.lat;
    if (isFinite(s.lon)) TB.$("lon").value = s.lon;
    if (typeof s.when === "string" && isFinite(P.parseUtcInput(s.when))) TB.$("when").value = s.when;
    else TB.$("when").value = P.toUtcInput(Math.floor((Date.now() - 7 * 86400000) / HOUR) * HOUR);
    if (["3", "6", "12"].indexOf(s.window) >= 0) TB.$("window").value = s.window;
    if (typeof s.station === "string") TB.$("station").value = s.station;
    TB.$("asTyped").checked = !!s.asTyped;
    TB.$("form").addEventListener("submit", function (ev) { ev.preventDefault(); getEra5(); });
    TB.$("getMetar").addEventListener("click", getMetar);
    TB.$("decode").addEventListener("click", decodePasted);
    TB.$("copy").addEventListener("click", copy);
    TB.$("era5All").addEventListener("click", function () { toggleScroll("era5Wrap", "era5All"); });
    TB.$("metarAll").addEventListener("click", function () { toggleScroll("metarWrap", "metarAll"); });
  });
})();

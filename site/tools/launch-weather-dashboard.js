/* Launch Weather Dashboard page. The parsing, scales and screening are in ../lib/launch-weather.js (tested in
   tests/launch-weather.test.js). Network, only when a button is pressed: Launch Library 2, NOAA SWPC, Open-Meteo. */
(function () {
  "use strict";
  var KEY = "launch-weather";
  var W = DD.launchWeather;
  var LIMIT_IDS = Object.keys(W.DEFAULT_LIMITS);
  var ll2 = [], custom = [], swx = null, wx = {}, waves = {}, cats = {}, selected = null, rendered = [];

  function key(lat, lon) { return lat.toFixed(4) + "," + lon.toFixed(4); }
  function isPos(lat, lon) { return isFinite(lat) && isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180; }
  function all() { return ll2.concat(custom); }
  function find(id) { return all().filter(function (l) { return l.id === id; })[0] || null; }
  function catOf(l) { return cats[l.id] || l.category; }
  function limits() {
    var o = {};
    LIMIT_IDS.forEach(function (k) { var v = TB.num(k); o[k] = isFinite(v) && v >= 0 ? v : W.DEFAULT_LIMITS[k]; });
    return o;
  }
  function saveAll() {
    TB.save(KEY, { days: TB.$("days").value, country: TB.$("country").value, limits: limits(), cats: cats });
    TB.save(KEY + "-custom", custom);
  }
  function getJSON(url) {
    return fetch(url).then(function (r) {
      if (r.status === 429) throw new Error("rate limit reached; try again later");
      if (!r.ok) throw new Error("answered " + r.status);
      return r.json();
    });
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

  function fetchForecasts(list) {
    var need = {};
    list.forEach(function (l) {
      if (isPos(l.lat, l.lon) && !wx[key(l.lat, l.lon)]) need[key(l.lat, l.lon)] = { lat: l.lat, lon: l.lon, marine: false };
      if (l.recovery && !waves[key(l.recovery.lat, l.recovery.lon)]) need["m" + key(l.recovery.lat, l.recovery.lon)] = { lat: l.recovery.lat, lon: l.recovery.lon, marine: true };
    });
    var failed = 0;
    return Promise.all(Object.keys(need).map(function (k) {
      var n = need[k];
      return getJSON(n.marine ? W.URLS.marine(n.lat, n.lon) : W.URLS.forecast(n.lat, n.lon)).then(function (d) {
        (n.marine ? waves : wx)[key(n.lat, n.lon)] = { resp: d, fetchedMs: Date.now() };
      }, function () { failed++; });
    })).then(function () { return failed; });
  }

  function loadSpaceWeather() {
    var parts = { kp: W.URLS.kp, scales: W.URLS.scales, alerts: W.URLS.alerts, protons: W.URLS.protons, xrays: W.URLS.xrays };
    var out = { fetchedMs: Date.now(), errors: [] };
    return Promise.all(Object.keys(parts).map(function (k) {
      return getJSON(parts[k]).then(function (d) { out[k + "Raw"] = d; }, function (e) { out.errors.push(k + " (" + e.message + ")"); });
    })).then(function () {
      swx = { fetchedMs: out.fetchedMs, errors: out.errors,
        kp: out.kpRaw ? W.latestKp(out.kpRaw) : null,
        protons: out.protonsRaw ? W.latestProtons10(out.protonsRaw) : null,
        xray: out.xraysRaw ? W.latestXrayLong(out.xraysRaw) : null,
        scales: out.scalesRaw ? W.parseScales(out.scalesRaw) : null,
        alerts: out.alertsRaw ? W.parseAlerts(out.alertsRaw) : [] };
    });
  }

  function loadAll() {
    TB.message("msg", "");
    var btn = TB.$("load");
    btn.disabled = true;
    TB.message("msg", "Loading launches, space weather and forecasts…", "info");
    var now = Date.now(), days = Number(TB.$("days").value) || 7, notes = [];
    var launches = getJSON(W.URLS.ll2(now - 3600000, now + days * 86400000)).then(function (d) {
      ll2 = (d.results || []).map(W.mapLL2Launch);
    }, function (e) { notes.push("Launch Library 2 " + e.message + "."); });
    Promise.all([launches, loadSpaceWeather()]).then(function () {
      return fetchForecasts(all());
    }).then(function (failed) {
      if (failed) notes.push(failed + " Open-Meteo request" + (failed > 1 ? "s" : "") + " failed.");
      if (swx && swx.errors.length) notes.push("SWPC: no data for " + swx.errors.join(", ") + ".");
      TB.message("msg", notes.length ? notes.join(" ") : "Loaded at " + TB.time(Date.now()) + ".", notes.length ? "error" : "info");
      saveAll();
      render();
    }).then(function () { btn.disabled = false; }, function (e) { btn.disabled = false; TB.message("msg", e.message, "error"); });
  }

  function screenOf(l) {
    var f = isPos(l.lat, l.lon) && wx[key(l.lat, l.lon)] ? W.forecastAt(wx[key(l.lat, l.lon)].resp, l.netMs) : null;
    var waveM;
    if (l.recovery) {
      var m = waves[key(l.recovery.lat, l.recovery.lon)];
      waveM = m ? W.waveAt(m.resp, l.netMs) : null;
    }
    var sw = W.spaceWeatherFor(swx, l.netMs);
    return { forecast: f, waveM: waveM, space: sw, result: W.screen(f, waveM, sw, catOf(l), limits()) };
  }
  function levelSpan(level) { return TB.el("span", { class: "lwd-" + level, text: W.LEVEL_TEXT[level] }); }

  function renderSpace() {
    if (!swx) return;
    TB.message("swxMsg", swx.errors.length ? "Not available: " + swx.errors.join(", ") + "." : "", "error");
    var kp = swx.kp, p = swx.protons, x = swx.xray, past = swx.scales && swx.scales.past24h;
    var g = kp ? W.gScaleFromKp(kp.kp) : null, s = p ? W.sScaleFromProtonFlux(p.flux) : null, r = x ? W.rScaleFromXray(x.flux) : null;
    var cls = function (n) { return n === null ? null : n >= 3 ? "alarm" : n >= 1 ? "warn" : "ok"; };
    TB.results("swx", [
      { k: "Planetary Kp (latest 3 hours)", v: kp ? W.kpText(kp.kp) + " (" + TB.fix(kp.kp, 2) + ")" : "–", cls: cls(g) },
      { k: "Geomagnetic", v: kp ? W.kpActivity(kp.kp) : "–", cls: cls(g) },
      { k: "Protons above 10 MeV", v: p ? TB.fix(p.flux, p.flux < 10 ? 2 : 0) : "–", u: "pfu", cls: cls(s) },
      { k: "Solar radiation storm", v: s === null ? "–" : "S" + s + " (" + W.SCALE_WORDS[s] + ")", cls: cls(s) },
      { k: "X-ray flux, 0.1-0.8 nm", v: x ? W.flareClass(x.flux) : "–", cls: cls(r) },
      { k: "Radio blackout", v: r === null ? "–" : "R" + r + " (" + W.SCALE_WORDS[r] + ")", cls: cls(r) },
      { k: "Past 24 h maximum", v: past ? "G" + (past.G === null ? "–" : past.G) + " S" + (past.S === null ? "–" : past.S) + " R" + (past.R === null ? "–" : past.R) : "–" }
    ]);
    var bits = [];
    if (kp) bits.push("Kp for the 3 hours from " + TB.time(kp.timeMs));
    if (p) bits.push("protons at " + TB.time(p.timeMs));
    if (x) bits.push("X-rays at " + TB.time(x.timeMs));
    TB.$("swxNote").textContent = bits.length ? "Measured: " + bits.join("; ") + ". Source: NOAA SWPC." : "";
    var days = swx.scales ? swx.scales.days : [];
    var pct = function (v) { return v === null ? "–" : v + " %"; };
    TB.table("swxDays", ["UTC day", "Predicted G level", "Chance of S1 or more", "Chance of R1 to R2", "Chance of R3 or more"],
      days.map(function (d) { return [d.date || "–", d.G === null ? "–" : "G" + d.G, pct(d.sProb), pct(d.rMinorProb), pct(d.rMajorProb)]; }));
    var alerts = swx.alerts || [];
    TB.table("alerts", ["Issued", "Product", "Message"], alerts.map(function (a) {
      var det = TB.el("details", { class: "lwd-alert" }, [TB.el("summary", { text: a.title || "Message" }), TB.el("pre", { text: a.message })]);
      return [TB.time(a.timeMs), a.productId || "–", det];
    }));
    setScroll("alertWrap", "alertAll", alerts.length);
  }

  function renderCountries() {
    var sel = TB.$("country"), was = sel.value, codes = {};
    ll2.forEach(function (l) { if (l.countryCode) codes[l.countryCode] = true; });
    TB.clear(sel);
    sel.appendChild(TB.el("option", { value: "all", text: "All" }));
    Object.keys(codes).sort().forEach(function (c) { sel.appendChild(TB.el("option", { value: c, text: c })); });
    if (custom.length) sel.appendChild(TB.el("option", { value: "custom", text: "Your launches" }));
    sel.value = Array.prototype.some.call(sel.options, function (o) { return o.value === was; }) ? was : "all";
  }

  function render() {
    renderSpace();
    renderCountries();
    var c = TB.$("country").value;
    var list = all().filter(function (l) {
      return c === "all" || (c === "custom" ? l.source === "custom" : l.countryCode === c);
    }).sort(function (a, b) { return (a.netMs === null ? Infinity : a.netMs) - (b.netMs === null ? Infinity : b.netMs); });
    rendered = list.map(function (l) { return { launch: l, s: screenOf(l) }; });
    TB.table("launches", ["Earliest time", "Launch", "Vehicle", "Site", "Kind", "Screening", "Published weather probability", ""],
      rendered.map(function (x) {
        var l = x.launch, flagged = x.s.result.checks.filter(function (k) { return k.level === "over" || k.level === "watch"; });
        var cell = TB.el("span", null, [levelSpan(x.s.result.level)].concat(flagged.length ? [TB.el("br"), flagged.map(function (k) { return k.label; }).join("; ")] : []));
        var b = TB.el("button", { type: "button", text: "Details" });
        b.addEventListener("click", function () { selected = l.id; renderDetail(true); });
        return [l.netMs === null ? "–" : TB.time(l.netMs), l.name, l.vehicle || "–", l.siteName || l.padName || "–",
          W.CATEGORIES[catOf(l)], cell, l.weatherProbability === null ? "–" : l.weatherProbability + " %", b];
      }));
    setScroll("launchWrap", "launchAll", rendered.length);
    renderDetail(false);
  }

  function renderDetail(scroll) {
    var l = selected ? find(selected) : null;
    TB.$("detail").hidden = !l;
    if (!l) return;
    var s = screenOf(l);
    TB.$("dName").textContent = l.name;
    TB.results("dFacts", [
      { k: "Earliest launch time", v: l.netMs === null ? "–" : TB.time(l.netMs) },
      { k: "Site", v: l.siteName || "–" },
      { k: "Pad", v: l.padName || "–" },
      { k: "Pad position", v: isPos(l.lat, l.lon) ? TB.fix(l.lat, 4) + ", " + TB.fix(l.lon, 4) : "–" },
      { k: "Forecast hour used", v: s.forecast ? TB.time(s.forecast.timeMs) : "None (launch beyond the forecast, or no forecast loaded)" },
      { k: "Space-weather forecast day", v: s.space && s.space.forecastDate ? s.space.forecastDate + " UTC" : "None (current conditions only)" },
      { k: "Screening", v: W.LEVEL_TEXT[s.result.level], cls: s.result.level === "over" ? "alarm" : s.result.level === "watch" ? "warn" : s.result.level === "ok" ? "ok" : null }
    ]);
    TB.$("dCat").value = catOf(l);
    TB.table("dChecks", ["Check", "At launch", "Flagged when", "Result", "Basis"], s.result.checks.map(function (k) {
      var v = k.value === null || k.value === undefined ? "–" : (typeof k.value === "number" ? TB.fix(k.value, k.unit === "m" ? 1 : 0) : k.value) + (k.unit && k.value !== null && k.value !== undefined ? " " + k.unit : "");
      return [k.label, v, k.limit, levelSpan(k.level), k.basis];
    }));
    var f = s.forecast, extra = [];
    if (f) {
      if (f.gustKt !== null) extra.push("gusts " + TB.fix(f.gustKt, 0) + " kt");
      if (f.windDirDeg !== null) extra.push("wind from " + TB.fix(f.windDirDeg, 0) + "° true");
      if (f.temperatureC !== null) extra.push(TB.fix(f.temperatureC, 1) + " °C");
      if (f.weatherCode !== null) extra.push(W.wmoText(f.weatherCode).toLowerCase());
    }
    TB.$("dNote").textContent = (extra.length ? "Also forecast for that hour: " + extra.join(", ") + ". " : "") +
      "Forecast: Open-Meteo, at the pad's position. A screening aid only, not a launch decision.";
    TB.$("dRLat").value = l.recovery ? l.recovery.lat : "";
    TB.$("dRLon").value = l.recovery ? l.recovery.lon : "";
    TB.$("dRemove").hidden = l.source !== "custom";
    if (scroll) TB.$("detail").scrollIntoView({ block: "nearest" });
  }

  function addCustom() {
    TB.message("msg", "");
    var t = W.parseUtcInput(TB.$("cTime").value), lat = TB.num("cLat"), lon = TB.num("cLon");
    var rlat = TB.num("cRLat"), rlon = TB.num("cRLon");
    if (!isFinite(t)) return TB.message("msg", "Enter the launch time (UTC).", "error");
    if (!isPos(lat, lon)) return TB.message("msg", "Enter the pad's latitude (-90 to 90) and longitude (-180 to 180).", "error");
    var rec = null;
    if (isFinite(rlat) || isFinite(rlon)) {
      if (!isPos(rlat, rlon)) return TB.message("msg", "Enter both recovery coordinates, or neither.", "error");
      rec = { lat: rlat, lon: rlon };
    }
    var l = { id: "custom:" + Date.now(), source: "custom", name: TB.$("cName").value.trim() || "Your launch", netMs: t,
      vehicle: "", padName: "Your position", siteName: "Your position", countryCode: "", lat: lat, lon: lon,
      category: TB.$("cCat").value in W.CATEGORIES ? TB.$("cCat").value : "general", weatherProbability: null, recovery: rec };
    custom.push(l);
    selected = l.id;
    saveAll();
    TB.message("msg", "Getting the forecast for your launch…", "info");
    Promise.all([fetchForecasts([l]), swx ? null : loadSpaceWeather()]).then(function (r) {
      TB.message("msg", r[0] ? "Open-Meteo did not answer; the launch is listed without a forecast." : "", r[0] ? "error" : "info");
      render();
      renderDetail(true);
    });
  }

  TB.ready(function () {
    [TB.$("cCat"), TB.$("dCat")].forEach(function (sel) {
      Object.keys(W.CATEGORIES).forEach(function (k) { sel.appendChild(TB.el("option", { value: k, text: W.CATEGORIES[k] })); });
    });
    var saved = TB.load(KEY) || {};
    LIMIT_IDS.forEach(function (k) {
      var v = saved.limits && saved.limits[k];
      TB.$(k).value = typeof v === "number" && isFinite(v) ? v : W.DEFAULT_LIMITS[k];
    });
    if (["3", "7", "10", "14"].indexOf(saved.days) >= 0) TB.$("days").value = saved.days;
    if (saved.cats && typeof saved.cats === "object") Object.keys(saved.cats).forEach(function (k) { if (W.CATEGORIES[saved.cats[k]]) cats[k] = saved.cats[k]; });
    var sc = TB.load(KEY + "-custom");
    if (Array.isArray(sc)) custom = sc.filter(function (l) { return l && l.source === "custom" && isFinite(l.netMs) && isPos(l.lat, l.lon); });
    TB.$("cTime").value = W.toUtcInput(Math.ceil(Date.now() / 3600000) * 3600000);
    TB.$("form").addEventListener("submit", function (ev) { ev.preventDefault(); loadAll(); });
    TB.$("cAdd").addEventListener("click", addCustom);
    LIMIT_IDS.forEach(function (k) { TB.$(k).addEventListener("change", function () { saveAll(); render(); }); });
    TB.$("resetLimits").addEventListener("click", function () {
      LIMIT_IDS.forEach(function (k) { TB.$(k).value = W.DEFAULT_LIMITS[k]; });
      saveAll(); render();
    });
    TB.$("country").addEventListener("change", function () { saveAll(); render(); });
    TB.$("dCat").addEventListener("change", function () {
      if (!selected) return;
      cats[selected] = TB.$("dCat").value;
      saveAll(); render();
    });
    TB.$("dWaves").addEventListener("click", function () {
      var l = selected ? find(selected) : null, lat = TB.num("dRLat"), lon = TB.num("dRLon");
      if (!l) return;
      if (!isPos(lat, lon)) return TB.message("dMsg", "Enter the recovery point's latitude and longitude.", "error");
      l.recovery = { lat: lat, lon: lon };
      saveAll();
      TB.message("dMsg", "Asking Open-Meteo Marine…", "info");
      fetchForecasts([l]).then(function (failed) {
        TB.message("dMsg", failed ? "Open-Meteo Marine did not answer for that point." : "", "error");
        render();
      });
    });
    TB.$("dRemove").addEventListener("click", function () {
      custom = custom.filter(function (l) { return l.id !== selected; });
      delete cats[selected];
      selected = null;
      saveAll(); render();
    });
    TB.$("launchAll").addEventListener("click", function () { toggleScroll("launchWrap", "launchAll"); });
    TB.$("alertAll").addEventListener("click", function () { toggleScroll("alertWrap", "alertAll"); });
    TB.$("copy").addEventListener("click", function () {
      if (!rendered.length && !swx) return TB.message("msg", "Load launches first.", "info");
      var out = { note: "Indicative screening only, not a launch decision.", limits: limits(),
        spaceWeather: swx ? { fetchedUtc: new Date(swx.fetchedMs).toISOString(), kp: swx.kp, protons10MeV: swx.protons,
          xray: swx.xray, scales: swx.scales } : null,
        launches: rendered.map(function (x) {
          var l = x.launch;
          return { name: l.name, earliestUtc: l.netMs === null ? null : new Date(l.netMs).toISOString(), vehicle: l.vehicle,
            site: l.siteName, lat: l.lat, lon: l.lon, kind: catOf(l), publishedWeatherProbability: l.weatherProbability,
            screening: x.s.result.level, checks: x.s.result.checks.map(function (k) { return { id: k.id, value: k.value, level: k.level }; }) };
        }) };
      TB.copyJSON(out).then(function () { TB.message("msg", "Copied.", "info"); },
        function () { TB.message("msg", "This browser would not let the page use the clipboard.", "error"); });
    });
    if (custom.length) render();
  });
})();

/* Launch Site Database page. The list and the maths are in ../lib/launch-sites.js (tested in
   tests/launch-sites.test.js); weather code words come from ../lib/launch-weather.js. Network: OpenStreetMap tiles,
   and Open-Meteo and Launch Library 2 only when their buttons are pressed. */
(function () {
  "use strict";
  var KEY = "launch-site-database";
  var LS = DD.launchSites, LW = DD.launchWeather;
  var FILTERS = ["text", "launchType", "country", "status", "era", "capability", "sort"];
  var map = null, layer = null, selectedId = null, compareIds = [], rows = [], upcoming = null, lastWeather = null;
  var byId = {};
  LS.SITES.forEach(function (s) { byId[s.id] = s; });
  var TYPE_COLOUR = { "orbital": "--plot-1", "suborbital": "--plot-2", "horizontal": "--plot-3", "test-range": "--plot-4", "multi-capability": "--warn" };

  function cssVar(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name);
    return (v && v.trim()) || fallback;
  }
  function colourOf(type) { return cssVar(TYPE_COLOUR[type] || "--muted", "#777"); }
  function fill(sel, obj) {
    Object.keys(obj).forEach(function (k) { sel.appendChild(TB.el("option", { value: k, text: obj[k] })); });
  }
  function point() {
    var lat = TB.num("lat"), lon = TB.num("lon");
    return { lat: lat, lon: lon, given: isFinite(lat) || isFinite(lon) };
  }
  function query() {
    var q = {};
    FILTERS.forEach(function (k) { q[k] = TB.$(k).value; });
    return q;
  }
  function km(x) { return x === null ? "–" : x < 10 ? TB.fix(x, 2) : TB.fix(x, 0); }
  function firstText(s) { return s.firstLaunch === null ? "None yet" : String(s.firstLaunch) + (s.firstLaunchNote ? " (" + s.firstLaunchNote + ")" : ""); }

  function setScroll(wrapId, btnId, n) {
    TB.$(wrapId).classList.remove("all");
    TB.$(btnId).hidden = n <= 10;
    TB.$(btnId).textContent = "Show all";
  }
  function toggleScroll(wrapId, btnId) {
    var all = TB.$(wrapId).classList.toggle("all");
    TB.$(btnId).textContent = all ? "Show fewer" : "Show all";
  }

  function run() {
    TB.message("msg", "");
    var q = query(), p = point();
    try {
      if (p.given && !LS.isLatLon(p.lat, p.lon)) throw new Error("Enter both a latitude (-90 to 90) and a longitude (-180 to 180), or leave both empty.");
      var shown = LS.filterSites(LS.SITES, q);
      rows = LS.arrange(shown, q.sort, p.given ? p.lat : NaN, p.given ? p.lon : NaN);
    } catch (e) {
      TB.message("msg", e.message, "error");
      return;
    }
    var save = { lat: p.lat, lon: p.lon, compare: compareIds };
    FILTERS.forEach(function (k) { save[k] = q[k]; });
    TB.save(KEY, save);
    var st = LS.countBy(shown, "status");
    TB.results("summary", [
      { k: "Sites shown", v: String(shown.length) + " of " + LS.SITES.length },
      { k: "Active", v: String(st.active || 0) },
      { k: "In development or proposed", v: String((st["under-construction"] || 0) + (st.proposed || 0)) },
      { k: "Inactive", v: String(st.inactive || 0) },
      { k: "Countries", v: String(Object.keys(LS.countBy(shown, "country")).length) }
    ]);
    var head = ["Site", "Country", "Type", "Status", "First launch", "Operator"];
    if (p.given) head.push("Distance (km)");
    var trs = rows.map(function (r) {
      var s = r.site;
      var b = TB.el("button", { type: "button", text: s.name, "aria-label": "Show details of " + s.name });
      b.addEventListener("click", function () { select(s.id, true); });
      var row = [b, s.country, LS.TYPES[s.launchType], LS.STATUSES[s.status], firstText(s), s.operator];
      if (p.given) row.push(km(r.distanceKm));
      return row;
    });
    TB.table("sites", head, trs);
    if (!trs.length) TB.message("msg", "No sites match these filters.", "info");
    setScroll("siteWrap", "showAll", trs.length);
    drawMap();
  }

  function drawMap() {
    if (!window.L) { TB.$("map").hidden = true; return; }   // Leaflet did not load; the list still works.
    if (!map) {
      map = L.map("map", { worldCopyJump: true }).setView([20, 0], 2);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19, minZoom: 1,
        attribution: "© <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a> contributors"
      }).addTo(map);
      layer = L.layerGroup().addTo(map);
    }
    layer.clearLayers();
    var edge = cssVar("--panel", "#fff");
    rows.forEach(function (r) {
      var s = r.site, c = colourOf(s.launchType);
      var style = { radius: 7, color: edge, weight: 2, fillColor: c, fillOpacity: 0.85 };
      if (s.status === "inactive") style.fillOpacity = 0.35;
      if (s.status === "under-construction") style.dashArray = "4 3";
      if (s.status === "proposed") { style.fillOpacity = 0; style.color = c; }
      var popup = TB.el("div", null, [TB.el("strong", { text: s.name }), TB.el("br"), s.location + ", " + s.country,
        TB.el("br"), LS.TYPES[s.launchType] + " · " + LS.STATUSES[s.status]]);
      L.circleMarker([s.lat, s.lon], style).addTo(layer).bindPopup(popup).on("click", function () { select(s.id, false); });
    });
    var p = point();
    if (p.given && LS.isLatLon(p.lat, p.lon)) {
      L.circleMarker([p.lat, p.lon], { radius: 5, color: cssVar("--alarm", "#b3261e"), weight: 2, fillOpacity: 0 })
        .addTo(layer).bindTooltip("Your point");
    }
  }

  function legend() {
    var lg = TB.$("legend");
    Object.keys(LS.TYPES).forEach(function (t) {
      var sw = TB.el("span", { class: "lsd-swatch" });
      sw.style.background = colourOf(t);
      lg.appendChild(TB.el("span", { class: "item" }, [sw, LS.TYPES[t]]));
    });
    lg.appendChild(TB.el("span", { class: "item", text: "Faded: inactive. Dashed edge: in development. Hollow: proposed." }));
  }

  function select(id, pan) {
    var s = byId[id];
    if (!s) return;
    selectedId = id;
    lastWeather = null;
    TB.$("detail").hidden = false;
    TB.$("detailName").textContent = s.name;
    TB.$("detailWhere").textContent = s.location + ", " + s.country + " · " + s.region;
    var p = point(), facts = [
      { k: "Type", v: LS.TYPES[s.launchType] },
      { k: "Status", v: LS.STATUSES[s.status] },
      { k: "First launch", v: firstText(s) },
      { k: "Operator", v: s.operator },
      { k: "Latitude", v: TB.fix(s.lat, 4), u: "°" },
      { k: "Longitude", v: TB.fix(s.lon, 4), u: "°" },
      { k: "Position marks", v: s.point }
    ];
    if (s.capabilities.length) facts.push({ k: "Used for", v: s.capabilities.map(function (c) { return LS.CAPABILITIES[c]; }).join("; ") });
    if (p.given && LS.isLatLon(p.lat, p.lon)) facts.push({ k: "Distance from your point", v: km(LS.haversineKm(p.lat, p.lon, s.lat, s.lon)), u: "km" });
    TB.results("detailFacts", facts);
    var ul = TB.$("detailPads");
    TB.clear(ul);
    s.pads.forEach(function (x) { ul.appendChild(TB.el("li", { text: x })); });
    TB.$("detailText").textContent = s.description;
    TB.$("detailCheck").textContent = s.coordsConfirmed ? "Position checked to about 0.05° (5 km)."
      : "Position not confirmed to 0.05°: treat it as approximate.";
    var links = TB.$("detailLinks");
    TB.clear(links);
    if (s.website) links.appendChild(TB.el("a", { href: s.website, rel: "noopener", target: "_blank", text: "Official site" }));
    if (s.website && s.wikipedia) links.appendChild(document.createTextNode(" · "));
    if (s.wikipedia) links.appendChild(TB.el("a", { href: s.wikipedia, rel: "noopener", target: "_blank", text: "Wikipedia" }));
    TB.clear(TB.$("weather"));
    TB.$("weatherNote").textContent = "";
    TB.message("weatherMsg", "");
    TB.$("compareBtn").disabled = compareIds.indexOf(id) >= 0 || compareIds.length >= 4;
    if (map && pan) map.setView([s.lat, s.lon], 8);
    if (pan) TB.$("detail").scrollIntoView({ block: "nearest" });
  }

  function fetchWeather() {
    var s = byId[selectedId];
    if (!s) return;
    TB.message("weatherMsg", "Asking Open-Meteo…", "info");
    var url = "https://api.open-meteo.com/v1/forecast?latitude=" + s.lat + "&longitude=" + s.lon +
      "&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,cloud_cover," +
      "surface_pressure,wind_speed_10m,wind_direction_10m,wind_gusts_10m&timeformat=unixtime";
    fetch(url).then(function (r) {
      if (!r.ok) throw new Error("Open-Meteo answered " + r.status + ".");
      return r.json();
    }).then(function (d) {
      if (selectedId !== s.id) return;
      var c = d.current || {};
      lastWeather = { site: s.id, fetchedFrom: "Open-Meteo", current: c };
      TB.message("weatherMsg", "");
      TB.results("weather", [
        { k: "Conditions", v: LW.wmoText(c.weather_code) },
        { k: "Temperature", v: TB.fix(c.temperature_2m, 1), u: "°C" },
        { k: "Feels like", v: TB.fix(c.apparent_temperature, 1), u: "°C" },
        { k: "Relative humidity", v: TB.fix(c.relative_humidity_2m, 0), u: "%" },
        { k: "Wind (10 m)", v: TB.fix(c.wind_speed_10m, 0) + " km/h, " + TB.fix(LW.kmhToKnots(c.wind_speed_10m), 0), u: "kt" },
        { k: "Gusts (10 m)", v: TB.fix(c.wind_gusts_10m, 0) + " km/h, " + TB.fix(LW.kmhToKnots(c.wind_gusts_10m), 0), u: "kt" },
        { k: "Wind from", v: TB.fix(c.wind_direction_10m, 0), u: "° true" },
        { k: "Cloud cover", v: TB.fix(c.cloud_cover, 0), u: "%" },
        { k: "Precipitation (past hour)", v: TB.fix(c.precipitation, 1), u: "mm" },
        { k: "Pressure at ground level", v: TB.fix(c.surface_pressure, 0), u: "hPa" }
      ]);
      TB.$("weatherNote").textContent = "Model analysis for " + (isFinite(c.time) ? TB.time(c.time * 1000) : "an unknown time") +
        ", from Open-Meteo. Pressure is at the ground, not reduced to sea level.";
    }).catch(function (e) {
      TB.message("weatherMsg", "Could not get the weather: " + e.message, "error");
    });
  }

  function addCompare() {
    if (!selectedId || compareIds.indexOf(selectedId) >= 0 || compareIds.length >= 4) return;
    compareIds.push(selectedId);
    TB.$("compareBtn").disabled = true;
    drawCompare();
    run();
  }
  function drawCompare() {
    var sites = compareIds.map(function (id) { return byId[id]; }).filter(Boolean);
    TB.$("compare").hidden = !sites.length;
    if (!sites.length) return;
    var fields = [["Country", function (s) { return s.country; }], ["Operator", function (s) { return s.operator; }],
      ["Type", function (s) { return LS.TYPES[s.launchType]; }], ["Status", function (s) { return LS.STATUSES[s.status]; }],
      ["First launch", firstText], ["Latitude", function (s) { return TB.fix(s.lat, 4) + "°"; }],
      ["Longitude", function (s) { return TB.fix(s.lon, 4) + "°"; }], ["Pads", function (s) { return s.pads.join("; "); }],
      ["Used for", function (s) { return s.capabilities.map(function (c) { return LS.CAPABILITIES[c]; }).join("; ") || "–"; }]];
    TB.table("compareTable", [""].concat(sites.map(function (s) { return s.name; })),
      fields.map(function (f) { return [f[0]].concat(sites.map(f[1])); }));
    TB.table("compareDist", [""].concat(sites.map(function (s) { return s.name; })), sites.map(function (a) {
      return [a.name].concat(sites.map(function (b) { return a === b ? "–" : km(LS.haversineKm(a.lat, a.lon, b.lat, b.lon)); }));
    }));
  }

  function loadUpcoming() {
    var btn = TB.$("ll2Btn");
    btn.disabled = true;
    TB.message("ll2Msg", "Asking Launch Library 2…", "info");
    fetch("https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=100").then(function (r) {
      if (r.status === 429) throw new Error("Launch Library 2's free limit (about 15 requests an hour) is used up; try again later.");
      if (!r.ok) throw new Error("Launch Library 2 answered " + r.status + ".");
      return r.json();
    }).then(function (d) {
      var launches = (d.results || []).map(LS.parseLL2Launch);
      var m = LS.matchLaunches(launches, LS.SITES, 50);
      upcoming = { fetchedMs: Date.now(), total: launches.length, bySite: m.bySite, unmatched: m.unmatched };
      drawUpcoming();
    }).catch(function (e) {
      TB.message("ll2Msg", "Could not load launches: " + e.message, "error");
    }).then(function () { btn.disabled = false; });
  }
  function drawUpcoming() {
    if (!upcoming) return;
    var list = [];
    Object.keys(upcoming.bySite).forEach(function (id) {
      upcoming.bySite[id].forEach(function (l) { list.push({ site: byId[id], launch: l }); });
    });
    list.sort(function (a, b) { return (a.launch.netMs || Infinity) - (b.launch.netMs || Infinity); });
    TB.message("ll2Msg", upcoming.total + " launches loaded at " + TB.time(upcoming.fetchedMs) + "; " + list.length +
      " at listed sites, " + upcoming.unmatched.length + " elsewhere or without a pad position.", "info");
    TB.table("ll2", ["Time (no earlier than)", "Launch", "Vehicle", "Site", "Pad", "Status", "Weather probability"],
      list.map(function (x) {
        var l = x.launch, b = TB.el("button", { type: "button", text: x.site.name });
        b.addEventListener("click", function () { select(x.site.id, true); });
        return [l.netMs === null ? "–" : TB.time(l.netMs), l.name, l.vehicle || "–", b, l.padName || "–", l.status || "–",
          l.weatherProbability === null ? "–" : l.weatherProbability + " %"];
      }));
    setScroll("ll2Wrap", "ll2All", list.length);
  }

  TB.ready(function () {
    fill(TB.$("launchType"), LS.TYPES);
    fill(TB.$("status"), LS.STATUSES);
    fill(TB.$("era"), LS.ERAS);
    fill(TB.$("capability"), LS.CAPABILITIES);
    var countries = Object.keys(LS.countBy(LS.SITES, "country")).sort();
    countries.forEach(function (c) { TB.$("country").appendChild(TB.el("option", { value: c, text: c })); });
    legend();
    var saved = TB.load(KEY);
    if (saved) {
      FILTERS.forEach(function (k) {
        var e = TB.$(k);
        if (typeof saved[k] !== "string") return;
        if (e.tagName === "SELECT" && !Array.prototype.some.call(e.options, function (o) { return o.value === saved[k]; })) return;
        e.value = saved[k];
      });
      ["lat", "lon"].forEach(function (k) { if (isFinite(saved[k]) && saved[k] !== null) TB.$(k).value = saved[k]; });
      if (Array.isArray(saved.compare)) compareIds = saved.compare.filter(function (id) { return byId[id]; }).slice(0, 4);
    }
    TB.$("form").addEventListener("submit", function (ev) { ev.preventDefault(); run(); });
    TB.$("text").addEventListener("input", run);
    ["launchType", "country", "status", "era", "capability", "sort"].forEach(function (k) { TB.$(k).addEventListener("change", run); });
    TB.$("reset").addEventListener("click", function () {
      ["launchType", "country", "status", "era", "capability"].forEach(function (k) { TB.$(k).value = "all"; });
      TB.$("text").value = "";
      run();
    });
    TB.$("showAll").addEventListener("click", function () { toggleScroll("siteWrap", "showAll"); });
    TB.$("ll2All").addEventListener("click", function () { toggleScroll("ll2Wrap", "ll2All"); });
    TB.$("weatherBtn").addEventListener("click", fetchWeather);
    TB.$("compareBtn").addEventListener("click", addCompare);
    TB.$("compareClear").addEventListener("click", function () {
      compareIds = [];
      drawCompare();
      if (selectedId) TB.$("compareBtn").disabled = false;
      run();
    });
    TB.$("ll2Btn").addEventListener("click", loadUpcoming);
    TB.$("copy").addEventListener("click", function () {
      var out = { filters: query(), point: point().given ? { lat: TB.num("lat"), lon: TB.num("lon") } : null,
        sites: rows.map(function (r) {
          var s = r.site;
          return { id: s.id, name: s.name, country: s.country, operator: s.operator, lat: s.lat, lon: s.lon,
            coordsConfirmed: s.coordsConfirmed, status: s.status, launchType: s.launchType, firstLaunch: s.firstLaunch,
            distanceKm: r.distanceKm };
        }),
        comparison: compareIds, selectedWeather: lastWeather,
        upcoming: upcoming ? { fetchedUtc: new Date(upcoming.fetchedMs).toISOString(), bySite: upcoming.bySite } : null };
      TB.copyJSON(out).then(function () { TB.message("msg", "Copied.", "info"); },
        function () { TB.message("msg", "This browser would not let the page use the clipboard.", "error"); });
    });
    drawCompare();
    run();
  });
})();

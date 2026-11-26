/* Ground Station Frequency Map page. Band look-up, parsing and the station list are in
   ../lib/ground-station-frequency.js (tested in tests/ground-station-frequency.test.js). */
(function () {
  "use strict";
  var KEY = "ground-station-frequency";
  var G = DD.groundStationFrequency;
  var C_M_S = 299792458;
  var ROWS = 10;
  var map, layer, builtIn = G.stations(), custom = [], customRaw = [], shown = [], showAll = false, selected = null;

  function all() { return builtIn.concat(custom); }
  function dirWord(d) { return d === "up" ? "Uplink" : d === "down" ? "Downlink" : d === "both" ? "Both" : "Not given"; }
  function linksText(s) { return s.links.map(function (l) { return G.formatRange(l.lowMHz, l.highMHz); }).join(", "); }

  function persist() {
    TB.save(KEY, { band: TB.$("band").value, query: TB.$("query").value, freq: TB.$("freq").value, custom: customRaw });
  }

  function fillBandSelect() {
    var sel = TB.$("band"), keep = sel.value;
    while (sel.options.length > 1) sel.remove(1);
    var list = all();
    G.IEEE_BANDS.forEach(function (b) {
      var n = list.filter(function (s) { return s.bands.indexOf(b) >= 0; }).length;
      if (n) sel.appendChild(TB.el("option", { value: b, text: b + " (" + n + ")" }));
    });
    sel.value = keep;
    if (sel.value !== keep) sel.value = "all";
  }

  function detail(s) {
    selected = s;
    TB.$("detailTitle").textContent = "Station links: " + s.name;
    var wrap = TB.$("detail");
    TB.clear(wrap);
    wrap.appendChild(TB.el("p", { class: "small muted",
      text: [s.operator, s.country, s.kind, s.lat.toFixed(2) + "°, " + s.lon.toFixed(2) + "°"].filter(Boolean).join(" · ") }));
    var t = TB.el("div");
    wrap.appendChild(t);
    TB.table(t, ["Direction", "Frequencies", "IEEE band", "Use"], s.links.map(function (l) {
      return [dirWord(l.dir), G.formatRange(l.lowMHz, l.highMHz), l.bands.join(", ") || "–", l.use || "–"];
    }));
    if (s.custom) {
      var del = TB.el("button", { type: "button", text: "Remove this station" });
      del.addEventListener("click", function () {
        var i = custom.indexOf(s);
        if (i >= 0) { custom.splice(i, 1); customRaw.splice(i, 1); }
        TB.clear(wrap);
        wrap.appendChild(TB.el("p", { class: "empty", text: "Choose a station on the map or in the list." }));
        TB.$("detailTitle").textContent = "Station links";
        selected = null;
        persist(); fillBandSelect(); render();
      });
      wrap.appendChild(TB.el("div", { class: "actions" }, [del]));
    }
  }

  function focus(s) {
    map.setView([s.lat, s.lon], Math.max(map.getZoom(), 5));
    detail(s);
  }

  function render() {
    shown = G.filter(all(), TB.$("band").value, TB.$("query").value);
    TB.$("count").textContent = shown.length;
    layer.clearLayers();
    shown.forEach(function (s) {
      var m = L.circleMarker([s.lat, s.lon], { radius: 7, weight: 2, color: s.custom ? "#a21caf" : "#b3261e",
        fillColor: "#ffffff", fillOpacity: 1 });
      m.bindTooltip(TB.el("span", { text: s.name + " · " + s.bands.join(", ") }));
      m.on("click", function () { detail(s); });
      m.addTo(layer);
    });
    var rows = shown.map(function (s) {
      var b = TB.el("button", { type: "button", text: "Show" });
      b.addEventListener("click", function () { focus(s); });
      return [s.name, s.operator, s.bands.join(", "), linksText(s), b];
    });
    TB.table("list", ["Station", "Operator", "IEEE bands", "Frequencies", ""], rows);
    if (!rows.length) {
      TB.clear(TB.$("list"));
      TB.$("list").appendChild(TB.el("p", { class: "empty", text: "No station matches this band and search." }));
    }
    TB.$("showAll").hidden = shown.length <= ROWS;
    TB.$("showAll").textContent = showAll ? "Show fewer" : "Show all " + shown.length;
    TB.$("listWrap").className = "scroll" + (showAll ? " all" : "");
    persist();
  }

  function lookUp() {
    TB.message("msg", "");
    try {
      var f = G.parseFrequency(TB.$("freq").value);
      var items;
      if (f.lowHz === f.highHz) {
        var c = G.classify(f.lowHz);
        items = [
          { k: "IEEE letter band", v: c.ieee || "outside the IEEE table" },
          { k: "ITU band", v: c.itu ? c.itu + " (band " + c.ituNumber + ")" : "outside bands 4 to 12" },
          { k: "Wavelength", v: wavelength(f.lowHz) }
        ];
      } else {
        var lo = G.classify(f.lowHz), hi = G.classify(f.highHz);
        items = [
          { k: "IEEE letter bands", v: G.bandsOfRange(f.lowHz, f.highHz).join(", ") || "outside the IEEE table" },
          { k: "ITU bands", v: lo.itu === hi.itu ? (lo.itu || "–") : (lo.itu || "–") + " to " + (hi.itu || "–") },
          { k: "Wavelength", v: wavelength(f.highHz) + " to " + wavelength(f.lowHz) }
        ];
      }
      TB.results("bandResults", items);
      persist();
    } catch (e) { TB.message("msg", e.message, "error"); }
  }
  function wavelength(hz) {
    var m = C_M_S / hz;
    if (m >= 1) return TB.fix(m, m >= 100 ? 0 : 2) + " m";
    if (m >= 0.01) return TB.fix(m * 100, 2) + " cm";
    return TB.fix(m * 1000, 2) + " mm";
  }

  function addStation() {
    TB.message("msg", "");
    try {
      var raw = { name: TB.$("sName").value, lat: TB.num("sLat"), lon: TB.num("sLon"), operator: TB.$("sOp").value,
        links: TB.$("sLinks").value };
      var s = G.makeStation(raw.name, raw.lat, raw.lon, raw.operator, raw.links);
      if (all().some(function (x) { return x.id === s.id; })) throw new Error("A station with that name is already on the list.");
      custom.push(s);
      customRaw.push(raw);
      fillBandSelect();
      render();
      focus(s);
      TB.message("msg", "Added " + s.name + " (bands " + (s.bands.join(", ") || "none in the IEEE table") + ").", "info");
    } catch (e) { TB.message("msg", e.message, "error"); }
  }

  TB.ready(function () {
    var saved = TB.load(KEY) || {};
    if (Array.isArray(saved.custom)) {
      saved.custom.forEach(function (r) {
        try {
          var s = G.makeStation(r.name, Number(r.lat), Number(r.lon), r.operator, r.links);
          if (!builtIn.concat(custom).some(function (x) { return x.id === s.id; })) { custom.push(s); customRaw.push(r); }
        } catch (e) { /* skip a bad saved station */ }
      });
    }
    if (typeof saved.query === "string") TB.$("query").value = saved.query;
    if (typeof saved.freq === "string") TB.$("freq").value = saved.freq;
    fillBandSelect();
    if (typeof saved.band === "string") { TB.$("band").value = saved.band; if (TB.$("band").value !== saved.band) TB.$("band").value = "all"; }

    map = L.map("map", { worldCopyJump: true }).setView([20, 0], 2);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a> contributors"
    }).addTo(map);
    layer = L.layerGroup().addTo(map);
    render();
    lookUp();

    TB.$("form").addEventListener("submit", function (ev) { ev.preventDefault(); });
    TB.$("band").addEventListener("change", function () { showAll = false; render(); });
    TB.$("query").addEventListener("input", function () { showAll = false; render(); });
    TB.$("classify").addEventListener("click", lookUp);
    TB.$("freq").addEventListener("keydown", function (ev) { if (ev.key === "Enter") { ev.preventDefault(); lookUp(); } });
    TB.$("addStation").addEventListener("click", addStation);
    TB.$("showAll").addEventListener("click", function () { showAll = !showAll; render(); });
    TB.$("copy").addEventListener("click", function () {
      TB.copyJSON({ filter: { band: TB.$("band").value, query: TB.$("query").value }, stations: shown,
        selected: selected ? selected.id : null,
        bandSystems: "IEEE Std 521-2019 letters; ITU Radio Regulations Art. 2 band numbers" })
        .then(function () { TB.message("msg", "Copied.", "info"); },
          function () { TB.message("msg", "This browser would not let the page use the clipboard.", "error"); });
    });
  });
})();

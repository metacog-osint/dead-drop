/* RF Source Triangulation page. The maths is in ../lib/rf-triangulation.js (tested in tests/rf-triangulation.test.js). */
(function () {
  "use strict";
  var KEY = "rf-triangulation";
  var T = DD.rfTriangulation;
  var EXAMPLE = [
    { name: "West", lat: 38.45, lon: -98.40, bearing: 59.0, tdoaUs: 0 },
    { name: "North", lat: 38.80, lon: -98.30, bearing: 140.5, tdoaUs: -9.20 },
    { name: "East", lat: 38.50, lon: -97.80, bearing: 294.0, tdoaUs: -8.73 },
    { name: "North-east", lat: 38.75, lon: -97.85, bearing: 233.0, tdoaUs: -12.00 }
  ];
  var state = { method: "aoa", receivers: EXAMPLE.slice(0, 3).map(copy) };
  var last = null, map = null, layer = null, fitted = false;

  function copy(r) { return { name: r.name, lat: r.lat, lon: r.lon, bearing: r.bearing, tdoaUs: r.tdoaUs }; }
  function color(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }
  function numOrNaN(s) { s = String(s).trim(); return s === "" ? NaN : Number(s); }

  function renderRows() {
    var list = TB.$("rx-list");
    TB.clear(list);
    var aoa = state.method === "aoa";
    TB.$("rx-help").textContent = aoa
      ? "Bearing: degrees clockwise from north (true, or magnetic with the declination above). Two or more receivers."
      : "Arrival time: microseconds, from any common clock; the first receiver is the reference. Three or more receivers.";
    state.receivers.forEach(function (r, i) {
      function input(field, label, step) {
        var id = "rx" + i + "-" + field;
        var inp = TB.el("input", { type: field === "name" ? "text" : "number", id: id, step: step || "any",
          value: r[field] === undefined || r[field] === null || (typeof r[field] === "number" && !isFinite(r[field])) ? "" : String(r[field]) });
        inp.addEventListener("change", function () {
          r[field] = field === "name" ? inp.value : numOrNaN(inp.value);
          persist();
        });
        return TB.el("div", null, [TB.el("label", { for: id, text: label }), inp]);
      }
      var del = TB.el("button", { type: "button", title: "Remove this receiver", "aria-label": "Remove receiver " + (i + 1) }, ["Remove"]);
      del.addEventListener("click", function () { state.receivers.splice(i, 1); persist(); renderRows(); drawMap(null); });
      list.appendChild(TB.el("div", { class: "rx-row" }, [
        input("name", (i + 1) + (state.method === "tdoa" && i === 0 ? " (reference)" : "")),
        input("lat", "Latitude"), input("lon", "Longitude"),
        aoa ? input("bearing", "Bearing (°)") : input("tdoaUs", "Arrival (µs)"),
        del
      ]));
    });
    TB.$("aoa-settings").hidden = !aoa;
    TB.$("tdoa-settings").hidden = aoa;
    TB.$("pairs-head").hidden = !aoa;
    TB.$("pairs").hidden = !aoa;
  }

  function settings() {
    return { sigmaDeg: TB.num("sigmaDeg"), declinationDeg: TB.num("declination") || 0, sigmaNs: TB.num("sigmaNs") };
  }
  function persist() {
    var s = settings();
    TB.save(KEY, { method: state.method, receivers: state.receivers, sigmaDeg: s.sigmaDeg, declination: s.declinationDeg, sigmaNs: s.sigmaNs });
  }

  function addReceiver(lat, lon) {
    var n = state.receivers.length + 1;
    state.receivers.push({ name: "Receiver " + n, lat: Number(lat.toFixed(5)), lon: Number(lon.toFixed(5)), bearing: NaN, tdoaUs: NaN });
    persist(); renderRows(); drawMap(null);
  }

  function lonWrap(x) { return ((x + 540) % 360 + 360) % 360 - 180; }

  function drawMap(fix) {
    if (!map) return;
    layer.clearLayers();
    var blue = color("--plot-1", "#2b5d8a"), red = color("--alarm", "#b3261e");
    var pts = [];
    var decl = settings().declinationDeg;
    state.receivers.forEach(function (r) {
      if (!isFinite(r.lat) || !isFinite(r.lon)) return;
      pts.push([r.lat, r.lon]);
      L.circleMarker([r.lat, r.lon], { radius: 6, color: blue, fillColor: blue, fillOpacity: 0.9, weight: 2 })
        .bindTooltip(TB.el("span", { text: r.name || "Receiver" })).addTo(layer);
      if (state.method === "aoa" && isFinite(r.bearing)) {
        var len = 100;
        if (fix) len = Math.max(30, 1.4 * T.distanceKm(r.lat, r.lon, fix.lat, fix.lon));
        L.polyline(T.gcPath(r.lat, r.lon, r.bearing + decl, len), { color: blue, weight: 2, opacity: 0.7, dashArray: "6 6" }).addTo(layer);
      }
    });
    if (fix) {
      pts.push([fix.lat, fix.lon]);
      L.polygon(T.ellipsePath(fix.lat, fix.lon, fix.ellipse95), { color: red, weight: 2, fillOpacity: 0.12 }).addTo(layer);
      L.circleMarker([fix.lat, fix.lon], { radius: 6, color: red, fillColor: red, fillOpacity: 1 })
        .bindTooltip(TB.el("span", { text: "Estimate" })).addTo(layer);
      (fix.alternates || []).forEach(function (a) {
        pts.push([a.lat, a.lon]);
        L.circleMarker([a.lat, a.lon], { radius: 6, color: red, fillOpacity: 0, weight: 2 })
          .bindTooltip(TB.el("span", { text: "Also fits" })).addTo(layer);
      });
    }
    if (pts.length && (fix || !fitted)) {
      map.fitBounds(L.latLngBounds(pts), { padding: [30, 30], maxZoom: 12 });
      fitted = true;
    }
  }

  function showWarnings(list) {
    var ul = TB.$("warnings");
    TB.clear(ul);
    (list || []).forEach(function (w) { ul.appendChild(TB.el("li", { text: w })); });
  }

  function run() {
    TB.message("msg", "");
    var s = settings();
    persist();
    try {
      var rx = state.receivers.map(function (r) { return { name: r.name, lat: r.lat, lon: r.lon, bearing: r.bearing, tdoaUs: r.tdoaUs }; });
      var f = state.method === "aoa"
        ? T.aoaFix(rx, { sigmaDeg: s.sigmaDeg, declinationDeg: s.declinationDeg })
        : T.tdoaFix(rx, { sigmaNs: s.sigmaNs });
      last = { method: state.method, settings: s, receivers: rx, result: f };
      var e = f.ellipse95, km = function (x) { return x < 1 ? TB.fix(x * 1000, 0) : TB.fix(x, 2); };
      var unit = function (x) { return x < 1 ? "m" : "km"; };
      TB.results("results", [
        { k: "Latitude", v: TB.fix(f.lat, 5), u: "°" },
        { k: "Longitude", v: TB.fix(f.lon, 5), u: "°" },
        { k: "95% ellipse, long half-axis", v: km(e.majorKm), u: unit(e.majorKm) },
        { k: "95% ellipse, short half-axis", v: km(e.minorKm), u: unit(e.minorKm) },
        { k: "Long axis points", v: TB.fix(e.orientDeg, 0) + "° / " + TB.fix(e.orientDeg + 180, 0) + "°",
          title: "Bearing of the ellipse's long axis, degrees clockwise from north" },
        { k: "Fit check: χ² / degrees of freedom", v: TB.fix(f.chi2, 2) + " / " + f.dof,
          cls: f.dof > 0 && f.chi2 > 4 * f.dof + 6 ? "warn" : null,
          title: "Near the degrees of freedom is a consistent fit; much larger means the measurements disagree" }
      ]);
      var warns = f.warnings.slice();
      if (f.dof > 0 && f.chi2 > 4 * f.dof + 6) warns.push("The measurements disagree by more than the stated errors allow; the ellipse is too small.");
      if (f.dof === 0 && state.method === "aoa") warns.push("With two bearings there is no check on the fit: any bearing error moves the fix without warning.");
      showWarnings(warns);
      if (f.method === "aoa") {
        TB.table("rx-table", ["Receiver", "True bearing", "Bearing to fix", "Misfit", "Range"], f.receivers.map(function (r) {
          return [r.name, TB.fix(r.trueBearingDeg, 1) + "°", TB.fix(r.bearingToFixDeg, 1) + "°", TB.fix(r.residualDeg, 2) + "°", TB.fix(r.rangeKm, 2) + " km"];
        }));
        TB.table("pairs", ["Pair", "Crossing", "Cut angle"], f.pairs.map(function (p) {
          return [p.a + " and " + p.b, p.point ? TB.fix(p.point.lat, 5) + ", " + TB.fix(p.point.lon, 5) : "Do not cross ahead",
            p.cutDeg === null ? "–" : TB.fix(p.cutDeg, 0) + "°"];
        }));
      } else {
        TB.table("rx-table", ["Receiver", "Measured (µs)", "Fitted (µs)", "Misfit (ns)", "Range"], f.receivers.map(function (r, i) {
          return [r.name, TB.fix(r.measuredUs, 3), TB.fix(r.fittedUs, 3), i === 0 ? "reference" : TB.fix(r.residualNs, 1), TB.fix(r.rangeKm, 2) + " km"];
        }));
        TB.clear(TB.$("pairs"));
      }
      drawMap(f);
    } catch (err) {
      last = null;
      TB.clear(TB.$("results")); showWarnings([]);
      TB.message("msg", err.message, "error");
      drawMap(null);
    }
  }

  TB.ready(function () {
    var saved = TB.load(KEY);
    if (saved && Array.isArray(saved.receivers)) {
      state.method = saved.method === "tdoa" ? "tdoa" : "aoa";
      state.receivers = saved.receivers.map(function (r) {
        return { name: String(r.name || ""), lat: Number(r.lat), lon: Number(r.lon),
          bearing: r.bearing === null ? NaN : Number(r.bearing), tdoaUs: r.tdoaUs === null ? NaN : Number(r.tdoaUs) };
      });
      if (isFinite(saved.sigmaDeg)) TB.$("sigmaDeg").value = saved.sigmaDeg;
      if (isFinite(saved.declination)) TB.$("declination").value = saved.declination;
      if (isFinite(saved.sigmaNs)) TB.$("sigmaNs").value = saved.sigmaNs;
    }
    TB.$("method").value = state.method;
    if (window.L) {
      map = L.map("map").setView([38.6, -98.1], 8);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19, attribution: "&copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a> contributors"
      }).addTo(map);
      layer = L.layerGroup().addTo(map);
      map.on("click", function (ev) {
        if (TB.$("clickAdd").checked) addReceiver(ev.latlng.lat, lonWrap(ev.latlng.lng));
      });
    } else {
      TB.$("map").appendChild(TB.el("p", { class: "empty", text: "The map library did not load; the calculation still works." }));
    }
    renderRows();
    TB.$("method").addEventListener("change", function () {
      state.method = TB.$("method").value; persist(); renderRows(); run();
    });
    TB.$("add").addEventListener("click", function () {
      var c = map ? map.getCenter() : { lat: 0, lng: 0 };
      addReceiver(c.lat, lonWrap(c.lng));
    });
    TB.$("example").addEventListener("click", function () {
      state.receivers = (state.method === "aoa" ? EXAMPLE.slice(0, 3) : EXAMPLE).map(copy);
      fitted = false; persist(); renderRows(); run();
    });
    TB.$("form").addEventListener("submit", function (ev) { ev.preventDefault(); run(); });
    TB.$("copy").addEventListener("click", function () {
      if (!last) return TB.message("msg", "Calculate first.", "info");
      TB.copyJSON(last).then(function () { TB.message("msg", "Copied.", "info"); },
        function () { TB.message("msg", "This browser would not let the page use the clipboard.", "error"); });
    });
    run();
  });
})();

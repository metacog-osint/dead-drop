/* CSV to Map Plotter page. Parsing, column finding, distances and the drawn great-circle legs come from
   ../lib/csv-map.js (tested in tests/csv-map.test.js). */
(function () {
  "use strict";
  var C = DD.csvMap;
  var KEY = "csv-map-plotter";
  var ROWS = 10;
  var SAMPLE = "name,lat,lon,description\n" +
    "Kennedy Space Center,28.573,-80.649,\"Launch Complex 39, Florida\"\n" +
    "Vandenberg SFB,34.742,-120.572,West coast launch site\n" +
    "Wallops Flight Facility,37.940,-75.466,Virginia\n" +
    "Pacific Spaceport Complex,57.435,-152.338,\"Kodiak Island, Alaska\"";
  var map, group = null, last = null, showAll = false;

  function settings() {
    return { csv: TB.$("csv").value, connect: TB.$("connect").checked, labels: TB.$("labels").checked, colour: TB.$("colour").value };
  }

  function popup(p) {
    var kids = [TB.el("strong", { text: p.name }), TB.el("br"), TB.fix(p.lat, 6) + ", " + TB.fix(p.lon, 6),
      TB.el("br"), TB.el("span", { class: "muted", text: "CSV line " + p.line })];
    if (p.description) { kids.push(TB.el("br")); kids.push(p.description); }
    Object.keys(p.extra).forEach(function (k) { kids.push(TB.el("br")); kids.push(k + ": " + p.extra[k]); });
    return TB.el("div", null, kids);
  }

  function listLegs() {
    var rows = last ? last.legs.legs.map(function (l, i) {
      return [String(i + 1), l.from, l.to, TB.fix(l.km, 2), TB.fix(l.km / 1.852, 2), isFinite(l.bearing) ? TB.fix(l.bearing, 1) + "°" : "–", TB.fix(l.totalKm, 1)];
    }) : [];
    TB.table("legs", ["#", "From", "To", "km", "nmi", "Initial bearing (true)", "Running total km"], rows);
    TB.$("legsWrap").className = "scroll" + (showAll ? " all" : "");
    TB.$("showAll").hidden = rows.length <= ROWS;
    TB.$("showAll").textContent = showAll ? "Show fewer" : "Show all (" + rows.length + ")";
  }

  function clearMap() { if (group) { map.removeLayer(group); group = null; } }

  function plot() {
    TB.message("msg", "");
    TB.clear(TB.$("errors"));
    clearMap();
    var s = settings();
    TB.save(KEY, s);
    last = null;
    if (!s.csv.trim()) { TB.results("results", []); listLegs(); return TB.message("msg", "Paste CSV rows or open a file first.", "info"); }
    var r;
    try { r = C.readPoints(s.csv); } catch (e) { TB.results("results", []); listLegs(); return TB.message("msg", e.message, "error"); }
    var layers = [];
    r.points.forEach(function (p) {
      var m = L.circleMarker([p.lat, p.lon], { radius: 7, color: "#ffffff", weight: 2, fillColor: s.colour, fillOpacity: 0.9 })
        .bindPopup(popup(p));
      if (s.labels) m.bindTooltip(TB.el("span", { text: p.name }), { permanent: true, direction: "top", offset: [0, -6] });
      layers.push(m);
    });
    var legs = C.legs(r.points);
    if (s.connect) {
      for (var i = 1; i < r.points.length; i++) {
        layers.unshift(L.polyline(C.greatCirclePath(r.points[i - 1], r.points[i], 50), { color: s.colour, weight: 2, dashArray: "6 6" }));
      }
    }
    if (layers.length) {
      group = L.featureGroup(layers).addTo(map);
      map.fitBounds(group.getBounds(), { maxZoom: 12, padding: [30, 30] });
    }
    last = { points: r.points, errors: r.errors, legs: legs, columns: r.columns, delimiter: r.delimiter };
    var col = function (i) { return i < 0 ? "none" : (r.columns.names && r.columns.names[i] ? "'" + r.columns.names[i] + "'" : "column " + (i + 1)); };
    TB.results("results", [
      { k: "Points plotted", v: r.points.length, cls: r.points.length ? "ok" : "warn" },
      { k: "Rows left off", v: r.errors.length, cls: r.errors.length ? "warn" : null },
      { k: "Distance along the points", v: TB.fix(legs.totalKm, 1), u: "km", title: "Great-circle legs in row order" },
      { k: "Distance along the points", v: TB.fix(legs.totalKm / 1.852, 1), u: "nmi" },
      { k: "Latitude from", v: col(r.columns.lat) }, { k: "Longitude from", v: col(r.columns.lon) }
    ]);
    if (r.columns.guessed) TB.message("msg", "No header naming the columns, so latitude is taken from " + col(r.columns.lat) + " and longitude from " + col(r.columns.lon) + ". Add a header row if that is wrong.", "info");
    if (r.errors.length) {
      var box = TB.$("errors");
      box.appendChild(TB.el("h3", { text: "Rows left off (" + r.errors.length + ")" }));
      box.appendChild(TB.el("div", { class: "scroll small" }, [TB.el("ul", null, r.errors.map(function (e) {
        return TB.el("li", { text: "Line " + e.line + ": " + e.reason });
      }))]));
    }
    showAll = false;
    listLegs();
  }

  TB.ready(function () {
    map = L.map("map", { worldCopyJump: false }).setView([20, 0], 2);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a> contributors"
    }).addTo(map);
    var saved = TB.load(KEY);
    if (saved) {
      if (typeof saved.csv === "string") TB.$("csv").value = saved.csv;
      if (typeof saved.connect === "boolean") TB.$("connect").checked = saved.connect;
      if (typeof saved.labels === "boolean") TB.$("labels").checked = saved.labels;
      if (/^#[0-9a-f]{6}$/i.test(saved.colour || "")) TB.$("colour").value = saved.colour;
    } else TB.$("csv").value = SAMPLE;

    TB.$("form").addEventListener("submit", function (ev) { ev.preventDefault(); plot(); });
    TB.$("sample").addEventListener("click", function () { TB.$("csv").value = SAMPLE; plot(); });
    TB.$("clear").addEventListener("click", function () {
      TB.$("csv").value = ""; TB.$("file").value = ""; clearMap(); last = null;
      TB.clear(TB.$("errors")); TB.results("results", []); listLegs(); TB.message("msg", ""); TB.save(KEY, settings());
    });
    TB.$("file").addEventListener("change", function (ev) {
      var f = ev.target.files && ev.target.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onerror = function () { TB.message("msg", "The browser could not read that file.", "error"); };
      reader.onload = function () { TB.$("csv").value = reader.result; plot(); };
      reader.readAsText(f);
    });
    ["connect", "labels", "colour"].forEach(function (id) { TB.$(id).addEventListener("change", function () { if (last) plot(); }); });
    TB.$("showAll").addEventListener("click", function () { showAll = !showAll; listLegs(); });
    TB.$("copy").addEventListener("click", function () {
      if (!last) return TB.message("msg", "Plot some points first.", "info");
      TB.copyJSON({ geojson: C.toGeoJSON(last.points), legs: last.legs.legs, totalKm: last.legs.totalKm, rowsLeftOff: last.errors })
        .then(function () { TB.message("msg", "Copied.", "info"); },
          function () { TB.message("msg", "This browser would not let the page use the clipboard.", "error"); });
    });
    plot();
  });
})();

/* Bearing and Distance Overlay page. The maths is in ../lib/distance-bearing.js and ../lib/bearing-overlay.js
   (tested in tests/bearing-overlay.test.js and tests/distance-bearing.test.js). Map: Leaflet with OpenStreetMap tiles. */
(function () {
  "use strict";
  var KEY = "bearing-overlay";
  var ROWS = 10;
  var map, centreMarker, picking = false, showAll = false;
  var centre = { lat: 38.0, lon: -77.0 };
  var shapes = [];   // { spec, layers }

  function ll(lat, lon) {
    lon = DD.distanceBearing.normLon(lon);
    return TB.fix(Math.abs(lat), 4) + "° " + (lat < 0 ? "S" : "N") + ", " + TB.fix(Math.abs(lon), 4) + "° " + (lon < 0 ? "W" : "E");
  }
  function persist() {
    TB.save(KEY, { centre: centre, shapes: shapes.map(function (s) { return s.spec; }),
      form: { radius: TB.$("radius").value, ringColour: TB.$("ringColour").value, ringFill: TB.$("ringFill").value,
        bearing: TB.$("bearing").value, length: TB.$("length").value, lineColour: TB.$("lineColour").value } });
  }
  function drawCentre() {
    if (centreMarker) map.removeLayer(centreMarker);
    centreMarker = L.circleMarker([centre.lat, centre.lon], { radius: 6, color: "#ffffff", weight: 2,
      fillColor: "#b3261e", fillOpacity: 1 }).addTo(map).bindTooltip("Centre " + ll(centre.lat, centre.lon));
  }
  function setCentre(lat, lon, pan) {
    DD.distanceBearing.checkPoint(lat, lon, "Centre");
    centre = { lat: lat, lon: lon };
    TB.$("lat").value = lat; TB.$("lon").value = lon;
    drawCentre();
    if (pan) map.panTo([lat, lon]);
    persist();
  }
  function arrowIcon(colour, deg) {
    var span = TB.el("span");
    span.style.transform = "rotate(" + deg + "deg)";
    var box = TB.el("div", null, [span]);
    box.style.color = colour;
    return L.divIcon({ className: "bdo-arrow", html: box, iconSize: [18, 18], iconAnchor: [9, 9] });
  }

  /** Builds the map layers for one shape spec, adds them, and returns the shape record. Throws on bad input. */
  function build(spec) {
    var layers = [], info = {};
    if (spec.type === "ring") {
      var r = DD.bearingOverlay.ring(spec.lat, spec.lon, spec.radiusKm);
      layers.push(L.polygon(r.ring, { color: spec.colour, weight: 2, fillColor: spec.colour, fillOpacity: spec.fill }));
      info.detail = TB.fix(spec.radiusKm, 1) + " km radius" + (r.pole ? " (contains the " + (r.pole === "N" ? "North" : "South") + " Pole)" : "");
      info.end = "–";
    } else {
      var b = DD.bearingOverlay.bearingLine(spec.lat, spec.lon, spec.bearing, spec.lengthKm);
      layers.push(L.polyline(b.points, { color: spec.colour, weight: 3, dashArray: "10 5" }));
      var tip = b.points[b.points.length - 1];
      layers.push(L.marker(tip, { icon: arrowIcon(spec.colour, b.finalBearing), keyboard: false, interactive: false }));
      info.detail = TB.fix(b.bearing, 1) + "° true for " + TB.fix(spec.lengthKm, 1) + " km";
      info.end = ll(b.end.lat, b.end.lon) + "; arriving on " + TB.fix(b.finalBearing, 1) + "°";
      info.endPoint = b.end; info.finalBearing = b.finalBearing;
    }
    layers.forEach(function (l) { l.addTo(map); });
    return { spec: spec, layers: layers, info: info };
  }
  function add(spec) {
    TB.message("msg", "");
    try {
      shapes.push(build(spec));
      persist();
      list();
      var last = shapes[shapes.length - 1].layers[0];
      map.fitBounds(last.getBounds(), { maxZoom: 10, padding: [20, 20] });
    } catch (e) {
      TB.message("msg", e.message, "error");
    }
  }
  function remove(i) {
    shapes[i].layers.forEach(function (l) { map.removeLayer(l); });
    shapes.splice(i, 1);
    persist();
    list();
  }
  function list() {
    var rows = shapes.map(function (s, i) {
      var sw = TB.el("span", { class: "bdo-swatch" }); sw.style.background = s.spec.colour;
      var btn = TB.el("button", { type: "button", text: "Remove", "aria-label": "Remove shape " + (i + 1) });
      btn.addEventListener("click", function () { remove(i); });
      return [String(i + 1), TB.el("span", null, [sw, s.spec.type === "ring" ? "Ring" : "Line"]),
        ll(s.spec.lat, s.spec.lon), s.info.detail, s.info.end, btn];
    });
    TB.table("list", ["#", "Shape", "From", "Size", "End point and arrival bearing", ""], rows);
    TB.$("showAll").hidden = shapes.length <= ROWS;
    TB.$("listWrap").className = "scroll" + (showAll ? " all" : "");
    TB.$("showAll").textContent = showAll ? "Show fewer" : "Show all";
  }
  function readCentre() {
    var lat = TB.num("lat"), lon = TB.num("lon");
    setCentre(lat, lon, true);
  }
  function togglePick(on) {
    picking = on;
    TB.$("pick").setAttribute("aria-pressed", on ? "true" : "false");
    TB.$("pick").textContent = on ? "Click the map to set the centre" : "Pick centre on the map";
    map.getContainer().style.cursor = on ? "crosshair" : "";
  }

  TB.ready(function () {
    map = L.map("map", { worldCopyJump: false }).setView([centre.lat, centre.lon], 7);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a> contributors"
    }).addTo(map);

    var saved = TB.load(KEY);
    if (saved && saved.form) {
      Object.keys(saved.form).forEach(function (k) { if (TB.$(k) && saved.form[k] !== undefined) TB.$(k).value = saved.form[k]; });
    }
    try {
      if (saved && saved.centre) setCentre(saved.centre.lat, saved.centre.lon, false);
      else setCentre(centre.lat, centre.lon, false);
    } catch (e) { setCentre(38.0, -77.0, false); }
    map.setView([centre.lat, centre.lon], 7);
    if (saved && Array.isArray(saved.shapes)) {
      saved.shapes.forEach(function (spec) { try { shapes.push(build(spec)); } catch (e) { /* skip a bad saved shape */ } });
    }
    list();

    map.on("click", function (e) {
      if (!picking) return;
      try { setCentre(Number(e.latlng.lat.toFixed(6)), Number(DD.distanceBearing.normLon(e.latlng.lng).toFixed(6)), false); }
      catch (err) { TB.message("msg", err.message, "error"); }
      togglePick(false);
    });
    TB.$("form").addEventListener("submit", function (ev) { ev.preventDefault(); });
    TB.$("setCentre").addEventListener("click", function () {
      TB.message("msg", "");
      try { readCentre(); } catch (e) { TB.message("msg", e.message, "error"); }
    });
    TB.$("pick").addEventListener("click", function () { togglePick(!picking); });
    TB.$("addRing").addEventListener("click", function () {
      try { readCentre(); } catch (e) { return TB.message("msg", e.message, "error"); }
      var fill = TB.num("ringFill");
      add({ type: "ring", lat: centre.lat, lon: centre.lon, radiusKm: TB.num("radius"), colour: TB.$("ringColour").value,
        fill: isFinite(fill) ? Math.min(100, Math.max(0, fill)) / 100 : 0.15 });
    });
    TB.$("addLine").addEventListener("click", function () {
      try { readCentre(); } catch (e) { return TB.message("msg", e.message, "error"); }
      add({ type: "line", lat: centre.lat, lon: centre.lon, bearing: TB.num("bearing"), lengthKm: TB.num("length"),
        colour: TB.$("lineColour").value });
    });
    TB.$("clear").addEventListener("click", function () {
      shapes.forEach(function (s) { s.layers.forEach(function (l) { map.removeLayer(l); }); });
      shapes = [];
      persist();
      list();
    });
    TB.$("showAll").addEventListener("click", function () { showAll = !showAll; list(); });
    TB.$("copy").addEventListener("click", function () {
      if (!shapes.length) return TB.message("msg", "Add a ring or a line first.", "info");
      var out = { centre: centre, shapes: shapes.map(function (s) {
        var o = Object.assign({}, s.spec);
        if (s.info.endPoint) { o.endPoint = s.info.endPoint; o.arrivalBearing = s.info.finalBearing; }
        return o;
      }) };
      TB.copyJSON(out).then(function () { TB.message("msg", "Copied.", "info"); },
        function () { TB.message("msg", "This browser would not let the page use the clipboard.", "error"); });
    });
    ["radius", "ringColour", "ringFill", "bearing", "length", "lineColour"].forEach(function (k) {
      TB.$(k).addEventListener("change", persist);
    });
  });
})();

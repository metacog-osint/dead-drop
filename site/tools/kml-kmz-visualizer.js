/* KML/KMZ Visualizer page. KMZ is unzipped with JSZip and KML read with DOMParser in this browser; the features,
   lengths and areas come from ../lib/kml.js (tested in tests/kml.test.js). */
(function () {
  "use strict";
  var K = DD.kml;
  var KEY = "kml-kmz-visualizer";
  var ROWS = 10;
  var COLOURS = { Point: "#2b5d8a", LineString: "#c2410c", Polygon: "#0f766e" };
  var map, group = null, layers = [], state = null, showAll = false;

  /** Description HTML as plain text. A DOMParser document is inert: no scripts run and nothing is fetched. */
  function plain(html) {
    if (!html) return "";
    if (!/[<&]/.test(html)) return html;
    try { return new DOMParser().parseFromString(html, "text/html").body.textContent.trim(); } catch (e) { return html; }
  }
  function size(f) {
    if (f.type === "LineString") return TB.fix(f.lengthKm, 2) + " km long";
    if (f.type === "Polygon") return TB.fix(f.areaKm2, f.areaKm2 < 10 ? 3 : 1) + " km² · perimeter " + TB.fix(f.perimeterKm, 2) + " km" + (f.holes ? " · " + f.holes + (f.holes === 1 ? " hole" : " holes") : "");
    return TB.fix(f.coordinates[1], 5) + ", " + TB.fix(f.coordinates[0], 5);
  }
  function popup(f) {
    var desc = plain(f.description);
    return TB.el("div", { class: "kkv-pop" }, [TB.el("strong", { text: f.name }),
      f.folder ? TB.el("div", { class: "small muted", text: f.folder }) : null,
      TB.el("div", { class: "small", text: f.type + ": " + size(f) }),
      desc ? TB.el("div", { text: desc }) : null]);
  }
  function layerFor(f) {
    var c = COLOURS[f.type];
    if (f.type === "Point") return L.circleMarker([f.coordinates[1], f.coordinates[0]], { radius: 6, color: "#ffffff", weight: 2, fillColor: c, fillOpacity: 0.9 });
    if (f.type === "LineString") return L.polyline(K.latLngs(f.coordinates), { color: c, weight: 3 });
    return L.polygon(f.coordinates.map(K.latLngs), { color: c, weight: 2, fillOpacity: 0.25 });
  }

  function zoomTo(i) {
    var l = layers[i];
    if (!l) return;
    if (l.getBounds) map.fitBounds(l.getBounds(), { maxZoom: 15 });
    else map.setView(l.getLatLng(), Math.max(map.getZoom(), 12));
    l.openPopup();
  }

  function list() {
    var fs = state ? state.features : [];
    TB.table("list", ["#", "Type", "Name", "Folder", "Size or position", ""], fs.map(function (f, i) {
      var b = TB.el("button", { type: "button", class: "kkv-link", text: "Show" });
      b.addEventListener("click", function () { zoomTo(i); });
      return [String(i + 1), f.type === "LineString" && f.track ? "Track" : f.type, f.name, f.folder || "–", size(f), b];
    }));
    TB.$("listWrap").className = "scroll" + (showAll ? " all" : "");
    TB.$("showAll").hidden = fs.length <= ROWS;
    TB.$("showAll").textContent = showAll ? "Show fewer" : "Show all (" + fs.length + ")";
  }

  function render() {
    if (group) { map.removeLayer(group); group = null; }
    layers = [];
    var w = TB.$("warnings");
    TB.clear(w);
    if (!state) {
      TB.results("stats", [{ k: "Features", v: 0 }]);
      list();
      return;
    }
    var fs = state.features;
    layers = fs.map(function (f) { return layerFor(f).bindPopup(popup(f)); });
    if (layers.length) {
      group = L.featureGroup(layers).addTo(map);
      map.fitBounds(group.getBounds(), { maxZoom: 14, padding: [20, 20] });
    }
    var count = function (t) { return fs.filter(function (f) { return f.type === t; }).length; };
    var totalLen = fs.reduce(function (s, f) { return s + (f.lengthKm || 0); }, 0);
    var totalArea = fs.reduce(function (s, f) { return s + (f.areaKm2 || 0); }, 0);
    TB.results("stats", [
      { k: "File", v: state.file },
      { k: "Placemarks", v: state.placemarks },
      { k: "Points", v: count("Point") }, { k: "Lines", v: count("LineString") }, { k: "Polygons", v: count("Polygon") },
      { k: "Total line length", v: TB.fix(totalLen, 1), u: "km" },
      { k: "Total polygon area", v: TB.fix(totalArea, 1), u: "km²", title: "Overlapping polygons are counted twice" }
    ]);
    var notes = state.warnings.slice();
    if (state.networkLinks) notes.unshift(state.networkLinks + " network link" + (state.networkLinks === 1 ? "" : "s") + " (KML that loads other files from the internet) not followed.");
    if (notes.length) {
      w.appendChild(TB.el("h3", { text: "Notes on the file (" + notes.length + ")" }));
      w.appendChild(TB.el("div", { class: "scroll small" }, [TB.el("ul", null, notes.map(function (n) { return TB.el("li", { text: n }); }))]));
    }
    list();
  }

  function load(text, fileName) {
    TB.message("msg", "");
    var doc = new DOMParser().parseFromString(text, "application/xml");
    var err = doc.getElementsByTagName("parsererror")[0];
    if (err) throw new Error("This file is not well-formed XML, so it is not valid KML.");
    var r = K.extract(K.fromDom(doc));
    state = { file: fileName, placemarks: r.placemarks, networkLinks: r.networkLinks, warnings: r.warnings, features: r.features };
    if (!r.features.length) TB.message("msg", "No features this page can draw were found in the file.", "info");
    if (!TB.save(KEY, state)) { TB.save(KEY, null); TB.message("msg", "Loaded, but the file is too large to keep in this browser for next time.", "info"); }
    showAll = false;
    render();
  }

  function handle(file) {
    TB.message("msg", "");
    if (!file) return;
    var name = file.name || "file";
    var fail = function (e) { TB.message("msg", e && e.message ? e.message : "The file could not be read.", "error"); };
    if (/\.kmz$/i.test(name)) {
      if (!window.JSZip) return fail(new Error("JSZip did not load (cdnjs.cloudflare.com may be blocked), so a KMZ cannot be opened."));
      window.JSZip.loadAsync(file).then(function (zip) {
        var entry = K.pickKmlEntry(Object.keys(zip.files));
        if (!entry) throw new Error("This KMZ holds no KML file.");
        return zip.files[entry].async("string").then(function (text) { load(text, name + " › " + entry); });
      }).catch(function (e) { fail(new Error(/KML|XML/.test(e.message) ? e.message : "This is not a readable KMZ (ZIP) file: " + e.message)); });
    } else {
      var reader = new FileReader();
      reader.onerror = function () { fail(); };
      reader.onload = function () { try { load(reader.result, name); } catch (e) { fail(e); } };
      reader.readAsText(file);
    }
  }

  TB.ready(function () {
    map = L.map("map", { worldCopyJump: false }).setView([20, 0], 2);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a> contributors"
    }).addTo(map);
    var saved = TB.load(KEY);
    if (saved && Array.isArray(saved.features)) {
      state = saved;
      try { render(); TB.message("msg", "Showing " + saved.file + ", kept in this browser from your last visit.", "info"); }
      catch (e) { state = null; render(); }
    } else render();

    TB.$("form").addEventListener("submit", function (ev) { ev.preventDefault(); });
    TB.$("file").addEventListener("change", function (ev) { handle(ev.target.files && ev.target.files[0]); });
    var form = TB.$("form");
    form.addEventListener("dragover", function (ev) { ev.preventDefault(); form.classList.add("over"); });
    form.addEventListener("dragleave", function () { form.classList.remove("over"); });
    form.addEventListener("drop", function (ev) {
      ev.preventDefault(); form.classList.remove("over");
      if (ev.dataTransfer && ev.dataTransfer.files.length) handle(ev.dataTransfer.files[0]);
    });
    TB.$("showAll").addEventListener("click", function () { showAll = !showAll; list(); });
    TB.$("clear").addEventListener("click", function () {
      state = null; TB.save(KEY, null); TB.$("file").value = ""; TB.message("msg", ""); render();
    });
    TB.$("copy").addEventListener("click", function () {
      if (!state || !state.features.length) return TB.message("msg", "Open a file first.", "info");
      TB.copyJSON(K.toGeoJSON(state.features)).then(function () { TB.message("msg", "Copied as GeoJSON.", "info"); },
        function () { TB.message("msg", "This browser would not let the page use the clipboard.", "error"); });
    });
  });
})();

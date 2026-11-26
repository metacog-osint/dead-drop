/* Coordinate Converter page. DD, DMS, DDM, UTM and MGRS come from ../lib/coordinate-converter.js (tested in
   tests/coordinate-converter.test.js); reading an MGRS reference uses the mgrs library (window.mgrs, 1.0.0). */
(function () {
  "use strict";
  var KEY = "coordinate-converter";
  var last = null;
  var PLACES = [
    ["Kennedy Space Center LC-39A, United States", "28.6084", "-80.6043"],
    ["Baikonur Cosmodrome, Kazakhstan", "45.9658", "63.3050"],
    ["Jiuquan Satellite Launch Center, China", "40.9603", "100.2992"]
  ];
  var CC = function () { return DD.coordinateConverter; };

  function mgrsLib() { return (typeof window !== "undefined" && window.mgrs) ? window.mgrs : null; }

  function show(lat, lon, source) {
    var c = CC();
    var out = {
      lat: lat, lon: lon,
      dd: c.toDD(lat, "lat").text + ", " + c.toDD(lon, "lon").text,
      ddHemisphere: c.toDD(lat, "lat").hemiText + ", " + c.toDD(lon, "lon").hemiText,
      dms: c.toDMS(lat, "lat").text + ", " + c.toDMS(lon, "lon").text,
      ddm: c.toDDM(lat, "lat").text + ", " + c.toDDM(lon, "lon").text,
      utm: null, mgrs: null
    };
    var notes = [];
    try {
      var u = c.toUTM(lat, lon);
      out.utm = { zone: u.zone, band: u.band, hemisphere: u.hemisphere, easting: Math.round(u.easting),
        northing: Math.round(u.northing), text: u.text, scaleFactor: u.scale };
    } catch (e) { notes.push(e.message); }
    if (out.utm) {
      try { out.mgrs = c.toMGRS(c.toUTM(lat, lon), 5).spaced; } catch (e) { notes.push("MGRS: " + e.message); }
    }
    var items = [
      { k: "Decimal degrees (DD)", v: out.dd },
      { k: "DD with hemisphere", v: out.ddHemisphere },
      { k: "Degrees, minutes, seconds (DMS)", v: out.dms },
      { k: "Degrees, decimal minutes (DDM)", v: out.ddm }
    ];
    if (out.utm) {
      items.push({ k: "UTM (WGS 84)", v: out.utm.text });
      items.push({ k: "UTM zone and band", v: out.utm.zone + out.utm.band,
        title: "Zone number and MGRS latitude band letter" });
      items.push({ k: "Grid scale factor", v: TB.fix(out.utm.scaleFactor, 6),
        title: "Grid distance divided by true distance at this point" });
    }
    if (out.mgrs) items.push({ k: "MGRS (1 m)", v: out.mgrs });
    TB.results("results", items);
    var note = TB.$("note");
    if (source) notes.unshift(source);
    note.textContent = notes.join(" ");
    note.hidden = !notes.length;
    last = out;
  }
  function fromLatLon() {
    TB.message("msg", "");
    var latText = TB.$("lat").value, lonText = TB.$("lon").value;
    try {
      var lat = CC().parseAngle(latText, "lat");
      var lon = CC().parseAngle(lonText, "lon");
      TB.save(KEY, { lat: latText, lon: lonText });
      show(lat, lon, null);
    } catch (e) {
      TB.message("msg", e.message, "error");
    }
  }
  function fromMgrs() {
    TB.message("msg", "");
    var lib = mgrsLib();
    if (!lib || typeof lib.toPoint !== "function") return TB.message("msg", "The mgrs library did not load.", "error");
    var ref = TB.$("mgrsIn").value.replace(/\s+/g, "").toUpperCase();
    if (!ref) return TB.message("msg", "Type an MGRS reference first.", "error");
    var p;
    try { p = lib.toPoint(ref); } catch (e) { return TB.message("msg", "That MGRS reference could not be read: " + e.message, "error"); }
    if (!p || !isFinite(p[0]) || !isFinite(p[1])) return TB.message("msg", "That MGRS reference could not be read.", "error");
    var lat = p[1], lon = p[0];
    TB.$("lat").value = CC().toDD(lat, "lat").value;
    TB.$("lon").value = CC().toDD(lon, "lon").value;
    TB.save(KEY, { lat: TB.$("lat").value, lon: TB.$("lon").value });
    show(lat, lon, "From MGRS " + ref + " (centre of the square it names).");
  }
  TB.ready(function () {
    var sel = TB.$("place");
    sel.appendChild(TB.el("option", { value: "", text: "Choose a place, or type below" }));
    PLACES.forEach(function (p, i) { sel.appendChild(TB.el("option", { value: String(i), text: p[0] })); });
    sel.addEventListener("change", function () {
      if (sel.value === "") return;
      var p = PLACES[Number(sel.value)];
      TB.$("lat").value = p[1]; TB.$("lon").value = p[2];
      fromLatLon();
    });
    var saved = TB.load(KEY);
    if (saved && typeof saved.lat === "string" && typeof saved.lon === "string") {
      TB.$("lat").value = saved.lat; TB.$("lon").value = saved.lon;
    }
    TB.$("form").addEventListener("submit", function (ev) { ev.preventDefault(); fromLatLon(); });
    TB.$("fromMgrs").addEventListener("click", fromMgrs);
    TB.$("mgrsIn").addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") { ev.preventDefault(); fromMgrs(); }
    });
    TB.$("copy").addEventListener("click", function () {
      if (!last) return TB.message("msg", "Convert first.", "info");
      TB.copyJSON(last).then(function () { TB.message("msg", "Copied.", "info"); },
        function () { TB.message("msg", "This browser would not let the page use the clipboard.", "error"); });
    });
    fromLatLon();
  });
})();

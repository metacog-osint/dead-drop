/* Light Pollution Map page. The conversions are in ../lib/light-pollution.js (tested in tests/light-pollution.test.js). */
(function () {
  "use strict";
  var KEY = "light-pollution";
  var LP = DD.lightPollution;
  var ROWS = 10;
  // NASA GIBS, Web Mercator, VIIRS City Lights 2012 (a single image, so the time is "default"). Native zoom 0-8.
  var GIBS_URL = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_CityLights_2012/default/default/" +
    "GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpg";
  var map, lights, pin, sites = [], showAll = false, lastConv = null, tileErrors = 0;

  function persist() {
    TB.save(KEY, { lat: TB.$("lat").value, lon: TB.$("lon").value, siteName: TB.$("siteName").value,
      lights: TB.$("lights").checked, opacity: TB.$("opacity").value, sqm: TB.$("sqm").value, nelm: TB.$("nelm").value,
      sites: sites });
  }

  function placePin(lat, lon) {
    if (pin) pin.setLatLng([lat, lon]);
    else pin = L.circleMarker([lat, lon], { radius: 7, color: "#2b5d8a", weight: 3, fillColor: "#ffffff", fillOpacity: 1 }).addTo(map);
  }

  function go(zoom) {
    TB.message("msg", "");
    try {
      var p = LP.checkLatLon(TB.num("lat"), TB.num("lon"));
      placePin(p.lat, p.lon);
      map.setView([p.lat, p.lon], zoom || Math.max(map.getZoom(), 9));
      persist();
      return p;
    } catch (e) { TB.message("msg", e.message, "error"); return null; }
  }

  function listSites() {
    var rows = sites.map(function (s, i) {
      var goBtn = TB.el("button", { type: "button", text: "Go" });
      goBtn.addEventListener("click", function () {
        TB.$("lat").value = s.lat; TB.$("lon").value = s.lon; TB.$("siteName").value = s.name; go(10);
      });
      var del = TB.el("button", { type: "button", text: "Remove" });
      del.addEventListener("click", function () { sites.splice(i, 1); persist(); listSites(); });
      return [s.name, s.lat.toFixed(5) + ", " + s.lon.toFixed(5), s.savedUtc ? TB.time(s.savedUtc) : "–",
        TB.el("span", null, [goBtn, " ", del])];
    });
    TB.table("sites", ["Name", "Latitude, longitude (°)", "Saved", ""], rows);
    TB.$("showAll").hidden = sites.length <= ROWS;
    TB.$("showAll").textContent = showAll ? "Show fewer" : "Show all " + sites.length;
    TB.$("sitesWrap").className = "scroll" + (showAll ? " all" : "");
  }

  function setLights() {
    var on = TB.$("lights").checked;
    var op = TB.num("opacity");
    if (!isFinite(op) || op < 10 || op > 100) op = 70;
    lights.setOpacity(op / 100);
    if (on && !map.hasLayer(lights)) lights.addTo(map);
    if (!on && map.hasLayer(lights)) map.removeLayer(lights);
    persist();
  }

  function convert() {
    TB.message("convMsg", "");
    try {
      var items = [], out = {};
      var m = TB.num("sqm"), nelm = TB.num("nelm");
      if (!isFinite(m) && !isFinite(nelm)) throw new Error("Enter a meter reading, a limiting magnitude, or both.");
      if (isFinite(m)) {
        var r = LP.fromSqm(m);
        out.sky = r;
        items.push({ k: "Luminance", v: TB.fix(r.mcdm2, 3), u: "mcd/m²" });
        items.push({ k: "Luminance", v: TB.fix(r.ucdm2, 1), u: "µcd/m²" });
        items.push({ k: "Brightness against a natural sky", v: TB.fix(r.ratioToNatural, 2), u: "times",
          cls: r.ratioToNatural >= 3 ? "warn" : r.ratioToNatural <= 1.2 ? "ok" : null });
        items.push({ k: "Added by artificial light", v: r.artificialPctOfNatural < 0 ? "none" : TB.fix(r.artificialPctOfNatural, 0),
          u: r.artificialPctOfNatural < 0 ? "" : "% of natural",
          title: r.artificialPctOfNatural < 0 ? "The reading is darker than the 22.0 reference, within the natural sky's own range" : null });
      }
      if (isFinite(nelm)) {
        var b = LP.bortleFromNelm(nelm);
        out.bortle = { nelm: nelm, cls: b.cls, name: b.name, bortleNelmRange: b.nelm };
        items.push({ k: "Bortle class (from the faintest star)", v: b.cls, u: b.name });
      }
      lastConv = out;
      TB.results("convResults", items);
      persist();
    } catch (e) { TB.message("convMsg", e.message, "error"); }
  }

  TB.ready(function () {
    var saved = TB.load(KEY) || {};
    ["lat", "lon", "siteName", "opacity", "sqm", "nelm"].forEach(function (k) {
      if (typeof saved[k] === "string") TB.$(k).value = saved[k];
    });
    if (typeof saved.lights === "boolean") TB.$("lights").checked = saved.lights;
    sites = LP.cleanSites(saved.sites);

    map = L.map("map").setView([28.5, -80.6], 7);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a> contributors"
    }).addTo(map);
    lights = L.tileLayer(GIBS_URL, {
      maxNativeZoom: 8, maxZoom: 19, opacity: 0.7, bounds: [[-85.0511, -180], [85.0511, 180]],
      attribution: "Night lights: NASA Earth Observatory and NOAA NGDC, Suomi NPP VIIRS 2012, via " +
        "<a href=\"https://nasa-gibs.github.io/gibs-api-docs/\">NASA GIBS</a>"
    });
    lights.on("tileerror", function () {
      tileErrors++;
      if (tileErrors === 1) TB.message("msg", "Some NASA night-light tiles did not load. The street map still works; try again later.", "error");
    });
    setLights();
    try {
      var p = LP.checkLatLon(TB.num("lat"), TB.num("lon"));
      placePin(p.lat, p.lon);
      map.setView([p.lat, p.lon], 7);
    } catch (e) { /* keep the default view */ }
    listSites();
    convert();
    TB.table("bortle", ["Class", "Bortle's name", "Faintest star (mag)"],
      LP.BORTLE.map(function (b) { return [String(b.cls), b.name, b.nelm]; }));

    map.on("click", function (e) {
      var p = LP.checkLatLon(e.latlng.lat, e.latlng.lng);
      TB.$("lat").value = p.lat.toFixed(5);
      TB.$("lon").value = p.lon.toFixed(5);
      placePin(p.lat, p.lon);
      persist();
    });
    TB.$("form").addEventListener("submit", function (ev) { ev.preventDefault(); go(); });
    TB.$("saveSite").addEventListener("click", function () {
      TB.message("msg", "");
      var name = TB.$("siteName").value.trim();
      if (!name) return TB.message("msg", "Give the site a name first.", "error");
      try {
        var p = LP.checkLatLon(TB.num("lat"), TB.num("lon"));
        sites.push({ name: name.slice(0, 80), lat: Number(p.lat.toFixed(6)), lon: Number(p.lon.toFixed(6)),
          savedUtc: new Date().toISOString() });
        placePin(p.lat, p.lon);
        persist();
        listSites();
        TB.message("msg", "Saved " + name + ".", "info");
      } catch (e) { TB.message("msg", e.message, "error"); }
    });
    TB.$("lights").addEventListener("change", setLights);
    TB.$("opacity").addEventListener("change", setLights);
    TB.$("showAll").addEventListener("click", function () { showAll = !showAll; listSites(); });
    TB.$("convForm").addEventListener("submit", function (ev) { ev.preventDefault(); convert(); });
    TB.$("copy").addEventListener("click", function () {
      TB.copyJSON({ location: { lat: TB.num("lat"), lon: TB.num("lon") }, sites: sites, conversion: lastConv,
        references: { luminance: "L = 10.8e4 * 10^(-0.4 m) cd/m^2 (Cinzano 2005)", natural: "22.0 mag/arcsec^2 (Falchi et al. 2016)",
          bortle: "Bortle, Sky & Telescope, Feb 2001" } })
        .then(function () { TB.message("msg", "Copied.", "info"); },
          function () { TB.message("msg", "This browser would not let the page use the clipboard.", "error"); });
    });
  });
})();

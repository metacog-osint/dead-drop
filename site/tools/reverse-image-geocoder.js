/* Reverse Image Geocoder page. The photo is read with FileReader and Exif.js in this browser; the position, the
   DMS text and the direction line come from ../lib/image-geocode.js (tested in tests/image-geocode.test.js). */
(function () {
  "use strict";
  var G = DD.imageGeocode;
  var map, layer = null, last = null, previewUrl = null, copyUrl = null, fileName = "photo";

  function mins(m) {
    var s = m < 0 ? "−" : "+", a = Math.abs(m);
    return s + Math.floor(a / 60) + " h " + (a % 60 < 10 ? "0" : "") + (a % 60) + " min";
  }

  function render() {
    var notes = TB.$("notes");
    TB.clear(notes);
    if (!last) return;
    var r = last, g = r.gps;
    var items = [];
    if (g) {
      items.push({ k: "Latitude", v: TB.fix(g.lat, 6), u: "°", cls: g.warnings.length ? "warn" : "ok" });
      items.push({ k: "Longitude", v: TB.fix(g.lon, 6), u: "°", cls: g.warnings.length ? "warn" : "ok" });
      items.push({ k: "Degrees, minutes, seconds", v: r.dms });
      items.push({ k: "Altitude", v: g.altitudeM === null ? "–" : TB.fix(g.altitudeM, 1), u: g.altitudeM === null ? "" : "m (negative is below sea level)" });
      items.push({ k: "GPS time stamp", v: g.utc ? TB.time(g.utc, { year: true, seconds: true }) : "–" });
      if (g.direction) items.push({ k: "Camera pointing", v: TB.fix(g.direction.deg, 1), u: "° " + g.direction.ref + (g.direction.ref === "magnetic" ? " (not drawn)" : "") });
      if (g.datum) items.push({ k: "Map datum", v: g.datum });
    } else {
      items.push({ k: "GPS position", v: r.gpsError ? "Unreadable" : "None recorded", cls: "alarm" });
    }
    items.push({ k: "Taken (camera clock)", v: r.taken ? r.taken.text : "–", u: r.taken ? (r.taken.zone ? "offset " + r.taken.zone : "no time zone") : "" });
    if (r.clockMinusGpsMin !== null) items.push({ k: "Camera clock minus GPS (UTC)", v: mins(r.clockMinusGpsMin), title: "A hint at the offset the clock was set to; not a recorded time zone" });
    items.push({ k: "Camera", v: r.camera || "–" });
    TB.results("results", items);

    if (r.gpsError) notes.appendChild(TB.el("p", { class: "msg error", text: r.gpsError }));
    if (g) g.warnings.forEach(function (w) { notes.appendChild(TB.el("p", { class: "msg error", text: w })); });
    if (r.links.length) {
      var p = TB.el("p");
      r.links.forEach(function (l, i) {
        if (i) p.appendChild(document.createTextNode(" · "));
        p.appendChild(TB.el("a", { href: l.url, target: "_blank", rel: "noopener noreferrer", text: "Open in " + l.label }));
      });
      p.appendChild(document.createTextNode(" (opens a new tab and sends these coordinates to that site)"));
      notes.appendChild(p);
    }
    drawMap();
  }

  function drawMap() {
    if (layer) { map.removeLayer(layer); layer = null; }
    if (!last || !last.gps) return;
    var g = last.gps;
    var parts = [L.circleMarker([g.lat, g.lon], { radius: 7, color: "#ffffff", weight: 2, fillColor: "#c2410c", fillOpacity: 0.9 })
      .bindPopup(TB.el("div", null, [TB.el("strong", { text: "Recorded position" }), TB.el("br"), last.dms]))];
    var line = G.directionLine(g, 0.3);
    if (line) parts.push(L.polyline(line, { color: "#c2410c", weight: 3 }));
    layer = L.featureGroup(parts).addTo(map);
    map.setView([g.lat, g.lon], 16);
  }

  function handle(file) {
    TB.message("msg", "");
    if (!file) return;
    fileName = (file.name || "photo").replace(/\.[^.]+$/, "");
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (copyUrl) { URL.revokeObjectURL(copyUrl); copyUrl = null; }
    TB.$("save").hidden = true;
    previewUrl = URL.createObjectURL(file);   // a local blob: URL; the file stays on this computer
    var img = TB.$("preview");
    img.hidden = false;
    img.src = previewUrl;
    var reader = new FileReader();
    reader.onerror = function () { TB.message("msg", "The browser could not read that file.", "error"); };
    reader.onload = function () {
      var tags = null;
      if (!window.EXIF || !window.EXIF.readFromBinaryFile) {
        TB.message("msg", "Exif.js did not load (cdn.jsdelivr.net may be blocked), so the metadata cannot be read.", "error");
      } else {
        try { tags = window.EXIF.readFromBinaryFile(reader.result); } catch (e) {
          TB.message("msg", "The EXIF block is damaged and could not be read: " + e.message, "error");
        }
        if (!tags && !TB.$("msg").textContent) {
          TB.message("msg", /jpe?g/i.test(file.type) ? "This JPEG carries no EXIF metadata (it may have been stripped)."
            : "No EXIF read: this tool reads EXIF from JPEG files only.", "info");
        }
      }
      last = G.locate(tags || {});
      last.file = file.name;
      render();
    };
    reader.readAsArrayBuffer(file);
  }

  function stripCopy() {
    var img = TB.$("preview");
    if (img.hidden || !img.naturalWidth) return TB.message("msg", "Choose a photo first.", "info");
    var c = document.createElement("canvas");
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext("2d").drawImage(img, 0, 0);
    c.toBlob(function (blob) {
      if (!blob) return TB.message("msg", "This browser could not make the copy.", "error");
      if (copyUrl) URL.revokeObjectURL(copyUrl);
      copyUrl = URL.createObjectURL(blob);
      var a = TB.$("save");
      a.href = copyUrl;
      a.setAttribute("download", fileName + "-no-metadata.jpg");
      a.hidden = false;
      TB.message("msg", "Copy made in this browser (" + DD.imageMetadata.fileSize(blob.size) + "). Use Save the copy to keep it.", "info");
    }, "image/jpeg", 0.92);
  }

  TB.ready(function () {
    map = L.map("map", { worldCopyJump: false }).setView([20, 0], 2);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a> contributors"
    }).addTo(map);

    var sites = TB.$("sites");
    G.SEARCH_SITES.forEach(function (s) {
      sites.appendChild(TB.el("li", null, [TB.el("a", { href: s.url, target: "_blank", rel: "noopener noreferrer", text: s.label }),
        " (" + s.owner + ")"]));
    });

    TB.$("form").addEventListener("submit", function (ev) { ev.preventDefault(); });
    TB.$("file").addEventListener("change", function (ev) { handle(ev.target.files && ev.target.files[0]); });
    var form = TB.$("form");
    form.addEventListener("dragover", function (ev) { ev.preventDefault(); form.classList.add("over"); });
    form.addEventListener("dragleave", function () { form.classList.remove("over"); });
    form.addEventListener("drop", function (ev) {
      ev.preventDefault(); form.classList.remove("over");
      if (ev.dataTransfer && ev.dataTransfer.files.length) handle(ev.dataTransfer.files[0]);
    });
    TB.$("preview").addEventListener("error", function () { TB.$("preview").hidden = true; });
    TB.$("strip").addEventListener("click", stripCopy);
    TB.$("copyCoords").addEventListener("click", function () {
      if (!last || !last.gps) return TB.message("msg", "No GPS position to copy.", "info");
      var s = last.gps.lat.toFixed(6) + ", " + last.gps.lon.toFixed(6);
      if (!navigator.clipboard) return TB.message("msg", "This browser would not let the page use the clipboard.", "error");
      navigator.clipboard.writeText(s).then(function () { TB.message("msg", "Copied " + s + ".", "info"); },
        function () { TB.message("msg", "This browser would not let the page use the clipboard.", "error"); });
    });
    TB.$("copy").addEventListener("click", function () {
      if (!last) return TB.message("msg", "Choose a photo first.", "info");
      TB.copyJSON(last).then(function () { TB.message("msg", "Copied.", "info"); },
        function () { TB.message("msg", "This browser would not let the page use the clipboard.", "error"); });
    });
    if (window.TicTime && window.TicTime.onChange) window.TicTime.onChange(render);
  });
})();

/* Map Screenshot page. The scale and file-name maths is in ../lib/map-screenshot.js (tested in
   tests/map-screenshot.test.js). html2canvas copies the map element; this script then draws the title, notes, scale
   bar, centre, capture time and map credit around it on a second canvas, and hands the result to the browser as a
   file to save. */
(function () {
  "use strict";
  var KEY = "map-screenshot";
  var MS = DD.mapScreenshot;
  var BAR_MAX_PX = 200;           // CSS pixels: the longest the scale bar may be
  var INK = "#13202b", PAPER = "#ffffff", MARK = "#b3261e";
  var map, markerLayer, markers = [], lastCapture = null;

  function view() {
    var c = map.getCenter();
    return { lat: c.lat, lon: MS.normLon(c.lng), zoom: map.getZoom() };
  }
  function fmtM(m) {
    if (m >= 1000) return { v: TB.fix(m / 1000, 3), u: "km" };
    return { v: TB.fix(m, m < 10 ? 4 : 2), u: "m" };
  }
  function utcLine(d) { return d.toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC"); }

  function persist() {
    var v = view();
    TB.save(KEY, {
      lat: Number(v.lat.toFixed(6)), lon: Number(v.lon.toFixed(6)), zoom: v.zoom,
      title: TB.$("title").value, desc: TB.$("desc").value, markerLabel: TB.$("markerLabel").value,
      format: TB.$("format").value, scale: TB.$("scale").value, units: TB.$("units").value, markers: markers
    });
  }

  function scaleNow() {
    var v = view(), b = map.getBounds();
    var vs = MS.viewScale(b.getNorth(), b.getSouth(), v.zoom);
    var units = TB.$("units").value;
    var bar = units === "none" ? null : MS.scaleBar(v.lat, v.zoom, BAR_MAX_PX, units);
    return { view: v, scale: vs, bar: bar, ratio: MS.scaleDenominator(vs.centreMpp) };
  }

  function showScale() {
    var s = scaleNow();
    var c = fmtM(s.scale.centreMpp), t = fmtM(s.scale.topMpp), bt = fmtM(s.scale.bottomMpp);
    TB.results("results", [
      { k: "Map centre", v: MS.formatLatLon(s.view.lat, s.view.lon, 4) },
      { k: "Zoom", v: s.view.zoom },
      { k: "Ground per pixel at the centre", v: c.v, u: c.u },
      { k: "At the top edge", v: t.v, u: t.u },
      { k: "At the bottom edge", v: bt.v, u: bt.u },
      { k: "Change across the view", v: TB.fix(s.scale.changePct, 1), u: "%", cls: s.scale.changePct > 10 ? "warn" : null,
        title: "How much the ground per pixel differs between the top and bottom of the view" },
      { k: "Scale ratio on screen", v: "1:" + Math.round(s.ratio).toLocaleString("en-US"),
        title: "At 96 CSS pixels per inch" },
      { k: "Scale bar", v: s.bar ? s.bar.label : "none", u: s.bar ? "= " + s.bar.px.toFixed(0) + " px" : "" }
    ]);
  }

  function syncInputs() {
    var v = view();
    TB.$("lat").value = v.lat.toFixed(5);
    TB.$("lon").value = v.lon.toFixed(5);
    TB.$("zoom").value = v.zoom;
    showScale();
    persist();
  }

  function drawMarker(m) {
    var cm = L.circleMarker([m.lat, m.lon], { radius: 7, color: MARK, weight: 3, fillColor: PAPER, fillOpacity: 1 });
    if (m.label) {
      cm.bindTooltip(TB.el("span", { class: "ms-label", text: m.label }),
        { permanent: true, direction: "right", offset: [8, 0] });
    }
    cm.addTo(markerLayer);
  }
  function redrawMarkers() {
    markerLayer.clearLayers();
    markers.forEach(drawMarker);
  }

  // Splits text into lines no wider than maxW on this canvas context; keeps the writer's own line breaks.
  function wrap(ctx, text, maxW) {
    var out = [];
    String(text).split(/\r?\n/).forEach(function (para) {
      var words = para.split(/\s+/).filter(Boolean), line = "";
      if (!words.length) { out.push(""); return; }
      words.forEach(function (w) {
        var t = line ? line + " " + w : w;
        if (ctx.measureText(t).width <= maxW || !line) line = t;
        else { out.push(line); line = w; }
      });
      out.push(line);
    });
    return out;
  }

  function compose(shot, info) {
    var s = info.scale, W = shot.width, pad = 12 * s, maxW = W - 2 * pad;
    var fTitle = "bold " + 20 * s + "px sans-serif", fDesc = 14 * s + "px sans-serif", fFoot = 12 * s + "px sans-serif";
    var lhTitle = 26 * s, lhDesc = 19 * s, lhFoot = 17 * s;
    var probe = document.createElement("canvas").getContext("2d");
    probe.font = fTitle;
    var titleLines = info.title ? wrap(probe, info.title, maxW) : [];
    probe.font = fDesc;
    var descLines = info.desc ? wrap(probe, info.desc, maxW) : [];
    probe.font = fFoot;
    var footLines = wrap(probe, "Centre " + MS.formatLatLon(info.view.lat, info.view.lon, 5) + " · zoom " + info.view.zoom +
      " · captured " + utcLine(info.when), maxW)
      .concat(wrap(probe, "Map data © OpenStreetMap contributors, openstreetmap.org/copyright", maxW));
    if (info.bar) footLines.push("Scale bar true at the centre latitude only (Web Mercator).");
    var headH = (titleLines.length || descLines.length) ? pad * 2 + titleLines.length * lhTitle + descLines.length * lhDesc : 0;
    var barH = info.bar ? 22 * s : 0;
    var footH = pad * 2 + barH + footLines.length * lhFoot;

    var out = document.createElement("canvas");
    out.width = W;
    out.height = Math.ceil(headH + shot.height + footH);
    var ctx = out.getContext("2d");
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.fillStyle = INK;
    ctx.textBaseline = "top";
    var y = pad;
    ctx.font = fTitle;
    titleLines.forEach(function (l) { ctx.fillText(l, pad, y); y += lhTitle; });
    ctx.font = fDesc;
    descLines.forEach(function (l) { ctx.fillText(l, pad, y); y += lhDesc; });

    ctx.drawImage(shot, 0, headH);
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(1, s);
    ctx.strokeRect(0.5, headH + 0.5, W - 1, shot.height - 1);

    y = headH + shot.height + pad;
    if (info.bar) {
      var len = info.bar.px * s, x0 = pad, yb = y + 12 * s;
      ctx.lineWidth = 2 * s;
      ctx.beginPath();
      ctx.moveTo(x0, yb - 6 * s); ctx.lineTo(x0, yb); ctx.lineTo(x0 + len, yb); ctx.lineTo(x0 + len, yb - 6 * s);
      ctx.stroke();
      ctx.font = "bold " + 12 * s + "px sans-serif";
      ctx.textBaseline = "middle";
      ctx.fillText(info.bar.label, x0 + len + 8 * s, yb - 3 * s);
      ctx.textBaseline = "top";
      y += barH;
    }
    ctx.font = fFoot;
    footLines.forEach(function (l) { ctx.fillText(l, pad, y); y += lhFoot; });
    return out;
  }

  function toBlob(canvas, mime) {
    return new Promise(function (resolve, reject) {
      try {
        canvas.toBlob(function (b) { if (b) resolve(b); else reject(new Error("The browser could not encode the image.")); },
          mime, 0.92);
      } catch (e) { reject(e); }
    });
  }

  function saveFile(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = TB.el("a", { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
  }

  function capture() {
    if (typeof html2canvas !== "function") {
      return TB.message("msg", "The html2canvas library did not load, so the map cannot be copied. Check the connection and reload.", "error");
    }
    var fmt = TB.$("format").value, scale = Number(TB.$("scale").value) || 1;
    var sc = scaleNow(), when = new Date();
    var info = { scale: scale, view: sc.view, bar: sc.bar, when: when,
      title: TB.$("title").value.trim(), desc: TB.$("desc").value.trim() };
    var name = MS.fileName(info.title, when, fmt);
    TB.message("msg", "Making the image.", "info");
    html2canvas(TB.$("map"), {
      useCORS: true, allowTaint: false, scale: scale, backgroundColor: PAPER, logging: false,
      ignoreElements: function (el) { return !!(el.classList && el.classList.contains("leaflet-control-zoom")); }
    }).then(function (shot) {
      return toBlob(compose(shot, info), MS.mimeType(fmt));
    }).then(function (blob) {
      saveFile(blob, name);
      lastCapture = { file: name, type: MS.mimeType(fmt), bytes: blob.size, capturedUtc: when.toISOString() };
      TB.message("msg", "Saved " + name + " (" + Math.round(blob.size / 1024) + " KB), captured " + TB.time(when) + ".", "info");
    }).catch(function (e) {
      var text = e && e.name === "SecurityError"
        ? "The browser would not let the page copy the map tiles into an image (their server did not allow it). Wait for every tile to finish loading and try again."
        : "The image could not be made: " + (e && e.message ? e.message : String(e));
      TB.message("msg", text, "error");
    });
  }

  function go() {
    TB.message("msg", "");
    try {
      var v = MS.checkView(TB.num("lat"), TB.num("lon"), TB.num("zoom"));
      if (Math.round(v.zoom) !== v.zoom) throw new Error("Zoom must be a whole number.");
      map.setView([v.lat, v.lon], v.zoom);
    } catch (e) { TB.message("msg", e.message, "error"); }
  }

  TB.ready(function () {
    var saved = TB.load(KEY) || {};
    ["title", "desc", "markerLabel", "format", "scale", "units"].forEach(function (k) {
      if (typeof saved[k] === "string") TB.$(k).value = saved[k];
    });
    var start = { lat: 38.0, lon: -77.0, zoom: 8 };
    try { start = MS.checkView(Number(saved.lat), Number(saved.lon), Number(saved.zoom)); } catch (e) { /* keep the default */ }
    if (Array.isArray(saved.markers)) {
      markers = saved.markers.filter(function (m) { return m && isFinite(m.lat) && isFinite(m.lon); })
        .map(function (m) { return { lat: Number(m.lat), lon: Number(m.lon), label: String(m.label || "").slice(0, 60) }; });
    }

    map = L.map("map").setView([start.lat, start.lon], Math.round(start.zoom));
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, crossOrigin: "anonymous",
      attribution: "&copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a> contributors"
    }).addTo(map);
    markerLayer = L.layerGroup().addTo(map);
    redrawMarkers();
    map.on("moveend", syncInputs);
    syncInputs();

    TB.$("form").addEventListener("submit", function (ev) { ev.preventDefault(); go(); });
    ["title", "desc", "markerLabel", "format", "scale"].forEach(function (k) { TB.$(k).addEventListener("change", persist); });
    TB.$("units").addEventListener("change", function () { showScale(); persist(); });
    TB.$("addMarker").addEventListener("click", function () {
      var v = view();
      var m = { lat: Number(v.lat.toFixed(6)), lon: Number(v.lon.toFixed(6)), label: TB.$("markerLabel").value.trim() };
      markers.push(m);
      drawMarker(m);
      persist();
      TB.message("msg", "Marker added at " + MS.formatLatLon(m.lat, m.lon, 5) + ".", "info");
    });
    TB.$("clearMarkers").addEventListener("click", function () { markers = []; redrawMarkers(); persist(); TB.message("msg", ""); });
    TB.$("capture").addEventListener("click", capture);
    TB.$("copy").addEventListener("click", function () {
      var s = scaleNow();
      var out = { view: s.view, metresPerPixel: { top: s.scale.topMpp, centre: s.scale.centreMpp, bottom: s.scale.bottomMpp },
        changeAcrossViewPct: s.scale.changePct, scaleRatioAt96ppi: s.ratio, scaleBar: s.bar,
        title: TB.$("title").value, notes: TB.$("desc").value, markers: markers, lastImage: lastCapture };
      TB.copyJSON(out).then(function () { TB.message("msg", "Copied.", "info"); },
        function () { TB.message("msg", "This browser would not let the page use the clipboard.", "error"); });
    });
  });
})();

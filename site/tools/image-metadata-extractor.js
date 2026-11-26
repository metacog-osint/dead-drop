/* Image Metadata Extractor page. The file is read with FileReader and parsed by Exif.js in this browser; the tag
   values are turned into figures by ../lib/image-metadata.js (tested in tests/image-metadata.test.js). */
(function () {
  "use strict";
  var M = DD.imageMetadata;
  var ROWS = 10;
  var last = null, previewUrl = null, showAll = false;

  function dash(x) { return (x === undefined || x === null || x === "") ? "–" : x; }
  function mins(m) {
    var s = m < 0 ? "−" : "+", a = Math.abs(m);
    return s + Math.floor(a / 60) + " h " + (a % 60 < 10 ? "0" : "") + (a % 60) + " min";
  }

  function dateItem(label, d) {
    if (!d) return { k: label, v: "–" };
    if (d.iso) return { k: label, v: TB.time(d.iso, { year: true, seconds: true }), title: "Written " + d.text + " with offset " + d.zone };
    return { k: label, v: d.text, u: "camera clock, no time zone", title: "Shown exactly as written in the file" };
  }

  function render() {
    if (!last) return;
    var s = last.summary, g = s.gps;
    TB.$("none").hidden = true;
    TB.$("out").hidden = false;

    var links = TB.$("links");
    TB.clear(links);
    if (g) {
      var items = [
        { k: "Latitude", v: TB.fix(g.lat, 6), u: "°", cls: g.warnings.length ? "warn" : "ok" },
        { k: "Longitude", v: TB.fix(g.lon, 6), u: "°", cls: g.warnings.length ? "warn" : "ok" },
        { k: "Altitude", v: g.altitudeM === null ? "–" : TB.fix(g.altitudeM, 1), u: g.altitudeM === null ? "" : "m (negative is below sea level)" },
        { k: "GPS time stamp", v: g.utc ? TB.time(g.utc, { year: true, seconds: true }) : "–", title: "Defined as UTC by the Exif standard" }
      ];
      if (g.direction) items.push({ k: "Camera pointing", v: TB.fix(g.direction.deg, 1), u: "° " + g.direction.ref });
      if (g.speed) items.push({ k: "Speed", v: TB.fix(g.speed.value, 1), u: g.speed.unit });
      if (g.datum) items.push({ k: "Map datum", v: g.datum });
      TB.results("resGps", items);
      g.warnings.forEach(function (w) { links.appendChild(TB.el("p", { class: "msg error", text: w })); });
      M.mapLinks(g.lat, g.lon).forEach(function (l, i) {
        if (i) links.appendChild(document.createTextNode(" · "));
        links.appendChild(TB.el("a", { href: l.url, target: "_blank", rel: "noopener noreferrer", text: "Open in " + l.label }));
      });
      links.appendChild(document.createTextNode(" (opens a new tab and sends these coordinates to that site)"));
    } else {
      TB.results("resGps", [{ k: "GPS position", v: s.gpsError ? "Unreadable" : "None recorded", cls: s.gpsError ? "alarm" : null }]);
      if (s.gpsError) links.appendChild(TB.el("p", { class: "msg error", text: s.gpsError }));
    }

    var dates = [dateItem("Taken (original)", s.dates.original), dateItem("Digitised", s.dates.digitized),
      dateItem("File changed", s.dates.modified)];
    if (s.clockMinusGpsMin !== null) dates.push({ k: "Camera clock minus GPS (UTC)", v: mins(s.clockMinusGpsMin),
      title: "A hint at the offset the camera clock was set to; not a recorded time zone" });
    TB.results("resDates", dates);

    var c = s.camera;
    TB.results("resCamera", [{ k: "Make", v: dash(c.Make) }, { k: "Model", v: dash(c.Model) }, { k: "Software", v: dash(c.Software) }]
      .concat(c.Artist ? [{ k: "Artist", v: c.Artist }] : []).concat(c.Copyright ? [{ k: "Copyright", v: c.Copyright }] : []));

    var st = s.settings;
    TB.results("resSettings", [
      { k: "ISO speed", v: dash(st.iso) },
      { k: "Exposure time", v: dash(st.exposure) },
      { k: "Aperture", v: st.fNumber ? "f/" + st.fNumber : "–" },
      { k: "Focal length", v: st.focalLengthMm ? st.focalLengthMm : "–", u: st.focalLengthMm ? "mm" + (st.focalLength35mm ? " (" + st.focalLength35mm + " mm on 35 mm film)" : "") : "" },
      { k: "Flash", v: st.flash ? st.flash.text : "–" },
      { k: "White balance", v: dash(st.whiteBalance) }
    ]);

    var im = s.image;
    TB.results("resImage", [
      { k: "Pixels (as decoded)", v: last.pixels || "–" },
      { k: "Pixels (EXIF says)", v: dash(im.exifPixels) },
      { k: "File size", v: dash(last.size) },
      { k: "File type", v: dash(last.type) },
      { k: "Orientation", v: dash(im.orientation) },
      { k: "Colour space", v: dash(im.colorSpace) }
    ]);
    renderTags();
  }

  function renderTags() {
    var rows = last ? last.rows : [];
    TB.table("tags", ["Tag", "Value"], rows);
    TB.$("tagsWrap").className = "scroll" + (showAll ? " all" : "");
    TB.$("showAll").hidden = rows.length <= ROWS;
    TB.$("showAll").textContent = showAll ? "Show fewer" : "Show all (" + rows.length + ")";
  }

  function handle(file) {
    TB.message("msg", "");
    if (!file) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(file);   // a local blob: URL; the file stays on this computer
    var img = TB.$("preview");
    img.hidden = false;
    img.src = previewUrl;
    last = { file: file.name, size: M.fileSize(file.size), type: file.type || "unknown", pixels: null,
      summary: M.summarise({}), rows: [] };
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
      last.summary = M.summarise(tags || {});
      last.rows = M.tagRows(tags || {});
      render();
    };
    reader.readAsArrayBuffer(file);
  }

  TB.ready(function () {
    var img = TB.$("preview");
    img.addEventListener("load", function () {
      if (last) { last.pixels = img.naturalWidth + " × " + img.naturalHeight; render(); }
    });
    img.addEventListener("error", function () { img.hidden = true; });
    TB.$("form").addEventListener("submit", function (ev) { ev.preventDefault(); });
    TB.$("file").addEventListener("change", function (ev) { handle(ev.target.files && ev.target.files[0]); });
    var form = TB.$("form");
    form.addEventListener("dragover", function (ev) { ev.preventDefault(); form.classList.add("over"); });
    form.addEventListener("dragleave", function () { form.classList.remove("over"); });
    form.addEventListener("drop", function (ev) {
      ev.preventDefault(); form.classList.remove("over");
      if (ev.dataTransfer && ev.dataTransfer.files.length) handle(ev.dataTransfer.files[0]);
    });
    TB.$("showAll").addEventListener("click", function () { showAll = !showAll; renderTags(); });
    TB.$("copy").addEventListener("click", function () {
      if (!last) return TB.message("msg", "Choose a photo first.", "info");
      TB.copyJSON({ file: last.file, fileSize: last.size, pixels: last.pixels, summary: last.summary,
        tags: last.rows.reduce(function (o, r) { o[r[0]] = r[1]; return o; }, {}) })
        .then(function () { TB.message("msg", "Copied.", "info"); },
          function () { TB.message("msg", "This browser would not let the page use the clipboard.", "error"); });
    });
    if (window.TicTime && window.TicTime.onChange) window.TicTime.onChange(render);
  });
})();

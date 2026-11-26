/* NOTAM Decoder page. The parsing and geometry are in ../lib/notam-decoder.js (tested in tests/notam-decoder.test.js).
   Map tiles from OpenStreetMap; nothing else is fetched. */
(function () {
  "use strict";
  var KEY = "notam-decoder";
  var N = DD.notamDecoder;
  var WINDOW = 10;
  var map, layer, last = null, showAll = false;

  // Made-up examples (series, numbers and areas are invented; formats are realistic).
  var SAMPLES = [
    ["Danger area with a polygon", "(D0412/26 NOTAMN\nQ) LIMM/QRDCA/IV/BO/W/000/150/4530N01000E025\nA) LIMM B) 2612010800 C) 2612051600\nD) DAILY 0800-1600\nE) TEMPORARY DANGER AREA ACT WI AREA 452000N0094000E-454000N0094000E-\n454000N0102000E-452000N0102000E-452000N0094000E.\nMISSILE FIRING.\nF) SFC G) FL150)"],
    ["Permanent obstacle (PERM)", "(A2345/26 NOTAMN\nQ) EDGG/QOBCE/IV/M/A/000/005/5002N00834E005\nA) EDDF B) 2611260900 C) PERM\nE) CRANE ERECTED PSN 500210N0083412E, HGT 210FT AGL, ELEV 560FT AMSL. OBST LGT.)"],
    ["Drone operation, replacing NOTAM, estimated end", "(C0789/26 NOTAMR C0780/26\nQ) KZJX/QWULW/IV/BO/W/000/040/2830N08035W010\nA) KZJX B) 2612031400 C) 2612032000 EST\nE) UNMANNED ACFT ACT WI 5NM RADIUS OF 2830.50N08035.25W.\nF) SFC G) 4000FT AMSL)"],
    ["Broken NOTAM (to show the checks)", "(B0100/26 NOTAMN A0099/26\nQ) KZNY/QXYZZ/IV/NBQ/E/400/200/4060N07350W015\nA) KZNY B) 2613011200 C) 2612011300 EST\nE) AIRSPACE NOTE. PSN 406000N0735000W."]
  ];

  function ddm(v, isLat) {
    var h = isLat ? (v < 0 ? "S" : "N") : (v < 0 ? "W" : "E");
    return TB.fix(Math.abs(v), 5) + "° " + h;
  }
  function pop(text) { return TB.el("span", { text: text }); }   // popup content as a text node, never HTML
  function llText(p) { return ddm(p.lat, true) + ", " + ddm(p.lon, false); }
  function when(x) {
    if (!x) return "–";
    if (x.perm) return "PERM: permanent";
    if (!x.iso) return x.raw + " (not readable)";
    return TB.time(x.iso, { year: true }) + (x.est ? " (estimated)" : "");
  }
  function fl(n) { return n === 0 ? "000 (surface)" : n === 999 ? "999 (no upper limit)" : pad3(n) + " (about " + (n * 100).toLocaleString("en-US") + " ft)"; }
  function pad3(n) { return ("00" + n).slice(-3); }

  function fieldRows(r) {
    var rows = [];
    if (r.header) {
      rows.push(["Series and number", r.header.id, "Series " + r.header.series + ", NOTAM " + r.header.number + " of " + r.header.year]);
      rows.push(["Type", "NOTAM" + r.header.type, r.header.typeText + (r.header.refersTo ? ": " + r.header.refersTo : "")]);
    }
    var q = r.q;
    if (q) {
      rows.push(["Q: FIR", q.fir || "–", "Flight information region the NOTAM is filed under"]);
      var qc = q.qcode;
      rows.push(["Q: NOTAM Code", qc.code || "–",
        (qc.subject ? qc.subject + " (" + qc.subjectCode + ", " + (qc.subjectGroup || "") + ")" : "Subject " + (qc.subjectCode || "?") + " not in the table") +
        " | " + (qc.condition ? qc.condition + " (" + qc.conditionCode + ", " + (qc.conditionGroup || "") + ")" : "Condition " + (qc.conditionCode || "?") + " not in the table")]);
      if (q.traffic) rows.push(["Q: traffic", q.trafficCode, q.traffic.join("; ")]);
      if (q.purpose) rows.push(["Q: purpose", q.purposeCode, q.purpose.join("; ")]);
      if (q.scope) rows.push(["Q: scope", q.scopeCode, q.scope.join("; ")]);
      if (isFinite(q.lowerFL)) rows.push(["Q: lower and upper", pad3(q.lowerFL) + "/" + pad3(q.upperFL), "FL" + fl(q.lowerFL) + " to FL" + fl(q.upperFL)]);
      if (q.centre) rows.push(["Q: centre and radius", q.raw.split("/").pop(), llText(q.centre) + ", radius " + q.radiusNm + " NM (" + TB.fix(q.radiusNm * 1.852, 1) + " km)"]);
    }
    if (r.a) rows.push(["A: location", r.a.join(" "), "ICAO location indicator(s) of the aerodrome or FIR"]);
    if (r.b) rows.push(["B: from", r.b.raw, when(r.b)]);
    if (r.c) rows.push(["C: to", r.c.raw, when(r.c)]);
    if (r.d) rows.push(["D: schedule", r.d, "Times within B to C when it applies (UTC)"]);
    if (r.e) rows.push(["E: text", r.e, ""]);
    if (r.f) rows.push(["F: lower limit", r.f.raw, r.f.text || "As written"]);
    if (r.g) rows.push(["G: upper limit", r.g.raw, r.g.text || "As written"]);
    return rows;
  }

  function drawMap(r) {
    if (!map) return;
    layer.clearLayers();
    var bounds = [];
    function addLL(arr) { arr.forEach(function (p) { bounds.push([p.lat, p.lon]); }); }
    var qc = r.geometry.qCircle;
    if (qc && qc.radiusNm < 999) {
      var ring = N.circlePolygon(qc.centre.lat, qc.centre.lon, qc.radiusNm, 96);
      L.polygon(ring.map(function (p) { return [p.lat, p.lon]; }), { color: "#2f6fd6", weight: 2, dashArray: "6 6", fillOpacity: 0.05 })
        .bindPopup(pop("Q-line circle: " + qc.radiusNm + " NM around " + llText(qc.centre))).addTo(layer);
      addLL(ring);
    } else if (qc) {
      L.circleMarker([qc.centre.lat, qc.centre.lon], { radius: 5, color: "#2f6fd6" }).bindPopup(pop("Q-line centre (radius 999 NM: whole FIR or more)")).addTo(layer);
      bounds.push([qc.centre.lat, qc.centre.lon]);
    }
    var red = { color: "#c62828", weight: 2, fillOpacity: 0.15 };
    r.geometry.features.forEach(function (f) {
      var txt = f.raw.join(" ");
      if (f.kind === "polygon") {
        L.polygon(f.points.map(function (p) { return [p.lat, p.lon]; }), red).bindPopup(pop("Area: " + txt)).addTo(layer);
        addLL(f.points);
      } else if (f.kind === "line") {
        L.polyline(f.points.map(function (p) { return [p.lat, p.lon]; }), red).bindPopup(pop("Line: " + txt)).addTo(layer);
        addLL(f.points);
      } else if (f.kind === "circle") {
        var c = N.circlePolygon(f.centre.lat, f.centre.lon, f.radiusNm, 72);
        L.polygon(c.map(function (p) { return [p.lat, p.lon]; }), red).bindPopup(pop("Circle: " + txt)).addTo(layer);
        addLL(c);
      } else {
        L.circleMarker([f.points[0].lat, f.points[0].lon], { radius: 6, color: "#ffffff", weight: 2, fillColor: "#c62828", fillOpacity: 1 })
          .bindPopup(pop("Position: " + txt)).addTo(layer);
        addLL(f.points);
      }
    });
    if (bounds.length) map.fitBounds(bounds, { padding: [20, 20], maxZoom: 12 });
  }

  function renderGeom() {
    if (!last) return;
    var feats = last.result.geometry.features;
    TB.table("geom", ["Shape", "Points", "Position(s)", "Source text"], feats.map(function (f, i) {
      if (f.kind === "circle") return ["Circle " + (i + 1), "1", llText(f.centre) + ", radius " + TB.fix(f.radiusNm, 2) + " NM", f.raw.join(" | ")];
      var names = { polygon: "Area", line: "Line", point: "Position" };
      return [names[f.kind] + " " + (i + 1), String(f.points.length), f.points.map(llText).join("; "), f.raw.join(" ")];
    }));
    var btn = TB.$("showall");
    btn.hidden = feats.length <= WINDOW;
    btn.textContent = showAll ? "Show fewer" : "Show all " + feats.length;
    TB.$("geom").className = showAll ? "" : "scroll";
  }

  function listBox(title, arr, cls) {
    if (!arr.length) return null;
    return TB.el("div", { class: "msg " + cls }, [TB.el("strong", { text: title }),
      TB.el("ul", null, arr.map(function (t) { return TB.el("li", { text: t }); }))]);
  }

  function run() {
    TB.message("msg", "");
    var text = TB.$("text").value;
    TB.save(KEY, { text: text.slice(0, 20000) });
    var prob = TB.$("problems");
    TB.clear(prob);
    var r;
    try { r = N.parse(text, Date.now()); }
    catch (e) {
      TB.message("msg", e.message, "error");
      last = null;
      TB.results("results", []); TB.clear(TB.$("fields")); TB.clear(TB.$("geom")); TB.clear(TB.$("abbr"));
      if (layer) layer.clearLayers();
      return;
    }
    last = { input: text, result: r };
    var items = [
      { k: "NOTAM", v: r.header ? r.header.id + " " + "NOTAM" + r.header.type : "Header not readable", cls: r.header ? null : "alarm" },
      { k: "About", v: r.q && r.q.qcode.subject ? r.q.qcode.subject + ": " + (r.q.qcode.condition || "condition not in table").toLowerCase() : "–" },
      { k: "Where", v: (r.a ? r.a.join(" ") : "–") + (r.q && r.q.fir ? " (FIR " + r.q.fir + ")" : "") },
      { k: "From", v: when(r.b) },
      { k: "To", v: when(r.c) }
    ];
    if (r.status) items.push({ k: "By your computer's clock", v: r.status, cls: r.status === "in force" ? "ok" : "warn",
      title: "Compares B and C with the current time; does not read the item D schedule" });
    items.push({ k: "Errors and warnings", v: r.errors.length + " and " + r.warnings.length, cls: r.errors.length ? "alarm" : r.warnings.length ? "warn" : "ok" });
    TB.results("results", items);
    var eb = listBox("Could not be read", r.errors, "error"), wb = listBox("Check", r.warnings, "info");
    if (eb) prob.appendChild(eb);
    if (wb) prob.appendChild(wb);
    TB.table("fields", ["Item", "As written", "Meaning"], fieldRows(r));
    TB.table("abbr", ["Abbreviation", "Meaning (ICAO Doc 8400)"], r.abbreviations.map(function (a) { return [a.abbr, a.meaning]; }));
    showAll = false;
    renderGeom();
    drawMap(r);
  }

  TB.ready(function () {
    var sel = TB.$("sample");
    sel.appendChild(TB.el("option", { value: "", text: "Choose an example, or paste your own below" }));
    SAMPLES.forEach(function (s, i) { sel.appendChild(TB.el("option", { value: String(i), text: s[0] })); });
    sel.addEventListener("change", function () {
      if (sel.value === "") return;
      TB.$("text").value = SAMPLES[Number(sel.value)][1];
      run();
    });
    var saved = TB.load(KEY);
    TB.$("text").value = saved && typeof saved.text === "string" && saved.text.trim() ? saved.text : SAMPLES[0][1];
    if (window.L) {
      map = L.map("map").setView([45, 10], 5);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a> contributors"
      }).addTo(map);
      layer = L.layerGroup().addTo(map);
    } else {
      TB.$("map").textContent = "The map library (Leaflet, from unpkg.com) did not load, so nothing can be drawn. The decoding below still works.";
    }
    TB.$("form").addEventListener("submit", function (ev) { ev.preventDefault(); run(); });
    TB.$("showall").addEventListener("click", function () { showAll = !showAll; renderGeom(); });
    TB.$("copy").addEventListener("click", function () {
      if (!last) return TB.message("msg", "Decode first.", "info");
      TB.copyJSON(last).then(function () { TB.message("msg", "Copied.", "info"); },
        function () { TB.message("msg", "This browser would not let the page use the clipboard.", "error"); });
    });
    run();
  });
})();

/* Satellite Visibility Calculator page. The maths is in ../lib/satellite-visibility.js and ../lib/tle-analyzer.js
   (tested in tests/satellite-visibility.test.js and tests/tle-analyzer.test.js); satellite.js runs SGP4. */
(function () {
  "use strict";
  var KEY = "satellite-visibility";
  var V = DD.satelliteVisibility, T = DD.tleAnalyzer;
  var SVG = "http://www.w3.org/2000/svg";
  var EXAMPLE = "ISS (ZARYA)\n" +
    "1 25544U 98067A   08264.51782528 -.00002182  00000-0 -11606-4 0  2927\n" +
    "2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.72125391563537";
  var last = null;

  function readElements() {
    var sets = T.splitSets(TB.$("tle").value);
    if (!sets.length) throw new Error("Paste an element set: line 1 starting '1 ' and line 2 starting '2 ', with an optional name line above.");
    return T.parse(sets[0].line1, sets[0].line2, sets[0].name);
  }
  function propagator(e) {
    if (!window.satellite) throw new Error("The orbit library (satellite.js) did not load, so positions cannot be worked out. Check the connection and reload.");
    var rec = satellite.twoline2satrec(e.line1, e.line2);
    if (rec.error) throw new Error("SGP4 cannot use this element set (error code " + rec.error + ").");
    return function (ms) {
      var pv = satellite.propagate(rec, new Date(ms));
      return pv && pv.position ? pv : null;
    };
  }

  function svg(tag, attrs) {
    var e = document.createElementNS(SVG, tag);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    return e;
  }
  function skyXY(az, el, R) {
    var r = (90 - Math.max(0, el)) / 90 * R, a = az * Math.PI / 180;
    return [R + 20 + r * Math.sin(a), R + 20 - r * Math.cos(a)];
  }
  function drawSky(track, now) {
    var box = TB.$("sky"); TB.clear(box);
    var R = 150, S = 2 * R + 40;
    var s = svg("svg", { viewBox: "0 0 " + S + " " + S, class: "figure", role: "img",
      "aria-label": "Sky view: azimuth around the circle, elevation from the edge (horizon) to the centre (overhead)" });
    [0, 30, 60].forEach(function (el) {
      var c = svg("circle", { cx: R + 20, cy: R + 20, r: (90 - el) / 90 * R, fill: "none", class: "faint" });
      s.appendChild(c);
      if (el) { var t = svg("text", { x: R + 24, y: R + 20 - (90 - el) / 90 * R + 13 }); t.textContent = el + "°"; s.appendChild(t); }
    });
    s.appendChild(svg("line", { x1: 20, y1: R + 20, x2: 2 * R + 20, y2: R + 20, class: "faint" }));
    s.appendChild(svg("line", { x1: R + 20, y1: 20, x2: R + 20, y2: 2 * R + 20, class: "faint" }));
    [["N", R + 16, 14], ["E", 2 * R + 26, R + 24], ["S", R + 16, 2 * R + 36], ["W", 2, R + 24]].forEach(function (p) {
      var t = svg("text", { x: p[1], y: p[2] }); t.textContent = p[0]; s.appendChild(t);
    });
    var pts = [], segs = [];
    track.forEach(function (o) {
      if (o && o.elDeg >= 0) pts.push(skyXY(o.azDeg, o.elDeg, R).join(","));
      else if (pts.length) { segs.push(pts); pts = []; }
    });
    if (pts.length) segs.push(pts);
    segs.forEach(function (p) {
      var pl = svg("polyline", { points: p.join(" "), fill: "none" });
      pl.style.stroke = "var(--plot-1)"; pl.style.strokeWidth = "2";
      s.appendChild(pl);
    });
    if (now && now.elDeg >= 0) {
      var xy = skyXY(now.azDeg, now.elDeg, R);
      var dot = svg("circle", { cx: xy[0], cy: xy[1], r: 6 });
      dot.style.fill = now.visible ? "var(--ok)" : "var(--plot-2)";
      s.appendChild(dot);
    }
    box.appendChild(s);
    if (!segs.length) box.appendChild(TB.el("p", { class: "empty", text: "Below the horizon for the whole 20 minutes." }));
  }

  function shadowText(o) {
    if (o.shadow === "sunlit") return "Sunlit";
    if (o.shadow === "umbra") return "In the Earth's shadow";
    return "Partly shadowed (" + Math.round(o.sunFraction * 100) + "% of the Sun's disc)";
  }

  function run() {
    TB.message("msg", ""); TB.message("warn", "");
    try {
      var e = readElements();
      var input = { tle: TB.$("tle").value, lat: TB.num("lat"), lon: TB.num("lon"), height: TB.num("height") || 0,
        when: TB.$("when").value };
      if (!isFinite(input.lat) || !isFinite(input.lon)) throw new Error("Enter a latitude and a longitude.");
      if (input.lat < -90 || input.lat > 90) throw new Error("Latitude must be between -90 and 90 degrees.");
      if (input.lon < -180 || input.lon > 180) throw new Error("Longitude must be between -180 and 180 degrees.");
      var ms = V.parseUtcInput(input.when);
      if (!isFinite(ms)) throw new Error("Enter the time in UTC.");
      var obs = { latDeg: input.lat, lonDeg: input.lon, hKm: input.height / 1000 };
      var prop = propagator(e);
      var o = V.observe(prop, ms, obs);
      if (!o) throw new Error("SGP4 could not move this element set to that time (the orbit may have decayed). Use a newer element set.");
      TB.save(KEY, input);
      var age = T.ageDays(e.epochMs, ms);
      var warn = e.warnings.slice();
      if (Math.abs(age) > 7) warn.push("The time is " + Math.abs(age).toFixed(1) + " days from the element set's epoch, so the position is rough.");
      TB.message("warn", warn.join(" "), "error");
      TB.results("results", [
        { k: "Can be seen with the eye", v: o.visible ? "Yes" : "No: " + o.reason, cls: o.visible ? "ok" : "warn" },
        { k: "At", v: TB.time(ms, { year: true, seconds: true }) },
        { k: "Elevation", v: TB.fix(o.elDeg, 1), u: "°", cls: o.elDeg >= 0 ? null : "warn", title: "Angle above the horizon; negative is below it" },
        { k: "Azimuth", v: TB.fix(o.azDeg, 1) + "° " + V.compass(o.azDeg), title: "Clockwise from true north" },
        { k: "Range", v: TB.fix(o.rangeKm, 0), u: "km", title: "Straight-line distance from you" },
        { k: "Height", v: TB.fix(o.heightKm, 0), u: "km", title: "Above the WGS 84 ellipsoid" },
        { k: "Point below", v: TB.fix(o.subLatDeg, 2) + ", " + TB.fix(o.subLonDeg, 2), u: "°" },
        { k: "Speed (inertial)", v: TB.fix(o.speedKmS, 2), u: "km/s", title: "In the non-rotating TEME frame" },
        { k: "Sunlight on the satellite", v: shadowText(o), cls: o.shadow === "umbra" ? "warn" : null },
        { k: "Sun's elevation where you are", v: TB.fix(o.sunElDeg, 1), u: "°", title: "6 degrees or more below the horizon counts as dark" },
        { k: "Days from the epoch", v: TB.fix(age, 2), u: "days", cls: Math.abs(age) > 7 ? "warn" : null }
      ]);
      var track = [];
      for (var t = ms - 600000; t <= ms + 600000; t += 20000) track.push(V.observe(prop, t, obs));
      drawSky(track, o);
      last = { input: input, satellite: { name: e.name, catalogNumber: e.catalogNumber, epochMs: e.epochMs },
        result: { azDeg: o.azDeg, elDeg: o.elDeg, rangeKm: o.rangeKm, heightKm: o.heightKm, subLatDeg: o.subLatDeg,
          subLonDeg: o.subLonDeg, speedKmS: o.speedKmS, shadow: o.shadow, sunFraction: o.sunFraction,
          sunElDeg: o.sunElDeg, visible: o.visible, reason: o.reason } };
    } catch (err) {
      TB.message("msg", err.message, "error");
    }
  }

  TB.ready(function () {
    var sel = TB.$("site");
    V.SITES.forEach(function (s, i) { sel.appendChild(TB.el("option", { value: String(i), text: s.name })); });
    sel.addEventListener("change", function () {
      var s = V.SITES[Number(sel.value)];
      if (sel.value !== "" && s) { TB.$("lat").value = s.lat; TB.$("lon").value = s.lon; }
    });
    var saved = TB.load(KEY);
    if (saved) {
      if (typeof saved.tle === "string" && saved.tle.trim()) TB.$("tle").value = saved.tle;
      ["lat", "lon", "height"].forEach(function (k) { if (isFinite(saved[k])) TB.$(k).value = saved[k]; });
      if (typeof saved.when === "string") TB.$("when").value = saved.when;
    }
    if (!TB.$("tle").value.trim()) TB.$("tle").value = EXAMPLE;
    if (!isFinite(V.parseUtcInput(TB.$("when").value))) TB.$("when").value = V.toUtcInput(Date.now());
    TB.$("form").addEventListener("submit", function (ev) { ev.preventDefault(); run(); });
    TB.$("now").addEventListener("click", function () { TB.$("when").value = V.toUtcInput(Date.now()); run(); });
    TB.$("example").addEventListener("click", function () {
      TB.$("tle").value = EXAMPLE;
      TB.$("when").value = V.toUtcInput(T.parse(EXAMPLE.split("\n")[1], EXAMPLE.split("\n")[2]).epochMs);
      run();
    });
    TB.$("copy").addEventListener("click", function () {
      if (!last) return TB.message("msg", "Calculate first.", "info");
      TB.copyJSON(last).then(function () { TB.message("msg", "Copied.", "info"); },
        function () { TB.message("msg", "This browser would not let the page use the clipboard.", "error"); });
    });
    run();
  });
})();

/* TLE Analyzer page. The maths is in ../lib/tle-analyzer.js and ../lib/satellite-visibility.js (tested in
   tests/tle-analyzer.test.js and tests/satellite-visibility.test.js). Positions use satellite.js (SGP4) when it
   has loaded. The only network request is a CelesTrak lookup the user starts. */
(function () {
  "use strict";
  var KEY = "tle-analyzer";
  var T = DD.tleAnalyzer, V = DD.satelliteVisibility;
  var EXAMPLE = "ISS (ZARYA)\n" +
    "1 25544U 98067A   08264.51782528 -.00002182  00000-0 -11606-4 0  2927\n" +
    "2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.72125391563537";
  var CACHE_MS = 2 * 3600 * 1000;    // CelesTrak updates GP data about every two hours
  var cache = {};                     // query -> {at, text}, for this page view only
  var busy = false;
  var last = null;

  function f(x, n) { return TB.fix(x, n); }

  function selectedSet() {
    var sets = T.splitSets(TB.$("tle").value);
    var pick = TB.$("pick");
    TB.$("pickField").hidden = sets.length < 2;
    if (sets.length >= 2) {
      var keep = pick.value;
      TB.clear(pick);
      sets.forEach(function (s, i) {
        pick.appendChild(TB.el("option", { value: String(i), text: (s.name || "Unnamed") + " (" + s.line1.substring(2, 7).trim() + ")" }));
      });
      if (keep !== "" && Number(keep) < sets.length) pick.value = keep;
    }
    if (!sets.length) return null;
    return sets[sets.length >= 2 ? Number(pick.value || 0) : 0];
  }

  function clearResults() {
    ["resId", "resEl", "resOrbit", "resNow"].forEach(function (id) { TB.clear(TB.$(id)); });
    TB.$("nowNote").textContent = "";
    TB.message("warn", "");
  }

  function run() {
    TB.message("msg", "");
    clearResults();
    last = null;
    var s = selectedSet();
    if (!s) {
      if (TB.$("tle").value.trim()) TB.message("msg", "No element set found: line 1 must start with '1 ' and be followed by line 2 starting with '2 '.", "error");
      return;
    }
    try {
      var e = T.parse(s.line1, s.line2, s.name);
      var o = T.orbitFromMeanMotion(e.meanMotionRevDay, e.eccentricity);
      var now = Date.now();
      var age = T.ageDays(e.epochMs, now);
      var warn = e.warnings.slice();
      if (age > 7) warn.push("This element set is " + age.toFixed(1) + " days old; positions from it are rough. Fetch a current one.");
      if (age < -1) warn.push("The epoch is " + (-age).toFixed(1) + " days in the future; check the epoch field.");
      TB.message("warn", warn.join(" "), "error");
      TB.save(KEY, { tle: TB.$("tle").value });

      TB.results("resId", [
        { k: "Name", v: e.name || "(none given)" },
        { k: "Catalog number", v: String(e.catalogNumber) },
        { k: "International designator", v: e.intlDesignator || "–",
          title: "Launch year, launch number of that year, and piece of the launch" },
        { k: "Launch", v: e.launchYear ? e.launchYear + ", launch " + e.launchNumber + ", piece " + e.launchPiece : "–" },
        { k: "Classification", v: T.CLASSIFICATION[e.classification] || e.classification },
        { k: "Epoch", v: TB.time(e.epochMs, { year: true, seconds: true }) },
        { k: "Epoch (UTC)", v: new Date(Math.round(e.epochMs)).toISOString().replace(/\.\d+Z$/, "Z") },
        { k: "Age now", v: f(age, 2), u: "days", cls: age > 7 ? "warn" : null },
        { k: "Element set number", v: String(e.elementSetNumber) },
        { k: "Revolution number at epoch", v: String(e.revNumber) },
        { k: "Checksums", v: e.checksum.every(function (c) { return c.ok; }) ? "Both correct" : "Mismatch",
          cls: e.checksum.every(function (c) { return c.ok; }) ? "ok" : "alarm" }
      ]);
      TB.results("resEl", [
        { k: "Inclination", v: f(e.inclinationDeg, 4), u: "°", title: "Tilt of the orbit to the equator" },
        { k: "Right ascension of ascending node", v: f(e.raanDeg, 4), u: "°", title: "Where the orbit crosses the equator going north, measured from the vernal equinox" },
        { k: "Eccentricity", v: f(e.eccentricity, 7), title: "0 is a circle; closer to 1 is a longer ellipse" },
        { k: "Argument of perigee", v: f(e.argPerigeeDeg, 4), u: "°", title: "Angle from the ascending node to the lowest point" },
        { k: "Mean anomaly", v: f(e.meanAnomalyDeg, 4), u: "°", title: "Where the satellite was along its orbit at the epoch" },
        { k: "Mean motion", v: f(e.meanMotionRevDay, 8), u: "rev/day" },
        { k: "Mean motion change ÷ 2", v: e.meanMotionDot.toExponential(5), u: "rev/day²", title: "First time derivative of mean motion, divided by 2, as published" },
        { k: "Second change ÷ 6", v: e.meanMotionDdot.toExponential(5), u: "rev/day³" },
        { k: "BSTAR drag term", v: e.bstar.toExponential(5), u: "1/Earth radii" }
      ]);
      TB.results("resOrbit", [
        { k: "Period", v: f(o.periodMin, 2), u: "min" },
        { k: "Semi-major axis", v: f(o.semiMajorAxisKm, 1), u: "km" },
        { k: "Perigee height", v: f(o.perigeeAltKm, 1), u: "km", title: "Lowest point, above the equatorial radius" },
        { k: "Apogee height", v: f(o.apogeeAltKm, 1), u: "km", title: "Highest point, above the equatorial radius" }
      ]);
      var nowRes = positionNow(e, now);
      last = { input: { name: e.name, line1: e.line1, line2: e.line2 }, elements: e, orbit: o, ageDays: age,
        now: nowRes };
    } catch (err) {
      TB.message("msg", err.message, "error");
    }
  }

  function positionNow(e, now) {
    if (!window.satellite) {
      TB.$("nowNote").textContent = "The orbit library (satellite.js) did not load, so the position cannot be shown.";
      return null;
    }
    var rec = satellite.twoline2satrec(e.line1, e.line2);
    var pv = rec.error ? null : satellite.propagate(rec, new Date(now));
    if (!pv || !pv.position) {
      TB.$("nowNote").textContent = "SGP4 could not propagate this element set to now (error code " + rec.error +
        "; 6 means the orbit has decayed).";
      return null;
    }
    var th = V.gmst(V.julianDate(now));
    var g = V.ecefToGeodetic(V.temeToEcef(pv.position, th));
    var v = pv.velocity;
    var speed = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    TB.results("resNow", [
      { k: "At", v: TB.time(now, { year: true, seconds: true }) },
      { k: "Point below: latitude", v: f(g.latDeg, 3), u: "°" },
      { k: "Point below: longitude", v: f(g.lonDeg, 3), u: "°" },
      { k: "Height above WGS 84", v: f(g.hKm, 1), u: "km" },
      { k: "Speed (inertial)", v: f(speed, 3), u: "km/s", title: "Speed in the non-rotating TEME frame" },
      { k: "TEME x", v: f(pv.position.x, 1), u: "km" },
      { k: "TEME y", v: f(pv.position.y, 1), u: "km" },
      { k: "TEME z", v: f(pv.position.z, 1), u: "km" }
    ]);
    TB.$("nowNote").textContent = "From SGP4, " + T.ageDays(e.epochMs, now).toFixed(1) + " days from the epoch.";
    return { ms: now, latDeg: g.latDeg, lonDeg: g.lonDeg, heightKm: g.hKm, speedKmS: speed, teme: pv.position };
  }

  function lookup(by, q) {
    if (busy) return;
    q = String(q || "").trim();
    if (by !== "CATNR" && by !== "NAME") by = "CATNR";
    if (by === "CATNR" && !/^\d{1,9}$/.test(q)) return TB.message("fetchMsg", "A catalog number is digits only, for example 25544.", "error");
    if (by === "NAME" && (q.length < 2 || q.length > 40)) return TB.message("fetchMsg", "Give 2 to 40 characters of the name.", "error");
    var key = by + "=" + q.toUpperCase();
    var hit = cache[key];
    if (hit && Date.now() - hit.at < CACHE_MS) {
      TB.$("tle").value = hit.text;
      TB.message("fetchMsg", "Reused CelesTrak's answer from " + TB.time(hit.at) + " (it updates about every two hours).", "info");
      return run();
    }
    busy = true;
    TB.$("fetch").disabled = true;
    TB.message("fetchMsg", "Asking CelesTrak…", "info");
    var url = "https://celestrak.org/NORAD/elements/gp.php?" + by + "=" + encodeURIComponent(q) + "&FORMAT=TLE";
    fetch(url, { credentials: "omit" }).then(function (r) {
      if (!r.ok) throw new Error("CelesTrak answered HTTP " + r.status + ".");
      return r.text();
    }).then(function (text) {
      var sets = T.splitSets(text);
      if (!sets.length) throw new Error(/No GP data found/i.test(text) ? "CelesTrak has no element set for that " + (by === "CATNR" ? "catalog number" : "name") + "." : "CelesTrak's answer held no element set.");
      var clean = sets.map(function (s) { return (s.name ? s.name + "\n" : "") + s.line1 + "\n" + s.line2; }).join("\n");
      cache[key] = { at: Date.now(), text: clean };
      TB.$("tle").value = clean;
      TB.$("pick").value = "0";
      TB.message("fetchMsg", "CelesTrak returned " + sets.length + " element set" + (sets.length === 1 ? "" : "s") + " at " + TB.time(Date.now()) + ".", "info");
      run();
    }).catch(function (err) {
      TB.message("fetchMsg", "Lookup failed: " + (err && err.message ? err.message : "no answer") + " Check the connection, or paste an element set instead.", "error");
    }).then(function () {
      busy = false;
      TB.$("fetch").disabled = false;
    });
  }

  TB.ready(function () {
    var saved = TB.load(KEY);
    TB.$("tle").value = saved && typeof saved.tle === "string" && saved.tle.trim() ? saved.tle : EXAMPLE;
    TB.$("form").addEventListener("submit", function (ev) { ev.preventDefault(); run(); });
    TB.$("pick").addEventListener("change", run);
    TB.$("example").addEventListener("click", function () { TB.$("tle").value = EXAMPLE; run(); });
    TB.$("clear").addEventListener("click", function () {
      TB.$("tle").value = ""; TB.$("pickField").hidden = true; clearResults(); TB.message("msg", ""); last = null;
    });
    TB.$("by").addEventListener("change", function () {
      TB.$("query").placeholder = TB.$("by").value === "CATNR" ? "25544" : "NOAA 20";
    });
    TB.$("fetch").addEventListener("click", function () { lookup(TB.$("by").value, TB.$("query").value); });
    TB.$("query").addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") { ev.preventDefault(); lookup(TB.$("by").value, TB.$("query").value); }
    });
    Array.prototype.forEach.call(document.querySelectorAll("button.preset"), function (b) {
      b.addEventListener("click", function () {
        TB.$("by").value = "CATNR"; TB.$("query").value = b.getAttribute("data-catnr");
        lookup("CATNR", b.getAttribute("data-catnr"));
      });
    });
    TB.$("copy").addEventListener("click", function () {
      if (!last) return TB.message("msg", "Analyze an element set first.", "info");
      TB.copyJSON(last).then(function () { TB.message("msg", "Copied.", "info"); },
        function () { TB.message("msg", "This browser would not let the page use the clipboard.", "error"); });
    });
    run();
  });
})();

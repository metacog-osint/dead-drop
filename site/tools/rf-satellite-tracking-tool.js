/* RF Satellite Tracking Tool page. The maths is in ../lib/rf-doppler.js, ../lib/satellite-visibility.js,
   ../lib/satellite-passes.js and ../lib/tle-analyzer.js (tested in tests/rf-doppler.test.js and the others);
   satellite.js runs SGP4. */
(function () {
  "use strict";
  var KEY = "rf-satellite-tracking";
  var V = DD.satelliteVisibility, T = DD.tleAnalyzer, P = DD.satellitePasses, D = DD.rfDoppler;
  var EXAMPLE = "ISS (ZARYA)\n" +
    "1 25544U 98067A   08264.51782528 -.00002182  00000-0 -11606-4 0  2927\n" +
    "2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.72125391563537";
  // Published channels (MHz). Status changes: check the operator or AMSAT before relying on one.
  var PRESETS = [
    { name: "ISS, FM voice downlink (ARISS)", down: 145.800 },
    { name: "ISS, APRS packet (1200 baud AFSK)", down: 145.825, up: 145.825 },
    { name: "SO-50, FM repeater", down: 436.795, up: 145.850 },
    { name: "AO-91, FM repeater (may be inactive)", down: 145.960, up: 435.250 },
    { name: "Meteor-M N2-3, LRPT weather images", down: 137.900 },
    { name: "GPS L1 C/A", down: 1575.42 },
    { name: "Galileo E1", down: 1575.42 },
    { name: "GLONASS L1, channel 0 (centre)", down: 1602.0 }
  ];
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
  function hz(x) { return (x >= 0 ? "+" : "−") + Math.abs(x).toFixed(0); }
  function mhz(x) { return (x / 1e6).toFixed(6); }

  function run() {
    TB.message("msg", ""); TB.message("warn", "");
    try {
      var e = readElements();
      var input = { tle: TB.$("tle").value, down: TB.num("down"), up: TB.num("up"), lat: TB.num("lat"),
        lon: TB.num("lon"), height: TB.num("height") || 0, when: TB.$("when").value };
      if (!(input.down > 0)) throw new Error("Enter the downlink frequency in MHz.");
      if (TB.$("up").value.trim() !== "" && !(input.up > 0)) throw new Error("The uplink frequency must be a positive number of MHz, or left empty.");
      if (!isFinite(input.lat) || !isFinite(input.lon)) throw new Error("Enter a latitude and a longitude.");
      if (input.lat < -90 || input.lat > 90) throw new Error("Latitude must be between -90 and 90 degrees.");
      if (input.lon < -180 || input.lon > 180) throw new Error("Longitude must be between -180 and 180 degrees.");
      var ms = V.parseUtcInput(input.when);
      if (!isFinite(ms)) throw new Error("Enter the time in UTC.");
      var obs = { latDeg: input.lat, lonDeg: input.lon, hKm: input.height / 1000 };
      var prop = propagator(e);
      var look = function (t) { return V.observe(prop, t, obs); };
      var o = look(ms);
      if (!o) throw new Error("SGP4 could not move this element set to that time (the orbit may have decayed). Use a newer element set.");
      TB.save(KEY, input);
      var fDown = input.down * 1e6, fUp = input.up > 0 ? input.up * 1e6 : null;
      var shift = D.shiftHz(fDown, o.rangeRateKmS);
      var age = T.ageDays(e.epochMs, ms);
      var warn = e.warnings.slice();
      if (Math.abs(age) > 7) warn.push("The time is " + Math.abs(age).toFixed(1) + " days from the element set's epoch, so the figures are rough.");
      TB.message("warn", warn.join(" "), "error");
      var items = [
        { k: "Above the horizon", v: o.elDeg >= 0 ? "Yes" : "No", cls: o.elDeg >= 0 ? "ok" : "warn" },
        { k: "At", v: TB.time(ms, { year: true, seconds: true }) },
        { k: "Azimuth", v: TB.fix(o.azDeg, 1) + "° " + V.compass(o.azDeg), title: "Clockwise from true north" },
        { k: "Elevation", v: TB.fix(o.elDeg, 1), u: "°" },
        { k: "Range", v: TB.fix(o.rangeKm, 1), u: "km" },
        { k: "Range rate", v: TB.fix(o.rangeRateKmS, 3), u: "km/s", title: "Negative while the satellite approaches" },
        { k: "Downlink Doppler shift", v: hz(shift), u: "Hz" },
        { k: "Listen on (downlink)", v: mhz(fDown + shift), u: "MHz" }
      ];
      if (fUp) {
        var tx = D.uplinkTransmitHz(fUp, o.rangeRateKmS);
        items.push({ k: "Transmit on (uplink)", v: mhz(tx), u: "MHz", title: "So that the satellite hears " + input.up + " MHz" });
        items.push({ k: "Uplink correction", v: hz(tx - fUp), u: "Hz" });
      }
      items.push({ k: "Days from the epoch", v: TB.fix(age, 2), u: "days", cls: Math.abs(age) > 7 ? "warn" : null });
      TB.results("results", items);

      var passes = P.findPasses(look, ms, ms + 86400000, { stepS: 30, maskDeg: 0 });
      TB.table("passes", ["Rise", "Highest", "Peak elevation", "Set", "Shift at rise", "Shift at set"],
        passes.slice(0, 12).map(function (p) {
          var r = look(p.riseMs), s = look(p.setMs);
          return [(p.startsInProgress ? "(already up) " : "") + TB.time(p.riseMs, { seconds: true }),
            TB.time(p.peakMs, { date: false, seconds: true }), TB.fix(p.peakElDeg, 1) + "°",
            TB.time(p.setMs, { date: false, seconds: true }) + (p.endsInProgress ? " (still up)" : ""),
            r ? hz(D.shiftHz(fDown, r.rangeRateKmS)) + " Hz" : "–", s ? hz(D.shiftHz(fDown, s.rangeRateKmS)) + " Hz" : "–"];
        }));
      var pass = passes[0];
      var rows = [], curve = [];
      if (pass) {
        curve = D.curve(fDown, P.samplePass(look, pass, 30));
        rows = curve.map(function (c) {
          return [TB.time(c.ms, { date: false, seconds: true }), TB.fix(c.azDeg, 1) + "°", TB.fix(c.elDeg, 1) + "°",
            TB.fix(c.rangeKm, 0), TB.fix(c.rangeRateKmS, 3), hz(c.shiftHz), mhz(c.receivedHz)];
        });
        TB.$("curveTitle").textContent = "Doppler through the pass from " + TB.time(pass.riseMs);
      } else {
        TB.$("curveTitle").textContent = "Doppler through the pass";
      }
      TB.table("curve", ["Time", "Azimuth", "Elevation", "Range (km)", "Range rate (km/s)", "Shift (Hz)", "Listen on (MHz)"], rows);
      TB.$("showAll").hidden = rows.length <= 10;
      TB.$("curveWrap").style.maxHeight = "";
      TB.$("showAll").textContent = "Show all";
      last = { input: input, satellite: { name: e.name, catalogNumber: e.catalogNumber, epochMs: e.epochMs },
        now: { azDeg: o.azDeg, elDeg: o.elDeg, rangeKm: o.rangeKm, rangeRateKmS: o.rangeRateKmS,
          downlinkShiftHz: shift, listenHz: fDown + shift, uplinkTransmitHz: fUp ? D.uplinkTransmitHz(fUp, o.rangeRateKmS) : null },
        passes: passes.map(function (p) { return { riseUtc: new Date(p.riseMs).toISOString(), peakUtc: new Date(p.peakMs).toISOString(),
          setUtc: new Date(p.setMs).toISOString(), peakElDeg: p.peakElDeg }; }),
        doppler: curve.map(function (c) { return { utc: new Date(c.ms).toISOString(), elDeg: c.elDeg, rangeRateKmS: c.rangeRateKmS,
          shiftHz: c.shiftHz }; }) };
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
    var pre = TB.$("preset");
    PRESETS.forEach(function (p, i) {
      pre.appendChild(TB.el("option", { value: String(i), text: p.name + ", " + p.down.toFixed(3) + " MHz" }));
    });
    pre.addEventListener("change", function () {
      var p = PRESETS[Number(pre.value)];
      if (pre.value === "" || !p) return;
      TB.$("down").value = p.down.toFixed(4).replace(/0$/, "");
      TB.$("up").value = p.up ? p.up.toFixed(3) : "";
    });
    var saved = TB.load(KEY);
    if (saved) {
      if (typeof saved.tle === "string" && saved.tle.trim()) TB.$("tle").value = saved.tle;
      ["down", "up", "lat", "lon", "height"].forEach(function (k) { if (isFinite(saved[k])) TB.$(k).value = saved[k]; });
      if (typeof saved.when === "string") TB.$("when").value = saved.when;
    }
    if (!TB.$("tle").value.trim()) TB.$("tle").value = EXAMPLE;
    if (!isFinite(V.parseUtcInput(TB.$("when").value))) TB.$("when").value = V.toUtcInput(Date.now());
    TB.$("form").addEventListener("submit", function (ev) { ev.preventDefault(); run(); });
    TB.$("now").addEventListener("click", function () { TB.$("when").value = V.toUtcInput(Date.now()); run(); });
    TB.$("example").addEventListener("click", function () {
      TB.$("tle").value = EXAMPLE;
      TB.$("when").value = V.toUtcInput(T.parse(EXAMPLE.split("\n")[1], EXAMPLE.split("\n")[2]).epochMs);
      TB.$("down").value = "145.800"; TB.$("up").value = "";
      run();
    });
    TB.$("showAll").addEventListener("click", function () {
      var w = TB.$("curveWrap"), all = w.style.maxHeight === "none";
      w.style.maxHeight = all ? "" : "none";
      TB.$("showAll").textContent = all ? "Show all" : "Show fewer";
    });
    TB.$("copy").addEventListener("click", function () {
      if (!last) return TB.message("msg", "Calculate first.", "info");
      TB.copyJSON(last).then(function () { TB.message("msg", "Copied.", "info"); },
        function () { TB.message("msg", "This browser would not let the page use the clipboard.", "error"); });
    });
    run();
  });
})();

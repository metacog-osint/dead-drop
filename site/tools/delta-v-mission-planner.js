/* Delta-V Mission Planner page. The maths is in ../lib/delta-v.js (tested in tests/delta-v.test.js). */
(function () {
  "use strict";
  var KEY = "delta-v";
  var NUMS = ["r1", "i1", "r2", "i2", "wetMass", "isp"];
  var R = 6378.137;
  var PRESETS = {
    "cape-geo": { r1: R + 300, i1: 28.5, r2: 42164.137, i2: 0, oneBurn: false },
    "iss-geo": { r1: R + 550, i1: 51.6, r2: 42164.137, i2: 0, oneBurn: false },
    "moon": { r1: R + 300, i1: 28.5, r2: 384400, i2: 28.5, oneBurn: false },
    "geo-incl": { r1: 42164.137, i1: 0.1, r2: 42164.137, i2: 0, oneBurn: false },
    "deorbit": { r1: R + 550, i1: 51.6, r2: R + 50, i2: 51.6, oneBurn: true },
    "plane": { r1: R + 550, i1: 51.6, r2: R + 550, i2: 28.5, oneBurn: false }
  };
  var NOTES = {
    "moon": "The Moon's gravity is ignored: burn 1 is close to a trans-lunar injection; burn 2 only circularises around the Earth at the Moon's distance.",
    "deorbit": "One burn lowers the far side of the orbit to 50 km altitude, deep enough in the air for re-entry.",
    "geo-incl": "Correcting a 0.1° tilt at geostationary radius, the kind of burn made routinely to keep a satellite on station."
  };
  var last = null, note = "";

  function readInput() {
    var p = {};
    NUMS.forEach(function (k) { p[k] = TB.num(k); });
    p.oneBurn = TB.$("oneBurn").checked;
    return p;
  }
  function kms(x) { return TB.fix(x, 3); }
  function run() {
    TB.message("msg", "");
    var p = readInput();
    try {
      var r = DD.deltaV.compute(p);
      last = { input: p, result: r };
      TB.save(KEY, p);
      var b = r.best, prop = r.propellant;
      TB.$("bestName").textContent = "Shown: " + b.name.toLowerCase() + ".";
      var items = [
        { k: "Total delta-v", v: kms(b.total), u: "km/s", cls: "ok" },
        { k: "Burn 1 (at the start)", v: kms(b.burn1), u: "km/s" }
      ];
      if (!p.oneBurn) items.push({ k: "Burn 2 (half an orbit later)", v: kms(b.burn2), u: "km/s" });
      items.push(
        { k: "Inclination change", v: TB.fix(r.planeChangeDeg, 2), u: "°" },
        { k: "Of it, done in burn 1", v: TB.fix(b.planeAtStartDeg, 2), u: "°" },
        { k: "Propellant", v: TB.fix(prop.propellantKg, 1), u: "kg (" + TB.fix(prop.propellantFraction * 100, 1) + " %)" },
        { k: "Mass left after the burns", v: TB.fix(prop.finalMassKg, 1), u: "kg" },
        { k: "Mass ratio (start ÷ end)", v: TB.fix(prop.massRatio, 3) },
        { k: p.oneBurn ? "Time to the far side" : "Transfer time", v: TB.fix(r.transferTimeH, 2), u: "h" }
      );
      TB.results("results", items);
      var rows = [["No inclination change (Hohmann alone)", kms(r.hohmann.burn1), kms(r.hohmann.burn2), "–", kms(r.hohmann.total)]];
      if (p.oneBurn) {
        rows = [["One burn, inclination change included", kms(r.oneBurn.burn1), "–", "–", kms(r.oneBurn.total)]];
      } else {
        rows.push(
          ["Inclination change on its own, at the larger orbit", kms(r.separate.burn1), kms(r.separate.burn2), kms(r.separate.planeChange), kms(r.separate.total)],
          ["All of it in the burn at the larger radius", kms(r.combinedAtOuter.burn1), kms(r.combinedAtOuter.burn2), "in burn", kms(r.combinedAtOuter.total)],
          ["Split for the least delta-v (" + TB.fix(r.optimal.planeAtStartDeg, 2) + "° + " + TB.fix(r.optimal.planeAtEndDeg, 2) + "°)",
            kms(r.optimal.burn1), kms(r.optimal.burn2), "in burns", kms(r.optimal.total)]
        );
      }
      TB.table("table", ["Way", "Burn 1 (km/s)", "Burn 2 (km/s)", "Separate turn (km/s)", "Total (km/s)"], rows);
      TB.$("note").textContent = note;
    } catch (e) {
      TB.message("msg", e.message, "error");
    }
  }
  function applyPreset(name) {
    var pr = PRESETS[name];
    if (!pr) return;
    ["r1", "i1", "r2", "i2"].forEach(function (k) { TB.$(k).value = Math.round(pr[k] * 1000) / 1000; });
    TB.$("oneBurn").checked = pr.oneBurn;
    note = NOTES[name] || "";
    run();
  }
  TB.ready(function () {
    var saved = TB.load(KEY);
    if (saved) {
      NUMS.forEach(function (k) { if (isFinite(saved[k])) TB.$(k).value = saved[k]; });
      TB.$("oneBurn").checked = !!saved.oneBurn;
    }
    Array.prototype.forEach.call(document.querySelectorAll("[data-preset]"), function (btn) {
      btn.addEventListener("click", function () { applyPreset(btn.getAttribute("data-preset")); });
    });
    TB.$("form").addEventListener("submit", function (ev) { ev.preventDefault(); note = ""; run(); });
    TB.$("copy").addEventListener("click", function () {
      if (!last) return TB.message("msg", "Calculate first.", "info");
      TB.copyJSON(last).then(function () { TB.message("msg", "Copied.", "info"); },
        function () { TB.message("msg", "This browser would not let the page use the clipboard.", "error"); });
    });
    run();
  });
})();

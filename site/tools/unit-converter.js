/* Aerospace Unit Converter page. The maths is in ../lib/unit-converter.js (tested in tests/unit-converter.test.js). */
(function () {
  "use strict";
  var KEY = "unit-converter";
  var FIELDS = ["cat", "value", "from", "mach", "tsrc", "isaAlt", "tempC", "palt", "paltUnit"];
  var U = null, last = null;

  // Ten significant figures, without trailing zeros; very large or small values in exponent form.
  function show(x) {
    if (!isFinite(x)) return "–";
    if (x === 0) return "0";
    var a = Math.abs(x);
    if (a >= 1e12 || a < 1e-6) return x.toExponential(8);
    return Number(x.toPrecision(10)).toLocaleString("en-US", { maximumFractionDigits: 10 });
  }

  function fillUnits(keep) {
    var cat = TB.$("cat").value, sel = TB.$("from");
    TB.clear(sel);
    U.CATEGORIES[cat].units.forEach(function (u) { sel.appendChild(TB.el("option", { value: u[0], text: u[1] + " (" + u[0] + ")" })); });
    sel.value = keep && U.CATEGORIES[cat].units.some(function (u) { return u[0] === keep; }) ? keep : U.CATEGORIES[cat].units[0][0];
  }

  function showTsrc() {
    var isa = TB.$("tsrc").value === "isa";
    TB.$("isa-field").hidden = !isa;
    TB.$("temp-field").hidden = isa;
  }

  function run() {
    TB.message("msg", "");
    var input = {};
    FIELDS.forEach(function (k) { input[k] = TB.$(k).value; });
    TB.save(KEY, input);
    var out = {}, errors = [];
    // Conversion
    try {
      var cat = input.cat, v = TB.num("value");
      var rows = U.all(v, cat, input.from);
      out.conversion = { category: cat, value: v, from: input.from, results: rows };
      TB.$("conv-title").textContent = U.CATEGORIES[cat].label;
      TB.table("conv", ["Unit", "Value"], rows.map(function (r) { return [r.label + " (" + r.id + ")", show(r.value)]; }));
    } catch (e) { TB.clear(TB.$("conv")); errors.push(e.message); }
    // Mach
    try {
      var tK = input.tsrc === "isa" ? U.isaTemperatureK(TB.num("isaAlt")) : TB.num("tempC") + 273.15;
      var a = U.speedOfSound(tK), spd = U.machToSpeed(TB.num("mach"), tK);
      out.mach = { mach: TB.num("mach"), temperatureK: tK, speedOfSoundMs: a, speedMs: spd };
      TB.results("machres", [
        { k: "Air temperature", v: TB.fix(tK - 273.15, 2), u: "°C" },
        { k: "Speed of sound", v: TB.fix(a, 2), u: "m/s" },
        { k: "Speed", v: TB.fix(spd, 2), u: "m/s" },
        { k: "Speed", v: TB.fix(spd * 3.6, 1), u: "km/h" },
        { k: "Speed", v: TB.fix(U.convert(spd, "speed", "m/s", "kn"), 1), u: "kn" },
        { k: "Speed", v: TB.fix(U.convert(spd, "speed", "m/s", "mph"), 1), u: "mph" }
      ]);
    } catch (e) { TB.clear(TB.$("machres")); errors.push("Mach: " + e.message); }
    // Flight level
    try {
      var p = TB.num("palt");
      var ft = input.paltUnit === "m" ? U.convert(p, "length", "m", "ft") : p;
      if (!isFinite(ft)) throw new Error("Enter a pressure altitude.");
      var fl = U.flightLevel(ft);
      out.flightLevel = { pressureAltitudeFt: ft, flightLevel: fl };
      TB.results("flres", [
        { k: "Flight level", v: "FL" + (fl < 0 ? "−" + String(-fl).padStart(3, "0") : String(fl).padStart(3, "0")) },
        { k: "Pressure altitude", v: TB.fix(ft, 0), u: "ft" },
        { k: "Pressure altitude", v: TB.fix(U.convert(ft, "length", "ft", "m"), 0), u: "m" }
      ]);
    } catch (e) { TB.clear(TB.$("flres")); errors.push("Flight level: " + e.message); }
    last = out;
    if (errors.length) TB.message("msg", errors.join(" "), "error");
  }

  TB.ready(function () {
    U = DD.unitConverter;
    var cat = TB.$("cat");
    Object.keys(U.CATEGORIES).forEach(function (k) { cat.appendChild(TB.el("option", { value: k, text: U.CATEGORIES[k].label })); });
    var saved = TB.load(KEY) || {};
    cat.value = saved.cat && U.CATEGORIES[saved.cat] ? saved.cat : "length";
    fillUnits(saved.from || "km");
    FIELDS.forEach(function (k) {
      if (k === "cat" || k === "from") return;
      if (typeof saved[k] === "string" && saved[k] !== "") TB.$(k).value = saved[k];
    });
    showTsrc();
    cat.addEventListener("change", function () { fillUnits(null); run(); });
    TB.$("tsrc").addEventListener("change", function () { showTsrc(); run(); });
    FIELDS.forEach(function (k) {
      if (k === "cat" || k === "tsrc") return;
      TB.$(k).addEventListener("input", run);
      TB.$(k).addEventListener("change", run);
    });
    TB.$("form").addEventListener("submit", function (ev) { ev.preventDefault(); run(); });
    TB.$("copy").addEventListener("click", function () {
      if (!last) return TB.message("msg", "Convert first.", "info");
      TB.copyJSON(last).then(function () { TB.message("msg", "Copied.", "info"); },
        function () { TB.message("msg", "This browser would not let the page use the clipboard.", "error"); });
    });
    run();
  });
})();

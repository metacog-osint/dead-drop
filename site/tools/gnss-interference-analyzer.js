/* GNSS Interference Indicators page. The checks are in ../lib/gnss-interference.js (tested in tests/gnss-interference.test.js). */
(function () {
  "use strict";
  var KEY = "gnss-interference";
  var NUMS = ["cn0", "cn0Baseline", "sats", "satsBaseline", "hacc", "haccBaseline", "lat", "lon"];
  var FLAGS = ["agcDrop", "posJump", "timeJump", "cn0Uniform", "crossCheckFail"];
  var WORDS = { normal: "Normal", flag: "Flagged", strong: "Strongly flagged" };
  var PATTERN = { none: "None flagged", "interference-like": "Fits interference", "spoofing-like": "Fits spoofing",
    both: "Fits both" };
  var last = null;
  function val(v) { return isFinite(v) ? v : null; }
  function readUtc() {
    var s = TB.$("when").value;
    if (!s) return null;
    var d = new Date(s + (s.length === 16 ? ":00" : "") + "Z");   // the box is labelled UTC
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  function run() {
    TB.message("msg", "");
    var input = { constellations: TB.$("constellations").value, flags: {} };
    NUMS.forEach(function (k) { input[k] = val(TB.num(k)); });
    FLAGS.forEach(function (k) { input.flags[k] = TB.$(k).checked; });
    input.whenUtc = readUtc();
    TB.save(KEY, { constellations: input.constellations, values: NUMS.reduce(function (o, k) { o[k] = input[k]; return o; }, {}),
      flags: input.flags, when: TB.$("when").value });
    try {
      if (input.lat !== null && Math.abs(input.lat) > 90) throw new Error("Latitude must be between -90 and 90.");
      var r = DD.gnssInterference.assess({ constellations: input.constellations, cn0: input.cn0, cn0Baseline: input.cn0Baseline,
        sats: input.sats, satsBaseline: input.satsBaseline, haccM: input.hacc, haccBaseline: input.haccBaseline, flags: input.flags });
      last = { input: input, result: r };
      var items = [
        { k: "Indicators flagged", v: r.flaggedCount + " of " + r.indicators.length, cls: r.flaggedCount ? "warn" : null },
        { k: "Pattern (indicative)", v: PATTERN[r.pattern] },
        { k: "Lost-signal indicators", v: String(r.jammingLike) },
        { k: "False-signal indicators", v: String(r.spoofingLike) }
      ];
      if (r.interferenceToNoiseDb !== null) {
        items.push({ k: "Implied interference over thermal noise", v: TB.fix(r.interferenceToNoiseDb, 1), u: "dB",
          title: "From the C/N0 drop, if the satellites' signal power is unchanged" });
      }
      if (input.whenUtc) items.push({ k: "Observation time", v: TB.time(input.whenUtc, { year: true }) });
      TB.results("results", items);
      TB.$("summary").textContent = r.summary;
      TB.$("caution").textContent = r.caution;
      TB.table("table", ["Indicator", "Value", "Reading", "What it means", "Threshold basis"], r.indicators.map(function (x) {
        return [x.label, typeof x.value === "number" ? String(x.value) : x.value,
          WORDS[x.reading], x.text, x.basis];
      }));
    } catch (e) {
      last = null;
      TB.clear(TB.$("results")); TB.clear(TB.$("table"));
      TB.$("summary").textContent = ""; TB.$("caution").textContent = "";
      TB.message("msg", e.message, "error");
    }
  }
  TB.ready(function () {
    var saved = TB.load(KEY);
    if (saved) {
      if (saved.constellations === "multi" || saved.constellations === "single") TB.$("constellations").value = saved.constellations;
      NUMS.forEach(function (k) {
        if (!saved.values || !(k in saved.values)) return;
        TB.$(k).value = isFinite(saved.values[k]) && saved.values[k] !== null ? saved.values[k] : "";
      });
      FLAGS.forEach(function (k) { if (saved.flags) TB.$(k).checked = !!saved.flags[k]; });
      if (typeof saved.when === "string") TB.$("when").value = saved.when;
    }
    TB.$("form").addEventListener("submit", function (ev) { ev.preventDefault(); run(); });
    TB.$("copy").addEventListener("click", function () {
      if (!last) return TB.message("msg", "Check the indicators first.", "info");
      TB.copyJSON(last).then(function () { TB.message("msg", "Copied.", "info"); },
        function () { TB.message("msg", "This browser would not let the page use the clipboard.", "error"); });
    });
    run();
  });
})();

/* Time Zone Batch Converter page. The maths is in ../lib/timestamp-batch.js and ../lib/timezone.js
   (tested in tests/timestamp-batch.test.js and tests/timezone.test.js). */
(function () {
  "use strict";
  var KEY = "timezone-batch";
  var tz = DD.timezone, B = DD.timestampBatch;
  var last = null, showAll = false;
  var DEFAULT_TARGETS = ["UTC", "America/Chicago", "Europe/London"];
  var SAMPLE = ["2025-10-26T14:30:00Z", "2025-10-26 18:45", "1761489000", "26 Oct 2025 21:00 UTC",
    "261430ROCT25", "27/10/2025 08:00"].join("\n");

  function zoneList() {
    var suite = (window.TicTime && TicTime.zones) || tz.SUITE_ZONES;
    var seen = {}, out = [];
    suite.concat(tz.EXTRA_ZONES).forEach(function (z) { if (!seen[z[0]]) { seen[z[0]] = 1; out.push(z); } });
    return out;
  }
  function chosenZone() {
    var v = TB.$("zone").value;
    return v === "other" ? TB.$("other").value.trim() : v;
  }
  function setZone(z) {
    var known = zoneList().some(function (x) { return x[0] === z; });
    TB.$("zone").value = known ? z : "other";
    TB.$("other").value = known ? "" : z;
    TB.$("otherRow").hidden = known;
  }
  function targets() {
    var list = Array.prototype.slice.call(document.querySelectorAll("#targets input:checked")).map(function (c) { return c.value; });
    TB.$("extra").value.split(",").map(function (s) { return s.trim(); }).filter(Boolean).forEach(function (z) {
      if (list.indexOf(z) < 0) list.push(z);
    });
    return list;
  }

  function render() {
    var r = last.result;
    var items = [
      { k: "Lines read", v: String(r.read) },
      { k: "Lines not read", v: String(r.failed), cls: r.failed ? "alarm" : null },
      { k: "Lines with a note", v: String(r.flagged), cls: r.flagged ? "warn" : null },
      { k: "Earliest", v: r.earliest ? TB.time(r.earliest, { year: true }) : "–" },
      { k: "Latest", v: r.latest ? TB.time(r.latest, { year: true }) : "–" },
      { k: "Span", v: r.read ? r.spanText : "–" }
    ];
    TB.results("results", items);
    var head = ["Line", "Input", "UTC"].concat(r.targets).concat(["Read as", "Notes"]);
    var rows = r.rows.map(function (x) {
      if (!x.ok) return [String(x.line), x.input, "Not read"].concat(r.targets.map(function () { return ""; })).concat(["", x.error]);
      return [String(x.line), x.input, x.utc].concat(x.out).concat([x.kind + ", zone " + x.zoneUsed, x.notes.join(" ")]);
    });
    TB.table("table", head, rows);
    var btn = TB.$("showall");
    btn.hidden = rows.length <= 10;
    btn.textContent = showAll ? "Show fewer" : "Show all " + rows.length;
    TB.$("table").className = showAll ? "" : "scroll";
  }

  function run() {
    TB.message("msg", "");
    var input = { text: TB.$("input").value, zone: chosenZone(), order: TB.$("order").value, targets: targets(),
      extra: TB.$("extra").value };
    try {
      if (!tz.validZone(input.zone)) throw new Error("Not a time zone name this browser knows: " + (input.zone || "(empty)"));
      if (!input.text.trim()) throw new Error("Paste at least one timestamp.");
      if (!input.targets.length) throw new Error("Tick at least one zone to show.");
      var result = B.convertAll(input.text, { sourceZone: input.zone, order: input.order, targets: input.targets });
      last = { input: input, result: result };
      TB.save(KEY, input);
      render();
    } catch (e) {
      TB.message("msg", e.message, "error");
    }
  }

  TB.ready(function () {
    var sel = TB.$("zone");
    zoneList().forEach(function (z) {
      sel.appendChild(TB.el("option", { value: z[0], text: z[1] + (z[0] === "UTC" ? "" : " (" + z[0] + ")") }));
    });
    sel.appendChild(TB.el("option", { value: "other", text: "Other IANA zone…" }));
    var saved = TB.load(KEY) || {};
    var ticked = saved.targets || DEFAULT_TARGETS;
    var box = TB.$("targets");
    zoneList().forEach(function (z) {
      var cb = TB.el("input", { type: "checkbox", value: z[0], checked: ticked.indexOf(z[0]) >= 0 ? "checked" : null });
      box.appendChild(TB.el("label", { class: "check", title: z[0] }, [cb, z[1]]));
    });
    setZone(saved.zone && tz.validZone(saved.zone) ? saved.zone : "UTC");
    if (saved.order) TB.$("order").value = saved.order;
    if (saved.extra) TB.$("extra").value = saved.extra;
    TB.$("input").value = saved.text || SAMPLE;
    sel.addEventListener("change", function () { TB.$("otherRow").hidden = sel.value !== "other"; });
    TB.$("form").addEventListener("submit", function (ev) { ev.preventDefault(); run(); });
    TB.$("sample").addEventListener("click", function () { TB.$("input").value = SAMPLE; run(); });
    TB.$("clear").addEventListener("click", function () { TB.$("input").value = ""; TB.$("input").focus(); });
    TB.$("showall").addEventListener("click", function () { showAll = !showAll; if (last) render(); });
    TB.$("copy").addEventListener("click", function () {
      if (!last) return TB.message("msg", "Convert first.", "info");
      TB.copyJSON(last).then(function () { TB.message("msg", "Copied.", "info"); },
        function () { TB.message("msg", "This browser would not let the page use the clipboard.", "error"); });
    });
    if (window.TicTime && TicTime.onChange) TicTime.onChange(function () { if (last) render(); });
    run();
  });
})();

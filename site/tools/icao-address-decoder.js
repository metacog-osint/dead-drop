/* ICAO Address Decoder page. The table and the N-number arithmetic are in ../lib/icao-address-decoder.js
   (tested in tests/icao-address-decoder.test.js). */
(function () {
  "use strict";
  var KEY = "icao-address-decoder";
  var D = DD.icaoAddressDecoder;
  var MAX_LINES = 500, WINDOW = 10;
  var last = null, showAll = false;

  function rowFor(line) {
    try {
      var r = D.decodeAny(line);
      return { line: line, ok: true, r: r };
    } catch (e) {
      return { line: line, ok: false, error: e.message };
    }
  }
  function sizeText(n) { return n ? n.toLocaleString("en-US") + " addresses" : "–"; }

  function showFirst(row) {
    var notes = TB.$("notes");
    TB.clear(notes);
    if (!row) { TB.results("results", []); TB.$("first").textContent = ""; return; }
    TB.$("first").textContent = "First line: " + row.line;
    if (!row.ok) {
      TB.results("results", [{ k: "Could not decode", v: row.error, cls: "alarm" }]);
      return;
    }
    var r = row.r;
    var items = [
      { k: "ICAO address (hexadecimal)", v: r.hex },
      { k: "State of registry (ICAO block)", v: r.state || "Not in the ICAO table", cls: r.state ? null : "warn" },
      { k: "Block", v: r.block || "–", u: r.blockSize ? "(" + sizeText(r.blockSize) + ")" : "" }
    ];
    if (r.state === "United States") {
      items.push({ k: "US N-number", v: r.nNumber || "None (outside A00001–ADF7C7)", cls: r.nNumber ? null : "warn" });
    }
    items.push({ k: "Octal (as the FAA registry writes it)", v: r.octal });
    items.push({ k: "Decimal", v: String(r.decimal) });
    items.push({ k: "Binary (24 bits)", v: r.binary.replace(/(.{4})/g, "$1 ").trim() });
    TB.results("results", items);
    r.notes.forEach(function (n) { notes.appendChild(TB.el("li", { text: n })); });
    r.community.forEach(function (c) { notes.appendChild(TB.el("li", { text: c.range + ": " + c.label })); });
  }

  function renderTable() {
    if (!last) return;
    TB.table("table", ["Line", "ICAO address", "State of registry", "Block", "N-number", "Notes"], last.rows.map(function (row) {
      if (!row.ok) return [row.line, "–", "–", "–", "–", row.error];
      var r = row.r;
      var notes = r.notes.concat(r.community.map(function (c) { return c.label; }));
      return [row.line, r.hex, r.state || "Not in the ICAO table", r.block || "–",
        r.state === "United States" ? (r.nNumber || "none") : "–", notes.join(" ")];
    }));
    var btn = TB.$("showall");
    btn.hidden = last.rows.length <= WINDOW;
    btn.textContent = showAll ? "Show fewer" : "Show all " + last.rows.length;
    TB.$("table").className = showAll ? "" : "scroll";
  }

  function run() {
    TB.message("msg", "");
    var text = TB.$("q").value;
    var lines = text.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(function (s) { return s !== ""; });
    if (!lines.length) { TB.message("msg", "Enter at least one address or N-number.", "error"); return; }
    if (lines.length > MAX_LINES) {
      TB.message("msg", "Only the first " + MAX_LINES + " lines are decoded.", "info");
      lines = lines.slice(0, MAX_LINES);
    }
    TB.save(KEY, { q: text.slice(0, 20000) });
    var rows = lines.map(rowFor);
    last = {
      rows: rows,
      json: rows.map(function (row) {
        return row.ok ? { input: row.line, inputKind: row.r.inputKind, icaoHex: row.r.hex, octal: row.r.octal,
          stateOfRegistry: row.r.state, icaoBlock: row.r.block, nNumber: row.r.nNumber, notes: row.r.notes,
          communityReportedNotIcao: row.r.community } : { input: row.line, error: row.error };
      })
    };
    showFirst(rows[0]);
    showAll = false;
    renderTable();
    var bad = rows.filter(function (r) { return !r.ok; }).length;
    if (bad) TB.message("msg", bad + " of " + rows.length + " lines could not be decoded; the table says why.", "error");
  }

  TB.ready(function () {
    var saved = TB.load(KEY);
    if (saved && typeof saved.q === "string" && saved.q.trim()) TB.$("q").value = saved.q;
    TB.$("form").addEventListener("submit", function (ev) { ev.preventDefault(); run(); });
    TB.$("showall").addEventListener("click", function () { showAll = !showAll; renderTable(); });
    TB.$("copy").addEventListener("click", function () {
      if (!last) return TB.message("msg", "Decode first.", "info");
      TB.copyJSON(last.json).then(function () { TB.message("msg", "Copied.", "info"); },
        function () { TB.message("msg", "This browser would not let the page use the clipboard.", "error"); });
    });
    run();
  });
})();

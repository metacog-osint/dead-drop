/* Evidence Capture page. Address cleaning, timestamps, the availability answer, CSV and the citation are in
   ../lib/evidence-capture.js (tested in tests/evidence-capture.test.js). Network: one GET to the Internet Archive's
   availability API when "Check" is pressed. Save Page Now and archive.today are only opened in a new tab on a click;
   this page never posts to them. */
(function () {
  "use strict";
  var KEY = "evidence-capture";
  var E = DD.evidenceCapture;
  var log = [], found = null, showAll = false;

  function parseUtcInput(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(s || "").trim());
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], m[6] ? +m[6] : 0) : NaN;
  }
  function saveInputs() {
    TB.save(KEY, { url: TB.$("url").value, title: TB.$("title").value, near: TB.$("near").value, note: TB.$("note").value });
  }
  function saveLog() {
    if (!TB.save(KEY + "-log", log)) TB.message("logMsg", "This browser would not store the log; export it now to keep it.", "error");
  }
  function cleaned() {
    var n = E.normaliseUrl(TB.$("url").value);
    if (n.ok) TB.$("url").value = n.url;
    return n;
  }
  function updateLinks() {
    var n = E.normaliseUrl(TB.$("url").value);
    TB.$("links").hidden = !n.ok;
    if (!n.ok) return;
    TB.$("calLink").setAttribute("href", E.waybackCalendarUrl(n.url));
    TB.$("atLink").setAttribute("href", E.archiveTodayUrl(n.url));
  }
  function link(href, text) { return TB.el("a", { href: href, target: "_blank", rel: "noopener noreferrer", text: text }); }
  function writeText(s) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(s);
    return Promise.reject(new Error("no clipboard"));
  }

  // ---- Check ----
  function check() {
    TB.message("msg", "");
    var n = cleaned();
    if (!n.ok) return TB.message("msg", n.error, "error");
    var nearMs = parseUtcInput(TB.$("near").value);
    if (TB.$("near").value && !isFinite(nearMs)) return TB.message("msg", "The time is not complete.", "error");
    saveInputs();
    updateLinks();
    var api = E.availabilityUrl(n.url, isFinite(nearMs) ? nearMs : undefined);
    var askedMs = Date.now(), btn = TB.$("check");
    btn.disabled = true;
    TB.message("msg", (n.notes.length ? n.notes.join(" ") + " " : "") + "Asking the Wayback Machine…", "info");
    fetch(api, { credentials: "omit", referrerPolicy: "no-referrer" }).then(function (r) {
      if (!r.ok) throw new Error("it answered " + r.status);
      return r.json();
    }).then(function (d) {
      var a = E.parseAvailability(d);
      found = { url: n.url, askedMs: askedMs, nearMs: isFinite(nearMs) ? nearMs : null, answer: a, api: api };
      TB.message("msg", n.notes.join(" "), "info");
      renderFound();
    }).catch(function (e) {
      TB.message("msg", "The Wayback Machine could not be asked from this page (" + e.message + "). Open the check " +
        "yourself, or use the \"all Wayback copies\" link.", "error");
      found = null;
      TB.clear(TB.$("found"));
      TB.$("found").appendChild(TB.el("p", { class: "empty", text: "No answer." }));
      TB.$("cite").textContent = "";
      TB.$("logFound").disabled = true;
      TB.$("copyCite").disabled = true;
      var p = TB.$("foundLink");
      TB.clear(p);
      p.appendChild(link(api, "Open the availability check in a new tab"));
      p.hidden = false;
    }).then(function () { btn.disabled = false; });
  }

  function foundEntry() {
    if (!found) return null;
    var a = found.answer;
    return E.makeEntry({ url: found.url, title: TB.$("title").value.trim(), askedMs: found.askedMs,
      captureUrl: a.found ? a.url : "", captureTimestamp: a.found ? a.timestamp : "",
      how: a.found ? "Wayback availability check" : "Wayback availability check: no copy found", note: TB.$("note").value.trim() });
  }
  function renderFound() {
    var a = found.answer, items;
    TB.$("foundLink").hidden = true;
    if (!a.found) {
      items = [{ k: "Wayback copy", v: "None found", cls: "warn" },
        { k: "Asked about", v: found.url }];
    } else {
      var ref = found.nearMs !== null ? found.nearMs : found.askedMs;
      var gap = a.timeMs !== null ? a.timeMs - ref : null;
      items = [
        { k: "Archived", v: a.timeMs !== null ? TB.time(a.timeMs) : a.timestamp, cls: "ok" },
        { k: "Archive timestamp (UTC)", v: a.timestamp },
        { k: found.nearMs !== null ? "From the time you gave" : "Age of the copy",
          v: gap === null ? "–" : E.gapText(gap) + (gap < 0 ? " before" : gap > 0 ? " after" : "") },
        { k: "Site's answer when archived", v: a.status || "–",
          cls: a.status && a.status !== "200" ? "warn" : null,
          title: a.status === "200" ? "The page was there" : "Not a plain 200: open the copy and check what it shows" }
      ];
      var p = TB.$("foundLink");
      TB.clear(p);
      p.appendChild(link(a.url, "Open the archived copy"));
      p.appendChild(document.createTextNode(" · "));
      p.appendChild(link(E.waybackCalendarUrl(found.url), "all copies of this address"));
      p.hidden = false;
    }
    TB.results("found", items);
    TB.$("cite").textContent = E.citation(foundEntry());
    TB.$("logFound").disabled = false;
    TB.$("copyCite").disabled = false;
  }

  // ---- Save (user click only) ----
  function savePageNow() {
    TB.message("msg", "");
    var n = cleaned();
    if (!n.ok) return TB.message("msg", n.error, "error");
    saveInputs();
    updateLinks();
    window.open(E.savePageNowUrl(n.url), "_blank", "noopener,noreferrer");
    TB.message("msg", "Save Page Now opened in a new tab. When it finishes, copy the archived copy's address into " +
      "\"Record a copy you made\", or press Check again.", "info");
  }

  // ---- Log ----
  function addEntry(e) {
    log.unshift(e);
    saveLog();
    renderLog();
  }
  function record() {
    TB.message("recMsg", "");
    var n = cleaned();
    if (!n.ok) return TB.message("recMsg", "First give the page's address above: " + n.error, "error");
    var cap = TB.$("capUrl").value.trim();
    if (!/^https:\/\/\S+$|^http:\/\/\S+$/i.test(cap)) return TB.message("recMsg", "Paste the archived copy's full address, starting https://.", "error");
    var w = E.parseWaybackUrl(cap), tMs = parseUtcInput(TB.$("capTime").value);
    if (!w && !isFinite(tMs)) return TB.message("recMsg", "That is not a Wayback address, so give the archive time (UTC) the archive shows.", "error");
    if (w && E.normaliseUrl(w.original).ok && E.normaliseUrl(w.original).url !== n.url) {
      TB.message("recMsg", "Note: that copy is of " + w.original + ", not exactly the address above.", "info");
    }
    var e = E.makeEntry({ url: n.url, title: TB.$("title").value.trim(), askedMs: Date.now(), captureUrl: cap,
      captureTimeMs: w ? undefined : tMs, how: "Recorded by hand", note: TB.$("note").value.trim() });
    addEntry(e);
    TB.$("capUrl").value = "";
    TB.$("capTime").value = "";
  }
  function renderLog() {
    var head = ["Checked", "Page", "Archived copy", "Archive time", "Note", ""];
    TB.table("log", head, log.map(function (e) {
      var copyB = TB.el("button", { type: "button", text: "Copy citation" });
      copyB.addEventListener("click", function () {
        writeText(E.citation(e)).then(function () { TB.message("logMsg", "Citation copied.", "info"); },
          function () { TB.message("logMsg", "This browser would not let the page use the clipboard.", "error"); });
      });
      var rmB = TB.el("button", { type: "button", text: "Remove" });
      rmB.addEventListener("click", function () {
        if (!window.confirm("Remove this entry from the log? It is not kept anywhere else unless you exported it.")) return;
        log = log.filter(function (x) { return x.id !== e.id; });
        saveLog();
        renderLog();
      });
      return [TB.time(e.askedMs), TB.el("span", null, [e.title ? e.title + " " : "", link(e.url, e.url)]),
        e.captureUrl ? link(e.captureUrl, e.archive || "archived copy") : "none",
        e.captureTimeMs !== null ? TB.time(e.captureTimeMs) : "–", e.note || "", TB.el("span", null, [copyB, rmB])];
    }));
    var many = log.length > 10;
    TB.$("logAll").hidden = !many;
    TB.$("logAll").textContent = showAll ? "Show fewer" : "Show all";
    TB.$("logWrap").className = showAll ? "scroll all" : "scroll";
  }
  function stamp() { return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z").replace("T", "-"); }
  function download(name, type, text) {
    var url = URL.createObjectURL(new Blob([text], { type: type }));
    var a = TB.el("a", { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  function exportJson() {
    return { exportedUtc: new Date().toISOString(), note: "Capture log from Dead Drop Evidence Capture. Times in UTC.",
      entries: E.exportRows(log).map(function (r, i) { r.captureTimeMs = log[i].captureTimeMs; r.askedMs = log[i].askedMs; return r; }) };
  }

  TB.ready(function () {
    var s = TB.load(KEY) || {};
    ["url", "title", "near", "note"].forEach(function (k) { if (typeof s[k] === "string") TB.$(k).value = s[k]; });
    log = E.cleanLog(TB.load(KEY + "-log"));
    updateLinks();
    renderLog();
    TB.$("form").addEventListener("submit", function (ev) { ev.preventDefault(); check(); });
    TB.$("url").addEventListener("input", updateLinks);
    TB.$("save").addEventListener("click", savePageNow);
    TB.$("record").addEventListener("click", record);
    TB.$("logFound").addEventListener("click", function () {
      var e = foundEntry();
      if (!e) return;
      addEntry(e);
      TB.$("logFound").disabled = true;
      TB.message("logMsg", "Added to the log.", "info");
    });
    TB.$("copyCite").addEventListener("click", function () {
      var e = foundEntry();
      if (!e) return;
      writeText(E.citation(e)).then(function () { TB.message("logMsg", "Citation copied.", "info"); },
        function () { TB.message("logMsg", "This browser would not let the page use the clipboard.", "error"); });
    });
    TB.$("logAll").addEventListener("click", function () { showAll = !showAll; renderLog(); });
    TB.$("csv").addEventListener("click", function () {
      if (!log.length) return TB.message("logMsg", "The log is empty.", "info");
      download("capture-log-" + stamp() + ".csv", "text/csv;charset=utf-8", "﻿" + E.toCsv(E.exportRows(log), E.LOG_COLUMNS));
    });
    TB.$("json").addEventListener("click", function () {
      if (!log.length) return TB.message("logMsg", "The log is empty.", "info");
      download("capture-log-" + stamp() + ".json", "application/json", JSON.stringify(exportJson(), null, 2));
    });
    TB.$("copy").addEventListener("click", function () {
      var out = exportJson();
      if (found) out.lastCheck = { url: found.url, askedUtc: new Date(found.askedMs).toISOString(),
        nearUtc: found.nearMs === null ? null : new Date(found.nearMs).toISOString(), answer: found.answer, request: found.api };
      TB.copyJSON(out).then(function () { TB.message("logMsg", "Copied.", "info"); },
        function () { TB.message("logMsg", "This browser would not let the page use the clipboard.", "error"); });
    });
    TB.$("clear").addEventListener("click", function () {
      if (!log.length) return;
      if (!window.confirm("Delete all " + log.length + " log entries from this browser? This cannot be undone; export first to keep them.")) return;
      log = [];
      saveLog();
      renderLog();
      TB.message("logMsg", "Log cleared.", "info");
    });
  });
})();

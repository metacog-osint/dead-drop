/* Dead Drop Toolbox: helpers every tool page shares. Classic script, no dependencies, CSP-safe (DOM calls only, no
   HTML strings). Load it after tic-time.js and before the tool's own script. Defines window.TB.
     TB.$(id)                       document.getElementById
     TB.num(id)                     the input's value as a number (NaN when empty or not a number)
     TB.el(tag, attrs, children)    builds an element; children are nodes or strings (strings become text)
     TB.results(container, items)   fills a results grid: items are {k, v, u?, cls?} (label, value, unit, ok|warn|alarm)
     TB.table(container, head, rows)  a table of text cells; rows are arrays
     TB.message(id, text, kind)     shows an error or info line (kind "error" | "info"); empty text hides it
     TB.fix(x, n)                   x.toFixed(n), or an en dash when x is not finite
     TB.save(key, obj) / TB.load(key)  keep a tool's inputs in this browser (localStorage), nowhere else
     TB.copyJSON(obj)               copies obj as JSON to the clipboard
     TB.time(isoOrDate, opts)       a time in the viewer's chosen zone, zone named (TicTime.format)
     TB.ready(fn)                   runs fn once the page has loaded */
(function () {
  "use strict";
  function $(id) { return document.getElementById(id); }
  function num(id) {
    var e = $(id);
    if (!e) return NaN;
    var s = String(e.value).trim();
    return s === "" ? NaN : Number(s);
  }
  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (attrs[k] === null || attrs[k] === undefined || attrs[k] === false) return;
        if (k === "class") e.className = attrs[k];
        else if (k === "text") e.textContent = attrs[k];
        else e.setAttribute(k, attrs[k]);
      });
    }
    (children || []).forEach(function (c) {
      if (c === null || c === undefined) return;
      e.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
    });
    return e;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function results(container, items) {
    var c = typeof container === "string" ? $(container) : container;
    clear(c);
    items.forEach(function (it) {
      var v = el("div", { class: "v" }, [String(it.v)]);
      if (it.u) { v.appendChild(document.createTextNode(" ")); v.appendChild(el("span", { class: "u", text: it.u })); }
      c.appendChild(el("div", { class: "result" + (it.cls ? " " + it.cls : ""), title: it.title || null },
        [el("div", { class: "k", text: it.k }), v]));
    });
  }
  function table(container, head, rows) {
    var c = typeof container === "string" ? $(container) : container;
    clear(c);
    if (!rows.length) { c.appendChild(el("p", { class: "empty", text: "Nothing to show yet." })); return; }
    var thead = el("thead", null, [el("tr", null, head.map(function (h) { return el("th", { scope: "col", text: h }); }))]);
    var tbody = el("tbody", null, rows.map(function (r) {
      return el("tr", null, r.map(function (x) { return el("td", null, [x instanceof Node ? x : String(x)]); }));
    }));
    c.appendChild(el("table", { class: "data" }, [thead, tbody]));
  }
  function message(id, text, kind) {
    var m = $(id);
    if (!m) return;
    m.textContent = text || "";
    m.className = "msg " + (kind || "error");
    m.hidden = !text;
  }
  function fix(x, n) { return (typeof x === "number" && isFinite(x)) ? x.toFixed(n) : "–"; }
  function save(key, obj) {
    try { localStorage.setItem("deaddrop:" + key, JSON.stringify(obj)); return true; } catch (e) { return false; }
  }
  function load(key) {
    try { var s = localStorage.getItem("deaddrop:" + key); return s ? JSON.parse(s) : null; } catch (e) { return null; }
  }
  function copyJSON(obj) {
    var s = JSON.stringify(obj, null, 2);
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(s);
    return Promise.reject(new Error("Clipboard not available"));
  }
  function time(d, opts) {
    if (window.TicTime) return window.TicTime.format(d, opts || {});
    return new Date(d).toISOString().replace(/\.\d+Z$/, "Z");
  }
  function ready(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }
  // Every page has <span id="time-settings"></span> in its header for the time zone and clock settings.
  ready(function () {
    var ts = $("time-settings");
    if (ts && window.TicTime) window.TicTime.mountSettings(ts);
  });
  window.TB = { $: $, num: num, el: el, clear: clear, results: results, table: table, message: message, fix: fix,
    save: save, load: load, copyJSON: copyJSON, time: time, ready: ready };
})();

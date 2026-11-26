/* Reading KML (the XML map format of Google Earth) into points, lines and polygons, with each line's length and
   each polygon's perimeter and area, and writing the result as GeoJSON.
   References: OGC KML 2.2 (OGC 07-147r2): section 16.9 (coordinates: tuples "longitude,latitude[,altitude]" in
   decimal degrees on WGS 84, separated by white space, no spaces inside a tuple), 10.8 (Polygon: one
   outerBoundaryIs and any number of innerBoundaryIs, each a LinearRing), 10.5 (LinearRing: closed, first and
   last positions equal, at least four), 10.2 (MultiGeometry); KMZ is a ZIP whose first .kml at the root, by custom
   doc.kml, is the main file. Google's gx:Track extension gives positions as "lon lat alt" in gx:coord.
   Distance: haversine on a sphere of radius 6371 km (Chris Veness, "Calculate distance, bearing and more between
   latitude/longitude points", movable-type.co.uk). Area on the sphere: A = (R^2 / 2) |sum (lon[i+1] - lon[i-1])
   sin lat[i]| (Chamberlain and Duquette, "Some algorithms for polygons on a sphere", JPL Publication 07-03, 2007).
   GeoJSON output: RFC 7946 (positions [lon, lat], a Polygon is an array of rings, outer ring first).
   No DOM is needed: parseXml reads the text itself, and fromDom turns a browser DOMParser document into the same
   tree, so this file loads in Node. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.DD = root.DD || {}).kml = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var R_EARTH = 6371.0;   // km, mean Earth radius (IUGG)
  var D2R = Math.PI / 180;

  // ---- XML into a small tree: {name (local name, prefix dropped), attrs, children, text} ----
  var ENT = { lt: "<", gt: ">", amp: "&", quot: "\"", apos: "'" };
  function decode(s) {
    return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, function (m, e) {
      if (e.charAt(0) === "#") {
        var n = e.charAt(1) === "x" || e.charAt(1) === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return isFinite(n) && n > 0 && n <= 0x10FFFF ? String.fromCodePoint(n) : m;
      }
      return ENT.hasOwnProperty(e) ? ENT[e] : m;
    });
  }
  function local(n) { var i = n.indexOf(":"); return i >= 0 ? n.slice(i + 1) : n; }

  /** Parses XML text. Handles the declaration, comments, CDATA, DOCTYPE, attributes and the five entities plus
   *  numeric ones. Throws on text that is not well formed. Returns the root element. */
  function parseXml(text) {
    if (typeof text !== "string") throw new Error("No KML text.");
    var root = { name: "#root", attrs: {}, children: [], text: "" }, stack = [root], i = 0, n = text.length;
    while (i < n) {
      var lt = text.indexOf("<", i);
      if (lt < 0) { stack[stack.length - 1].text += decode(text.slice(i)); break; }
      if (lt > i) stack[stack.length - 1].text += decode(text.slice(i, lt));
      if (text.startsWith("<!--", lt)) {
        var ce = text.indexOf("-->", lt + 4); if (ce < 0) throw new Error("Not well-formed XML: an unclosed comment.");
        i = ce + 3; continue;
      }
      if (text.startsWith("<![CDATA[", lt)) {
        var cd = text.indexOf("]]>", lt + 9); if (cd < 0) throw new Error("Not well-formed XML: an unclosed CDATA section.");
        stack[stack.length - 1].text += text.slice(lt + 9, cd); i = cd + 3; continue;
      }
      if (text.startsWith("<?", lt)) {
        var pe = text.indexOf("?>", lt + 2); if (pe < 0) throw new Error("Not well-formed XML: an unclosed declaration.");
        i = pe + 2; continue;
      }
      if (text.startsWith("<!", lt)) {   // DOCTYPE and the like (an internal subset in [] is skipped too)
        var depth = 0, j = lt + 2;
        for (; j < n; j++) { var ch = text.charAt(j); if (ch === "[") depth++; else if (ch === "]") depth--; else if (ch === ">" && depth <= 0) break; }
        i = j + 1; continue;
      }
      var gt = -1, q = null;
      for (var k = lt + 1; k < n; k++) {
        var c = text.charAt(k);
        if (q) { if (c === q) q = null; } else if (c === "\"" || c === "'") q = c; else if (c === ">") { gt = k; break; }
      }
      if (gt < 0) throw new Error("Not well-formed XML: a tag is never closed.");
      var body = text.slice(lt + 1, gt);
      if (body.charAt(0) === "/") {
        var endName = local(body.slice(1).trim());
        var top = stack.pop();
        if (!top || top === root || top.name !== endName) throw new Error("Not well-formed XML: </" + endName + "> does not match <" + (top ? top.name : "") + ">.");
      } else {
        var selfClose = body.charAt(body.length - 1) === "/";
        if (selfClose) body = body.slice(0, -1);
        var m = /^([^\s/>]+)/.exec(body);
        if (!m) throw new Error("Not well-formed XML: an empty tag.");
        var el = { name: local(m[1]), attrs: {}, children: [], text: "" };
        var re = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g, a;
        while ((a = re.exec(body.slice(m[1].length)))) el.attrs[local(a[1])] = decode(a[3] !== undefined ? a[3] : a[4]);
        stack[stack.length - 1].children.push(el);
        if (!selfClose) stack.push(el);
      }
      i = gt + 1;
    }
    if (stack.length !== 1) throw new Error("Not well-formed XML: <" + stack[stack.length - 1].name + "> is never closed.");
    if (root.children.length !== 1) throw new Error("Not well-formed XML: there must be exactly one root element.");
    return root.children[0];
  }

  /** The same tree from a browser DOM node (a DOMParser document or element). Duck-typed: needs only nodeType,
   *  localName or nodeName, attributes, childNodes and nodeValue. */
  function fromDom(node) {
    if (node && node.nodeType === 9) node = node.documentElement;
    if (!node || node.nodeType !== 1) throw new Error("No XML element.");
    var el = { name: local(node.localName || node.nodeName), attrs: {}, children: [], text: "" };
    var at = node.attributes || [];
    for (var i = 0; i < at.length; i++) el.attrs[local(at[i].localName || at[i].name)] = at[i].value;
    var kids = node.childNodes || [];
    for (var j = 0; j < kids.length; j++) {
      var k = kids[j];
      if (k.nodeType === 1) el.children.push(fromDom(k));
      else if (k.nodeType === 3 || k.nodeType === 4) el.text += k.nodeValue;
    }
    return el;
  }

  function kids(el, name) { return el.children.filter(function (c) { return c.name === name; }); }
  function kid(el, name) { return kids(el, name)[0] || null; }
  function textOf(el) { return el ? el.text + el.children.map(textOf).join("") : ""; }
  function descend(el, name, out) {
    out = out || [];
    el.children.forEach(function (c) { if (c.name === name) out.push(c); descend(c, name, out); });
    return out;
  }

  // ---- Coordinates and measures ----
  /** A KML coordinates string to [[lon, lat, alt?], ...]. Spaces after commas are tolerated. Throws on a tuple
   *  that is not numbers or is out of range. */
  function parseCoordinates(s) {
    var t = String(s || "").trim().replace(/\s*,\s*/g, ",");
    if (!t) return [];
    return t.split(/\s+/).map(function (tuple) {
      var p = tuple.split(",");
      if (p.length < 2 || p.length > 3) throw new Error("'" + tuple + "' is not longitude,latitude[,altitude].");
      var v = p.map(Number);
      if (!v.every(isFinite) || p.some(function (x) { return x === ""; })) throw new Error("'" + tuple + "' holds something that is not a number.");
      if (Math.abs(v[0]) > 180) throw new Error("Longitude " + v[0] + " in '" + tuple + "' is out of range.");
      if (Math.abs(v[1]) > 90) throw new Error("Latitude " + v[1] + " in '" + tuple + "' is out of range (is the file latitude,longitude instead of longitude,latitude?).");
      return v;
    });
  }

  function haversineKm(lat1, lon1, lat2, lon2) {
    var p1 = lat1 * D2R, p2 = lat2 * D2R, dp = (lat2 - lat1) * D2R, dl = (lon2 - lon1) * D2R;
    var a = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    a = Math.min(1, Math.max(0, a));
    return 2 * R_EARTH * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  /** Length of a path of [lon, lat] positions, km, summed segment by segment along great circles. */
  function pathLengthKm(coords) {
    var d = 0;
    for (var i = 1; i < coords.length; i++) d += haversineKm(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]);
    return d;
  }
  function wrapRad(x) { while (x > Math.PI) x -= 2 * Math.PI; while (x <= -Math.PI) x += 2 * Math.PI; return x; }
  /** Area enclosed by a ring of [lon, lat] positions on the sphere, km^2 (closing position optional). */
  function ringAreaKm2(ring) {
    var pts = ring.slice();
    if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
    var n = pts.length;
    if (n < 3) return 0;
    var sum = 0;
    for (var i = 0; i < n; i++) {
      var prev = pts[(i - 1 + n) % n], next = pts[(i + 1) % n];
      sum += wrapRad((next[0] - prev[0]) * D2R) * Math.sin(pts[i][1] * D2R);
    }
    return Math.abs(sum) * R_EARTH * R_EARTH / 2;
  }

  function closeRing(c, warn, what) {
    if (!c.length) return c;
    var a = c[0], b = c[c.length - 1];
    if (a[0] !== b[0] || a[1] !== b[1]) { c = c.concat([a.slice()]); warn(what + ": the ring was not closed, so it was closed."); }
    return c;
  }

  // ---- Placemarks into features ----
  /** Walks a KML tree. Returns {features, warnings, placemarks, networkLinks}. Each feature: {type: "Point" |
   *  "LineString" | "Polygon", name, description, folder, coordinates (GeoJSON order), and lengthKm, or
   *  perimeterKm and areaKm2}. Descriptions are kept as plain text; nothing in the file is run or fetched. */
  function extract(tree) {
    var out = { features: [], warnings: [], placemarks: 0, networkLinks: descend(tree, "NetworkLink").length };
    if (tree.name !== "kml" && tree.name !== "Document" && tree.name !== "Folder" && tree.name !== "Placemark") {
      throw new Error("This is XML but not KML (its root is <" + tree.name + ">).");
    }
    function walk(el, folder) {
      el.children.forEach(function (c) {
        if (c.name === "Document" || c.name === "Folder") {
          var nm = textOf(kid(c, "name")).trim();
          walk(c, nm ? (folder ? folder + " / " + nm : nm) : folder);
        } else if (c.name === "Placemark") placemark(c, folder);
      });
    }
    function placemark(pm, folder) {
      out.placemarks++;
      var name = textOf(kid(pm, "name")).trim() || "Unnamed placemark " + out.placemarks;
      var desc = textOf(kid(pm, "description")).trim();
      var before = out.features.length;
      var warn = function (w) { out.warnings.push(name + ": " + w); };
      function add(type, coordinates, extra) {
        var f = { type: type, name: name, description: desc, folder: folder || "", coordinates: coordinates };
        Object.keys(extra || {}).forEach(function (k) { f[k] = extra[k]; });
        out.features.push(f);
      }
      function geom(g) {
        try {
          if (g.name === "Point") {
            var p = parseCoordinates(textOf(kid(g, "coordinates")));
            if (p.length !== 1) throw new Error("a Point needs exactly one position, found " + p.length + ".");
            add("Point", p[0]);
          } else if (g.name === "LineString" || g.name === "LinearRing") {
            var l = parseCoordinates(textOf(kid(g, "coordinates")));
            if (g.name === "LinearRing") l = closeRing(l, warn, "LinearRing");
            if (l.length < 2) throw new Error("a line needs at least two positions.");
            add("LineString", l, { lengthKm: pathLengthKm(l) });
          } else if (g.name === "Polygon") {
            var ob = kid(g, "outerBoundaryIs");
            var outerRing = ob && kid(ob, "LinearRing");
            if (!outerRing) throw new Error("a Polygon has no outer boundary.");
            var rings = [closeRing(parseCoordinates(textOf(kid(outerRing, "coordinates"))), warn, "outer ring")];
            kids(g, "innerBoundaryIs").forEach(function (ib) {
              kids(ib, "LinearRing").forEach(function (lr) { rings.push(closeRing(parseCoordinates(textOf(kid(lr, "coordinates"))), warn, "inner ring")); });
            });
            if (rings.some(function (r) { return r.length < 4; })) throw new Error("a polygon ring needs at least three distinct positions.");
            var area = ringAreaKm2(rings[0]);
            for (var h = 1; h < rings.length; h++) area -= ringAreaKm2(rings[h]);
            add("Polygon", rings, { perimeterKm: pathLengthKm(rings[0]), areaKm2: Math.max(0, area), holes: rings.length - 1 });
          } else if (g.name === "MultiGeometry") {
            g.children.forEach(geom);
          } else if (g.name === "Track") {
            var t = kids(g, "coord").map(function (cEl) {
              var v = textOf(cEl).trim().split(/\s+/).map(Number);
              if (v.length < 2 || !v.every(isFinite) || Math.abs(v[0]) > 180 || Math.abs(v[1]) > 90) throw new Error("bad gx:coord '" + textOf(cEl).trim() + "'.");
              return v.slice(0, 3);
            });
            if (t.length >= 2) add("LineString", t, { lengthKm: pathLengthKm(t), track: true });
            else if (t.length === 1) add("Point", t[0]);
          } else if (g.name === "MultiTrack") {
            g.children.forEach(geom);
          }
        } catch (e) { warn(e.message.replace(/^\w/, function (x) { return x.toLowerCase(); }) + " Skipped."); }
      }
      pm.children.forEach(geom);
      if (out.features.length === before && !out.warnings.some(function (w) { return w.indexOf(name + ":") === 0; })) warn("no geometry this page can draw.");
    }
    if (tree.name === "Placemark") placemark(tree, "");
    else walk(tree, tree.name === "kml" ? "" : textOf(kid(tree, "name")).trim());
    return out;
  }

  /** Text to features in one call (Node and tests; the page uses DOMParser and fromDom). */
  function parseKml(text) { return extract(parseXml(text)); }

  /** Which file inside a KMZ is the main KML: doc.kml at the root, else the first .kml at the root, else the
   *  first .kml anywhere. Null if there is none. */
  function pickKmlEntry(names) {
    var kmls = (names || []).filter(function (n) { return /\.kml$/i.test(n) && !/\/$/.test(n); });
    var rootOnes = kmls.filter(function (n) { return n.indexOf("/") < 0; });
    var doc = rootOnes.filter(function (n) { return n.toLowerCase() === "doc.kml"; })[0];
    return doc || rootOnes[0] || kmls[0] || null;
  }

  /** Features as an RFC 7946 GeoJSON FeatureCollection. */
  function toGeoJSON(features) {
    return {
      type: "FeatureCollection",
      features: (features || []).map(function (f) {
        var props = { name: f.name, description: f.description, folder: f.folder };
        if (f.lengthKm !== undefined) props.lengthKm = Number(f.lengthKm.toFixed(3));
        if (f.areaKm2 !== undefined) { props.areaKm2 = Number(f.areaKm2.toFixed(3)); props.perimeterKm = Number(f.perimeterKm.toFixed(3)); }
        return { type: "Feature", geometry: { type: f.type, coordinates: f.coordinates }, properties: props };
      })
    };
  }

  /** [lat, lon] pairs for Leaflet from GeoJSON-order positions. */
  function latLngs(coords) { return coords.map(function (c) { return [c[1], c[0]]; }); }

  return { parseXml: parseXml, fromDom: fromDom, parseCoordinates: parseCoordinates, haversineKm: haversineKm,
    pathLengthKm: pathLengthKm, ringAreaKm2: ringAreaKm2, extract: extract, parseKml: parseKml,
    pickKmlEntry: pickKmlEntry, toGeoJSON: toGeoJSON, latLngs: latLngs, R_EARTH: R_EARTH };
});

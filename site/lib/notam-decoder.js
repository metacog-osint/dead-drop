/* NOTAM decoder: reads an ICAO-format NOTAM that a user pastes, field by field, and finds the geometry in it.
   Pure functions, no DOM, no network.

   References:
   - Format, Q line and items A-G: ICAO PANS-AIM (Doc 10066), Appendix 3, "NOTAM format", and the NOTAM Code and
     its use in ICAO Doc 8126, Aeronautical Information Services Manual (NOTAM chapter and its NOTAM Code appendix).
   - The NOTAM Code (the Q code's subject and condition letters) and the abbreviations: ICAO Doc 8400, Procedures
     for Air Navigation Services, ICAO Abbreviations and Codes (PANS-ABC), Part on the NOTAM Code.
   - Great-circle distance and destination point (for the circles): Chris Veness, "Calculate distance, bearing and
     more between latitude/longitude points", movable-type.co.uk; sphere of mean radius 6,371 km.
   The tables below are a transcription of the subject and condition codes. National practice adds local codes,
   and the codes are amended from time to time; an unknown code is reported, not guessed at. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.DD = root.DD || {}).notamDecoder = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var R_EARTH_M = 6371000;          // mean Earth radius (IUGG)
  var NM_M = 1852;                  // 1 nautical mile, exact
  var D2R = Math.PI / 180;

  // ---- NOTAM Code, Doc 8400: subject (2nd and 3rd letters of the Q code) -----------------------------------------
  var SUBJECT_GROUPS = {
    L: "Lighting facilities (aerodromes)", M: "Movement and landing area (aerodromes)",
    F: "Facilities and services (aerodromes)", C: "Communications and surveillance facilities",
    I: "Instrument and microwave landing systems", G: "GNSS services", N: "Terminal and en-route navigation facilities",
    A: "Airspace organization", S: "Air traffic and VOLMET services", P: "Air traffic procedures",
    R: "Airspace restrictions (navigation warnings)", W: "Warnings (navigation warnings)", O: "Other information",
    X: "Other (plain language)", K: "Checklist"
  };
  var SUBJECTS = {
    LA: "Approach lighting system", LB: "Aerodrome beacon", LC: "Runway centre line lights",
    LD: "Landing direction indicator lights", LE: "Runway edge lights", LF: "Sequenced flashing lights",
    LG: "Pilot-controlled lighting", LH: "High intensity runway lights", LI: "Runway end identifier lights",
    LJ: "Runway alignment indicator lights", LK: "Category II components of approach lighting system",
    LL: "Low intensity runway lights", LM: "Medium intensity runway lights",
    LP: "Precision approach path indicator (PAPI)", LR: "All landing area lighting facilities", LS: "Stopway lights",
    LT: "Threshold lights", LU: "Helicopter approach path indicator", LV: "Visual approach slope indicator system (VASIS)",
    LW: "Heliport lighting", LX: "Taxiway centre line lights", LY: "Taxiway edge lights",
    LZ: "Runway touchdown zone lights",
    MA: "Movement area", MB: "Bearing strength", MC: "Clearway", MD: "Declared distances",
    MG: "Taxiing guidance system", MH: "Runway arresting gear", MK: "Parking area", MM: "Daylight markings",
    MN: "Apron", MO: "Stopbar", MP: "Aircraft stands", MR: "Runway", MS: "Stopway", MT: "Threshold",
    MU: "Runway turning bay", MW: "Strip or shoulder", MX: "Taxiway(s)", MY: "Rapid exit taxiway",
    FA: "Aerodrome", FB: "Friction measuring device", FC: "Ceiling measurement equipment", FD: "Docking system",
    FE: "Oxygen", FF: "Fire fighting and rescue", FG: "Ground movement control", FH: "Helicopter alighting area or platform",
    FI: "Aircraft de-icing", FJ: "Oils", FL: "Landing direction indicator", FM: "Meteorological service",
    FO: "Fog dispersal system", FP: "Heliport", FS: "Snow removal equipment", FT: "Transmissometer",
    FU: "Fuel availability", FW: "Wind direction indicator", FZ: "Customs and immigration",
    CA: "Air/ground facility", CB: "Automatic dependent surveillance - broadcast (ADS-B)",
    CC: "Automatic dependent surveillance - contract (ADS-C)", CD: "Controller-pilot data link communications (CPDLC)",
    CE: "En-route surveillance radar", CG: "Ground controlled approach system (GCA)",
    CL: "Selective calling system (SELCAL)", CM: "Surface movement radar", CP: "Precision approach radar (PAR)",
    CR: "Surveillance radar element of precision approach radar system", CS: "Secondary surveillance radar (SSR)",
    CT: "Terminal area surveillance radar (TAR)",
    IC: "Instrument landing system (ILS)", ID: "DME associated with ILS", IG: "Glide path (ILS)",
    II: "Inner marker (ILS)", IL: "Localizer (ILS)", IM: "Middle marker (ILS)", IN: "Localizer (not associated with ILS)",
    IO: "Outer marker (ILS)", IS: "ILS Category I", IT: "ILS Category II", IU: "ILS Category III",
    IW: "Microwave landing system (MLS)", IX: "Locator, outer (ILS)", IY: "Locator, middle (ILS)",
    GA: "GNSS airfield-specific operations", GW: "GNSS area-wide operations",
    NA: "All radio navigation facilities", NB: "Non-directional radio beacon (NDB)", NC: "DECCA",
    ND: "Distance measuring equipment (DME)", NF: "Fan marker", NL: "Locator", NM: "VOR/DME", NN: "TACAN",
    NO: "OMEGA", NT: "VORTAC", NV: "VOR", NX: "Direction-finding station",
    AA: "Minimum altitude", AC: "Control zone", AD: "Air defence identification zone (ADIZ)", AE: "Control area",
    AF: "Flight information region (FIR)", AH: "Upper control area", AL: "Minimum usable flight level",
    AN: "Area navigation route", AO: "Oceanic control area", AP: "Reporting point", AR: "ATS route",
    AT: "Terminal control area (TMA)", AU: "Upper flight information region", AV: "Upper advisory area",
    AX: "Significant point", AZ: "Aerodrome traffic zone (ATZ)",
    SA: "Automatic terminal information service (ATIS)", SB: "ATS reporting office", SC: "Area control centre",
    SE: "Flight information service", SF: "Aerodrome flight information service", SL: "Flow control centre",
    SO: "Oceanic area control centre", SP: "Approach control service", SS: "Flight service station",
    ST: "Aerodrome control tower", SU: "Upper area control centre", SV: "VOLMET broadcast", SY: "Upper advisory service",
    PA: "Standard instrument arrival (STAR)", PB: "Standard VFR arrival", PC: "Contingency procedures",
    PD: "Standard instrument departure (SID)", PE: "Standard VFR departure", PF: "Flow control procedure",
    PH: "Holding procedure", PI: "Instrument approach procedure", PK: "VFR approach procedure",
    PL: "Flight plan processing", PM: "Aerodrome operating minima", PN: "Noise operating restriction",
    PO: "Obstacle clearance altitude and height", PR: "Radio failure procedure",
    PT: "Transition altitude or transition level", PU: "Missed approach procedure", PX: "Minimum holding altitude",
    PZ: "ADIZ procedure",
    RA: "Airspace reservation", RD: "Danger area", RM: "Military operating area", RO: "Overflying of",
    RP: "Prohibited area", RR: "Restricted area", RT: "Temporary restricted area",
    WA: "Air display", WB: "Aerobatics", WC: "Captive balloon or kite", WD: "Demolition of explosives",
    WE: "Exercises", WF: "Air refuelling", WG: "Glider flying", WH: "Blasting", WJ: "Banner or target towing",
    WL: "Ascent of free balloon", WM: "Missile, gun or rocket firing",
    WP: "Parachute jumping exercise, paragliding or hang gliding", WR: "Radioactive materials or toxic chemicals",
    WS: "Burning or blowing gas", WT: "Mass movement of aircraft", WU: "Unmanned aircraft", WV: "Formation flight",
    WW: "Significant volcanic activity", WZ: "Model flying",
    OA: "Aeronautical information service", OB: "Obstacle", OE: "Aircraft entry requirements",
    OL: "Obstacle lights on", OR: "Rescue coordination centre",
    XX: "Plain language: the subject is given in item E", KK: "Checklist"
  };
  // ---- condition (4th and 5th letters) ----------------------------------------------------------------------------
  var CONDITION_GROUPS = { A: "Availability", C: "Changes", H: "Hazard conditions", L: "Limitations", X: "Other",
    T: "Trigger NOTAM", K: "Checklist" };
  var CONDITIONS = {
    AC: "Withdrawn for maintenance", AD: "Available for daylight operation", AF: "Flight checked and found reliable",
    AG: "Operating but ground checked only, awaiting flight check", AH: "Hours of service are now",
    AK: "Resumed normal operation", AL: "Operative (or re-operative) subject to previously published limitations or conditions",
    AM: "Military operations only", AN: "Available for night operation", AO: "Operational",
    AP: "Available, prior permission required", AR: "Available on request", AS: "Unserviceable",
    AU: "Not available", AW: "Completely withdrawn", AX: "Previously promulgated shutdown has been cancelled",
    CA: "Activated", CC: "Completed", CD: "Deactivated", CE: "Erected", CF: "Operating frequency(ies) changed to",
    CG: "Downgraded to", CH: "Changed", CI: "Identification or radio call sign changed to", CL: "Realigned",
    CM: "Displaced", CN: "Cancelled", CO: "Operating", CP: "Operating on reduced power", CR: "Temporarily replaced by",
    CS: "Installed", CT: "On test, do not use",
    HA: "Braking action is", HB: "Friction coefficient is", HC: "Covered by compacted snow to a depth of",
    HD: "Covered by dry snow to a depth of", HE: "Covered by water to a depth of", HF: "Totally free of snow and ice",
    HG: "Grass cutting in progress", HH: "Hazard due to", HI: "Covered by ice", HJ: "Launch planned",
    HK: "Bird migration in progress", HL: "Snow clearance completed", HM: "Marked by",
    HN: "Covered by wet snow or slush to a depth of", HO: "Obscured by snow", HP: "Snow clearance in progress",
    HQ: "Operation cancelled", HR: "Standing water", HS: "Sanding in progress",
    HT: "Approach according to signal area only", HU: "Launch in progress", HV: "Work completed",
    HW: "Work in progress", HX: "Concentration of birds", HY: "Snow banks exist",
    HZ: "Covered by frozen ruts and ridges",
    LA: "Operating on auxiliary power supply", LB: "Reserved for aircraft based therein", LC: "Closed",
    LD: "Unsafe", LE: "Operating without auxiliary power supply", LF: "Interference from",
    LG: "Operating without identification", LH: "Unserviceable for aircraft heavier than",
    LI: "Closed to IFR operations", LK: "Operating as a fixed light", LL: "Usable for length of ... and width of ...",
    LN: "Closed to all night operations", LP: "Prohibited to", LR: "Aircraft restricted to runways and taxiways",
    LS: "Subject to interruption", LT: "Limited to", LV: "Closed to VFR operations", LW: "Will take place",
    LX: "Operating but caution advised due to",
    XX: "Plain language: the condition is given in item E", TT: "Trigger NOTAM: points to a published amendment",
    KK: "Checklist"
  };
  var TRAFFIC = { I: "IFR (instrument flight rules)", V: "VFR (visual flight rules)", K: "Checklist" };
  var PURPOSE = { N: "For the immediate attention of aircraft operators", B: "For pre-flight information bulletins",
    O: "Significant for flight operations", M: "Miscellaneous: not for briefing, but available on request",
    K: "Checklist" };
  var SCOPE = { A: "Aerodrome", E: "En route", W: "Navigation warning", K: "Checklist" };
  var TYPES = { N: "New NOTAM", R: "Replacing NOTAM: replaces the one it names", C: "Cancelling NOTAM: cancels the one it names" };

  // A selection of ICAO abbreviations (Doc 8400) common in item E.
  var ABBREVIATIONS = {
    ABV: "above", ACFT: "aircraft", ACT: "active or activated", AD: "aerodrome", ADJ: "adjacent",
    AGL: "above ground level", AIP: "aeronautical information publication", ALT: "altitude",
    AMDT: "amendment", AMSL: "above mean sea level", APCH: "approach", APN: "apron", ARP: "aerodrome reference point",
    ARR: "arrival", ATC: "air traffic control", AVBL: "available", AWY: "airway", BLW: "below", BTN: "between",
    CL: "centre line", CLSD: "closed", CNL: "cancel or cancelled", COORD: "coordinates", CTA: "control area",
    CTN: "caution", CTR: "control zone", DEP: "departure", DLY: "daily", DME: "distance measuring equipment",
    ELEV: "elevation", EST: "estimated", EXC: "except", FIR: "flight information region", FL: "flight level",
    FLT: "flight", FM: "from", FREQ: "frequency", FRNG: "firing", FT: "feet", GND: "ground",
    GNSS: "global navigation satellite system", H24: "continuous day and night service", HEL: "helicopter",
    HGT: "height", HJ: "sunrise to sunset", HN: "sunset to sunrise", HR: "hours", ILS: "instrument landing system",
    INFO: "information", LDG: "landing", LEN: "length", LGT: "lighting or lighted", MAINT: "maintenance",
    MAX: "maximum", MIL: "military", MNM: "minimum", NAV: "navigation", NDB: "non-directional radio beacon",
    NM: "nautical miles", NR: "number", OBST: "obstacle", OPS: "operations", PERM: "permanent",
    PJE: "parachute jumping exercise", PPR: "prior permission required", PSN: "position", RAD: "radius",
    REF: "reference to", RMK: "remark", RTE: "route", RWY: "runway", SFC: "surface", SID: "standard instrument departure",
    SR: "sunrise", SS: "sunset", STAR: "standard instrument arrival", TEMPO: "temporary or temporarily",
    THR: "threshold", TIL: "until", TKOF: "take-off", TMA: "terminal control area", TWR: "aerodrome control tower",
    TWY: "taxiway", "U/S": "unserviceable", UAS: "unmanned aircraft system", UFN: "until further notice",
    UNL: "unlimited", UTC: "coordinated universal time", VIS: "visibility", VOR: "VHF omnidirectional radio range",
    WEF: "with effect from", WI: "within", WID: "width", WIE: "with immediate effect", WIP: "work in progress",
    MON: "Monday", TUE: "Tuesday", WED: "Wednesday", THU: "Thursday", FRI: "Friday", SAT: "Saturday", SUN: "Sunday",
    JAN: "January", FEB: "February", MAR: "March", APR: "April", JUN: "June", JUL: "July", AUG: "August",
    SEP: "September", OCT: "October", NOV: "November", DEC: "December"
  };

  // ---- small helpers ----------------------------------------------------------------------------------------------
  function pad(n, w) { return ("0000" + n).slice(-w); }

  /** "2612010800" (YYMMDDhhmm, UTC) to an ISO string, or throws with the reason. */
  function parseDateTime(s) {
    var m = /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(s);
    if (!m) throw new Error("\"" + s + "\" is not a date-time in the form YYMMDDhhmm (ten digits, UTC).");
    var y = 2000 + Number(m[1]), mo = Number(m[2]), d = Number(m[3]), h = Number(m[4]), mi = Number(m[5]);
    if (mo < 1 || mo > 12) throw new Error("\"" + s + "\": month " + m[2] + " does not exist.");
    if (h === 24 && mi === 0) throw new Error("\"" + s + "\": NOTAMs write the end of a day as 2359, not 2400.");
    if (h > 23 || mi > 59) throw new Error("\"" + s + "\": time " + m[4] + m[5] + " is not a valid hhmm.");
    var t = Date.UTC(y, mo - 1, d, h, mi);
    if (new Date(t).getUTCDate() !== d || d < 1) throw new Error("\"" + s + "\": day " + m[3] + " does not exist in that month.");
    return new Date(t).toISOString().replace(".000Z", "Z");
  }

  /** Degrees from a coordinate's digits. latitude: "DDMM", "DDMMSS", optional decimals; longitude "DDDMM", "DDDMMSS". */
  function dmsToDeg(digits, frac, hemi, isLat) {
    var dw = isLat ? 2 : 3;
    var n = digits.length - dw;                 // 2: minutes only; 4: minutes and seconds
    var deg = Number(digits.slice(0, dw));
    var min = Number(digits.slice(dw, dw + 2)) + (n === 2 && frac ? Number("0." + frac) : 0);
    var sec = n === 4 ? Number(digits.slice(dw + 2, dw + 4)) + (frac ? Number("0." + frac) : 0) : 0;
    if (min >= 60) throw new Error("minutes " + digits.slice(dw, dw + 2) + " must be under 60");
    if (sec >= 60) throw new Error("seconds " + digits.slice(dw + 2, dw + 4) + " must be under 60");
    var v = deg + min / 60 + sec / 3600;
    if (isLat ? v > 90 : v > 180) throw new Error((isLat ? "latitude" : "longitude") + " beyond " + (isLat ? 90 : 180) + "°");
    return (hemi === "S" || hemi === "W") ? -v : v;
  }

  // Hemisphere last: 4530N01230E, 453012N0123045E, 4530.50N01230.25E, 453012N 0123045E.
  // Hemisphere first: N453012E0123045.
  var COORD_RE = new RegExp(
    "(?<![0-9A-Z.])(\\d{4}|\\d{6})(?:\\.(\\d+))?([NS])\\s?\\/?\\s?(\\d{5}|\\d{7})(?:\\.(\\d+))?([EW])(?![A-Z0-9])" +
    "|(?<![0-9A-Z])([NS])(\\d{4}|\\d{6})(?:\\.(\\d+))?\\s?\\/?\\s?([EW])(\\d{5}|\\d{7})(?:\\.(\\d+))?(?![0-9])", "g");

  /** Every coordinate pair in a text: [{lat, lon, raw, index, end}] plus problems for ones that look like
   *  coordinates but are not valid. */
  function findCoordinates(text) {
    var out = [], problems = [], m;
    COORD_RE.lastIndex = 0;
    while ((m = COORD_RE.exec(text)) !== null) {
      try {
        var lat, lon;
        if (m[1]) { lat = dmsToDeg(m[1], m[2], m[3], true); lon = dmsToDeg(m[4], m[5], m[6], false); }
        else { lat = dmsToDeg(m[8], m[9], m[7], true); lon = dmsToDeg(m[11], m[12], m[10], false); }
        out.push({ lat: lat, lon: lon, raw: m[0], index: m.index, end: m.index + m[0].length });
      } catch (e) {
        problems.push("Coordinate \"" + m[0] + "\" skipped: " + e.message + ".");
      }
    }
    return { points: out, problems: problems };
  }

  var JOIN_RE = /^\s*(?:-|–|,|;|TO|AND|THEN)?\s*$/;
  var RADIUS_RES = [
    /RADIUS\s+(?:OF\s+)?(\d+(?:\.\d+)?)\s?(NM|KM|M)\b/g,
    /(\d+(?:\.\d+)?)\s?(NM|KM|M)\s+RADIUS/g,
    /\bWI\s+(\d+(?:\.\d+)?)\s?(NM|KM|M)\s+OF\b/g
  ];
  function toNm(v, unit) { return unit === "NM" ? v : unit === "KM" ? v * 1000 / NM_M : v / NM_M; }

  /** Groups the coordinates in item E into polygons (3 or more points in a run), lines (2), circles (a point with a
   *  radius nearby) and single points. */
  function extractGeometry(text) {
    var found = findCoordinates(text);
    var pts = found.points, groups = [];
    pts.forEach(function (p, i) {
      if (i > 0 && JOIN_RE.test(text.slice(pts[i - 1].end, p.index))) groups[groups.length - 1].push(p);
      else groups.push([p]);
    });
    var features = [];
    groups.forEach(function (g, gi) {
      var verts = g.slice();
      if (verts.length >= 4 && verts[0].lat === verts[verts.length - 1].lat && verts[0].lon === verts[verts.length - 1].lon) {
        verts.pop();                            // the closing repeat of the first point
      }
      if (verts.length >= 3) {
        features.push({ kind: "polygon", points: verts.map(ll), raw: g.map(function (p) { return p.raw; }) });
      } else if (verts.length === 2) {
        features.push({ kind: "line", points: verts.map(ll), raw: g.map(function (p) { return p.raw; }) });
      } else {
        // Look for a radius in the same sentence only, and not past the neighbouring coordinates.
        var p = verts[0];
        var lo = Math.max(gi > 0 ? groups[gi - 1][groups[gi - 1].length - 1].end : 0, p.index - 120, sentenceStart(text, p.index));
        var hi = Math.min(gi < groups.length - 1 ? groups[gi + 1][0].index : text.length, p.end + 120, sentenceEnd(text, p.end));
        var best = null;
        RADIUS_RES.forEach(function (re) {
          re.lastIndex = 0;
          var w = text.slice(lo, hi), mm;
          while ((mm = re.exec(w)) !== null) {
            var at = lo + mm.index, gap = at < p.index ? p.index - (at + mm[0].length) : at - p.end;
            if (!best || gap < best.gap) best = { gap: gap, nm: toNm(Number(mm[1]), mm[2]), raw: mm[0] };
          }
        });
        if (best) features.push({ kind: "circle", centre: ll(p), radiusNm: best.nm, raw: [p.raw, best.raw] });
        else features.push({ kind: "point", points: [ll(p)], raw: [p.raw] });
      }
    });
    return { features: features, problems: found.problems };
  }
  function ll(p) { return { lat: p.lat, lon: p.lon }; }
  // A sentence ends at a full stop followed by a space, a line break or the end (not a decimal point).
  function sentenceStart(text, i) {
    var re = /\.(?=\s|$)/g, m, at = 0;
    while ((m = re.exec(text)) !== null && m.index < i) at = m.index + 1;
    return at;
  }
  function sentenceEnd(text, i) {
    var re = /\.(?=\s|$)/g, m;
    re.lastIndex = i;
    m = re.exec(text);
    return m ? m.index : text.length;
  }

  /** Great-circle distance in NM (haversine, Veness). */
  function distanceNm(a, b) {
    var p1 = a.lat * D2R, p2 = b.lat * D2R, dp = p2 - p1, dl = (b.lon - a.lon) * D2R;
    var h = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    return 2 * R_EARTH_M * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)) / NM_M;
  }
  /** Point reached from (lat, lon) after distNm on initial bearing brgDeg (Veness, destination point). */
  function destination(lat, lon, brgDeg, distNm) {
    var d = distNm * NM_M / R_EARTH_M, p1 = lat * D2R, l1 = lon * D2R, t = brgDeg * D2R;
    var p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(t));
    var l2 = l1 + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
    return { lat: p2 / D2R, lon: ((l2 / D2R + 540) % 360) - 180 };
  }
  /** A circle as n points, each radiusNm from the centre along the great circle. */
  function circlePolygon(lat, lon, radiusNm, n) {
    n = n || 72;
    var out = [];
    for (var i = 0; i < n; i++) out.push(destination(lat, lon, i * 360 / n, radiusNm));
    return out;
  }

  // ---- Q line -----------------------------------------------------------------------------------------------------
  function decodeQCode(code) {
    var out = { code: code, subject: null, subjectGroup: null, condition: null, conditionGroup: null };
    if (!/^Q[A-Z]{4}$/.test(code)) return out;
    var s = code.slice(1, 3), c = code.slice(3, 5);
    out.subjectCode = s; out.conditionCode = c;
    out.subject = SUBJECTS[s] || null;
    out.subjectGroup = out.subject ? SUBJECT_GROUPS[s.charAt(0)] || null : null;
    out.condition = CONDITIONS[c] || null;
    out.conditionGroup = out.condition ? CONDITION_GROUPS[c.charAt(0)] || null : null;
    return out;
  }
  function letters(str, table, what, errors) {
    var out = [];
    if (!str) errors.push(what + " is missing.");
    str.split("").forEach(function (ch) {
      if (table[ch]) out.push(table[ch]); else errors.push(what + " letter \"" + ch + "\" is not one of " + Object.keys(table).join(", ") + ".");
    });
    return out;
  }

  function parseQLine(q, errors, warnings) {
    var f = q.replace(/\s+/g, "").split("/");
    var out = { raw: q.trim() };
    if (f.length !== 8) {
      errors.push("Q line: expected 8 fields separated by \"/\" (FIR/code/traffic/purpose/scope/lower/upper/position), found " + f.length + ".");
    }
    var fir = f[0] || "";
    out.fir = fir;
    if (!/^[A-Z]{4}$/.test(fir)) errors.push("Q line: FIR \"" + fir + "\" is not a four-letter ICAO location indicator.");
    else if (/XX$/.test(fir)) warnings.push("Q line: FIR \"" + fir + "\" ends in XX, the form for a NOTAM covering more than one FIR of a state; item A lists them.");
    var code = f[1] || "";
    out.qcode = decodeQCode(code);
    if (!/^Q[A-Z]{4}$/.test(code)) errors.push("Q line: NOTAM code \"" + code + "\" is not Q plus four letters.");
    else {
      if (!out.qcode.subject) warnings.push("Q line: subject \"" + out.qcode.subjectCode + "\" is not in the NOTAM Code table here.");
      if (!out.qcode.condition) warnings.push("Q line: condition \"" + out.qcode.conditionCode + "\" is not in the NOTAM Code table here.");
    }
    if (f.length > 2) {
      out.traffic = letters(f[2], TRAFFIC, "Q line traffic", errors);
      out.purpose = letters(f[3] || "", PURPOSE, "Q line purpose", errors);
      out.scope = letters(f[4] || "", SCOPE, "Q line scope", errors);
      out.trafficCode = f[2]; out.purposeCode = f[3]; out.scopeCode = f[4];
    }
    if (f.length > 6) {
      if (/^\d{3}$/.test(f[5]) && /^\d{3}$/.test(f[6])) {
        out.lowerFL = Number(f[5]); out.upperFL = Number(f[6]);
        if (out.lowerFL > out.upperFL) errors.push("Q line: lower limit FL" + f[5] + " is above the upper limit FL" + f[6] + ".");
      } else {
        errors.push("Q line: lower and upper limits must be three-digit flight levels (got \"" + f[5] + "\" and \"" + f[6] + "\").");
      }
    }
    if (f.length > 7) {
      var m = /^(\d{2})(\d{2})([NS])(\d{3})(\d{2})([EW])(\d{3})$/.exec(f[7]);
      if (!m) errors.push("Q line: position \"" + f[7] + "\" is not DDMM[N|S]DDDMM[E|W] plus a three-digit radius in NM.");
      else {
        try {
          out.centre = { lat: dmsToDeg(m[1] + m[2], "", m[3], true), lon: dmsToDeg(m[4] + m[5], "", m[6], false) };
          out.radiusNm = Number(m[7]);
          if (out.radiusNm === 0) errors.push("Q line: radius 000 NM; the smallest radius is 001.");
          if (out.radiusNm === 999) warnings.push("Q line: radius 999 NM is the convention for a NOTAM that covers a whole FIR or more; the circle is not a boundary.");
        } catch (e) {
          errors.push("Q line: position \"" + f[7] + "\": " + e.message + ".");
        }
      }
    }
    return out;
  }

  /** Item F or G: a vertical limit in words. */
  function describeLimit(s) {
    var t = s.replace(/\s+/g, " ").trim(), m;
    if (/^(SFC|GND)$/.test(t)) return t === "SFC" ? "Surface" : "Ground";
    if (t === "UNL") return "Unlimited";
    if ((m = /^FL\s?(\d{2,3})$/.exec(t))) return "Flight level " + Number(m[1]) + " (about " + (Number(m[1]) * 100).toLocaleString("en-US") + " ft on the standard pressure setting)";
    if ((m = /^(\d+)\s?(FT|M)\s?(AMSL|AGL|MSL)$/.exec(t))) {
      return Number(m[1]).toLocaleString("en-US") + (m[2] === "FT" ? " ft" : " m") +
        (m[3] === "AGL" ? " above ground level" : " above mean sea level");
    }
    return null;
  }

  var ORDER = "QABCDEFG";
  /** Splits the body into items Q) and A) to G), taking each label only in order so an "A)" inside item E is text. */
  function splitItems(body) {
    var re = /(^|[\s(])([QABCDEFG])\)/g, m, marks = [], lastIdx = -1;
    while ((m = re.exec(body)) !== null) {
      var k = ORDER.indexOf(m[2]);
      if (k > lastIdx) { marks.push({ key: m[2], start: m.index + m[1].length, valueStart: re.lastIndex }); lastIdx = k; }
    }
    var items = {};
    marks.forEach(function (mk, i) {
      items[mk.key] = body.slice(mk.valueStart, i + 1 < marks.length ? marks[i + 1].start : body.length).trim();
    });
    return { items: items, firstAt: marks.length ? marks[0].start : body.length };
  }

  /** The whole NOTAM. now (optional, ms or Date) lets the result say whether it is in force at that moment. */
  function parse(text, now) {
    var errors = [], warnings = [];
    var s = String(text == null ? "" : text).replace(/\r\n?/g, "\n").trim().toUpperCase();
    if (!s) throw new Error("Paste a NOTAM first.");
    if (/^!/.test(s)) {
      throw new Error("This looks like a US domestic-format NOTAM (it starts with \"!\"). The decoder reads the ICAO format, with a Q line and items A) to G).");
    }
    if (s.charAt(0) === "(" && s.charAt(s.length - 1) === ")") s = s.slice(1, -1).trim();
    else if (s.charAt(0) === "(") { s = s.slice(1).trim(); warnings.push("The NOTAM opens with \"(\" but has no closing \")\"; it may be cut short."); }

    var out = { header: null, q: null, items: {}, a: null, b: null, c: null, d: null, e: null, f: null, g: null,
      geometry: { qCircle: null, features: [] }, abbreviations: [], errors: errors, warnings: warnings };

    var sp = splitItems(s);
    var head = s.slice(0, sp.firstAt).replace(/\s+/g, " ").trim();
    var hm = /^([A-Z])(\d{4})\/(\d{2}) NOTAM([NRC])(?: ([A-Z])(\d{4})\/(\d{2}))?$/.exec(head);
    if (!hm) {
      errors.push("First line: \"" + head + "\" is not a NOTAM header such as \"A1234/26 NOTAMN\" or \"A1235/26 NOTAMR A1234/26\".");
    } else {
      out.header = { id: hm[1] + hm[2] + "/" + hm[3], series: hm[1], number: Number(hm[2]), year: 2000 + Number(hm[3]),
        type: hm[4], typeText: TYPES[hm[4]], refersTo: hm[5] ? hm[5] + hm[6] + "/" + hm[7] : null };
      if (hm[4] !== "N" && !hm[5]) errors.push("A NOTAM" + hm[4] + " must name the NOTAM it " + (hm[4] === "R" ? "replaces" : "cancels") + ".");
      if (hm[4] === "N" && hm[5]) errors.push("A new NOTAM (NOTAMN) does not refer to another NOTAM.");
    }
    var it = sp.items;
    out.items = it;
    ["Q", "A", "B", "E"].forEach(function (k) { if (!(k in it)) errors.push("Item " + k + ") is missing; every NOTAM has it."); });
    if (!("C" in it) && !(out.header && out.header.type === "C")) errors.push("Item C) is missing; only a cancelling NOTAM leaves it out.");

    if (it.Q) out.q = parseQLine(it.Q, errors, warnings);
    if (it.A) {
      out.a = it.A.split(/\s+/).filter(Boolean);
      out.a.forEach(function (x) { if (!/^[A-Z]{4}$/.test(x)) errors.push("Item A: \"" + x + "\" is not a four-letter ICAO location indicator."); });
    }
    if (it.B) {
      try { out.b = { raw: it.B, iso: parseDateTime(it.B.replace(/\s+/g, "")) }; }
      catch (e) { errors.push("Item B: " + e.message); out.b = { raw: it.B, iso: null }; }
    }
    if (it.C) {
      var c = it.C.replace(/\s+/g, "");
      if (c === "PERM") out.c = { raw: it.C, iso: null, perm: true, est: false };
      else {
        var cm = /^(\d{10})(EST)?$/.exec(c);
        out.c = { raw: it.C, iso: null, perm: false, est: !!(cm && cm[2]) };
        if (!cm) errors.push("Item C: \"" + it.C + "\" is not YYMMDDhhmm, YYMMDDhhmm EST, or PERM.");
        else {
          try { out.c.iso = parseDateTime(cm[1]); } catch (e) { errors.push("Item C: " + e.message); }
        }
      }
      if (out.b && out.b.iso && out.c.iso && out.c.iso <= out.b.iso) errors.push("Item C (end) is not after item B (start).");
    }
    if (it.D) out.d = it.D.replace(/\s+/g, " ");
    if (it.E) {
      out.e = it.E;
      var g = extractGeometry(it.E);
      out.geometry.features = g.features;
      g.problems.forEach(function (p) { warnings.push("Item E: " + p); });
      var seen = {};
      it.E.split(/[^A-Z0-9/]+/).forEach(function (w) {
        w = w.replace(/^\d+(?:\.\d+)?(?=[A-Z])/, "");      // "5NM" -> "NM", "4000FT" -> "FT"
        if (ABBREVIATIONS[w] && !seen[w]) { seen[w] = 1; out.abbreviations.push({ abbr: w, meaning: ABBREVIATIONS[w] }); }
      });
    }
    ["F", "G"].forEach(function (k) {
      if (it[k]) out[k.toLowerCase()] = { raw: it[k].replace(/\s+/g, " "), text: describeLimit(it[k]) };
    });
    if (out.q && out.q.centre) {
      out.geometry.qCircle = { centre: out.q.centre, radiusNm: out.q.radiusNm };
      if (out.q.radiusNm && out.q.radiusNm < 999) {
        // The Q position is rounded to whole minutes (up to about 0.7 NM off), so allow 1 NM.
        out.geometry.features.forEach(function (ft) {
          var pts = ft.kind === "circle" ? [ft.centre] : ft.points;
          pts.forEach(function (p) {
            var dnm = distanceNm(out.q.centre, p) + (ft.kind === "circle" ? ft.radiusNm : 0);
            if (dnm > out.q.radiusNm + 1) {
              warnings.push("Item E " + ft.kind + " reaches " + dnm.toFixed(1) + " NM from the Q-line centre, beyond its " + out.q.radiusNm + " NM radius.");
            }
          });
        });
      }
    }
    if (now !== undefined && out.b && out.b.iso) {
      var t = new Date(now).getTime(), tb = Date.parse(out.b.iso);
      var tc = out.c && out.c.iso ? Date.parse(out.c.iso) : null;
      out.status = t < tb ? "not yet in force" : (tc !== null && t > tc) ? (out.c.est ? "past its estimated end" : "expired")
        : "in force";
    }
    return out;
  }

  return { parse: parse, parseDateTime: parseDateTime, findCoordinates: findCoordinates, extractGeometry: extractGeometry,
    decodeQCode: decodeQCode, describeLimit: describeLimit, distanceNm: distanceNm, destination: destination,
    circlePolygon: circlePolygon, SUBJECTS: SUBJECTS, CONDITIONS: CONDITIONS, SUBJECT_GROUPS: SUBJECT_GROUPS,
    CONDITION_GROUPS: CONDITION_GROUPS, TRAFFIC: TRAFFIC, PURPOSE: PURPOSE, SCOPE: SCOPE, ABBREVIATIONS: ABBREVIATIONS,
    NM_M: NM_M, R_EARTH_M: R_EARTH_M };
});

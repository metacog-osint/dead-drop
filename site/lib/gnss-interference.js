/* GNSS interference indicator checklist. It reads a receiver's own figures against open-sky norms, or better,
   against that receiver's normal readings at the same place, and lists which indicators are flagged. It is a
   checklist, not a detector: no output confirms jamming or spoofing.
   Physics behind the figures:
   - Effective C/N0 under interference of density I0: (C/N0)_eff = C / (N0 + I0) (Kaplan & Hegarty,
     Understanding GPS: Principles and Applications, 2nd ed., chapter 6, interference, multipath and scintillation). If the
     signal power C is unchanged, a drop of D dB from the receiver's normal C/N0 means the noise-plus-interference
     density rose by D dB, so I0 / N0 = 10^(D/10) - 1.
   - Four satellites are the minimum for a 3-D fix: four unknowns, x, y, z and the receiver clock bias
     (Kaplan & Hegarty, 2nd ed., chapter 2; Misra & Enge, Global Positioning System, 2nd ed.).
   Every other threshold here is indicative: a round number near commonly quoted open-sky values, not a standard.
   Spoofing signs (all satellites at much the same C/N0, signals stronger than normal, jumps in position or time,
   disagreement with an independent position) follow the list in Humphreys et al., "Assessing the spoofing threat",
   ION GNSS 2008, and later reviews; each can also have an innocent cause. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.DD = root.DD || {}).gnssInterference = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var LIMITS = {
    cn0Normal: 40, cn0VeryLow: 35,           // dB-Hz, absolute: indicative (open-sky GPS L1 C/A is commonly 40-50)
    cn0DropFlag: 3, cn0DropStrong: 10,       // dB below the receiver's normal: indicative
    cn0RiseFlag: 3,                          // dB above normal: indicative
    satsMinFix: 4,                           // physics: four unknowns
    satsLowSingle: 6, satsLowMulti: 10,      // without a baseline: indicative
    satsLossFlag: 0.25, satsLossStrong: 0.5, // share of the normal count lost: indicative
    haccFlag: 10, haccStrong: 20,            // metres, absolute: indicative
    haccRatioFlag: 2, haccRatioStrong: 5     // times the normal figure: indicative
  };
  var CAUTION = "This is a checklist of indicators, not a detection. It cannot confirm jamming or spoofing.";

  function present(x) { return x !== undefined && x !== null && !(typeof x === "string" && x.trim() === ""); }
  function num(x, what) {
    if (!present(x)) return null;
    if (typeof x !== "number" || !isFinite(x)) throw new Error(what + " must be a number.");
    return x;
  }

  /** I0/N0 in dB implied by a C/N0 drop of dropDb (> 0), assuming the signal power is unchanged. */
  function interferenceToNoiseDb(dropDb) {
    if (typeof dropDb !== "number" || !isFinite(dropDb) || dropDb <= 0) return null;
    return 10 * Math.log10(Math.pow(10, dropDb / 10) - 1);
  }

  /** input: {constellations: "single"|"multi", cn0, cn0Baseline, sats, satsBaseline, haccM, haccBaseline,
   *  flags: {agcDrop, posJump, timeJump, cn0Uniform, crossCheckFail}}. Measurements are optional; at least one
   *  measurement or observation is needed. */
  function assess(input) {
    input = input || {};
    var multi = input.constellations === "multi";
    var cn0 = num(input.cn0, "C/N0"), cn0b = num(input.cn0Baseline, "Normal C/N0");
    var sats = num(input.sats, "Satellites used"), satsb = num(input.satsBaseline, "Normal satellites used");
    var hacc = num(input.haccM, "Horizontal accuracy"), haccb = num(input.haccBaseline, "Normal horizontal accuracy");
    var flags = input.flags || {};
    [cn0, cn0b].forEach(function (v) { if (v !== null && (v < 0 || v > 70)) throw new Error("C/N0 values must be between 0 and 70 dB-Hz."); });
    [sats, satsb].forEach(function (v) {
      if (v !== null && (v < 0 || Math.floor(v) !== v)) throw new Error("Satellite counts must be whole numbers, 0 or more.");
    });
    if (satsb === 0) throw new Error("The normal satellite count must be above 0.");
    [hacc, haccb].forEach(function (v) { if (v !== null && v < 0) throw new Error("Accuracy figures cannot be negative."); });
    if (haccb === 0) throw new Error("The normal accuracy figure must be above 0.");
    var anyFlag = ["agcDrop", "posJump", "timeJump", "cn0Uniform", "crossCheckFail"].some(function (k) { return !!flags[k]; });
    if (cn0 === null && sats === null && hacc === null && !anyFlag) {
      throw new Error("Enter at least one measurement or tick at least one observation.");
    }

    var out = [], L = LIMITS, inr = null, drop = null;
    function add(id, label, value, reading, text, basis, kind) {
      out.push({ id: id, label: label, value: value, reading: reading, text: text, basis: basis, kind: kind });
    }

    if (cn0 !== null) {
      if (cn0b !== null) {
        drop = cn0b - cn0;
        inr = interferenceToNoiseDb(drop);
        if (drop >= L.cn0DropStrong) add("cn0", "C/N0 against normal", cn0, "strong", "Down " + drop.toFixed(1) + " dB on normal",
          "Indicative: a drop of 10 dB or more", "jamming");
        else if (drop >= L.cn0DropFlag) add("cn0", "C/N0 against normal", cn0, "flag", "Down " + drop.toFixed(1) + " dB on normal",
          "Indicative: a drop of 3 dB or more (noise plus interference doubled)", "jamming");
        else if (-drop >= L.cn0RiseFlag) add("cn0", "C/N0 against normal", cn0, "flag", "Up " + (-drop).toFixed(1) + " dB on normal",
          "Indicative: signals 3 dB or more stronger than normal can be a sign of false signals", "spoofing");
        else add("cn0", "C/N0 against normal", cn0, "normal", "Within 3 dB of normal", "Indicative", "jamming");
      } else {
        if (cn0 < L.cn0VeryLow) add("cn0", "C/N0", cn0, "strong", "Well below open-sky values",
          "Indicative: under 35 dB-Hz; open-sky GPS L1 C/A is commonly 40 to 50", "jamming");
        else if (cn0 < L.cn0Normal) add("cn0", "C/N0", cn0, "flag", "Below open-sky values",
          "Indicative: 35 to 40 dB-Hz; low satellites and obstructions also read here", "jamming");
        else add("cn0", "C/N0", cn0, "normal", "In the open-sky range", "Indicative: 40 dB-Hz or more", "jamming");
      }
    }

    if (sats !== null) {
      if (sats < L.satsMinFix) add("sats", "Satellites used", sats, "strong", "Too few for a 3-D fix",
        "Physics: a 3-D fix needs four (x, y, z and clock)", "jamming");
      else if (satsb !== null) {
        var lost = (satsb - sats) / satsb;
        if (lost >= L.satsLossStrong) add("sats", "Satellites used against normal", sats, "strong", "Half or more of the normal " + satsb + " lost",
          "Indicative: half or more lost", "jamming");
        else if (lost >= L.satsLossFlag) add("sats", "Satellites used against normal", sats, "flag", "A quarter or more of the normal " + satsb + " lost",
          "Indicative: a quarter or more lost", "jamming");
        else add("sats", "Satellites used against normal", sats, "normal", "Close to the normal " + satsb, "Indicative", "jamming");
      } else {
        var low = multi ? L.satsLowMulti : L.satsLowSingle;
        if (sats < low) add("sats", "Satellites used", sats, "flag", "Fewer than usual in open sky",
          "Indicative: under " + low + " with " + (multi ? "several constellations" : "one constellation"), "jamming");
        else add("sats", "Satellites used", sats, "normal", "A usual open-sky count", "Indicative", "jamming");
      }
    }

    if (hacc !== null) {
      if (haccb !== null) {
        var ratio = hacc / haccb;
        if (ratio >= L.haccRatioStrong) add("hacc", "Horizontal accuracy against normal", hacc, "strong", ratio.toFixed(1) + " times the normal figure",
          "Indicative: five times normal or worse", "jamming");
        else if (ratio >= L.haccRatioFlag) add("hacc", "Horizontal accuracy against normal", hacc, "flag", ratio.toFixed(1) + " times the normal figure",
          "Indicative: twice normal or worse", "jamming");
        else add("hacc", "Horizontal accuracy against normal", hacc, "normal", "Close to normal", "Indicative", "jamming");
      } else {
        if (hacc > L.haccStrong) add("hacc", "Horizontal accuracy", hacc, "strong", "Much worse than open-sky values",
          "Indicative: over 20 m", "jamming");
        else if (hacc > L.haccFlag) add("hacc", "Horizontal accuracy", hacc, "flag", "Worse than open-sky values",
          "Indicative: over 10 m", "jamming");
        else add("hacc", "Horizontal accuracy", hacc, "normal", "In the usual open-sky range", "Indicative: 10 m or better", "jamming");
      }
    }

    var obs = [
      ["agcDrop", "Automatic gain control (AGC) fell", "More power in the GNSS band than usual", "jamming"],
      ["posJump", "Position jumped or drifted against known motion", "Fits false signals; also multipath or a receiver reset", "spoofing"],
      ["timeJump", "Receiver time or clock bias stepped", "Fits false signals; also a receiver reset or clock fault", "spoofing"],
      ["cn0Uniform", "Every satellite at much the same C/N0", "Real satellites differ with elevation; false signals from one transmitter often do not", "spoofing"],
      ["crossCheckFail", "Position disagrees with an independent source", "Inertial, map, visual or another receiver; fits false signals or a fault", "spoofing"]
    ];
    obs.forEach(function (o) {
      if (flags[o[0]]) add(o[0], o[1], "seen", "flag", o[2], "Observation", o[3]);
    });

    var flagged = out.filter(function (x) { return x.reading === "flag" || x.reading === "strong"; });
    var jam = flagged.filter(function (x) { return x.kind === "jamming"; }).length;
    var spoof = flagged.filter(function (x) { return x.kind === "spoofing"; }).length;
    var pattern, summary;
    if (!flagged.length) {
      pattern = "none";
      summary = "No indicator is flagged. That does not rule out interference: these checks are coarse.";
    } else if (spoof && jam) {
      pattern = "both";
      summary = "The flagged indicators include both lost or weakened signals and signs of false signals. A spoofer " +
        "often starts by drowning the real signals, but faults and obstructions can produce the same mix. Corroborate " +
        "with an independent position or time source and with other receivers.";
    } else if (spoof) {
      pattern = "spoofing-like";
      summary = "The flagged indicators fit false or re-broadcast signals (spoofing or meaconing), but receiver resets, " +
        "faults and multipath can produce them too. Corroborate with an independent position or time source.";
    } else {
      pattern = "interference-like";
      summary = "The flagged indicators fit radio interference in the GNSS band, of which jamming is one cause. " +
        "Obstruction, antenna or cable faults, unwanted emissions from nearby equipment and ionospheric scintillation " +
        "look the same. Corroborate with other receivers, other times or published interference monitoring.";
    }
    return { indicators: out, flaggedCount: flagged.length, jammingLike: jam, spoofingLike: spoof, pattern: pattern,
      summary: summary, caution: CAUTION, cn0DropDb: drop, interferenceToNoiseDb: inr };
  }

  return { assess: assess, interferenceToNoiseDb: interferenceToNoiseDb, LIMITS: LIMITS, CAUTION: CAUTION };
});

/* Launch vehicle performance: an estimate of how much a vehicle can carry to a target orbit, scaled from its
   published payload to a reference low Earth orbit. Two parts, kept apart on purpose:
   1. Physics (ideal velocity changes, no losses): the speed the Earth's rotation gives for the chosen inclination
      (velocity triangle, cos i = cos(lat) sin(Az); see launch-azimuth.js), Hohmann transfers (Vallado, Fundamentals of
      Astrodynamics and Applications, 4th ed., section 6.3, example 6-1; Curtis, Orbital Mechanics for Engineering
      Students, chapter 6), and plane changes (simple: 2 v sin(di/2); combined with a speed change: law of cosines,
      Vallado section 6.4). Sun-synchronous inclination from the J2 nodal rate (Curtis section 4.7).
   2. Payload scaling (a rule of thumb, not a vehicle model): the extra velocity change is paid for by turning payload
      into upper-stage propellant, using the rocket equation (Tsiolkovsky) on the upper stage's burnout mass:
      P = (P0 + m_dry) exp(-dv_extra / (g0 Isp)) - m_dry. It ignores changes in gravity and drag losses, tank size,
      restarts, coast time and the lower stages, so treat it as a first estimate only.
   No DOM, no network. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.DD = root.DD || {}).launchVehiclePerformance = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var MU = 398600.4418;       // km^3/s^2 (WGS 84)
  var R_EQ = 6378.137;        // km (WGS 84)
  var E2 = 6.69437999014e-3;  // WGS 84 first eccentricity squared
  var OMEGA = 7.292115e-5;    // rad/s (WGS 84)
  var J2 = 1.08262668e-3;
  var G0 = 9.80665;           // m/s^2, standard gravity (exact, CGPM 1901)
  var GEO_ALT = 35786;        // km, geostationary altitude (radius 42,164 km)
  var SUN_RATE = 360 / 365.2421897 / 86400 * Math.PI / 180;   // rad/s, mean sun's motion (tropical year)
  var D2R = Math.PI / 180;

  function vCirc(rKm) { return Math.sqrt(MU / rKm); }
  function vEllipse(rKm, aKm) { return Math.sqrt(MU * (2 / rKm - 1 / aKm)); }

  /** Hohmann transfer between circular radii r1 and r2 (km): the two burns (km/s) and the time of flight (s). */
  function hohmann(r1, r2) {
    if (!(r1 > 0 && r2 > 0)) throw new Error("Radii must be positive.");
    var at = (r1 + r2) / 2;
    return { dv1: Math.abs(vEllipse(r1, at) - vCirc(r1)), dv2: Math.abs(vCirc(r2) - vEllipse(r2, at)),
      tofS: Math.PI * Math.sqrt(at * at * at / MU) };
  }

  /** Speed to add relative to the ground to reach a circular orbit at altKm and incDeg from latDeg (ideal, km/s):
   *  |v_orbit - v_site|, with v_site's component along the orbit equal to omega N cos i. */
  function groundRelativeSpeed(latDeg, altKm, incDeg) {
    var p = latDeg * D2R, N = R_EQ / Math.sqrt(1 - E2 * Math.sin(p) * Math.sin(p));
    var v = vCirc(R_EQ + altKm), vs = OMEGA * N * Math.cos(p);
    return Math.sqrt(v * v - 2 * v * OMEGA * N * Math.cos(incDeg * D2R) + vs * vs);
  }

  /** Inclination of a sun-synchronous circular orbit at altKm (degrees), where J2 turns the node 0.9856 deg/day. */
  function ssoInclinationDeg(altKm) {
    var a = R_EQ + altKm, n = Math.sqrt(MU / (a * a * a));
    var c = -SUN_RATE / (1.5 * n * J2 * Math.pow(R_EQ / a, 2));
    if (c < -1) throw new Error("No sun-synchronous circular orbit exists at this altitude.");
    return Math.acos(c) / D2R;
  }

  function payloadFromDv(p0Kg, dryKg, ispS, dvExtraKms) {
    var mbo = (p0Kg + dryKg) * Math.exp(-dvExtraKms * 1000 / (G0 * ispS));
    return mbo - dryKg;
  }

  /** opts: { p0Kg (published payload to the reference orbit), refAltKm, refIncDeg, siteLatDeg, dryKg, ispS,
   *          target: { type: "circular" | "sso" | "gto" | "geo", altKm, incDeg, apogeeKm } } */
  function estimate(opts) {
    var o = opts || {}, t = o.target || {};
    var lat = o.siteLatDeg, absLat = Math.abs(lat);
    var refAlt = o.refAltKm === undefined ? 200 : o.refAltKm;
    var refInc = o.refIncDeg === undefined ? absLat : o.refIncDeg;
    if (![o.p0Kg, refAlt, refInc, lat, o.dryKg, o.ispS].every(isFinite)) throw new Error("Every vehicle input must be a number.");
    if (o.p0Kg <= 0) throw new Error("The reference payload must be more than zero.");
    if (o.dryKg < 0) throw new Error("The upper stage's dry mass cannot be negative.");
    if (o.ispS <= 0 || o.ispS > 1000) throw new Error("Specific impulse must be between 0 and 1000 s for a chemical stage.");
    if (lat < -90 || lat > 90 || Math.abs(lat) > 89.99) throw new Error("The site latitude must be between -89.99 and 89.99 degrees.");
    if (refAlt < 100 || refAlt > 2000) throw new Error("The reference orbit must be a low orbit, 100 to 2,000 km.");
    if (refInc < absLat - 1e-9 || refInc > 180 - absLat + 1e-9) throw new Error("The reference inclination cannot be reached directly from the site.");

    var r0 = R_EQ + refAlt, parts = [], inc, planeChange = 0;
    function launchInc(i) { return Math.min(Math.max(i, absLat), 180 - absLat); }
    var type = t.type || "circular";
    if (type === "sso") {
      if (!isFinite(t.altKm)) throw new Error("Enter the orbit altitude.");
      t = { type: "sso", altKm: t.altKm, incDeg: ssoInclinationDeg(t.altKm) };
    }
    if (type === "circular" || type === "sso") {
      if (![t.altKm, t.incDeg].every(isFinite)) throw new Error("Enter the orbit altitude and inclination.");
      if (t.altKm < 100) throw new Error("The target orbit must be at least 100 km up.");
      if (t.incDeg < 0 || t.incDeg > 180) throw new Error("Inclination must be between 0 and 180 degrees.");
      inc = launchInc(t.incDeg);
    } else if (type === "gto" || type === "geo") {
      inc = absLat;   // GTO launched due east, at the site's latitude
    } else {
      throw new Error("Unknown target type.");
    }
    var dvRot = groundRelativeSpeed(lat, refAlt, inc) - groundRelativeSpeed(lat, refAlt, refInc);
    parts.push({ what: "Rotation: launch inclination " + inc.toFixed(2) + "° instead of " + refInc.toFixed(2) + "°", dvKms: dvRot });
    var resultIncDeg = inc;
    if (type === "circular" || type === "sso") {
      if (Math.abs(t.altKm - refAlt) > 1e-9) {
        var h = hohmann(r0, R_EQ + t.altKm);
        parts.push({ what: "Hohmann transfer, first burn", dvKms: h.dv1 });
        parts.push({ what: "Hohmann transfer, second burn", dvKms: h.dv2 });
      }
      if (Math.abs(t.incDeg - inc) > 1e-9) {
        planeChange = Math.abs(t.incDeg - inc);
        parts.push({ what: "Plane change of " + planeChange.toFixed(2) + "° in the final orbit (simple, an upper bound)",
          dvKms: 2 * vCirc(R_EQ + t.altKm) * Math.sin(planeChange * D2R / 2) });
      }
      resultIncDeg = t.incDeg;
    } else {
      var apo = t.apogeeKm === undefined ? GEO_ALT : t.apogeeKm;
      if (!isFinite(apo) || apo <= refAlt) throw new Error("The transfer orbit's apogee must be above the reference orbit.");
      var ra = R_EQ + apo, at = (r0 + ra) / 2;
      parts.push({ what: "Perigee burn into the transfer orbit (" + refAlt + " × " + apo + " km)", dvKms: vEllipse(r0, at) - vCirc(r0) });
      if (type === "geo") {
        var va = vEllipse(ra, at), vg = vCirc(ra);
        parts.push({ what: "Apogee burn: circularise and remove " + inc.toFixed(2) + "° of inclination",
          dvKms: Math.sqrt(va * va + vg * vg - 2 * va * vg * Math.cos(inc * D2R)) });
        resultIncDeg = 0;
      }
    }
    var dvExtra = parts.reduce(function (s, p) { return s + p.dvKms; }, 0);
    var payload = payloadFromDv(o.p0Kg, o.dryKg, o.ispS, dvExtra);
    return {
      parts: parts,
      dvExtraKms: dvExtra,
      payloadKg: Math.max(0, payload),
      reachable: payload > 0,
      ratio: Math.max(0, payload) / o.p0Kg,
      targetIncDeg: resultIncDeg,
      launchIncDeg: inc,
      exhaustVelocityKms: G0 * o.ispS / 1000,
      refGroundSpeedKms: groundRelativeSpeed(lat, refAlt, refInc)
    };
  }

  // Published payload figures as commonly quoted from makers' material, and rough upper-stage figures. All are
  // approximate public numbers, not checked against the users' guides here; reference orbits differ by vehicle.
  var VEHICLES = [
    { id: "falcon9", name: "Falcon 9 (expendable)", status: "Flying", siteLatDeg: 28.5, leoKg: 22800, gtoKg: 8300, dryKg: 4000, ispS: 348 },
    { id: "falconheavy", name: "Falcon Heavy (expendable)", status: "Flying", siteLatDeg: 28.5, leoKg: 63800, gtoKg: 26700, dryKg: 4000, ispS: 348 },
    { id: "atlasv551", name: "Atlas V 551", status: "Flying its last booked missions", siteLatDeg: 28.5, leoKg: 18850, gtoKg: 8900, dryKg: 2250, ispS: 450 },
    { id: "deltaivm", name: "Delta IV Medium", status: "Retired 2019", siteLatDeg: 28.5, leoKg: 9420, gtoKg: 4210, dryKg: 2850, ispS: 462 },
    { id: "deltaivh", name: "Delta IV Heavy", status: "Retired 2024", siteLatDeg: 28.5, leoKg: 28790, gtoKg: 14220, dryKg: 3490, ispS: 462 },
    { id: "ariane5", name: "Ariane 5 ECA", status: "Retired 2023", siteLatDeg: 5.2, leoKg: 21000, gtoKg: 10865, dryKg: 4540, ispS: 446 },
    { id: "lm3b", name: "Long March 3B", status: "Flying", siteLatDeg: 28.2, leoKg: 11500, gtoKg: 5500, dryKg: 2800, ispS: 438 }
  ];

  return { hohmann: hohmann, groundRelativeSpeed: groundRelativeSpeed, ssoInclinationDeg: ssoInclinationDeg,
    payloadFromDv: payloadFromDv, estimate: estimate, VEHICLES: VEHICLES, G0: G0, GEO_ALT: GEO_ALT, R_EQ: R_EQ, MU: MU };
});

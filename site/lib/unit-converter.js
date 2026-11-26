/* Unit converter for aerospace work. Every factor is the unit's size in SI, from NIST Special Publication 811
   (2008 ed.), Guide for the Use of the International System of Units, appendix B (exact where NIST marks it exact),
   except the astronomical unit (IAU 2012 resolution B2, exact). Speed of sound and standard temperatures from the
   U.S. Standard Atmosphere, 1976 (the same as the ICAO standard atmosphere below 32 km): a = sqrt(gamma R T),
   gamma = 1.4, R = 8.31432 / 0.0289644 = 287.05287 J/(kg K). No DOM, no network. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.DD = root.DD || {}).unitConverter = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var LBF = 0.45359237 * 9.80665;   // N, pound-force (exact from the pound and standard gravity)
  // [id, label, size in the SI unit]. Exact by definition except mmHg and inHg (NIST's rounded values) and pi.
  var CATEGORIES = {
    length: { label: "Length and distance", si: "m", units: [
      ["m", "metre", 1], ["km", "kilometre", 1000], ["cm", "centimetre", 0.01], ["mm", "millimetre", 0.001],
      ["in", "inch", 0.0254], ["ft", "foot", 0.3048], ["yd", "yard", 0.9144], ["mi", "mile (statute)", 1609.344],
      ["nmi", "nautical mile", 1852], ["kft", "thousand feet", 304.8], ["au", "astronomical unit", 149597870700]
    ] },
    speed: { label: "Speed", si: "m/s", units: [
      ["m/s", "metre per second", 1], ["km/h", "kilometre per hour", 1000 / 3600], ["km/s", "kilometre per second", 1000],
      ["ft/s", "foot per second", 0.3048], ["mph", "mile per hour", 0.44704], ["kn", "knot (nautical mile per hour)", 1852 / 3600]
    ] },
    mass: { label: "Mass", si: "kg", units: [
      ["kg", "kilogram", 1], ["g", "gram", 0.001], ["t", "tonne (metric ton)", 1000], ["lb", "pound (avoirdupois)", 0.45359237],
      ["oz", "ounce (avoirdupois)", 0.028349523125], ["shton", "short ton (2,000 lb)", 907.18474],
      ["lgton", "long ton (2,240 lb)", 1016.0469088], ["slug", "slug", LBF / 0.3048]
    ] },
    force: { label: "Force and thrust", si: "N", units: [
      ["N", "newton", 1], ["kN", "kilonewton", 1000], ["MN", "meganewton", 1e6], ["lbf", "pound-force", LBF],
      ["klbf", "thousand pounds-force", LBF * 1000], ["kgf", "kilogram-force", 9.80665]
    ] },
    pressure: { label: "Pressure", si: "Pa", units: [
      ["Pa", "pascal", 1], ["hPa", "hectopascal (= millibar)", 100], ["kPa", "kilopascal", 1000], ["bar", "bar", 1e5],
      ["atm", "standard atmosphere", 101325], ["psi", "pound-force per square inch", LBF / (0.0254 * 0.0254)],
      ["mmHg", "millimetre of mercury (conventional)", 133.3224], ["inHg", "inch of mercury (conventional)", 3386.389],
      ["torr", "torr (1/760 atm)", 101325 / 760]
    ] },
    angle: { label: "Angle", si: "rad", units: [
      ["rad", "radian", 1], ["deg", "degree", Math.PI / 180], ["arcmin", "minute of arc", Math.PI / 10800],
      ["arcsec", "second of arc", Math.PI / 648000], ["mil", "NATO mil (6,400 to a circle)", 2 * Math.PI / 6400],
      ["rev", "revolution", 2 * Math.PI]
    ] },
    temperature: { label: "Temperature", si: "K", units: [
      ["K", "kelvin"], ["C", "degree Celsius"], ["F", "degree Fahrenheit"], ["R", "degree Rankine"]
    ] }
  };

  function toKelvin(v, u) {
    if (u === "K") return v;
    if (u === "C") return v + 273.15;
    if (u === "F") return (v - 32) / 1.8 + 273.15;
    if (u === "R") return v / 1.8;
    throw new Error("Unknown temperature unit.");
  }
  function fromKelvin(k, u) {
    if (u === "K") return k;
    if (u === "C") return k - 273.15;
    if (u === "F") return (k - 273.15) * 1.8 + 32;
    if (u === "R") return k * 1.8;
    throw new Error("Unknown temperature unit.");
  }

  function unit(cat, id) {
    var c = CATEGORIES[cat];
    if (!c) throw new Error("Unknown category.");
    var u = c.units.filter(function (x) { return x[0] === id; })[0];
    if (!u) throw new Error("Unknown unit " + id + ".");
    return u;
  }

  /** Converts value from one unit to another within a category. */
  function convert(value, cat, from, to) {
    if (typeof value !== "number" || !isFinite(value)) throw new Error("Enter a number.");
    if (cat === "temperature") {
      unit(cat, from); unit(cat, to);
      var k = toKelvin(value, from);
      if (k < 0) throw new Error("That is below absolute zero.");
      return fromKelvin(k, to);
    }
    return value * unit(cat, from)[2] / unit(cat, to)[2];
  }

  /** The value in every unit of its category: [{ id, label, value }]. */
  function all(value, cat, from) {
    return CATEGORIES[cat].units.map(function (u) { return { id: u[0], label: u[1], value: convert(value, cat, from, u[0]) }; });
  }

  // U.S. Standard Atmosphere 1976 temperature by geopotential altitude (m), 0 to 47 km.
  var LAYERS = [[0, 288.15, -0.0065], [11000, 216.65, 0], [20000, 216.65, 0.001], [32000, 228.65, 0.0028], [47000, 270.65, 0]];
  function isaTemperatureK(hM) {
    if (!isFinite(hM) || hM < -610 || hM > 47000) throw new Error("Standard temperature is given here from -610 m to 47 km.");
    var L = LAYERS[0];
    for (var i = LAYERS.length - 1; i >= 0; i--) if (hM >= LAYERS[i][0]) { L = LAYERS[i]; break; }
    return L[1] + L[2] * (hM - L[0]);
  }
  var GAMMA = 1.4, R_AIR = 8.31432 / 0.0289644;
  function speedOfSound(tempK) {
    if (!isFinite(tempK) || tempK <= 0) throw new Error("Temperature must be above absolute zero.");
    return Math.sqrt(GAMMA * R_AIR * tempK);
  }
  /** Mach number to true airspeed (m/s) at the given air temperature (K). */
  function machToSpeed(mach, tempK) {
    if (!isFinite(mach) || mach < 0) throw new Error("Mach number must be zero or more.");
    return mach * speedOfSound(tempK);
  }

  /** Flight level from pressure altitude in feet: hundreds of feet, rounded to the nearest whole level. */
  function flightLevel(pressureAltFt) {
    if (!isFinite(pressureAltFt)) throw new Error("Enter a number.");
    return Math.round(pressureAltFt / 100);
  }

  return { CATEGORIES: CATEGORIES, convert: convert, all: all, isaTemperatureK: isaTemperatureK, speedOfSound: speedOfSound,
    machToSpeed: machToSpeed, flightLevel: flightLevel, R_AIR: R_AIR, LBF: LBF };
});

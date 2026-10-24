/* Sun position for the /globe day and night shade. NOAA low-precision formulas (about 0.01 deg until 2100).
   Browser global (window.Sun) + CommonJS (mocha). No dependencies. */
(function (g) {
  const R = Math.PI / 180;
  /* Sun below this altitude (deg) = night: refraction plus the sun's radius, the standard sunrise/sunset limit */
  const HORIZON = -0.833;

  /** Subsolar point at Date d: { dec (rad), lat, lng (deg) } */
  function sun(d) {
    const n = d / 864e5 + 2440587.5 - 2451545; /* days since J2000.0 */
    const L = (280.46 + 0.9856474 * n) % 360, m = (357.528 + 0.9856003 * n) * R;
    const lam = (L + 1.915 * Math.sin(m) + 0.02 * Math.sin(2 * m)) * R, eps = (23.439 - 4e-7 * n) * R;
    const dec = Math.asin(Math.sin(eps) * Math.sin(lam));
    const ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam));
    let eot = L * R - ra; eot = (Math.atan2(Math.sin(eot), Math.cos(eot)) / R) * 4; /* equation of time, minutes */
    const ut = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
    return { dec, lat: dec / R, lng: ((-15 * (ut - 12 + eot / 60)) % 360 + 540) % 360 - 180 };
  }

  /** Sun altitude (deg) seen from lat/lng, for a sun() result */
  function altitude(s, lat, lng) {
    const h = (lng - s.lng) * R, p = lat * R;
    const x = Math.sin(p) * Math.sin(s.dec) + Math.cos(p) * Math.cos(s.dec) * Math.cos(h);
    return Math.asin(Math.max(-1, Math.min(1, x))) / R; /* clamp: rounding can push x past 1 */
  }

  const isNight = (lat, lng, d = new Date()) => altitude(sun(d), lat, lng) < HORIZON;

  const api = { sun, altitude, isNight, HORIZON };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else g.Sun = api;
})(this);

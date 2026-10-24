// NOAA solar calculation from public/js/sun.js, used only for map shading.
export function sun(d: Date) {
  const R = Math.PI / 180;
  const n = d.getTime() / 864e5 + 2440587.5 - 2451545; /* days since J2000.0 */
  const L = (280.46 + 0.9856474 * n) % 360,
    m = (357.528 + 0.9856003 * n) * R;
  const lam = (L + 1.915 * Math.sin(m) + 0.02 * Math.sin(2 * m)) * R,
    eps = (23.439 - 4e-7 * n) * R;
  const dec = Math.asin(Math.sin(eps) * Math.sin(lam));
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam));
  let eot = L * R - ra;
  eot =
    (Math.atan2(Math.sin(eot), Math.cos(eot)) / R) *
    4; /* equation of time, minutes */
  const ut =
    d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
  return {
    dec,
    lat: dec / R,
    lng: ((((-15 * (ut - 12 + eot / 60)) % 360) + 540) % 360) - 180,
  };
}

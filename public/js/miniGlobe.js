/* Home: small spinning Outdoors globe in the live strip tile, with live visitor dots. Click opens /globe. */
(async () => {
  const tile = document.querySelector('.globe-tile');
  if (!tile || !window.d3 || !window.topojson) return;
  const root = document.documentElement;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Outdoors map tokens from views/globe.hbs (map-only colors, kept inside the tile)
  const PAL = {
    light: { sea: '#4a9fd8', land: '#9cd08a', line: '#6f9f5f', halo: 'rgba(70,150,200,.35)' },
    dark: { sea: '#0b3a5e', land: '#24502f', line: '#3a6d47', halo: 'rgba(90,170,230,.25)' },
  };

  let land;
  try {
    const t = await (await fetch('/data/world-ind.json')).json();
    land = topojson.feature(t, t.objects.ind);
  } catch { return; } // keep the line-art globe

  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  const ctx = canvas.getContext('2d');
  const proj = d3.geoOrthographic().clipAngle(90);
  const path = d3.geoPath(proj, ctx);
  let size = 0, cities = [], rot = [-78, -18], last = 0, centered = false;

  function fit() {
    const css = tile.querySelector('canvas, svg').offsetWidth || 200; // offsetWidth ignores the hover scale
    const dpr = devicePixelRatio || 1;
    size = css;
    canvas.width = canvas.height = Math.round(css * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    proj.translate([css / 2, css / 2]).scale(css / 2 - 1);
  }

  function draw(now) {
    const c = PAL[root.dataset.theme === 'dark' ? 'dark' : 'light'];
    const r = size / 2;
    ctx.clearRect(0, 0, size, size);
    ctx.beginPath(); ctx.arc(r, r, r - 1, 0, 2 * Math.PI);
    ctx.fillStyle = c.sea; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = c.halo; ctx.stroke();
    ctx.beginPath(); path(land); ctx.fillStyle = c.land; ctx.fill();
    ctx.lineWidth = .5; ctx.strokeStyle = c.line; ctx.stroke();
    const center = proj.invert([r, r]);
    const pulse = still ? 0 : (now / 1400) % 1;
    const k = size / 96; // dot scale tracks globe size
    // ponytail: top 120 cities only; more dots merge into one blob
    cities.slice(0, 120).forEach((p, i) => {
      if (d3.geoDistance([p.lng, p.lat], center) > Math.PI / 2 - .05) return;
      const [x, y] = proj([p.lng, p.lat]);
      const d = Math.min(2.6, 1 + Math.log2(p.count + 1) * .3) * k;
      if (pulse && i < 6) {
        ctx.beginPath(); ctx.arc(x, y, d + pulse * 5 * k, 0, 2 * Math.PI);
        ctx.strokeStyle = `rgba(255,255,255,${(1 - pulse) * .8})`; ctx.lineWidth = 1; ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(x, y, d, 0, 2 * Math.PI);
      ctx.fillStyle = '#fff'; ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = .5; ctx.stroke();
    });
  }

  function frame(now) {
    if (last) rot[0] -= Math.min(100, now - last) * 0.006; // ~6 degrees a second, cities drift left into view
    last = now;
    proj.rotate(rot);
    draw(now);
    requestAnimationFrame(frame);
  }

  async function loadCities() {
    try {
      // maxAge=300: reuse the server cache, no extra GA4 quota on most calls
      const j = await (await fetch('/api/globe-users?maxAge=300')).json();
      cities = (j.users || []).filter(c => Number.isFinite(c.lat) && Number.isFinite(c.lng)).sort((a, b) => b.count - a.count);
      const n = cities.reduce((s, c) => s + c.count, 0);
      tile.setAttribute('aria-label', n ? `Open the live globe, ${n} visitors on the map` : 'Open the live globe');
      if (cities.length && !centered) {
        // Start on the busiest city; the spin carries it left across the part the card does not clip
        centered = true;
        rot = [-cities[0].lng, -cities[0].lat * .6];
        if (still) { proj.rotate(rot); draw(0); }
      }
    } catch { /* globe still spins without dots */ }
  }

  tile.querySelector('svg').replaceWith(canvas);
  fit();
  new ResizeObserver(() => { fit(); if (still) draw(0); }).observe(tile);
  new MutationObserver(() => still && draw(0)).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  await loadCities();
  setInterval(loadCities, 60000);
  if (still) { proj.rotate(rot); draw(0); } else requestAnimationFrame(frame);
})();

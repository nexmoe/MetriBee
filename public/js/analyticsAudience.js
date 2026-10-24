/* Audience labels and the bundled India-POV map. No visitor locations are inferred. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AnalyticsAudience = api;
})(typeof window === 'object' ? window : globalThis, function () {
  const countries = new Intl.DisplayNames(['en'], { type: 'region' });
  const languages = new Intl.DisplayNames(['en'], { type: 'language' });
  const validCountry = code => /^[A-Z]{2}$/.test(code || '') ? code : '';
  const countryName = code => { try { return countries.of(code) || code; } catch { return code; } };

  function rowLabel(type, dims = []) {
    if (type === 'countries') return { text: dims[0] || '(not set)', countryCode: validCountry(dims[1]) };
    if (type === 'regions') return { text: dims[1] || '(not set)', prefix: validCountry(dims[0]), countryCode: validCountry(dims[0]) };
    if (type === 'cities') return { text: dims[2] || '(not set)', prefix: validCountry(dims[0]), countryCode: validCountry(dims[0]), detail: dims[1] && dims[1] !== '(not set)' ? dims[1] : '' };
    if (type === 'languages') {
      const value = dims[0] || '(not set)';
      try {
        const locale = new Intl.Locale(value);
        const name = languages.of(locale.language);
        const region = validCountry(locale.region);
        return { text: region ? `${name} (${countryName(region)})` : languages.of(locale.baseName), countryCode: region };
      } catch { return { text: value, countryCode: '' }; }
    }
    if (type === 'devices') {
      const names = { desktop: 'Desktop', mobile: 'Mobile', tablet: 'Tablet' };
      return { text: names[dims[0]] || dims[0] || '(not set)', device: dims[0] };
    }
    return { text: dims.join(' / ') || '(empty)', countryCode: '' };
  }

  // Decode only the quantized Polygon/MultiPolygon geometry used by world-ind.json.
  // Clip unwrapped rings at the antimeridian so an island never fills the whole map.
  function topologyPaths(topology) {
    if (topology.type !== 'Topology' || !topology.objects.ind || !topology.transform) throw new Error('Invalid map data');
    const { scale, translate } = topology.transform;
    const arcs = topology.arcs.map(arc => {
      let x = 0, y = 0;
      return arc.map(point => { x += point[0]; y += point[1]; return [x * scale[0] + translate[0], y * scale[1] + translate[1]]; });
    });
    const ring = ids => ids.flatMap((id, i) => {
      const points = id < 0 ? [...arcs[~id]].reverse() : arcs[id];
      return i ? points.slice(1) : points;
    });
    function clip(points, edge, keep) {
      const out = [];
      for (let i = 0; i < points.length; i++) {
        const a = points[(i + points.length - 1) % points.length], b = points[i];
        const insideA = keep(a[0], edge), insideB = keep(b[0], edge);
        if (insideA !== insideB) {
          const t = (edge - a[0]) / (b[0] - a[0]);
          out.push([edge, a[1] + t * (b[1] - a[1])]);
        }
        if (insideB) out.push(b);
      }
      return out;
    }
    function path(ids) {
      const points = ring(ids);
      const unwrapped = [];
      for (const [lon, lat] of points) {
        let x = lon;
        if (unwrapped.length) {
          const prev = unwrapped[unwrapped.length - 1][0];
          while (x - prev > 180) x -= 360;
          while (x - prev < -180) x += 360;
        }
        unwrapped.push([x, lat]);
      }
      return [-360, 0, 360].map(shift => {
        let part = unwrapped.map(([x, y]) => [x + shift, y]);
        part = clip(part, -180, (x, e) => x >= e);
        part = clip(part, 180, (x, e) => x <= e);
        return part.length < 3 ? '' : 'M' + part.map(([x, y]) => `${((x + 180) * 2).toFixed(2)},${((90 - y) * 2).toFixed(2)}`).join('L') + 'Z';
      }).join('');
    }
    return topology.objects.ind.geometries.map(g => ({
      countryCode: validCountry(g.properties.ISO_A2),
      path: (g.type === 'Polygon' ? [g.arcs] : g.type === 'MultiPolygon' ? g.arcs : []).flatMap(p => p.map(path)).join(''),
    }));
  }

  return { rowLabel, countryName, topologyPaths };
});

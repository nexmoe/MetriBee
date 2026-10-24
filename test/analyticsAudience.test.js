const { expect } = require('chai');
const fs = require('fs');
const { rowLabel, topologyPaths } = require('../public/js/analyticsAudience');

describe('analytics audience data', () => {
  it('keeps a city tied to its reported country and region', () => {
    expect(rowLabel('cities', ['US', 'California', 'San Jose'])).to.deep.equal({ text: 'San Jose', prefix: 'US', countryCode: 'US', detail: 'California' });
    expect(rowLabel('cities', ['CR', 'San José', 'San Jose']).countryCode).to.equal('CR');
    expect(rowLabel('regions', ['CN', '(not set)']).text).to.equal('(not set)');
    expect(rowLabel('countries', ['China', 'CN'])).to.deep.equal({ text: 'China', countryCode: 'CN' });
  });

  it('uses the locale region only when GA4 reports it, without inferring a visitor country', () => {
    expect(rowLabel('languages', ['en-us'])).to.deep.equal({ text: 'English (United States)', countryCode: 'US' });
    expect(rowLabel('languages', ['zh-cn'])).to.deep.equal({ text: 'Chinese (China)', countryCode: 'CN' });
    expect(rowLabel('languages', ['en']).countryCode).to.equal('');
    expect(rowLabel('languages', ['(not set)'])).to.deep.equal({ text: '(not set)', countryCode: '' });
    expect(rowLabel('languages', ['en-us@posix'])).to.deep.equal({ text: 'en-us@posix', countryCode: '' });
  });

  it('preserves unexpected device categories rather than inventing or replacing them', () => {
    expect(rowLabel('devices', ['desktop']).text).to.equal('Desktop');
    expect(rowLabel('devices', ['(not set)']).text).to.equal('(not set)');
    expect(rowLabel('devices', ['smart TV']).text).to.equal('smart TV');
  });

  it('projects only the bundled India-POV boundaries and keeps every coordinate on the map', () => {
    const topology = JSON.parse(fs.readFileSync('public/data/world-ind.json', 'utf8'));
    const paths = topologyPaths(topology);
    expect(paths.length).to.equal(topology.objects.ind.geometries.length);
    expect(paths.find(p => p.countryCode === 'IN').path.length).to.be.greaterThan(100);
    for (const p of paths) {
      expect(p.path).to.not.match(/NaN|Infinity/);
      for (const pair of p.path.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)) {
        expect(+pair[1]).to.be.within(0, 720);
        expect(+pair[2]).to.be.within(0, 360);
      }
    }
  });

  it('clips an island crossing the date line instead of drawing a polygon across the world', () => {
    const topology = { type: 'Topology', transform: { scale: [1, 1], translate: [0, 0] }, arcs: [[[179, 10], [-358, 0], [0, -10], [358, 0], [0, 10]]], objects: { ind: { geometries: [{ type: 'Polygon', arcs: [[0]], properties: { ISO_A2: 'FJ' } }] } } };
    const path = topologyPaths(topology)[0].path;
    expect((path.match(/M/g) || []).length).to.equal(2);
    for (const pair of path.matchAll(/(\d+\.\d+),(\d+\.\d+)/g)) expect(+pair[1] <= 2 || +pair[1] >= 718).to.equal(true);
  });
});

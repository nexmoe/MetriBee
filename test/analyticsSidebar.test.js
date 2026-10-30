const { expect } = require('chai');
const path = require('node:path');
const fs = require('node:fs/promises');
const handlebars = require('handlebars').create();

const pages = [
  ['analytics', '/analytics', 'analyticsMain'],
  ['pages', '/analytics/pages', 'pages'],
  ['events', '/events', 'events'],
  ['journeys', '/journeys', 'journeys'],
  ['retention', '/retention', 'retention'],
];
const expected = ['/analytics', '/analytics/pages', '/events', '/journeys', '/retention'];
handlebars.registerHelper('json_stringify', JSON.stringify);
const engine = { async renderView(file, data) {
  for (const partial of await fs.readdir(path.resolve('views/partials'))) if (partial.endsWith('.hbs')) handlebars.registerPartial(partial.replace(/\.hbs$/, ''), await fs.readFile(path.resolve('views/partials', partial), 'utf8'));
  return handlebars.compile(await fs.readFile(file, 'utf8'))(data);
} };

describe('shared analytics sidebar', () => {
  for (const [view, route, active] of pages) {
    it(`${view} keeps the same navigation order and marks only its own page active`, async () => {
      const html = await engine.renderView(path.resolve(`views/${view}.hbs`), {
        layout: false, properties: [{ id: '123', site: 'Example', domain: 'example.com' }], analyticsCatalog: [],
        nav: { analytics: true, [active]: true },
      });
      const sidebar = html.match(/<aside\b[\s\S]*?<\/aside>/g) || [];
      expect(sidebar).to.have.length(1);
      const nav = sidebar[0].match(/<nav\b[\s\S]*?<\/nav>/)[0];
      const links = [...nav.matchAll(/<a\b([^>]*)>/g)].map(match => ({
        href: match[1].match(/href="([^"]+)"/)[1], current: match[1].includes('aria-current="page"'),
      }));
      expect(links.map(link => link.href)).to.deep.equal(expected);
      expect(links.filter(link => link.current).map(link => link.href)).to.deep.equal([route]);
      expect(sidebar[0]).to.include('aria-label="Analytics navigation"');
      expect(sidebar[0]).to.include('value="123"');
    });
  }

  it('preserves the selected property and supported period when navigating to another report', () => {
    const { hrefFor } = require('../public/js/analyticsSidebar');
    const source = 'http://localhost/events?prop=456&range=30d&bucket=week&breakdown=name#activity';
    expect(hrefFor('/retention', source, { ranges: ['7d', '30d', '90d'], defaultRange: '30d' }))
      .to.equal('/retention?prop=456&range=30d');
    expect(hrefFor('/analytics', source, { ranges: ['today', '7d', '28d'], defaultRange: '28d' }))
      .to.equal('/analytics?prop=456&range=28d');
  });

  it('keeps page-specific filters on the current link and does not leak them into other reports', () => {
    const { hrefFor } = require('../public/js/analyticsSidebar');
    const source = 'http://localhost/analytics/pages?prop=456&start=2026-10-01&end=2026-10-07&view=entry&q=docs';
    expect(hrefFor('/analytics/pages', source)).to.equal('/analytics/pages?prop=456&start=2026-10-01&end=2026-10-07&view=entry&q=docs');
    expect(hrefFor('/events', source, { ranges: ['today', '7d', '28d', '30d', '90d'], defaultRange: '30d' }))
      .to.equal('/events?prop=456&range=30d');
  });
});

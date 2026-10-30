const { expect } = require('chai');
const { createRybbitHandler, filtersFor } = require('../controllers/rybbit');

// Evaluate the GA4 expressions against tagged and automatically attributed hits.
function matches(expression, hit) {
  if (!expression) return true;
  if (expression.andGroup) return expression.andGroup.expressions.every(item => matches(item, hit));
  if (expression.orGroup) return expression.orGroup.expressions.some(item => matches(item, hit));
  if (expression.notExpression) return !matches(expression.notExpression, hit);
  const { fieldName, stringFilter } = expression.filter;
  const value = hit[fieldName] || '';
  if (stringFilter.matchType === 'PARTIAL_REGEXP') return new RegExp(stringFilter.value).test(value);
  if (stringFilter.matchType === 'EXACT') return value.toLowerCase() === stringFilter.value.toLowerCase();
  throw new Error(`Unexpected filter: ${JSON.stringify(expression)}`);
}

const dimensions = {
  utm_source: 'sessionManualSource', utm_medium: 'sessionManualMedium',
  utm_campaign: 'sessionManualCampaignName', utm_content: 'sessionManualAdContent', utm_term: 'sessionManualTerm',
};
const query = { start_date: '2026-10-01', end_date: '2026-10-22' };
async function metric(parameter, action = 'metric', extra = {}) {
  const field = dimensions[parameter];
  const hits = [
    { pageLocation: 'https://example.com/', [field]: 'automatic' },
    { pageLocation: `https://example.com/?${parameter}=tagged`, [field]: 'tagged' },
    { pageLocation: `https://example.com/?q=1&${parameter}=organic`, [field]: 'organic' },
    { pageLocation: `https://example.com/?other_${parameter}=wrong`, [field]: 'wrong' },
    { pageLocation: `https://example.com/?${parameter}=`, [field]: '(not set)' },
    { pageLocation: `https://example.com/#?${parameter}=fragment`, [field]: 'fragment' },
  ];
  const calls = [];
  const handler = createRybbitHandler({
    properties: async () => ({ properties: [{ id: '123', timeZone: 'UTC' }] }),
    read: async () => null, write: async () => {}, now: () => new Date('2026-10-22T12:00:00Z'),
    run: async request => {
      calls.push(request);
      const rows = request.dimensions.length
        ? hits.filter(hit => matches(request.dimensionFilter, hit)).map(hit => ({
          dimensionValues: [{ value: hit[field] }],
          metricValues: [1, 2, 0.5, 30, 1].map(value => ({ value: String(value) })),
        }))
        : [{ metricValues: [6, 12].map(value => ({ value: String(value) })) }];
      return { ok: true, rows, rowCount: rows.length };
    },
  });
  let body, status = 200;
  await handler({ method: 'GET', path: `/sites/123/${action}`, query: { ...query, parameter, ...extra } }, {
    status(code) { status = code; return this; }, send(value) { body = value; },
  });
  return { body, status, calls };
}

describe('explicit UTM reporting', () => {
  for (const parameter of Object.keys(dimensions)) {
    it(`only reports nonempty query parameters for ${parameter}`, async () => {
      const { body, status, calls } = await metric(parameter);
      expect(status).to.equal(200);
      expect(body.data.data.map(item => item.value)).to.deep.equal(['tagged', 'organic']);
      expect(body.data.totalCount).to.equal(2);
      expect(body.data.data[0].percentage).to.be.closeTo(100 / 6, 0.001);
      expect(calls[0].dimensions).to.deep.equal([{ name: dimensions[parameter] }]);
      expect(calls[1].dimensionFilter).to.equal(undefined);
    });
    it(`keeps ${parameter} filters from matching untagged attribution`, () => {
      const filter = filtersFor([{ parameter, type: 'equals', value: ['organic'] }]);
      const hit = { [dimensions[parameter]]: 'organic' };
      expect(matches(filter, { ...hit, pageLocation: 'https://example.com/' })).to.equal(false);
      expect(matches(filter, { ...hit, pageLocation: `https://example.com/?${parameter}=organic` })).to.equal(true);
      const negative = filtersFor([{ parameter, type: 'not_equals', value: ['organic'] }]);
      expect(matches(negative, { ...hit, pageLocation: 'https://example.com/' })).to.equal(true);
    });
  }
  it('applies the same restriction to lite reports and preserves other filters', async () => {
    const filters = JSON.stringify([{ parameter: 'utm_source', type: 'equals', value: ['tagged'] }]);
    const { body } = await metric('utm_source', 'metric-lite', { filters });
    expect(body.data.data.map(item => item.value)).to.deep.equal(['tagged']);
  });
  it('requires every selected UTM tag in custom dashboard groupings', async () => {
    const { dashboardCard } = require('../controllers/analysisReports');
    let filter;
    await dashboardCard({
      raw: { dimensions: ['utm_source', 'utm_medium'], metrics: ['sessions'] }, q: {},
      report: async (dimensions, metrics, expression) => { filter = expression; return { rows: [], rowCount: 0 }; },
    });
    expect(matches(filter, { pageLocation: 'https://example.com/' })).to.equal(false);
    expect(matches(filter, { pageLocation: 'https://example.com/?utm_source=newsletter' })).to.equal(false);
    expect(matches(filter, { pageLocation: 'https://example.com/?utm_source=newsletter&utm_medium=email' })).to.equal(true);
  });
  it('models real URL tags in demo reports while keeping untagged sources separate', () => {
    const { runReport } = require('../controllers/demoData')._internal;
    const report = (parameter, filter) => runReport({
      property: 'properties/311000101', dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
      dimensions: [{ name: parameter }], metrics: [{ name: 'sessions' }], dimensionFilter: filter,
    });
    const { utmPresenceFilter } = require('../lib/utm');
    const sources = report('sessionManualSource', utmPresenceFilter('utm_source'));
    expect(sources.rows.map(row => row.dimensionValues[0].value)).to.deep.equal(['newsletter']);
    expect(report('sessionManualTerm', utmPresenceFilter('utm_term')).rows).to.deep.equal([]);
    expect(report('sessionSource').rows.map(row => row.dimensionValues[0].value)).to.include('google');
    expect(report('landingPagePlusQueryString').rows.every(row => !row.dimensionValues[0].value.includes('utm_'))).to.equal(true);
  });
});

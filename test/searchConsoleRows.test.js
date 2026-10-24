const { expect } = require('chai');
const { joinSearchRows, pageKey, pageSearchLookup, bucketSearchTrend } = require('../controllers/searchConsoleRows');
const { searchFilters, matchProperty } = require('../controllers/searchConsole');

const ga = (value, count = 10) => ({ value, count, percentage: 50, active_users: 8, pageviews: 20 });
const search = values => ({ clicks: 10, impressions: 100, ctr: .1, position: 4, ...values });

describe('GSC metrics in existing analytics rows', () => {
  it('aggregates trend buckets with recalculated CTR and impression-weighted position', () => {
    const rows = [search({ date: '2026-10-01', clicks: 20, impressions: 100, position: 2 }),
      search({ date: '2026-10-02', clicks: 10, impressions: 300, position: 6 }),
      search({ date: '2026-11-01', clicks: 5, impressions: 20, position: 4 })];
    expect(bucketSearchTrend(rows, 'month')[0]).to.deep.equal({ date: '2026-10-01', clicks: 30, impressions: 400, ctr: .075, position: 5 });
    expect(bucketSearchTrend(rows, 'day')).to.have.length(3);
    expect(bucketSearchTrend(rows, 'year')[0]).to.include({ date: '2026-01-01', clicks: 35, impressions: 420 });
  });
  it('anchors weekly search buckets to Monday across year boundaries without timezone shifts', () => {
    const rows = [search({ date: '2026-12-31' }), search({ date: '2027-01-03' }), search({ date: '2027-01-04' })];
    expect(bucketSearchTrend(rows, 'week').map(row => [row.date, row.clicks])).to.deep.equal([['2026-12-28', 20], ['2027-01-04', 10]]);
  });
  it('keeps missing trend days absent and undefined rates unavailable', () => {
    const rows = [search({ date: '2026-10-01', clicks: 0, impressions: 0, ctr: null, position: null }), search({ date: '2026-10-03' })];
    const result = bucketSearchTrend(rows, 'day');
    expect(result.map(row => row.date)).to.deep.equal(['2026-10-01', '2026-10-03']);
    expect(result[0]).to.include({ ctr: null, position: null });
    expect(bucketSearchTrend([], 'month')).to.deep.equal([]);
  });
  it('uses whole-period search totals for percentages, including weighted section rollups', () => {
    const lookup = pageSearchLookup([search({ page: 'https://example.com/docs/a', clicks: 20, impressions: 100, position: 2 }),
      search({ page: 'https://example.com/docs/b', clicks: 10, impressions: 300, position: 6 })], { clicks: 100, impressions: 1000 }, true);
    expect(lookup({ kind: 'section', key: '/docs' })).to.deep.equal({ clicks: 30, impressions: 400, ctr: .075, position: 5, clickSharePct: 30, impressionSharePct: 40, partial: true });
    expect(lookup({ kind: 'page', key: '/docs/a' })).to.include({ clickSharePct: 20, impressionSharePct: 10, partial: false });
    expect(lookup({ kind: 'page', key: '/docs' })).to.equal(undefined);
    expect(lookup({ kind: 'section', key: '/doc' })).to.equal(undefined);
  });
  it('does not calculate a share with a missing or zero denominator', () => {
    const rows = [search({ page: 'https://example.com/' })];
    for (const totals of [null, { clicks: 0, impressions: 0 }]) {
      expect(pageSearchLookup(rows, totals)({ kind: 'page', key: '/' })).to.include({ clickSharePct: null, impressionSharePct: null });
    }
  });
  it('joins full search URLs to GA4 paths and computes weighted rank and CTR across URL variants', () => {
    const rows = joinSearchRows([ga('/pricing')], [search({ page: 'https://example.com/pricing?lang=en' }),
      search({ page: 'https://example.com/pricing?lang=fr', clicks: 30, impressions: 300, position: 8 })], 'page');
    expect(rows).to.have.length(1);
    expect(rows[0].analytics).to.deep.equal(ga('/pricing'));
    expect(rows[0].search).to.deep.equal({ clicks: 40, impressions: 400, ctr: .1, position: 7 });
  });
  it('matches Unicode paths while preserving encoded separators, case and trailing slash', () => {
    expect(pageKey('https://example.com/%E4%B8%AD%E6%96%87?a=1')).to.equal('/中文');
    expect(pageKey('/a%2Fb')).not.to.equal(pageKey('/a/b'));
    expect(pageKey('/About')).not.to.equal(pageKey('/about'));
    expect(pageKey('/about/')).not.to.equal(pageKey('/about'));
  });
  it('preserves unmatched rows from both sources without fabricating zero measurements', () => {
    const rows = joinSearchRows([ga('/only-ga4')], [search({ page: 'https://example.com/only-search' })], 'page');
    expect(rows.find(row => row.key === '/only-ga4').search).to.equal(undefined);
    expect(rows.find(row => row.key === '/only-search').analytics).to.equal(undefined);
  });
  it('deduplicates repeated GA4 pagination rows without adding sessions twice', () => {
    const rows = joinSearchRows([ga('/'), ga('/')], [search({ page: 'https://example.com/' })], 'page');
    expect(rows).to.have.length(1);
    expect(rows[0].analytics.count).to.equal(10);
  });
  it('joins countries by ISO alpha-2 and devices without case sensitivity', () => {
    expect(joinSearchRows([ga('US')], [search({ country: 'usa', countryCode: 'US' })], 'country')[0].search.clicks).to.equal(10);
    expect(joinSearchRows([ga('desktop')], [search({ device: 'DESKTOP' })], 'device')).to.have.length(1);
    const unknown = joinSearchRows([ga('XX')], [search({ country: 'zzz' })], 'country');
    expect(unknown).to.have.length(2);
  });
  it('keeps unmeasured CTR and rank null when impressions are absent', () => {
    const rows = joinSearchRows([], [search({ device: 'MOBILE', clicks: 0, impressions: 0, ctr: null, position: null })], 'device');
    expect(rows[0].search).to.deep.equal({ clicks: 0, impressions: 0, ctr: null, position: null });
  });
  it('translates the existing country row filters to GSC country codes, including exclusion', () => {
    const match = matchProperty({ domain: 'example.com' }, [{ siteUrl: 'sc-domain:example.com', permissionLevel: 'siteFullUser' }]);
    const filter = searchFilters([{ parameter: 'country', type: 'equals', value: ['US', 'CN'] }], match)[1];
    expect(filter.dimension).to.equal('country');
    expect(new RegExp(filter.expression).test('usa')).to.equal(true);
    expect(new RegExp(filter.expression).test('CHN')).to.equal(true);
    expect(new RegExp(filter.expression).test('CAN')).to.equal(false);
    expect(searchFilters([{ parameter: 'country', type: 'not_equals', value: ['US'] }], match)[1].operator).to.equal('excludingRegex');
    expect(() => searchFilters([{ parameter: 'country', type: 'contains', value: ['US'] }], match)).to.throw('exact country');
  });
});

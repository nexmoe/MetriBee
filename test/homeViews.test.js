const { expect } = require('chai');
const { getHomeView, sitesHomeUrl } = require('../lib/homeViews');

describe('homepage view links', () => {
  it('keeps the original cards as the default and safely handles unknown views', () => {
    expect(getHomeView(null)).to.equal('cards');
    expect(getHomeView('unknown')).to.equal('cards');
    expect(getHomeView('table')).to.equal('table');
    expect(getHomeView('heatmap')).to.equal('heatmap');
  });

  it('opens old Sites bookmarks in the corresponding homepage snapshot view', () => {
    expect(sitesHomeUrl('/sites')).to.equal('/?view=status');
    expect(sitesHomeUrl('/sites?view=look')).to.equal('/?view=status');
    expect(sitesHomeUrl('/sites?view=table')).to.equal('/?view=table');
    expect(sitesHomeUrl('/sites?view=heat')).to.equal('/?view=heatmap');
    expect(sitesHomeUrl('/sites?view=unknown')).to.equal('/?view=status');
    expect(sitesHomeUrl('/en/sites?view=table')).to.equal('/?view=table');
  });

  it('preserves the language, other query parameters and fragment', () => {
    const result = new URL(sitesHomeUrl('/zh/sites/?view=heat&prop=123&range=7d#report'), 'http://localhost');
    expect(result.pathname).to.equal('/zh');
    expect(Object.fromEntries(result.searchParams)).to.deep.equal({ view: 'heatmap', prop: '123', range: '7d' });
    expect(result.hash).to.equal('#report');
  });
});

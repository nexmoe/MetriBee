const { expect } = require('chai');
const { withPropertyAccounts, groupPropertiesByAccount, matchesPropertySet } = require('../public/js/homeAccounts');

describe('homepage account groups', () => {
  it('keeps accounts with the same display name separate by ID', () => {
    const groups = groupPropertiesByAccount([
      { propertyId: '1', accountId: '10', accountName: 'Sites' },
      { propertyId: '2', accountId: '20', accountName: 'Sites' },
    ]);
    expect(groups.map(g => g.accountId)).to.deep.equal(['10', '20']);
    expect(groups.map(g => g.properties.length)).to.deep.equal([1, 1]);
  });

  it('normalizes account IDs and preserves property ranking within each account', () => {
    const properties = [
      { propertyId: 'spike', accountId: 10, accountName: 'Sites', active: 20 },
      { propertyId: 'other', accountId: '20', accountName: 'Other', active: 50 },
      { propertyId: 'normal', accountId: '10', accountName: 'Sites', active: 100 },
    ];
    const before = JSON.stringify(properties);
    const group = groupPropertiesByAccount(properties).find(g => g.accountId === '10');
    expect(group.properties.map(p => p.propertyId)).to.deep.equal(['spike', 'normal']);
    expect(JSON.stringify(properties)).to.equal(before);
  });

  it('retains quiet and failed properties in their own accounts', () => {
    const groups = groupPropertiesByAccount([
      { propertyId: 'active', accountId: '10', accountName: 'First', active: 10 },
      { propertyId: 'quiet', accountId: '20', accountName: 'Second', active: 0 },
      { propertyId: 'error', accountId: '20', accountName: 'Second', error: 'No access' },
    ]);
    expect(groups[1].properties.map(p => p.propertyId)).to.deep.equal(['quiet', 'error']);
  });

  it('sorts account names consistently and keeps missing metadata in a final group', () => {
    const groups = groupPropertiesByAccount([
      { propertyId: 'unknown' },
      { propertyId: 'b', accountId: '20', accountName: 'Beta' },
      { propertyId: 'a', accountId: '10', accountName: 'Alpha' },
      { propertyId: 'also-unknown', accountId: '' },
    ]);
    expect(groups.map(g => g.accountName)).to.deep.equal(['Alpha', 'Beta', 'Account unavailable']);
    expect(groups[2].properties).to.have.length(2);
  });

  it('uses an account ID when its display name is unavailable', () => {
    const groups = groupPropertiesByAccount([{ propertyId: '1', accountId: '10' }]);
    expect(groups[0].accountName).to.equal('Account 10');
  });
});

describe('account metadata for cached homepage metrics', () => {
  it('updates renamed properties without refetching metrics or mutating cached rows', () => {
    const rows = [{ propertyId: '1', siteName: 'Old name', activeUsers: 42 }];
    expect(withPropertyAccounts(rows, [{ id: '1', site: 'Renamed property' }])[0]).to.include({ siteName: 'Renamed property', activeUsers: 42 });
    expect(rows[0].siteName).to.equal('Old name');
  });
  it('refreshes legacy metrics when an account refresh discovers or removes properties', () => {
    const entry = { data: [{ propertyId: '1' }, { propertyId: '2' }] };
    expect(matchesPropertySet(entry, [{ id: '1' }, { id: '2' }, { id: '3' }])).to.equal(false);
    expect(matchesPropertySet(entry, [{ id: '1' }])).to.equal(false);
  });

  it('does not repeatedly refetch when inaccessible properties have no metric rows', () => {
    const entry = { propertyIds: ['1', '2'], data: [{ propertyId: '1' }] };
    expect(matchesPropertySet(entry, [{ id: 2 }, { id: 1 }])).to.equal(true);
  });

  it('adds current account metadata without mutating or refetching cached metrics', () => {
    const rows = [{ propertyId: '1', activeUsers: 42, accountId: 'old', accountName: 'Old' }];
    const result = withPropertyAccounts(rows, [{ id: 1, accountId: '10', accountName: 'Current' }]);
    expect(result[0]).to.include({ activeUsers: 42, accountId: '10', accountName: 'Current' });
    expect(rows[0].accountName).to.equal('Old');
  });

  it('retains known account metadata if the property is absent from the cache', () => {
    const rows = [{ propertyId: '1', accountId: '10', accountName: 'Known' }, { propertyId: '2' }];
    const result = withPropertyAccounts(rows, []);
    expect(result[0]).to.include({ accountId: '10', accountName: 'Known' });
    expect(result[1]).to.include({ accountId: null, accountName: null });
  });
});

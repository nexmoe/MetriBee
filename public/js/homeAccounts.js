// Account metadata shared by the homepage and its cached report endpoints.
(function (g) {
  function matchesPropertySet(entry, properties) {
    const expected = properties.map(p => String(p.id)).sort();
    const actual = (entry.propertyIds || entry.data.map(p => p.propertyId)).map(String).sort();
    return expected.length === actual.length && expected.every((id, i) => id === actual[i]);
  }

  function withPropertyAccounts(rows, properties) {
    const byId = new Map(properties.map(p => [String(p.id), p]));
    return rows.map(row => {
      const property = byId.get(String(row.propertyId));
      return {
        ...row,
        siteName: property?.site ?? row.siteName,
        accountId: property?.accountId ?? row.accountId ?? null,
        accountName: property?.accountName ?? row.accountName ?? null,
      };
    });
  }

  function groupPropertiesByAccount(properties) {
    const groups = new Map();
    for (const property of properties) {
      const accountId = property.accountId == null || property.accountId === '' ? null : String(property.accountId);
      if (!groups.has(accountId)) {
        groups.set(accountId, {
          accountId,
          accountName: accountId ? property.accountName || `Account ${accountId}` : 'Account unavailable',
          properties: [],
        });
      }
      const group = groups.get(accountId);
      if (accountId && property.accountName) group.accountName = property.accountName;
      group.properties.push(property);
    }
    return [...groups.values()].sort((a, b) => {
      if (a.accountId === null) return 1;
      if (b.accountId === null) return -1;
      return a.accountName.localeCompare(b.accountName, undefined, { numeric: true, sensitivity: 'base' })
        || a.accountId.localeCompare(b.accountId, undefined, { numeric: true });
    });
  }

  const api = { withPropertyAccounts, groupPropertiesByAccount, matchesPropertySet };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else g.homeAccounts = api;
})(this);

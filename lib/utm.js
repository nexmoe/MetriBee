const UTM_PARAMETERS = new Set(['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']);

// GA4's manual attribution dimensions can include inferred traffic sources.
// Require the corresponding nonempty URL tag as evidence. GA4 strips UTMs from
// landingPagePlusQueryString and pagePathPlusQueryString; use pageLocation.
// Anchor before the fragment so a hash or an unrelated parameter cannot match.
function utmPresenceFilter(parameter) {
  if (!UTM_PARAMETERS.has(parameter)) return undefined;
  return { filter: { fieldName: 'pageLocation', stringFilter: {
    matchType: 'PARTIAL_REGEXP', value: `^[^?#]*\\?(?:[^#]*&)?${parameter}=[^&#]+`, caseSensitive: true,
  } } };
}

module.exports = { utmPresenceFilter };

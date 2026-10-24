function analyticsUrl(propertyId) {
  return `/analytics?prop=${encodeURIComponent(String(propertyId))}`;
}

function websiteUrl(rawUrl) {
  if (!rawUrl) return null;

  try {
    const parsed = new URL(String(rawUrl));
    return ["http:", "https:"].includes(parsed.protocol) ? String(rawUrl) : null;
  } catch {
    return null;
  }
}

module.exports = { analyticsUrl, websiteUrl };

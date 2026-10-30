const { AsyncLocalStorage } = require("node:async_hooks");
const { createHash } = require("node:crypto");
const storage = new AsyncLocalStorage();
function filterProperties(properties) {
  const context = storage.getStore();
  if (context?.publicSiteId) return properties.filter(property => String(property.id) === context.publicSiteId);
  return context?.access && context.identity
    ? context.access.filterProperties(context.identity, properties)
    : properties;
}
function cacheScope() {
  const context = storage.getStore();
  if (context?.publicSiteId) return `public-${context.publicSiteId}`;
  if (!context?.identity) return "all";
  const ids = context.access.db
    .prepare("SELECT propertyId FROM property_access ORDER BY propertyId")
    .all()
    .filter((p) => context.access.siteRole(context.identity, p.propertyId))
    .map((p) => p.propertyId);
  return createHash("sha256")
    .update(JSON.stringify(ids))
    .digest("hex")
    .slice(0, 24);
}
module.exports = { storage, filterProperties, cacheScope };

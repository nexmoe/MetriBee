// Rybbit's credential scopes filter discovery; live API permissions still authorize calls.
const { WRITE_TOOL_NAMES } = require("./tools");
const READ = {
  get_account_summaries: "sites:read",
  get_property_details: "sites:read",
  list_google_ads_links: "sites:read",
  get_custom_dimensions_and_metrics: "sites:read",
  list_properties: "sites:read",
  list_members: "org:read",
  list_teams: "org:read",
  list_saved_widgets: "sites:read",
  get_widget_report: "analytics:read",
  refresh_property_quota: "sites:configure",
  request_indexing: "sites:configure",
};
const CONTEXT_TOOLS = new Set([
  "list_sites",
  "get_capabilities",
  "get_setup_status",
]);
const ADMIN_TOOLS = new Set([
  "get_cache_status",
  "get_rate_limit_status",
  "run_pagespeed_insights",
  "request_indexing",
]);
function permissionForTool(name, args = {}) {
  if (CONTEXT_TOOLS.has(name) || ADMIN_TOOLS.has(name)) return null;
  if (
    name.endsWith("analysis_definition") ||
    name === "list_analysis_definitions"
  )
    return `${args.kind || "segments"}:${
      WRITE_TOOL_NAMES.includes(name) ? "write" : "read"
    }`;
  if (READ[name]) return READ[name];
  if (name === 'get_journeys_report' && args.mode === 'sessions' && args.path) return 'sessions:read';
  if (["add_member", "update_member_site_access"].includes(name))
    return "members:manage";
  if (["create_team", "update_team", "delete_team"].includes(name))
    return "teams:manage";
  if (name === "get_goals_report") return "goals:read";
  if (name === "run_dashboard_card") return "dashboards:read";
  if (/funnel/.test(name))
    return `funnels:${WRITE_TOOL_NAMES.includes(name) ? "write" : "read"}`;
  if (/widget/.test(name))
    return WRITE_TOOL_NAMES.includes(name) ? "sites:configure" : "sites:read";
  if (/search_console|search_analytics/.test(name)) return "gsc:read";
  return "analytics:read";
}
function toolAvailable(name, identity, access) {
  if (!access) return true;
  if (!identity) return false;
  if (CONTEXT_TOOLS.has(name)) return true;
  if (ADMIN_TOOLS.has(name))
    return (
      identity.systemAdmin && (!identity.bearer || identity.statements === null)
    );
  if (/analysis_definition/.test(name))
    return ["segments", "annotations", "goals", "dashboards"].some((kind) =>
      access.scopeAllows(identity, permissionForTool(name, { kind }))
    );
  return access.scopeAllows(identity, permissionForTool(name));
}
module.exports = {
  permissionForTool,
  toolAvailable,
  CONTEXT_TOOLS,
  ADMIN_TOOLS,
};

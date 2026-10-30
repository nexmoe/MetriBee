// Rybbit's organization/site permission semantics, backed by SQLite. See NOTICE.
const { openDatabase } = require("./database");
const {
  PERMISSIONS,
  permissionsForRole,
  roleHasPermission,
  isOrgRole,
  isAdminRole,
  higherRole,
  assignableRoles,
} = require("./permissions");
const { SCOPE_MATRIX } = require("./scopes");
const failure = (message, statusCode = 403) =>
  Object.assign(new Error(message), { statusCode, status: statusCode });

function createAccess(db = openDatabase()) {
  const membership = (identity, organizationId) => {
    if (!identity) return null;
    if (identity.organizationId)
      return identity.organizationId === organizationId
        ? { role: "admin", organizationId, hasRestrictedSiteAccess: 0 }
        : null;
    const row = db
      .prepare("SELECT * FROM member WHERE userId=? AND organizationId=?")
      .get(identity.userId, organizationId);
    if (identity.systemAdmin && !row)
      return { role: "owner", organizationId, hasRestrictedSiteAccess: 0 };
    return row && isOrgRole(row.role) ? row : null;
  };
  function scopeAllows(identity, permission) {
    const spec = PERMISSIONS[permission];
    if (!spec) return false;
    if (!identity?.bearer) return true;
    if (spec.scope === "deny-scoped")
      return !identity.organizationId && identity.statements === null;
    return (
      identity.statements === null ||
      identity.statements?.[spec.scope.resource]?.includes(spec.scope.action) ||
      (spec.scope.action === "read" &&
        identity.statements?.[spec.scope.resource]?.includes("write"))
    );
  }
  function siteRole(identity, propertyId) {
    const property = db
      .prepare("SELECT * FROM property_access WHERE propertyId=?")
      .get(String(propertyId));
    if (!property) return null;
    if (!property.organizationId) return identity?.systemAdmin ? "owner" : null;
    const member = membership(identity, property.organizationId);
    if (!member) return null;
    if (isAdminRole(member.role)) return member.role;
    const direct = db
      .prepare(
        "SELECT role FROM member_site_access WHERE memberId=? AND propertyId=?"
      )
      .all(member.id, String(propertyId));
    const teams = db
      .prepare(
        `SELECT a.role FROM team_site_access a JOIN team t ON t.id=a.teamId
      JOIN teamMember m ON m.teamId=t.id WHERE t.organizationId=? AND m.userId=? AND a.propertyId=?`
      )
      .all(property.organizationId, identity.userId, String(propertyId));
    const gated = db
      .prepare(
        `SELECT 1 FROM team_site_access a JOIN team t ON t.id=a.teamId
      WHERE t.organizationId=? AND a.propertyId=? LIMIT 1`
      )
      .get(property.organizationId, String(propertyId));
    const grants = [
      ...(member.hasRestrictedSiteAccess ? direct : []),
      ...teams,
    ];
    if (!grants.length && (member.hasRestrictedSiteAccess || gated))
      return null;
    return grants.reduce(
      (role, grant) => higherRole(role, grant.role),
      member.role
    );
  }
  function requireOrg(identity, id, permission = "org:read") {
    const member = membership(identity, id);
    if (
      !member ||
      !roleHasPermission(member.role, permission) ||
      !scopeAllows(identity, permission)
    )
      throw failure("You do not have permission in this organization.");
    return member;
  }
  function requireSite(identity, id, permission = "analytics:read") {
    const role = siteRole(identity, id);
    if (
      !role ||
      !roleHasPermission(role, permission) ||
      !scopeAllows(identity, permission)
    )
      throw failure("You do not have permission on this property.");
    return role;
  }
  function organizations(identity) {
    const rows = identity?.organizationId
      ? db
          .prepare("SELECT o.*, ? AS role FROM organization o WHERE id=?")
          .all("admin", identity.organizationId)
      : db
          .prepare(
            "SELECT o.*,m.role FROM organization o JOIN member m ON m.organizationId=o.id WHERE m.userId=?"
          )
          .all(identity?.userId || "");
    return rows
      .filter((row) => isOrgRole(row.role))
      .map((row) => ({
        ...row,
        permissions: permissionsForRole(row.role).filter((p) =>
          scopeAllows(identity, p)
        ),
        assignableRoles: assignableRoles(row.role),
      }));
  }
  function decorateProperty(identity, property) {
    const stored = db
      .prepare("SELECT * FROM property_access WHERE propertyId=?")
      .get(String(property.id ?? property.siteId));
    const role = siteRole(identity, property.id ?? property.siteId);
    return {
      ...property,
      organizationId: stored?.organizationId,
      role,
      isOwner: role === "owner",
      permissions: permissionsForRole(role).filter((p) =>
        scopeAllows(identity, p)
      ),
      tags: JSON.parse(stored?.tags || "[]"),
      teams: db
        .prepare(
          `SELECT t.id,t.name FROM team t JOIN team_site_access a ON a.teamId=t.id WHERE a.propertyId=? AND t.organizationId=?`
        )
        .all(
          String(property.id ?? property.siteId),
          stored?.organizationId || ""
        ),
    };
  }
  function syncProperties(properties) {
    const defaultOrg = db
      .prepare("SELECT value FROM app_setting WHERE key='defaultOrganization'")
      .get()?.value;
    db.transaction(() => {
      for (const p of properties)
        db.prepare(
          `INSERT INTO property_access(propertyId,organizationId,name,domain) VALUES(?,?,?,?)
        ON CONFLICT(propertyId) DO UPDATE SET name=excluded.name,domain=excluded.domain`
        ).run(
          String(p.id),
          defaultOrg || "",
          p.site || p.name || String(p.id),
          p.domain || ""
        );
    }).immediate();
  }
  return {
    db,
    membership,
    siteRole,
    scopeAllows,
    requireOrg,
    requireSite,
    organizations,
    decorateProperty,
    syncProperties,
    filterProperties: (identity, properties, organizationId) =>
      properties.filter(
        (p) =>
          (!organizationId ||
            db
              .prepare(
                "SELECT organizationId FROM property_access WHERE propertyId=?"
              )
              .get(String(p.id))?.organizationId === organizationId) &&
          siteRole(identity, p.id)
      ),
  };
}
function validateScopes(value) {
  if (value == null) return undefined;
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !Object.keys(value).length
  )
    throw failure("Choose at least one API permission.", 400);
  for (const [resource, actions] of Object.entries(value))
    if (
      !SCOPE_MATRIX[resource] ||
      !Array.isArray(actions) ||
      !actions.length ||
      actions.some((a) => !SCOPE_MATRIX[resource].includes(a))
    )
      throw failure("Invalid API permission.", 400);
  return value;
}
module.exports = { createAccess, failure, validateScopes };

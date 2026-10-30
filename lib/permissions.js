// Derived from Rybbit shared/src/permissions.ts. AGPL-3.0-only; see NOTICE.
"use strict";
// Roles and permissions — the one answer to "what may this role do?".
//
// Pure data, like scopes.ts: the server enforces it (route guards, handler
// checks) and the client reads the permission names the server hands back.
// Nothing outside this file compares role strings to decide what a user may
// do; it asks roleHasPermission instead.
//
// A role is a rung on a ladder: every role holds all the permissions of the
// roles below it. Each permission names the lowest role that holds it and the
// bearer-credential scope it needs, so a request is allowed only when BOTH the
// caller's role and (for API keys and OAuth tokens) its scopes admit it.
Object.defineProperty(exports, "__esModule", { value: true });
exports.ALL_PERMISSIONS = exports.PERMISSIONS = exports.SITE_GRANT_ROLES = exports.ORG_ROLES = void 0;
exports.isOrgRole = isOrgRole;
exports.isSiteGrantRole = isSiteGrantRole;
exports.isAdminRole = isAdminRole;
exports.higherRole = higherRole;
exports.roleHasPermission = roleHasPermission;
exports.permissionsForRole = permissionsForRole;
exports.canAssignRole = canAssignRole;
exports.assignableRoles = assignableRoles;
// Highest first.
//  - owner:  everything, including billing and deleting the organization
//  - admin:  members, teams, API keys, creating/deleting/transferring sites
//  - editor: configures sites — tracking settings, flags, experiments, imports,
//            Search Console — and manages everyone's saved segments/annotations
//  - member: builds reports — goals, funnels, dashboards, own segments/annotations
//  - viewer: reads everything the organization lets them see, changes nothing
exports.ORG_ROLES = ["owner", "admin", "editor", "member", "viewer"];
const ROLE_RANK = {
    viewer: 1,
    member: 2,
    editor: 3,
    admin: 4,
    owner: 5,
};
function isOrgRole(value) {
    return typeof value === "string" && Object.prototype.hasOwnProperty.call(ROLE_RANK, value);
}
/**
 * Roles a site grant (a member's per-site access, or a team's) can carry.
 * Admin authority is organization-wide, so grants stop at editor.
 */
exports.SITE_GRANT_ROLES = ["editor", "member", "viewer"];
function isSiteGrantRole(value) {
    return typeof value === "string" && exports.SITE_GRANT_ROLES.includes(value);
}
/** Admins and owners: every site in the organization, never narrowed by site grants or teams. */
function isAdminRole(role) {
    return role === "admin" || role === "owner";
}
/** The higher of two roles; null when neither is a known role. */
function higherRole(a, b) {
    const left = isOrgRole(a) ? a : null;
    const right = isOrgRole(b) ? b : null;
    if (!left)
        return right;
    if (!right)
        return left;
    return ROLE_RANK[left] >= ROLE_RANK[right] ? left : right;
}
const read = (resource) => ({ resource, action: "read" });
const write = (resource) => ({ resource, action: "write" });
exports.PERMISSIONS = {
    // Reading a site's analytics and the organization it belongs to.
    "analytics:read": { minRole: "viewer", scope: read("analytics") },
    "sessions:read": { minRole: "viewer", scope: read("sessions") },
    "events:read": { minRole: "viewer", scope: read("events") },
    "users:read": { minRole: "viewer", scope: read("users") },
    "funnels:read": { minRole: "viewer", scope: read("funnels") },
    "goals:read": { minRole: "viewer", scope: read("goals") },
    "annotations:read": { minRole: "viewer", scope: read("annotations") },
    "segments:read": { minRole: "viewer", scope: read("segments") },
    "dashboards:read": { minRole: "viewer", scope: read("dashboards") },
    "flags:read": { minRole: "viewer", scope: read("flags") },
    "experiments:read": { minRole: "viewer", scope: read("experiments") },
    "replay:read": { minRole: "viewer", scope: read("replay") },
    "gsc:read": { minRole: "viewer", scope: read("gsc") },
    "sites:read": { minRole: "viewer", scope: read("sites") },
    "sql:read": { minRole: "viewer", scope: read("sql") },
    "org:read": { minRole: "viewer", scope: read("org") },
    // Building reports: shared analysis objects, and a member's own segments and
    // annotations (rows another user created need the :manage permission).
    "users:write": { minRole: "member", scope: write("users") },
    "funnels:write": { minRole: "member", scope: write("funnels") },
    "goals:write": { minRole: "member", scope: write("goals") },
    "dashboards:write": { minRole: "member", scope: write("dashboards") },
    "annotations:write": { minRole: "member", scope: write("annotations") },
    "segments:write": { minRole: "member", scope: write("segments") },
    // Configuring a site, and managing saved segments and annotations other people
    // created (org-wide ones are checked against the organization role).
    "annotations:manage": { minRole: "editor", scope: write("annotations") },
    "segments:manage": { minRole: "editor", scope: write("segments") },
    "users:delete": { minRole: "editor", scope: write("users") },
    "replay:delete": { minRole: "editor", scope: write("replay") },
    "flags:write": { minRole: "editor", scope: write("flags") },
    "experiments:write": { minRole: "editor", scope: write("experiments") },
    "gsc:write": { minRole: "editor", scope: write("gsc") },
    "sites:configure": { minRole: "editor", scope: write("sites") },
    "imports:read": { minRole: "editor", scope: read("sites") },
    "imports:write": { minRole: "editor", scope: write("sites") },
    // Administering the organization.
    "sites:create": { minRole: "admin", scope: write("sites") },
    "sites:delete": { minRole: "admin", scope: write("sites") },
    "sites:transfer": { minRole: "admin", scope: write("sites") },
    "members:manage": { minRole: "admin", scope: write("org") },
    "teams:manage": { minRole: "admin", scope: write("org") },
    "apikeys:manage": { minRole: "admin", scope: "deny-scoped" },
    // Enforced by better-auth's organization access control (orgRoles in the
    // server's auth.ts); listed here so the client can ask for it by name.
    "org:rename": { minRole: "admin", scope: "deny-scoped" },
    // Owning the organization.
    "billing:manage": { minRole: "owner", scope: "deny-scoped" },
    "org:delete": { minRole: "owner", scope: "deny-scoped" },
};
exports.ALL_PERMISSIONS = Object.keys(exports.PERMISSIONS);
function roleHasPermission(role, permission) {
    if (!isOrgRole(role)) {
        return false;
    }
    return ROLE_RANK[role] >= ROLE_RANK[exports.PERMISSIONS[permission].minRole];
}
/** Every permission the role holds, in declaration order. */
function permissionsForRole(role) {
    return exports.ALL_PERMISSIONS.filter(permission => roleHasPermission(role, permission));
}
/**
 * Whether someone holding `actorRole` may give another member `targetRole`:
 * they must manage members, and never grant a role above their own (only an
 * owner makes owners).
 */
function canAssignRole(actorRole, targetRole) {
    if (!isOrgRole(actorRole) || !isOrgRole(targetRole)) {
        return false;
    }
    return roleHasPermission(actorRole, "members:manage") && ROLE_RANK[actorRole] >= ROLE_RANK[targetRole];
}
/** The roles someone holding `actorRole` may give to others, highest first. */
function assignableRoles(actorRole) {
    return exports.ORG_ROLES.filter(role => canAssignRole(actorRole, role));
}

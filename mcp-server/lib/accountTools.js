// Adapted from Rybbit server/src/mcp/tools/{organizations,sites}.ts.
// AGPL-3.0-only; see frontend/third-party/NOTICE.md.
const { z } = require("zod");
const ACCOUNT_TOOL_NAMES = [
  "list_sites",
  "list_members",
  "add_member",
  "update_member_site_access",
  "list_teams",
  "create_team",
  "update_team",
  "delete_team",
];
const ACCOUNT_WRITE_TOOL_NAMES = [
  "add_member",
  "update_member_site_access",
  "create_team",
  "update_team",
  "delete_team",
];
const organization_id = z
  .string()
  .min(1)
  .max(200)
  .describe("Organization ID from list_sites");
const team_id = z.string().min(1).max(200).describe("Team ID from list_teams");
const site_ids = z
  .array(z.number().int().positive().max(Number.MAX_SAFE_INTEGER))
  .max(10000);
const site_role = z.enum(["editor", "member", "viewer"]).nullable().optional();
const member_user_ids = z
  .array(z.string().min(1).max(200))
  .max(10000)
  .optional();
const teamFields = {
  name: z.string().trim().min(1).max(200),
  member_user_ids,
  site_ids: site_ids.optional(),
  site_role,
};
const orgPath = (id) => `/organizations/${encodeURIComponent(id)}`;
function registerAccountTools({ registerTool, asText, api }) {
  const add = (name, description, shape, call) =>
    registerTool(
      name,
      {
        description,
        inputSchema: z.object(shape).strict(),
        annotations: {
          openWorldHint: false,
          ...(name === "update_team" || name === "update_member_site_access"
            ? { idempotentHint: true }
            : {}),
        },
      },
      async (args) => {
        if (!api)
          throw new Error(
            "Account tools require an authenticated HTTP connection."
          );
        return asText(await call(args));
      }
    );
  add(
    "list_sites",
    "Start here: list accessible organizations and sites, their organization roles, effective site permissions and team grants. Uses current access, never the organization selected in another browser. No Google calls.",
    {},
    async () => {
      const orgs = await api.call("GET", "/organizations");
      return {
        organizations: orgs.map((org) => ({
          organization_id: org.id,
          name: org.name,
          slug: org.slug,
          role: org.role,
          permissions: org.permissions,
          sites: org.sites.map((site) => ({
            site_id: Number(site.id),
            name: site.name,
            domain: site.domain,
            public: site.public ?? false,
            role: site.role,
            permissions: site.permissions,
            teams: site.teams,
          })),
        })),
      };
    }
  );
  add(
    "list_members",
    "List organization members, roles, restricted site access and team memberships. member_id is the membership record; team tools use userId.",
    { organization_id },
    (args) => api.call("GET", `${orgPath(args.organization_id)}/members`)
  );
  add(
    "add_member",
    "Add an existing account by email. Requires organization admin/owner and org:write; cannot grant a role above your own. Requires explicit user intent.",
    {
      organization_id,
      email: z.string().email(),
      role: z.enum(["owner", "admin", "editor", "member", "viewer"]),
    },
    (args) =>
      api.call("POST", `${orgPath(args.organization_id)}/members`, {
        email: args.email,
        role: args.role,
      })
  );
  add(
    "update_member_site_access",
    "Restrict or lift a member’s site access. Requires organization admin/owner. Grants cannot cross organizations; site_role can raise the site role, never organization authority. Requires explicit user intent.",
    {
      organization_id,
      member_id: z.string().min(1).max(200),
      has_restricted_site_access: z.boolean(),
      site_ids,
      site_role,
    },
    (args) =>
      api.call(
        "PUT",
        `${orgPath(args.organization_id)}/members/${encodeURIComponent(
          args.member_id
        )}/sites`,
        {
          hasRestrictedSiteAccess: args.has_restricted_site_access,
          siteIds: args.site_ids,
          siteRole: args.site_role,
        }
      )
  );
  add(
    "list_teams",
    "List teams visible to you, with members and site grants. Organization admins/owners see all teams; other members see their own teams.",
    { organization_id },
    (args) => api.call("GET", `${orgPath(args.organization_id)}/teams`)
  );
  const teamBody = (args) => ({
    name: args.name,
    memberUserIds: args.member_user_ids,
    siteIds: args.site_ids,
    siteRole: args.site_role,
  });
  add(
    "create_team",
    "Create a team with optional members and site grants. Requires organization admin/owner and explicit user intent.",
    { organization_id, ...teamFields },
    (args) =>
      api.call("POST", `${orgPath(args.organization_id)}/teams`, teamBody(args))
  );
  add(
    "update_team",
    "Rename a team or replace its member/site lists. Provided arrays replace the entire list: read list_teams first. Requires organization admin/owner and explicit user intent.",
    {
      organization_id,
      team_id,
      ...teamFields,
      name: teamFields.name.optional(),
    },
    (args) =>
      api.call(
        "PUT",
        `${orgPath(args.organization_id)}/teams/${encodeURIComponent(
          args.team_id
        )}`,
        teamBody(args)
      )
  );
  add(
    "delete_team",
    "Permanently delete a team and its grants; members keep organization membership. Requires organization admin/owner. Confirm the deletion with the user before calling.",
    { organization_id, team_id },
    (args) =>
      api.call(
        "DELETE",
        `${orgPath(args.organization_id)}/teams/${encodeURIComponent(
          args.team_id
        )}`
      )
  );
}
module.exports = {
  registerAccountTools,
  ACCOUNT_TOOL_NAMES,
  ACCOUNT_WRITE_TOOL_NAMES,
};

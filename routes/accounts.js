const { randomUUID, createHash } = require("node:crypto");
const { failure, validateScopes } = require("../lib/access");
const {
  isOrgRole,
  isAdminRole,
  isSiteGrantRole,
  canAssignRole,
} = require("../lib/permissions");
const { statements } = require("../lib/identity");
const now = () => new Date().toISOString();
const iso = (value) =>
  value == null ? null : new Date(Number(value) || value).toISOString();
const integerIds = (value) => {
  if (
    !Array.isArray(value) ||
    value.length > 10000 ||
    value.some((id) => !Number.isSafeInteger(id) || id < 1)
  )
    throw failure("Choose valid property IDs.", 400);
  return [...new Set(value)].map(String);
};

async function accountRoutes(app, runtime) {
  const { auth, db, access, mailer, baseURL, validateSites } = runtime;
  const root = "/api/rybbit";
  const billingView = (organizationId) => {
    const billing=app.billing;
    const sub=billing?.cloud ? billing.subscription(organizationId) : null;
    const plan=sub ? billing.catalog().plans.find(p=>p.productId===sub.productId) : null;
    return {id:sub?.orderId || null,source:sub ? 'waffo':'free',
      planName:billing?.cloud ? plan?.name || 'free':'self-hosted',status:sub?.status || (billing?.cloud?'free':'active'),
      eventLimit:0,currentPeriodEnd:sub?.currentPeriodEnd || null,cancelAtPeriodEnd:sub?.status==='canceling',
      interval:sub?.interval,memberLimit:null,siteLimit:null};
  };
  const publicSettings = require('../lib/embedStore').createEmbedStore();
  const headersFor = (request) =>
    new Headers(
      Object.entries(request.headers)
        .filter(([, v]) => v != null)
        .map(([k, v]) => [k, Array.isArray(v) ? v.join(",") : String(v)])
    );
  const requireSession = (req) => {
    if (!req.identity?.userId || req.identity.bearer)
      throw failure("A signed-in user session is required.", 401);
    return req.identity;
  };
  const adminOnly = (req) => {
    const identity = requireSession(req);
    if (!identity.systemAdmin)
      throw failure("System administrator permission is required.");
    return identity;
  };
  const org = (req, permission = "org:read") =>
    access.requireOrg(req.identity, req.params.organizationId, permission);
  const memberFor = (req) => {
    const row = db
      .prepare("SELECT * FROM member WHERE id=? AND organizationId=?")
      .get(req.params.memberId, req.params.organizationId);
    if (!row) throw failure("Member not found.", 404);
    return row;
  };
  const assertRole = (actor, targetRole) => {
    if (!isOrgRole(targetRole) || !canAssignRole(actor.role, targetRole))
      throw failure("You cannot assign or change this role.");
  };
  const assertOwnerRetained = (member) => {
    if (
      member.role === "owner" &&
      db
        .prepare(
          "SELECT count(*) n FROM member WHERE organizationId=? AND role='owner'"
        )
        .get(member.organizationId).n <= 1
    )
      throw failure("An organization must retain an owner.");
  };
  function members(organizationId) {
    return db
      .prepare(
        `SELECT m.*,u.name,u.email FROM member m JOIN user u ON u.id=m.userId WHERE m.organizationId=? ORDER BY m.createdAt`
      )
      .all(organizationId)
      .map((m) => {
        const grants = db
          .prepare(
            "SELECT propertyId,role FROM member_site_access WHERE memberId=?"
          )
          .all(m.id);
        const grantRoles = new Set(grants.map((g) => g.role));
        return {
          id: m.id,
          role: m.role,
          userId: m.userId,
          organizationId,
          createdAt: iso(m.createdAt),
          user: { id: m.userId, name: m.name, email: m.email },
          siteAccess: {
            hasRestrictedSiteAccess: !!m.hasRestrictedSiteAccess,
            siteIds: grants.map((g) => Number(g.propertyId)),
            siteRole: grantRoles.size === 1 ? grants[0].role : null,
            siteGrants: grants.map((g) => ({
              siteId: Number(g.propertyId),
              role: g.role,
            })),
          },
          teams: db
            .prepare(
              "SELECT t.id,t.name FROM team t JOIN teamMember tm ON tm.teamId=t.id WHERE t.organizationId=? AND tm.userId=?"
            )
            .all(organizationId, m.userId),
        };
      });
  }
  function teamView(t) {
    const sites = db
      .prepare(
        "SELECT p.*,a.role FROM property_access p JOIN team_site_access a ON a.propertyId=p.propertyId WHERE a.teamId=? AND p.organizationId=?"
      )
      .all(t.id, t.organizationId)
      .map((s) => ({
        siteId: Number(s.propertyId),
        name: s.name,
        domain: s.domain,
        role: s.role,
      }));
    const roles = new Set(sites.map((s) => s.role));
    return {
      ...t,
      createdAt: iso(t.createdAt),
      updatedAt: iso(t.updatedAt),
      members: db
        .prepare(
          "SELECT u.id userId,u.name userName,u.email userEmail FROM user u JOIN teamMember tm ON tm.userId=u.id JOIN member m ON m.userId=u.id AND m.organizationId=? WHERE tm.teamId=?"
        )
        .all(t.organizationId, t.id),
      sites,
      siteRole: roles.size === 1 ? sites[0].role : null,
    };
  }
  function updateMemberSites(target, body) {
    if (typeof body.hasRestrictedSiteAccess !== "boolean")
      throw failure("Choose whether to restrict site access.", 400);
    const ids = integerIds(body.siteIds || []),
      restricted = body.hasRestrictedSiteAccess;
    if (restricted && isAdminRole(target.role))
      throw failure(
        "Owners and admins cannot have restricted site access.",
        400
      );
    if (body.siteRole != null && !isSiteGrantRole(body.siteRole))
      throw failure("Choose a valid site role.", 400);
    validateSites(ids.map(Number), target.organizationId);
    const prior = new Map(
      db
        .prepare(
          "SELECT propertyId,role FROM member_site_access WHERE memberId=?"
        )
        .all(target.id)
        .map((g) => [g.propertyId, g.role])
    );
    db.transaction(() => {
      db.prepare("UPDATE member SET hasRestrictedSiteAccess=? WHERE id=?").run(
        Number(restricted),
        target.id
      );
      db.prepare("DELETE FROM member_site_access WHERE memberId=?").run(
        target.id
      );
      if (restricted)
        for (const id of ids)
          db.prepare("INSERT INTO member_site_access VALUES(?,?,?)").run(
            target.id,
            id,
            body.siteRole === undefined ? prior.get(id) ?? null : body.siteRole
          );
    }).immediate();
  }
  function moveProperty(id, organizationId) {
    if (
      !db.prepare("SELECT 1 FROM organization WHERE id=?").get(organizationId)
    )
      throw failure("Organization not found.", 404);
    db.transaction(() => {
      const changed = db
        .prepare(
          "UPDATE property_access SET organizationId=? WHERE propertyId=?"
        )
        .run(organizationId, String(id));
      if (!changed.changes) throw failure("Property not found.", 404);
      db.prepare('UPDATE analysis_object SET organizationId=? WHERE propertyId=?').run(organizationId, String(id));
      db.prepare("DELETE FROM member_site_access WHERE propertyId=?").run(
        String(id)
      );
      db.prepare("DELETE FROM team_site_access WHERE propertyId=?").run(
        String(id)
      );
      db.prepare(
        "UPDATE site_transfer SET status='cancelled' WHERE propertyId=? AND status='pending'"
      ).run(String(id));
    }).immediate();
  }

  app.all("/api/auth/*", { logLevel: "warn" }, async (req, reply) => {
    const headers = headersFor(req);
    // Never accept an arbitrary client-supplied forwarding header as the login rate-limit identity.
    headers.delete("x-forwarded-for");
    headers.set("x-forwarded-for", req.ip);
    const body =
      req.body === undefined
        ? undefined
        : headers
            .get("content-type")
            ?.startsWith("application/x-www-form-urlencoded")
        ? new URLSearchParams(req.body).toString()
        : JSON.stringify(req.body);
    const response = await auth.handler(
      new Request(new URL(req.url, baseURL), {
        method: req.method,
        headers,
        ...(!["GET", "HEAD"].includes(req.method) && body !== undefined
          ? { body }
          : {}),
      })
    );
    reply.code(response.status);
    for (const [key, value] of response.headers)
      if (key !== "set-cookie") reply.header(key, value);
    const cookies = response.headers.getSetCookie();
    if (cookies.length) reply.header("set-cookie", cookies);
    return reply.send(await response.text());
  });
  app.get(`${root}/config`, { config: { public: true } }, async () => ({
    disableSignup:
      process.env.DISABLE_SIGNUP === "true" &&
      !!db.prepare("SELECT 1 FROM user LIMIT 1").get(),
    registrationRequired: !db.prepare("SELECT 1 FROM user LIMIT 1").get(),
    mailConfigured: mailer.configured,
    socialProviders: Object.keys(auth.options.socialProviders),
    mapboxToken: "",
    liteDashboard: false,
  }));
  app.get(`${root}/user/mcp-connection`, async (req, reply) => {
    requireSession(req);
    reply.header('Cache-Control', 'no-store');
    return {
      url: (process.env.MCP_PUBLIC_URL || `${baseURL}/api/mcp`).trim(),
      oauthAvailable: auth.options.plugins.some(plugin => plugin.id === 'oauth-provider'),
    };
  });
  app.get(`${root}/user/organizations`, async (req) => {
    if (!access.scopeAllows(req.identity, "org:read"))
      throw failure("This credential does not grant organization access.");
    return access.organizations(req.identity);
  });
  // Minimal discovery is always available to authenticated MCP credentials,
  // just as Rybbit's list_sites; it never widens site access or reads Google.
  app.get(`${root}/organizations`, async (req) => {
    if (!req.identity) throw failure('Authentication required.', 401);
    return Promise.all(access.organizations(req.identity).map(async organization => ({
      id: organization.id, name: organization.name, slug: organization.slug,
      role: organization.role, permissions: organization.permissions,
      sites: await Promise.all(db.prepare('SELECT * FROM property_access WHERE organizationId=? ORDER BY name,propertyId')
        .all(organization.id).filter(site => access.siteRole(req.identity, site.propertyId))
        .map(async site => access.decorateProperty(req.identity, {
          id: site.propertyId, name: site.name, domain: site.domain, public: await publicSettings.isPublic(site.propertyId),
        }))),
    })));
  });
  app.post(`${root}/user/account-settings`, async (req) => {
    const identity = requireSession(req);
    if (typeof req.body?.sendAutoEmailReports !== "boolean")
      throw failure("Choose an email report preference.", 400);
    db.prepare(
      "UPDATE user SET sendAutoEmailReports=?,updatedAt=? WHERE id=?"
    ).run(Number(req.body.sendAutoEmailReports), Date.now(), identity.userId);
    return {
      success: true,
      settings: { sendAutoEmailReports: req.body.sendAutoEmailReports },
    };
  });
  for (const isOrg of [false, true])
    app.post(
      isOrg
        ? `${root}/organizations/:organizationId/api-keys`
        : `${root}/user/api-keys`,
      async (req) => {
        requireSession(req);
        if (isOrg) org(req, "apikeys:manage");
        const { name, expiresIn, permissions } = req.body || {};
        if (typeof name !== "string" || !name.trim() || name.length > 200)
          throw failure("Choose a key name.", 400);
        return auth.api.createApiKey({
          body: {
            userId: req.identity.userId,
            name: name.trim(),
            ...(expiresIn !== undefined ? { expiresIn } : {}),
            permissions: validateScopes(permissions),
            ...(isOrg
              ? {
                  configId: "org",
                  organizationId: req.params.organizationId,
                  metadata: { createdBy: req.identity.userId },
                }
              : {}),
          },
        });
      }
    );
  app.get(`${root}/organizations/:organizationId/api-usage`, async (req) => {
    org(req);
    return {
      metered: false,
      available: true,
      dailyUsed: 0,
      dailyLimit: 0,
      dailyRemaining: 0,
      resetsInSeconds: 0,
      burstLimit: 0,
      burstWindowSeconds: 0,
    };
  });
  app.get(`${root}/organizations/:organizationId/members`, async (req) => {
    org(req);
    return { data: members(req.params.organizationId) };
  });
  app.post(`${root}/organizations/:organizationId/members`, async (req) => {
    const actor = org(req, "members:manage");
    assertRole(actor, req.body?.role);
    const user = db.prepare("SELECT id FROM user WHERE email=?").get(
      String(req.body.email || "")
        .trim()
        .toLowerCase()
    );
    if (!user)
      throw failure("User not found. Invite them or create an account.", 404);
    if (
      db
        .prepare("SELECT 1 FROM member WHERE userId=? AND organizationId=?")
        .get(user.id, req.params.organizationId)
    )
      throw failure("This user already belongs to the organization.", 409);
    db.prepare(
      "INSERT INTO member(id,organizationId,userId,role,createdAt,hasRestrictedSiteAccess) VALUES(?,?,?,?,?,0)"
    ).run(
      randomUUID(),
      req.params.organizationId,
      user.id,
      req.body.role,
      Date.now()
    );
    return { message: "Member added successfully" };
  });
  app.post(`${root}/organizations/:organizationId/users`, async (req) => {
    const actor = org(req, "members:manage");
    assertRole(actor, req.body?.role);
    const { email, password, name } = req.body || {};
    if (
      typeof email !== "string" ||
      !/^\S+@\S+\.\S+$/.test(email) ||
      typeof password !== "string" ||
      password.length < 8 ||
      password.length > 128 ||
      (name !== undefined && (typeof name !== "string" || name.length > 200))
    )
      throw failure(
        "Use a valid email and a password of at least 8 characters.",
        400
      );
    if (
      db
        .prepare("SELECT 1 FROM user WHERE email=?")
        .get(email.trim().toLowerCase())
    )
      throw failure("An account already exists for this email.", 409);
    const context = await auth.$context;
    const user = await context.internalAdapter.createUser({
      email: email.trim().toLowerCase(),
      name: name?.trim() || email,
      emailVerified: false,
    });
    try {
      await context.internalAdapter.createAccount({
        userId: user.id,
        providerId: "credential",
        accountId: user.id,
        password: await context.password.hash(password),
      });
      db.prepare(
        "INSERT INTO member(id,organizationId,userId,role,createdAt,hasRestrictedSiteAccess) VALUES(?,?,?,?,?,0)"
      ).run(
        randomUUID(),
        req.params.organizationId,
        user.id,
        req.body.role,
        Date.now()
      );
    } catch (error) {
      await context.internalAdapter.deleteUser(user.id);
      throw error;
    }
    return {
      message: "User created successfully",
      user: { id: user.id, email: user.email, name: user.name },
    };
  });
  app.put(
    `${root}/organizations/:organizationId/members/:memberId/sites`,
    async (req) => {
      const actor = org(req, "members:manage"),
        target = memberFor(req);
      assertRole(actor, target.role);
      updateMemberSites(target, req.body || {});
      return { success: true };
    }
  );
  app.get(`${root}/organizations/:organizationId/teams`, async (req) => {
    org(req);
    let teams = db
      .prepare("SELECT * FROM team WHERE organizationId=? ORDER BY createdAt")
      .all(req.params.organizationId);
    if (
      !isAdminRole(
        access.membership(req.identity, req.params.organizationId)?.role
      )
    )
      teams = teams.filter((t) =>
        db
          .prepare("SELECT 1 FROM teamMember WHERE teamId=? AND userId=?")
          .get(t.id, req.identity.userId)
      );
    return { teams: teams.map(teamView) };
  });
  for (const method of ["POST", "PUT"])
    app.route({
      method,
      url:
        method === "POST"
          ? `${root}/organizations/:organizationId/teams`
          : `${root}/organizations/:organizationId/teams/:teamId`,
      handler: async (req) => {
        org(req, "teams:manage");
        const body = req.body || {};
        const existing =
          method === "PUT"
            ? db
                .prepare("SELECT * FROM team WHERE id=? AND organizationId=?")
                .get(req.params.teamId, req.params.organizationId)
            : null;
        if (method === "PUT" && !existing)
          throw failure("Team not found.", 404);
        if (
          (!existing || body.name !== undefined) &&
          (typeof body.name !== "string" ||
            !body.name.trim() ||
            body.name.length > 200)
        )
          throw failure("Choose a team name.", 400);
        if (
          body.memberUserIds !== undefined &&
          !Array.isArray(body.memberUserIds)
        )
          throw failure("Choose valid team members.", 400);
        const memberIds =
          body.memberUserIds === undefined
            ? undefined
            : [...new Set(body.memberUserIds)];
        if (
          memberIds &&
          (!Array.isArray(body.memberUserIds) ||
            memberIds.some(
              (id) =>
                typeof id !== "string" ||
                !db
                  .prepare(
                    "SELECT 1 FROM member WHERE userId=? AND organizationId=?"
                  )
                  .get(id, req.params.organizationId)
            ))
        )
          throw failure("Team members must belong to the organization.", 400);
        const siteIds =
          body.siteIds === undefined ? undefined : integerIds(body.siteIds);
        if (siteIds)
          validateSites(siteIds.map(Number), req.params.organizationId);
        if (body.siteRole != null && !isSiteGrantRole(body.siteRole))
          throw failure("Choose a valid site role.", 400);
        const id = existing?.id || randomUUID();
        db.transaction(() => {
          if (existing)
            db.prepare("UPDATE team SET name=?,updatedAt=? WHERE id=?").run(
              body.name?.trim() || existing.name,
              Date.now(),
              id
            );
          else
            db.prepare(
              "INSERT INTO team(id,name,memberCount,organizationId,createdAt,updatedAt) VALUES(?,?,0,?,?,?)"
            ).run(
              id,
              body.name.trim(),
              req.params.organizationId,
              Date.now(),
              Date.now()
            );
          if (memberIds) {
            db.prepare("DELETE FROM teamMember WHERE teamId=?").run(id);
            for (const userId of memberIds)
              db.prepare(
                "INSERT INTO teamMember(id,teamId,userId,membershipKey,createdAt) VALUES(?,?,?,?,?)"
              ).run(
                randomUUID(),
                id,
                userId,
                createHash("sha256")
                  .update(JSON.stringify([id, userId]))
                  .digest("base64url"),
                Date.now()
              );
          }
          db.prepare(
            "UPDATE team SET memberCount=(SELECT count(*) FROM teamMember WHERE teamId=?) WHERE id=?"
          ).run(id, id);
          if (siteIds) {
            const prior = new Map(
              db
                .prepare(
                  "SELECT propertyId,role FROM team_site_access WHERE teamId=?"
                )
                .all(id)
                .map((g) => [g.propertyId, g.role])
            );
            db.prepare("DELETE FROM team_site_access WHERE teamId=?").run(id);
            for (const siteId of siteIds)
              db.prepare("INSERT INTO team_site_access VALUES(?,?,?)").run(
                id,
                siteId,
                body.siteRole === undefined
                  ? prior.get(siteId) ?? null
                  : body.siteRole
              );
          } else if (body.siteRole !== undefined)
            db.prepare("UPDATE team_site_access SET role=? WHERE teamId=?").run(
              body.siteRole,
              id
            );
        }).immediate();
        return teamView(db.prepare("SELECT * FROM team WHERE id=?").get(id));
      },
    });
  app.delete(
    `${root}/organizations/:organizationId/teams/:teamId`,
    async (req) => {
      org(req, "teams:manage");
      db.transaction(() => {
        if (
          !db
            .prepare("DELETE FROM team WHERE id=? AND organizationId=?")
            .run(req.params.teamId, req.params.organizationId).changes
        )
          throw failure("Team not found.", 404);
        db.prepare("DELETE FROM teamMember WHERE teamId=?").run(
          req.params.teamId
        );
        db.prepare("DELETE FROM team_site_access WHERE teamId=?").run(
          req.params.teamId
        );
      }).immediate();
      return { success: true };
    }
  );
  app.put(`${root}/sites/:siteId/move`, async (req) => {
    access.requireSite(req.identity, req.params.siteId, "sites:transfer");
    access.requireOrg(req.identity, req.body?.organizationId, "sites:create");
    moveProperty(req.params.siteId, req.body.organizationId);
    return { success: true };
  });
  app.get(`${root}/properties/available`, async (req) => {
    requireSession(req);
    const { properties } =
      await require("../controllers/apiController").ensureProperties();
    return {
      properties: properties
        .filter((p) => {
          try {
            access.requireSite(req.identity, p.id, "sites:transfer");
            return true;
          } catch {
            return false;
          }
        })
        .map((p) => ({
          id: String(p.id),
          name: p.site || p.domain || String(p.id),
          domain: p.domain || "",
          organizationId: db
            .prepare(
              "SELECT organizationId FROM property_access WHERE propertyId=?"
            )
            .get(String(p.id))?.organizationId,
        })),
    };
  });
  app.post(`${root}/organizations/:organizationId/sites`, async (req) => {
    org(req, "sites:create");
    const id = String(req.body?.propertyId || "");
    if (!/^\d+$/.test(id))
      throw failure("Choose a connected GA4 property.", 400);
    access.requireSite(req.identity, id, "sites:transfer");
    moveProperty(id, req.params.organizationId);
    return { success: true, siteId: Number(id) };
  });
  const outgoing = (t) =>
    t
      ? {
          id: t.id,
          recipientEmail: t.targetEmail,
          createdAt: t.createdAt,
          expiresAt: t.expiresAt,
          url: `${baseURL}/transfer/${t.id}`,
        }
      : null;
  app.get(`${root}/sites/:siteId/transfer`, async (req) => {
    requireSession(req);
    access.requireSite(req.identity, req.params.siteId, "sites:transfer");
    return {
      transfer: outgoing(
        db
          .prepare(
            "SELECT * FROM site_transfer WHERE propertyId=? AND status='pending' AND expiresAt>? ORDER BY createdAt DESC LIMIT 1"
          )
          .get(req.params.siteId, now())
      ),
    };
  });
  app.post(`${root}/sites/:siteId/transfer`, async (req) => {
    requireSession(req);
    access.requireSite(req.identity, req.params.siteId, "sites:transfer");
    const email = String(req.body?.email || "")
      .trim()
      .toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email))
      throw failure("Choose a valid recipient email.", 400);
    if (!mailer.configured)
      throw failure("Configure email delivery before sending a transfer.", 422);
    const property = db
      .prepare("SELECT * FROM property_access WHERE propertyId=?")
      .get(req.params.siteId);
    const row = {
      id: randomUUID(),
      propertyId: property.propertyId,
      sourceOrganizationId: property.organizationId,
      targetEmail: email,
      createdBy: req.identity.userId,
      createdAt: now(),
      expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
    };
    db.transaction(() => {
      db.prepare(
        "UPDATE site_transfer SET status='cancelled' WHERE propertyId=? AND status='pending'"
      ).run(property.propertyId);
      db.prepare(
        "INSERT INTO site_transfer(id,propertyId,sourceOrganizationId,targetEmail,createdBy,createdAt,expiresAt) VALUES(?,?,?,?,?,?,?)"
      ).run(
        row.id,
        row.propertyId,
        row.sourceOrganizationId,
        row.targetEmail,
        row.createdBy,
        row.createdAt,
        row.expiresAt
      );
    }).immediate();
    try {
      await mailer.send(
        email,
        "MetriBee property transfer",
        `${req.identity.user.email} offered to transfer ${property.name} to your organization.`,
        outgoing(row).url
      );
    } catch (error) {
      db.prepare("UPDATE site_transfer SET status='cancelled' WHERE id=?").run(
        row.id
      );
      throw error;
    }
    return outgoing(row);
  });
  app.delete(`${root}/sites/:siteId/transfer`, async (req) => {
    requireSession(req);
    access.requireSite(req.identity, req.params.siteId, "sites:transfer");
    db.prepare(
      "UPDATE site_transfer SET status='cancelled' WHERE propertyId=? AND status='pending'"
    ).run(req.params.siteId);
    return { success: true };
  });
  function incoming(req) {
    const identity = requireSession(req),
      t = db
        .prepare(
          "SELECT * FROM site_transfer WHERE id=? AND status='pending' AND expiresAt>?"
        )
        .get(req.params.transferId, now());
    if (!t) throw failure("Transfer not found or expired.", 404);
    if (identity.user.email.toLowerCase() !== t.targetEmail)
      throw Object.assign(
        failure("Sign in with the recipient email to accept this transfer."),
        { recipientEmailHint: t.targetEmail.replace(/^(.).+(@.+)$/, "$1••$2") }
      );
    if (!identity.user.emailVerified)
      throw Object.assign(
        failure("Verify your email before accepting a transfer."),
        { reason: "email_unverified" }
      );
    if (
      db
        .prepare(
          "SELECT organizationId FROM property_access WHERE propertyId=?"
        )
        .get(t.propertyId)?.organizationId !== t.sourceOrganizationId
    )
      throw failure("The property has already moved.", 404);
    return t;
  }
  app.get(`${root}/site-transfers/:transferId`, async (req) => {
    const t = incoming(req),
      p = db
        .prepare("SELECT * FROM property_access WHERE propertyId=?")
        .get(t.propertyId);
    return {
      id: t.id,
      site: { siteId: Number(t.propertyId), name: p.name, domain: p.domain },
      sourceOrganizationId: t.sourceOrganizationId,
      sourceOrganizationName:
        db
          .prepare("SELECT name FROM organization WHERE id=?")
          .get(t.sourceOrganizationId)?.name || "",
      sentBy:
        db.prepare("SELECT email FROM user WHERE id=?").get(t.createdBy)
          ?.email || null,
      expiresAt: t.expiresAt,
    };
  });
  app.post(`${root}/site-transfers/:transferId/accept`, async (req) => {
    const t = incoming(req);
    access.requireOrg(req.identity, req.body?.organizationId, "sites:create");
    db.transaction(() => {
      incoming(req);
      moveProperty(t.propertyId, req.body.organizationId);
      db.prepare("UPDATE site_transfer SET status='accepted' WHERE id=?").run(
        t.id
      );
    }).immediate();
    return {
      success: true,
      siteId: Number(t.propertyId),
      organizationId: req.body.organizationId,
    };
  });
  app.post(`${root}/site-transfers/:transferId/decline`, async (req) => {
    const t = incoming(req);
    db.prepare("UPDATE site_transfer SET status='declined' WHERE id=?").run(
      t.id
    );
    return { success: true };
  });
  app.get(`${root}/admin/organizations`, async (req) => {
    adminOnly(req);
    return db
      .prepare("SELECT * FROM organization ORDER BY createdAt DESC")
      .all()
      .map((o) => ({
        ...o,
        createdAt: iso(o.createdAt),
        monthlyEventCount: 0,
        overMonthlyLimit: false,
        planOverride: null,
        customPlan: null,
        stripeCustomerId: null,
        stripeDashboardUrl: null,
        subscription: billingView(o.id),
        sites: db
          .prepare("SELECT * FROM property_access WHERE organizationId=?")
          .all(o.id)
          .map((p) => ({
            siteId: Number(p.propertyId),
            name: p.name,
            domain: p.domain,
            type: "web",
            createdAt: iso(o.createdAt),
            eventsLast24Hours: 0,
            eventsLast30Days: 0,
          })),
        members: members(o.id).map((m) => ({
          memberId: m.id,
          userId: m.userId,
          name: m.user.name,
          email: m.user.email,
          role: m.role,
          createdAt: m.createdAt,
        })),
      }));
  });
  app.get(`${root}/admin/organization-options`, async (req) => {
    adminOnly(req);
    return {
      items: db
        .prepare(
          "SELECT id,name FROM organization WHERE name LIKE ? ORDER BY name LIMIT ?"
        )
        .all(
          `%${String(req.query.search || "").slice(0, 200)}%`,
          Math.min(100, Math.max(1, Number(req.query.limit) || 25))
        ),
    };
  });
  app.get(
    `${root}/admin/organizations/:organizationId/members/:memberId`,
    async (req) => {
      adminOnly(req);
      const m = memberFor(req),
        u = db
          .prepare(
            "SELECT id,name,email,role,banned,banReason,banExpires FROM user WHERE id=?"
          )
          .get(m.userId);
      return {
        user: { ...u, banned: !!u.banned, banExpires: iso(u.banExpires) },
        membership: {
          id: m.id,
          role: m.role,
          hasRestrictedSiteAccess: !!m.hasRestrictedSiteAccess,
          siteIds: db
            .prepare(
              "SELECT propertyId FROM member_site_access WHERE memberId=?"
            )
            .all(m.id)
            .map((s) => Number(s.propertyId)),
        },
        sites: db
          .prepare(
            "SELECT propertyId siteId,name,domain FROM property_access WHERE organizationId=?"
          )
          .all(m.organizationId)
          .map((p) => ({ ...p, siteId: Number(p.siteId) })),
      };
    }
  );
  app.patch(
    `${root}/admin/organizations/:organizationId/members/:memberId`,
    async (req) => {
      adminOnly(req);
      const m = memberFor(req);
      if (!isOrgRole(req.body?.role))
        throw failure("Choose a valid role.", 400);
      if (req.body.role !== "owner") assertOwnerRetained(m);
      db.transaction(() => {
        db.prepare("UPDATE member SET role=? WHERE id=?").run(
          req.body.role,
          m.id
        );
        updateMemberSites({ ...m, role: req.body.role }, req.body);
      }).immediate();
      return { success: true };
    }
  );
  app.delete(
    `${root}/admin/organizations/:organizationId/members/:memberId`,
    async (req) => {
      adminOnly(req);
      const m = memberFor(req);
      assertOwnerRetained(m);
      db.transaction(() => {
        db.prepare(
          "DELETE FROM invitation WHERE organizationId=? AND email=(SELECT email FROM user WHERE id=?)"
        ).run(m.organizationId, m.userId);
        db.prepare("DELETE FROM member WHERE id=?").run(m.id);
        db.prepare(
          "UPDATE session SET activeOrganizationId=NULL,activeTeamId=NULL WHERE userId=? AND activeOrganizationId=?"
        ).run(m.userId, m.organizationId);
      }).immediate();
      return { success: true };
    }
  );
  app.get(`${root}/admin/sites`, async (req) => {
    adminOnly(req);
    return Promise.all(db
      .prepare("SELECT * FROM property_access")
      .all()
      .map(async (p) => ({
        siteId: Number(p.propertyId),
        name: p.name,
        domain: p.domain,
        organizationId: p.organizationId || null,
        type: "web",
        createdAt: now(),
        public: await publicSettings.isPublic(p.propertyId),
        eventsLast24Hours: 0,
        eventsLast30Days: 0,
        goalsCount: db.prepare("SELECT count(*) count FROM analysis_object WHERE kind='goals' AND propertyId=? AND organizationId=?").get(p.propertyId, p.organizationId).count,
        funnelsCount:
          JSON.parse(
            db
              .prepare(
                "SELECT payload FROM app_document WHERE kind='funnels' AND propertyId=?"
              )
              .get(p.propertyId)?.payload || "{}"
          ).funnels?.length || 0,
        sessionReplay: false,
        organizationOwnerEmail:
          db
            .prepare(
              "SELECT u.email FROM member m JOIN user u ON u.id=m.userId WHERE m.organizationId=? AND m.role='owner' LIMIT 1"
            )
            .get(p.organizationId)?.email || null,
        subscription: billingView(p.organizationId),
      })));
  });
  app.put(`${root}/admin/sites/:siteId/move`, async (req) => {
    adminOnly(req);
    moveProperty(req.params.siteId, req.body?.organizationId);
    return { success: true, organizationId: req.body.organizationId };
  });
  app.get(`${root}/admin/subscription-plans`, async (req) => {
    adminOnly(req);
    return [];
  });
  app.get(`${root}/admin/database`, async (req) => {
    adminOnly(req);
    return {
      engine: "SQLite",
      version: db.prepare("SELECT sqlite_version() version").get().version,
      integrity: db.pragma("quick_check", { simple: true }),
      bytes:
        db.pragma("page_count", { simple: true }) *
        db.pragma("page_size", { simple: true }),
      tables: db
        .prepare(
          "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        )
        .all()
        .map(({ name }) => ({
          name,
          rows: db
            .prepare(
              `SELECT count(*) AS count FROM "${name.replace(/"/g, '""')}"`
            )
            .get().count,
        })),
      migrations: db.prepare("SELECT * FROM app_migration ORDER BY id").all(),
    };
  });
  return { members, teamView, moveProperty };
}
module.exports = { accountRoutes };

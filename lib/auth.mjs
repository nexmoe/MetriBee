import { betterAuth } from "better-auth";
import { admin, emailOTP, organization } from "better-auth/plugins";
import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
} from "better-auth/api";
import { createAccessControl } from "better-auth/plugins/access";
import {
  defaultStatements,
  ownerAc,
  adminAc,
  memberAc,
} from "better-auth/plugins/organization/access";
import { apiKey } from "@better-auth/api-key";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import schema from "./db/schema.js";
import { randomBytes, randomUUID } from "node:crypto";
import database from "./database.js";
import permissionModule from "./permissions.js";
import accessModule from "./access.js";
import mailModule from "./mail.js";
import billingModule from "./billing.js";
import { createOAuthPlugins } from "./oauth.mjs";

const { isOrgRole, isAdminRole, isSiteGrantRole, canAssignRole } =
  permissionModule;
const parseIds = (value) =>
  Array.isArray(value) ? value : JSON.parse(value || "[]");

export async function createAuthentication({
  db = database.openDatabase(),
  env = process.env,
  mailer = mailModule.createMailer(env),
} = {}) {
  const orm = database.migrateDatabase(db);
  const access = accessModule.createAccess(db);
  let secret = env.BETTER_AUTH_SECRET;
  if (!secret) {
    db.prepare("INSERT OR IGNORE INTO app_setting VALUES(?,?)").run(
      "authSecret",
      randomBytes(48).toString("base64url")
    );
    secret = db
      .prepare("SELECT value FROM app_setting WHERE key='authSecret'")
      .get().value;
  }
  const baseURL = (
    env.BASE_URL ||
    env.BETTER_AUTH_URL ||
    `http://localhost:${env.PORT || 5483}`
  ).replace(/\/+$/, "");
  const ac = createAccessControl({
    ...defaultStatements,
    apiKey: ["create", "read", "update", "delete"],
  });
  const roles = Object.fromEntries(
    ["owner", "admin", "editor", "member", "viewer"].map((role) => [
      role,
      ac.newRole({
        ...(role === "owner" ? ownerAc : role === "admin" ? adminAc : memberAc)
          .statements,
        ...(isAdminRole(role)
          ? { apiKey: ["create", "read", "update", "delete"] }
          : {}),
      }),
    ])
  );
  const refuse = (message) => {
    throw new APIError("FORBIDDEN", { message });
  };
  function validateSites(ids, organizationId) {
    if (
      !Array.isArray(ids) ||
      ids.some((id) => !Number.isSafeInteger(id) || id < 1)
    )
      refuse("Choose valid property IDs.");
    for (const id of ids)
      if (
        !db
          .prepare(
            "SELECT 1 FROM property_access WHERE propertyId=? AND organizationId=?"
          )
          .get(String(id), organizationId)
      )
        refuse("Property does not belong to this organization.");
  }
  function protectOwner(member) {
    if (
      member.role === "owner" &&
      db
        .prepare(
          "SELECT count(*) AS n FROM member WHERE organizationId=? AND role='owner'"
        )
        .get(member.organizationId).n <= 1
    )
      refuse("An organization must retain at least one owner.");
  }
  const plugins = [
    admin(),
    ...createOAuthPlugins(baseURL),
    apiKey([
      { configId: "default", rateLimit: { enabled: false } },
      {
        configId: "org",
        references: "organization",
        defaultPrefix: "rb_org_",
        enableMetadata: true,
        rateLimit: { enabled: false },
      },
    ]),
    organization({
      ac,
      roles,
      creatorRole: "owner",
      allowUserToCreateOrganization: true,
      teams: { enabled: true },
      schema: {
        member: {
          additionalFields: {
            hasRestrictedSiteAccess: {
              type: "boolean",
              required: false,
              defaultValue: false,
              input: false,
            },
          },
        },
        invitation: {
          additionalFields: {
            hasRestrictedSiteAccess: {
              type: "boolean",
              required: false,
              defaultValue: false,
            },
            siteIds: { type: "number[]", required: false, defaultValue: [] },
            siteRole: { type: "string", required: false },
          },
        },
      },
      sendInvitationEmail: async (data) => {
        const url = new URL("/invitation", baseURL);
        url.search = new URLSearchParams({
          invitationId: data.id,
          organization: data.organization.name,
          inviterEmail: data.inviter.user.email,
        }).toString();
        await mailer.send(
          data.email,
          `Join ${data.organization.name} on MetriBee`,
          `${data.inviter.user.name} invited you to ${data.organization.name}.`,
          url.href
        );
      },
      organizationHooks: {
        beforeCreateInvitation: async ({ invitation }) => {
          if (!isOrgRole(invitation.role))
            refuse("Choose a valid organization role.");
          if (
            invitation.teamId &&
            !db
              .prepare("SELECT 1 FROM team WHERE id=? AND organizationId=?")
              .get(invitation.teamId, invitation.organizationId)
          )
            refuse("The team does not belong to this organization.");
          if (invitation.hasRestrictedSiteAccess) {
            if (isAdminRole(invitation.role))
              refuse("Owners and admins cannot have restricted site access.");
            if (!invitation.siteIds?.length)
              refuse("Choose at least one property.");
            validateSites(invitation.siteIds, invitation.organizationId);
            if (
              invitation.siteRole != null &&
              !isSiteGrantRole(invitation.siteRole)
            )
              refuse("Choose a valid site role.");
          }
          return {
            data: {
              hasRestrictedSiteAccess: !!invitation.hasRestrictedSiteAccess,
              siteIds: invitation.hasRestrictedSiteAccess
                ? [...new Set(invitation.siteIds)]
                : [],
              siteRole: invitation.hasRestrictedSiteAccess
                ? invitation.siteRole ?? null
                : null,
            },
          };
        },
        beforeAcceptInvitation: async ({ invitation }) => {
          if (invitation.hasRestrictedSiteAccess)
            validateSites(
              parseIds(invitation.siteIds),
              invitation.organizationId
            );
        },
        afterAcceptInvitation: async ({ invitation, member }) => {
          if (!invitation.hasRestrictedSiteAccess) return;
          db.transaction(() => {
            db.prepare(
              "UPDATE member SET hasRestrictedSiteAccess=1 WHERE id=?"
            ).run(member.id);
            for (const id of parseIds(invitation.siteIds))
              db.prepare(
                "INSERT OR REPLACE INTO member_site_access VALUES(?,?,?)"
              ).run(member.id, String(id), invitation.siteRole ?? null);
          }).immediate();
        },
        beforeRemoveMember: async ({ member }) => protectOwner(member),
        beforeUpdateMemberRole: async ({ member, newRole }) => {
          if (!isOrgRole(newRole))
            refuse("Choose one valid organization role.");
          if (newRole !== "owner") protectOwner(member);
        },
        afterUpdateMemberRole: async ({ member }) => {
          if (isAdminRole(member.role)) {
            db.prepare(
              "UPDATE member SET hasRestrictedSiteAccess=0 WHERE id=?"
            ).run(member.id);
            db.prepare("DELETE FROM member_site_access WHERE memberId=?").run(
              member.id
            );
          }
        },
        afterRemoveMember: async ({ member, user }) => {
          db.prepare("DELETE FROM member_site_access WHERE memberId=?").run(
            member.id
          );
          db.prepare(
            "DELETE FROM invitation WHERE organizationId=? AND email=?"
          ).run(member.organizationId, user.email);
          db.prepare(
            "DELETE FROM teamMember WHERE userId=? AND teamId IN (SELECT id FROM team WHERE organizationId=?)"
          ).run(user.id, member.organizationId);
        },
        beforeDeleteOrganization: async ({ organization }) => {
          const cloud = env.CLOUD === "true";
          const mode = env.WAFFO_MODE === "prod" ? "prod" : "test";
          if (cloud && db.prepare("SELECT 1 FROM billing_subscription WHERE organizationId=? AND mode=? AND status IN ('active','canceling','past_due')").get(organization.id, mode))
            refuse('Cancel the subscription and wait for it to end before deleting this organization.');
          if (cloud && db.prepare("SELECT 1 FROM billing_checkout WHERE organizationId=? AND mode=? AND status IN ('creating','pending') AND (expiresAt IS NULL OR expiresAt>?)").get(organization.id,mode,new Date().toISOString()))
            refuse('Finish or wait for the pending checkout to expire before deleting this organization.');
          db.transaction(() => {
            db.prepare(
              "DELETE FROM apikey WHERE configId='org' AND referenceId=?"
            ).run(organization.id);
            db.prepare(
              "DELETE FROM team_site_access WHERE teamId IN (SELECT id FROM team WHERE organizationId=?)"
            ).run(organization.id);
            db.prepare(
              "DELETE FROM member_site_access WHERE memberId IN (SELECT id FROM member WHERE organizationId=?)"
            ).run(organization.id);
            db.prepare("DELETE FROM analysis_object WHERE organizationId=?").run(organization.id);
            db.prepare(
              "UPDATE property_access SET organizationId='' WHERE organizationId=?"
            ).run(organization.id);
            db.prepare(
              "DELETE FROM app_setting WHERE key='defaultOrganization' AND value=?"
            ).run(organization.id);
          }).immediate();
        },
        afterDeleteTeam: async ({ team }) =>
          db
            .prepare("DELETE FROM team_site_access WHERE teamId=?")
            .run(team.id),
      },
    }),
    emailOTP({
      async sendVerificationOTP({ email, otp, type }) {
        await mailer.send(
          email,
          "MetriBee verification code",
          `Your ${type} verification code is ${otp}.`
        );
      },
    }),
  ];
  const options = {
    appName: "MetriBee",
    baseURL,
    basePath: "/api/auth",
    secret,
    database: drizzleAdapter(orm, { provider: "sqlite", schema }),
    plugins,
    logger: {
      log(level, message, ...args) {
        // A rejected credential is a normal authentication result, not a server fault.
        if (message.startsWith("Failed to validate API key") && args[0]?.status)
          return;
        (console[level] || console.log)(`[auth] ${message}`, ...args);
      },
    },
    trustedOrigins: [
      baseURL,
      ...(env.AUTH_TRUSTED_ORIGINS || "").split(",").filter(Boolean),
    ],
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      sendResetPassword: async ({ user, url }) =>
        mailer.send(
          user.email,
          "Reset your MetriBee password",
          "Use this link to reset your password.",
          url
        ),
    },
    emailVerification: {
      sendVerificationEmail: async ({ user, url }) =>
        mailer.send(
          user.email,
          "Verify your MetriBee email",
          "Verify your email address.",
          url
        ),
    },
    socialProviders: {
      ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? {
            google: {
              clientId: env.GOOGLE_CLIENT_ID,
              clientSecret: env.GOOGLE_CLIENT_SECRET,
            },
          }
        : {}),
      ...(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
        ? {
            github: {
              clientId: env.GITHUB_CLIENT_ID,
              clientSecret: env.GITHUB_CLIENT_SECRET,
            },
          }
        : {}),
    },
    user: {
      additionalFields: {
        sendAutoEmailReports: {
          type: "boolean",
          required: false,
          defaultValue: true,
        },
      },
      deleteUser: {
        enabled: true,
        beforeDelete: async (user) => {
          if (
            db
              .prepare(
                "SELECT 1 FROM member m WHERE userId=? AND role='owner' AND (SELECT count(*) FROM member x WHERE x.organizationId=m.organizationId AND x.role='owner')=1"
              )
              .get(user.id)
          )
            refuse(
              "Transfer ownership or delete your organizations before deleting your account."
            );
        },
        afterDelete: async (user) => {
          db.prepare("DELETE FROM apikey WHERE referenceId=? AND (configId IS NULL OR configId='default')").run(user.id);
          db.prepare('UPDATE analysis_object SET userId=NULL WHERE userId=?').run(user.id);
        },
      },
      changeEmail: {
        enabled: true,
        sendChangeEmailConfirmation: async ({ user, newEmail, url }) =>
          mailer.send(
            user.email,
            "Confirm your MetriBee email change",
            `Confirm changing your email to ${newEmail}.`,
            url
          ),
      },
    },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
    rateLimit: { enabled: true, window: 60, max: 100, storage: "database" },
    databaseHooks: {
      session: {
        create: {
          before: async (session) => {
            const first = db
              .prepare(
                "SELECT organizationId FROM member WHERE userId=? ORDER BY createdAt LIMIT 1"
              )
              .get(session.userId);
            return {
              data: {
                ...session,
                ...(first
                  ? { activeOrganizationId: first.organizationId }
                  : {}),
              },
            };
          },
        },
      },
      user: {
        create: {
          before: async (user, ctx) => {
            const identity = (
              await import("./requestContext.js")
            ).default.storage.getStore()?.identity;
            if (
              env.DISABLE_SIGNUP === "true" &&
              db.prepare("SELECT 1 FROM user LIMIT 1").get() &&
              !ctx?.path?.startsWith("/admin/") &&
              !identity &&
              !db
                .prepare(
                  "SELECT 1 FROM invitation WHERE email=? AND status='pending' AND expiresAt>?"
                )
                .get(user.email.toLowerCase(), Date.now())
            )
              refuse(
                "Registration is disabled. Ask an administrator for an invitation."
              );
            return { data: user };
          },
          after: async (user) => {
            db.transaction(() => {
              const claim = db
                .prepare(
                  "INSERT OR IGNORE INTO app_setting VALUES('bootstrapUser',?)"
                )
                .run(user.id);
              if (!claim.changes) return;
              const orgId = randomUUID(),
                now = Date.now();
              db.prepare("UPDATE user SET role='admin' WHERE id=?").run(
                user.id
              );
              db.prepare(
                "INSERT INTO organization(id,name,slug,createdAt) VALUES(?,?,?,?)"
              ).run(orgId, "MetriBee", `metribee-${orgId.slice(0, 8)}`, now);
              db.prepare(
                "INSERT INTO member(id,organizationId,userId,role,createdAt,hasRestrictedSiteAccess) VALUES(?,?,?,?,?,0)"
              ).run(randomUUID(), orgId, user.id, "owner", now);
              db.prepare(
                "UPDATE session SET activeOrganizationId=? WHERE userId=? AND activeOrganizationId IS NULL"
              ).run(orgId, user.id);
              db.prepare(
                "INSERT INTO app_setting VALUES('defaultOrganization',?)"
              ).run(orgId);
              db.prepare(
                "UPDATE property_access SET organizationId=? WHERE organizationId=''"
              ).run(orgId);
            }).immediate();
          },
        },
        update: {
          before: async (data, ctx) => {
            if (ctx?.path?.startsWith("/admin/")) return { data };
            const { role, banned, banReason, banExpires, ...safe } = data;
            return { data: safe };
          },
        },
        delete: {
          before: async (user) => {
            if (
              user.role === "admin" &&
              db
                .prepare(
                  "SELECT count(*) n FROM user WHERE role='admin' AND (banned IS NULL OR banned=0)"
                )
                .get().n <= 1
            )
              refuse("Keep at least one active system administrator.");
            if (
              db
                .prepare(
                  "SELECT 1 FROM member m WHERE userId=? AND role='owner' AND (SELECT count(*) FROM member x WHERE x.organizationId=m.organizationId AND x.role='owner')=1"
                )
                .get(user.id)
            )
              refuse(
                "Transfer ownership or delete the organizations before deleting this user."
              );
          },
          after: async (user) =>
            db
              .prepare(
                "DELETE FROM apikey WHERE referenceId=? AND (configId IS NULL OR configId='default')"
              )
              .run(user.id),
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        const body = ctx.body || {};
        if (
          ctx.path === "/admin/update-user" &&
          ["role", "banned", "banReason", "banExpires"].some(
            (field) => field in (body.data || {})
          )
        )
          refuse("Use the dedicated role and ban endpoints for these changes.");
        if (
          ctx.path === "/sign-up/email" &&
          env.DISABLE_SIGNUP === "true" &&
          db.prepare("SELECT 1 FROM user LIMIT 1").get() &&
          !db
            .prepare(
              "SELECT 1 FROM invitation WHERE email=? AND status='pending' AND expiresAt>?"
            )
            .get(String(body.email || "").toLowerCase(), Date.now())
        )
          refuse(
            "Registration is disabled. Ask an administrator for an invitation."
          );
        if (
          [
            "/organization/invite-member",
            "/organization/update-member-role",
            "/organization/add-member",
          ].includes(ctx.path)
        ) {
          if (!isOrgRole(body.role))
            refuse("Choose one valid organization role.");
          const session = await getSessionFromCtx(ctx);
          const orgId =
            body.organizationId || session?.session.activeOrganizationId;
          const actor = db
            .prepare("SELECT * FROM member WHERE organizationId=? AND userId=?")
            .get(orgId || "", session?.user.id || "");
          if (!canAssignRole(actor?.role, body.role))
            refuse("You cannot assign this role.");
          if (body.memberId) {
            const target = db
              .prepare("SELECT * FROM member WHERE id=? AND organizationId=?")
              .get(body.memberId, orgId);
            if (target && !canAssignRole(actor.role, target.role))
              refuse("You cannot edit this member.");
          }
        }
        if (ctx.path === "/organization/leave") {
          const session = await getSessionFromCtx(ctx);
          const member = db
            .prepare("SELECT * FROM member WHERE organizationId=? AND userId=?")
            .get(
              body.organizationId ||
                session?.session.activeOrganizationId ||
                "",
              session?.user.id || ""
            );
          if (member) protectOwner(member);
        }
        if (ctx.path === "/api-key/create" && body.permissions)
          accessModule.validateScopes(body.permissions);
        if (ctx.path === "/api-key/create" && body.configId === "org") {
          const session = await getSessionFromCtx(ctx);
          body.metadata = { createdBy: session?.user.id };
        }
        if (
          ["/admin/remove-user", "/admin/ban-user", "/admin/set-role"].includes(
            ctx.path
          ) &&
          (ctx.path !== "/admin/set-role" || body.role !== "admin")
        ) {
          const target = db
            .prepare("SELECT role FROM user WHERE id=?")
            .get(body.userId || "");
          if (
            target?.role === "admin" &&
            db
              .prepare(
                "SELECT count(*) n FROM user WHERE role='admin' AND (banned IS NULL OR banned=0)"
              )
              .get().n <= 1
          )
            refuse("Keep at least one active system administrator.");
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/organization/leave") {
          const session = ctx.context.session;
          if (session?.user && ctx.body?.organizationId) {
            db.prepare(
              "DELETE FROM invitation WHERE email=? AND organizationId=?"
            ).run(session.user.email, ctx.body.organizationId);
            db.prepare(
              "DELETE FROM teamMember WHERE userId=? AND teamId IN (SELECT id FROM team WHERE organizationId=?)"
            ).run(session.user.id, ctx.body.organizationId);
          }
        }
      }),
    },
  };
  database.migrateLegacyDocuments(db);
  const auth = betterAuth(options);
  // Provider initialization seeds resources asynchronously. One-shot database
  // commands may close SQLite as soon as this function returns.
  const context = await auth.$context;
  await context.checkSchema?.();
  return { auth, db, orm, access, mailer, baseURL, validateSites };
}

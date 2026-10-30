// Source of truth for application and Better Auth SQLite tables.
const { sql } = require("drizzle-orm");
const {
  sqliteTable,
  text,
  integer,
  customType,
  primaryKey,
  index,
  uniqueIndex,
} = require("drizzle-orm/sqlite-core");

// Earlier Better Auth SQLite records use ISO dates; organization hooks also
// wrote epoch milliseconds. Preserve both without rewriting sessions or tokens.
const sqliteDate = customType({
  dataType: () => "date",
  toDriver: (value) => value.toISOString(),
  fromDriver: (value) => new Date(value),
});

const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("accountId").notNull(),
    providerId: text("providerId").notNull(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("accessToken"),
    refreshToken: text("refreshToken"),
    idToken: text("idToken"),
    accessTokenExpiresAt: sqliteDate("accessTokenExpiresAt"),
    refreshTokenExpiresAt: sqliteDate("refreshTokenExpiresAt"),
    scope: text("scope"),
    password: text("password"),
    createdAt: sqliteDate("createdAt").notNull(),
    updatedAt: sqliteDate("updatedAt").notNull(),
  },
  (table) => [index("account_userId_idx").on(table.userId)]
);

const analysisObject = sqliteTable(
  "analysis_object",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    kind: text("kind").notNull(),
    propertyId: text("propertyId"),
    organizationId: text("organizationId").notNull(),
    userId: text("userId"),
    payload: text("payload").notNull(),
    createdAt: text("createdAt").notNull(),
    updatedAt: text("updatedAt").notNull(),
  },
  (table) => [
    index("analysis_scope").on(
      table.kind,
      table.organizationId,
      table.propertyId
    ),
  ]
);

const apikey = sqliteTable(
  "apikey",
  {
    id: text("id").primaryKey(),
    configId: text("configId").notNull(),
    name: text("name"),
    start: text("start"),
    referenceId: text("referenceId").notNull(),
    prefix: text("prefix"),
    key: text("key").notNull(),
    refillInterval: integer("refillInterval"),
    refillAmount: integer("refillAmount"),
    lastRefillAt: sqliteDate("lastRefillAt"),
    enabled: integer("enabled", { mode: "boolean" }),
    rateLimitEnabled: integer("rateLimitEnabled", { mode: "boolean" }),
    rateLimitTimeWindow: integer("rateLimitTimeWindow"),
    rateLimitMax: integer("rateLimitMax"),
    requestCount: integer("requestCount"),
    remaining: integer("remaining"),
    lastRequest: sqliteDate("lastRequest"),
    expiresAt: sqliteDate("expiresAt"),
    createdAt: sqliteDate("createdAt").notNull(),
    updatedAt: sqliteDate("updatedAt").notNull(),
    permissions: text("permissions"),
    metadata: text("metadata"),
  },
  (table) => [
    index("apikey_referenceId_idx").on(table.referenceId),
    index("apikey_key_idx").on(table.key),
    index("apikey_configId_idx").on(table.configId),
  ]
);

const appDocument = sqliteTable(
  "app_document",
  {
    kind: text("kind").notNull(),
    propertyId: text("propertyId").notNull(),
    payload: text("payload").notNull(),
    updatedAt: text("updatedAt").notNull(),
  },
  (table) => [primaryKey({ columns: [table.kind, table.propertyId] })]
);

const appMigration = sqliteTable("app_migration", {
  id: text("id").primaryKey(),
  appliedAt: text("appliedAt").notNull(),
});

const appSetting = sqliteTable("app_setting", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

const billingCheckout = sqliteTable(
  "billing_checkout",
  {
    id: text("id").primaryKey(),
    organizationId: text("organizationId").notNull(),
    userId: text("userId").notNull(),
    mode: text("mode").notNull(),
    productId: text("productId").notNull(),
    productType: text("productType").notNull(),
    status: text("status").notNull(),
    sessionId: text("sessionId"),
    checkoutUrl: text("checkoutUrl"),
    expiresAt: text("expiresAt"),
    createdAt: text("createdAt").notNull(),
    orderId: text("orderId"),
  },
  (table) => [
    uniqueIndex("billing_pending_org")
      .on(table.organizationId, table.mode)
      .where(sql`status IN ('creating','pending')`),
    index("billing_checkout_order").on(table.mode, table.orderId),
  ]
);

const billingPayment = sqliteTable(
  "billing_payment",
  {
    id: text("id").notNull(),
    mode: text("mode").notNull(),
    organizationId: text("organizationId").notNull(),
    orderId: text("orderId").notNull(),
    amount: text("amount").notNull(),
    currency: text("currency").notNull(),
    status: text("status").notNull(),
    createdAt: text("createdAt").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.id, table.mode] }),
    index("billing_payment_org").on(
      table.organizationId,
      table.mode,
      table.createdAt
    ),
  ]
);

const billingSubscription = sqliteTable(
  "billing_subscription",
  {
    organizationId: text("organizationId").notNull(),
    mode: text("mode").notNull(),
    orderId: text("orderId").notNull(),
    productId: text("productId").notNull(),
    status: text("status").notNull(),
    currency: text("currency").notNull(),
    amount: text("amount").notNull(),
    interval: text("interval").notNull(),
    currentPeriodStart: text("currentPeriodStart"),
    currentPeriodEnd: text("currentPeriodEnd"),
    updatedAt: text("updatedAt").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.mode] }),
    uniqueIndex("billing_subscription_orderId_mode_unique").on(
      table.orderId,
      table.mode
    ),
  ]
);

const billingWebhook = sqliteTable(
  "billing_webhook",
  {
    id: text("id").primaryKey(),
    mode: text("mode").notNull(),
    eventType: text("eventType").notNull(),
    payload: text("payload").notNull(),
    status: text("status")
      .notNull()
      .default(sql`'pending'`),
    attempts: integer("attempts")
      .notNull()
      .default(sql`0`),
    receivedAt: text("receivedAt").notNull(),
    processedAt: text("processedAt"),
    lastError: text("lastError"),
  },
  (table) => [
    index("billing_webhook_queue").on(
      table.mode,
      table.status,
      table.receivedAt
    ),
  ]
);

const emailReportDelivery = sqliteTable("email_report_delivery", {
  deliveryKey: text("deliveryKey").primaryKey(),
  status: text("status").notNull(),
  createdAt: text("createdAt").notNull(),
  updatedAt: text("updatedAt").notNull(),
});

const invitation = sqliteTable(
  "invitation",
  {
    id: text("id").primaryKey(),
    organizationId: text("organizationId")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role"),
    teamId: text("teamId"),
    status: text("status").notNull(),
    expiresAt: sqliteDate("expiresAt").notNull(),
    createdAt: sqliteDate("createdAt").notNull(),
    inviterId: text("inviterId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    hasRestrictedSiteAccess: integer("hasRestrictedSiteAccess", {
      mode: "boolean",
    }),
    siteIds: text("siteIds"),
    siteRole: text("siteRole"),
  },
  (table) => [
    index("invitation_organizationId_idx").on(table.organizationId),
    index("invitation_email_idx").on(table.email),
  ]
);

const jwks = sqliteTable("jwks", {
  id: text("id").primaryKey(),
  publicKey: text("publicKey").notNull(),
  privateKey: text("privateKey").notNull(),
  createdAt: sqliteDate("createdAt").notNull(),
  expiresAt: sqliteDate("expiresAt"),
  alg: text("alg"),
  crv: text("crv"),
});

const member = sqliteTable(
  "member",
  {
    id: text("id").primaryKey(),
    organizationId: text("organizationId")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    createdAt: sqliteDate("createdAt").notNull(),
    hasRestrictedSiteAccess: integer("hasRestrictedSiteAccess", {
      mode: "boolean",
    }),
  },
  (table) => [
    uniqueIndex("membership_identity").on(table.organizationId, table.userId),
    index("member_userId_idx").on(table.userId),
    index("member_organizationId_idx").on(table.organizationId),
  ]
);

const memberSiteAccess = sqliteTable(
  "member_site_access",
  {
    memberId: text("memberId").notNull(),
    propertyId: text("propertyId").notNull(),
    role: text("role"),
  },
  (table) => [primaryKey({ columns: [table.memberId, table.propertyId] })]
);

const oauthAccessTokenV2 = sqliteTable(
  "oauthAccessTokenV2",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    clientId: text("clientId")
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    sessionId: text("sessionId").references(() => session.id, {
      onDelete: "set null",
    }),
    userId: text("userId").references(() => user.id, { onDelete: "cascade" }),
    referenceId: text("referenceId"),
    authorizationCodeId: text("authorizationCodeId"),
    resources: text("resources"),
    requestedUserInfoClaims: text("requestedUserInfoClaims"),
    refreshId: text("refreshId").references(() => oauthRefreshToken.id, {
      onDelete: "cascade",
    }),
    expiresAt: sqliteDate("expiresAt").notNull(),
    createdAt: sqliteDate("createdAt").notNull(),
    revoked: sqliteDate("revoked"),
    confirmation: text("confirmation"),
    scopes: text("scopes").notNull(),
  },
  (table) => [
    index("oauthAccessTokenV2_userId_idx").on(table.userId),
    index("oauthAccessTokenV2_sessionId_idx").on(table.sessionId),
    index("oauthAccessTokenV2_refreshId_idx").on(table.refreshId),
    index("oauthAccessTokenV2_clientId_idx").on(table.clientId),
    index("oauthAccessTokenV2_authorizationCodeId_idx").on(
      table.authorizationCodeId
    ),
  ]
);

const oauthClient = sqliteTable(
  "oauthClient",
  {
    id: text("id").primaryKey(),
    clientId: text("clientId").notNull().unique(),
    clientSecret: text("clientSecret"),
    clientDiscoveryId: text("clientDiscoveryId"),
    disabled: integer("disabled", { mode: "boolean" }),
    skipConsent: integer("skipConsent", { mode: "boolean" }),
    enableEndSession: integer("enableEndSession", { mode: "boolean" }),
    subjectType: text("subjectType"),
    scopes: text("scopes"),
    clientCredentialsScopes: text("clientCredentialsScopes"),
    userId: text("userId").references(() => user.id, { onDelete: "cascade" }),
    createdAt: sqliteDate("createdAt"),
    updatedAt: sqliteDate("updatedAt"),
    name: text("name"),
    uri: text("uri"),
    icon: text("icon"),
    contacts: text("contacts"),
    tos: text("tos"),
    policy: text("policy"),
    softwareId: text("softwareId"),
    softwareVersion: text("softwareVersion"),
    softwareStatement: text("softwareStatement"),
    redirectUris: text("redirectUris").notNull(),
    postLogoutRedirectUris: text("postLogoutRedirectUris"),
    backchannelLogoutUri: text("backchannelLogoutUri"),
    backchannelLogoutSessionRequired: integer(
      "backchannelLogoutSessionRequired",
      { mode: "boolean" }
    ),
    tokenEndpointAuthMethod: text("tokenEndpointAuthMethod"),
    applicationType: text("applicationType"),
    jwks: text("jwks"),
    jwksUri: text("jwksUri"),
    grantTypes: text("grantTypes"),
    responseTypes: text("responseTypes"),
    requirePKCE: integer("requirePKCE", { mode: "boolean" }),
    dpopBoundAccessTokens: integer("dpopBoundAccessTokens", {
      mode: "boolean",
    }),
    referenceId: text("referenceId"),
    metadata: text("metadata"),
  },
  (table) => [index("oauthClient_userId_idx").on(table.userId)]
);

const oauthClientAssertion = sqliteTable("oauthClientAssertion", {
  id: text("id").primaryKey(),
  expiresAt: sqliteDate("expiresAt").notNull(),
});

const oauthClientResource = sqliteTable(
  "oauthClientResource",
  {
    id: text("id").primaryKey(),
    clientId: text("clientId")
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    resourceId: text("resourceId")
      .notNull()
      .references(() => oauthResource.identifier, { onDelete: "cascade" }),
    metadata: text("metadata"),
    createdAt: sqliteDate("createdAt"),
  },
  (table) => [
    index("oauthClientResource_resourceId_idx").on(table.resourceId),
    uniqueIndex("oauthClientResource_clientId_resourceId_uidx").on(
      table.clientId,
      table.resourceId
    ),
    index("oauthClientResource_clientId_idx").on(table.clientId),
  ]
);

const oauthConsentV2 = sqliteTable(
  "oauthConsentV2",
  {
    id: text("id").primaryKey(),
    clientId: text("clientId")
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    userId: text("userId").references(() => user.id, { onDelete: "cascade" }),
    referenceId: text("referenceId"),
    resources: text("resources"),
    requestedUserInfoClaims: text("requestedUserInfoClaims"),
    scopes: text("scopes").notNull(),
    createdAt: sqliteDate("createdAt").notNull(),
    updatedAt: sqliteDate("updatedAt").notNull(),
  },
  (table) => [
    index("oauthConsentV2_userId_idx").on(table.userId),
    index("oauthConsentV2_clientId_idx").on(table.clientId),
  ]
);

const oauthRefreshToken = sqliteTable(
  "oauthRefreshToken",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    clientId: text("clientId")
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    sessionId: text("sessionId").references(() => session.id, {
      onDelete: "set null",
    }),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    referenceId: text("referenceId"),
    authorizationCodeId: text("authorizationCodeId"),
    resources: text("resources"),
    requestedUserInfoClaims: text("requestedUserInfoClaims"),
    expiresAt: sqliteDate("expiresAt").notNull(),
    createdAt: sqliteDate("createdAt").notNull(),
    revoked: sqliteDate("revoked"),
    rotatedAt: sqliteDate("rotatedAt"),
    rotationReplayResponse: text("rotationReplayResponse"),
    rotationReplayExpiresAt: sqliteDate("rotationReplayExpiresAt"),
    authTime: sqliteDate("authTime"),
    confirmation: text("confirmation"),
    scopes: text("scopes").notNull(),
  },
  (table) => [
    index("oauthRefreshToken_userId_idx").on(table.userId),
    index("oauthRefreshToken_sessionId_idx").on(table.sessionId),
    index("oauthRefreshToken_clientId_idx").on(table.clientId),
    index("oauthRefreshToken_authorizationCodeId_idx").on(
      table.authorizationCodeId
    ),
  ]
);

const oauthResource = sqliteTable("oauthResource", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull().unique(),
  name: text("name").notNull(),
  accessTokenTtl: integer("accessTokenTtl"),
  refreshTokenTtl: integer("refreshTokenTtl"),
  signingAlgorithm: text("signingAlgorithm"),
  signingKeyId: text("signingKeyId"),
  allowedScopes: text("allowedScopes"),
  customClaims: text("customClaims"),
  dpopBoundAccessTokensRequired: integer("dpopBoundAccessTokensRequired", {
    mode: "boolean",
  }),
  disabled: integer("disabled", { mode: "boolean" }),
  createdAt: sqliteDate("createdAt"),
  updatedAt: sqliteDate("updatedAt"),
  policyVersion: integer("policyVersion"),
  metadata: text("metadata"),
});

const organization = sqliteTable("organization", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logo: text("logo"),
  createdAt: sqliteDate("createdAt").notNull(),
  metadata: text("metadata"),
});

const propertyAccess = sqliteTable(
  "property_access",
  {
    propertyId: text("propertyId").primaryKey(),
    organizationId: text("organizationId").notNull(),
    name: text("name")
      .notNull()
      .default(sql`''`),
    domain: text("domain")
      .notNull()
      .default(sql`''`),
    tags: text("tags")
      .notNull()
      .default(sql`'[]'`),
  },
  (table) => [index("property_org").on(table.organizationId)]
);

const rateLimit = sqliteTable("rateLimit", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: integer("lastRequest").notNull(),
});

const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: sqliteDate("expiresAt").notNull(),
    token: text("token").notNull().unique(),
    createdAt: sqliteDate("createdAt").notNull(),
    updatedAt: sqliteDate("updatedAt").notNull(),
    ipAddress: text("ipAddress"),
    userAgent: text("userAgent"),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    impersonatedBy: text("impersonatedBy"),
    activeOrganizationId: text("activeOrganizationId"),
    activeTeamId: text("activeTeamId"),
  },
  (table) => [index("session_userId_idx").on(table.userId)]
);

const siteTransfer = sqliteTable("site_transfer", {
  id: text("id").primaryKey(),
  propertyId: text("propertyId").notNull(),
  sourceOrganizationId: text("sourceOrganizationId").notNull(),
  targetEmail: text("targetEmail").notNull(),
  createdBy: text("createdBy").notNull(),
  createdAt: text("createdAt").notNull(),
  expiresAt: text("expiresAt").notNull(),
  status: text("status")
    .notNull()
    .default(sql`'pending'`),
});

const team = sqliteTable(
  "team",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    memberCount: integer("memberCount").notNull(),
    organizationId: text("organizationId")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    createdAt: sqliteDate("createdAt").notNull(),
    updatedAt: sqliteDate("updatedAt"),
  },
  (table) => [index("team_organizationId_idx").on(table.organizationId)]
);

const teamMember = sqliteTable(
  "teamMember",
  {
    id: text("id").primaryKey(),
    teamId: text("teamId")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    membershipKey: text("membershipKey").unique(),
    createdAt: sqliteDate("createdAt"),
  },
  (table) => [
    uniqueIndex("team_membership_identity").on(table.teamId, table.userId),
    index("teamMember_userId_idx").on(table.userId),
    index("teamMember_teamId_idx").on(table.teamId),
  ]
);

const teamSiteAccess = sqliteTable(
  "team_site_access",
  {
    teamId: text("teamId").notNull(),
    propertyId: text("propertyId").notNull(),
    role: text("role"),
  },
  (table) => [primaryKey({ columns: [table.teamId, table.propertyId] })]
);

const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("emailVerified", { mode: "boolean" }).notNull(),
  image: text("image"),
  createdAt: sqliteDate("createdAt").notNull(),
  updatedAt: sqliteDate("updatedAt").notNull(),
  role: text("role"),
  banned: integer("banned", { mode: "boolean" }),
  banReason: text("banReason"),
  banExpires: sqliteDate("banExpires"),
  sendAutoEmailReports: integer("sendAutoEmailReports", { mode: "boolean" }),
});

const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: sqliteDate("expiresAt").notNull(),
    createdAt: sqliteDate("createdAt").notNull(),
    updatedAt: sqliteDate("updatedAt").notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)]
);

module.exports = {
  account,
  analysisObject,
  apikey,
  appDocument,
  appMigration,
  appSetting,
  billingCheckout,
  billingPayment,
  billingSubscription,
  billingWebhook,
  emailReportDelivery,
  invitation,
  jwks,
  member,
  memberSiteAccess,
  oauthAccessTokenV2,
  oauthClient,
  oauthClientAssertion,
  oauthClientResource,
  oauthConsentV2,
  oauthRefreshToken,
  oauthResource,
  organization,
  propertyAccess,
  rateLimit,
  session,
  siteTransfer,
  team,
  teamMember,
  teamSiteAccess,
  user,
  verification,
};

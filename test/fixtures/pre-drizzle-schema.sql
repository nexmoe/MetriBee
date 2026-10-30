-- Schema from MetriBee f445982, before Drizzle. Contains no application data.
CREATE TABLE "account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" date, "refreshTokenExpiresAt" date, "scope" text, "password" text, "createdAt" date not null, "updatedAt" date not null);

CREATE TABLE analysis_object (
      id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL,
      propertyId TEXT, organizationId TEXT NOT NULL, userId TEXT,
      payload TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
    );

CREATE TABLE "apikey" ("id" text not null primary key, "configId" text not null, "name" text, "start" text, "referenceId" text not null, "prefix" text, "key" text not null, "refillInterval" integer, "refillAmount" integer, "lastRefillAt" date, "enabled" integer, "rateLimitEnabled" integer, "rateLimitTimeWindow" integer, "rateLimitMax" integer, "requestCount" integer, "remaining" integer, "lastRequest" date, "expiresAt" date, "createdAt" date not null, "updatedAt" date not null, "permissions" text, "metadata" text);

CREATE TABLE app_document (
      kind TEXT NOT NULL, propertyId TEXT NOT NULL, payload TEXT NOT NULL,
      updatedAt TEXT NOT NULL, PRIMARY KEY(kind, propertyId)
    );

CREATE TABLE app_migration (id TEXT PRIMARY KEY, appliedAt TEXT NOT NULL);

CREATE TABLE app_setting (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE billing_checkout (
      id TEXT PRIMARY KEY, organizationId TEXT NOT NULL, userId TEXT NOT NULL,
      mode TEXT NOT NULL, productId TEXT NOT NULL, productType TEXT NOT NULL,
      status TEXT NOT NULL, sessionId TEXT, checkoutUrl TEXT, expiresAt TEXT,
      createdAt TEXT NOT NULL, orderId TEXT
    );

CREATE TABLE billing_payment (
      id TEXT NOT NULL, mode TEXT NOT NULL, organizationId TEXT NOT NULL, orderId TEXT NOT NULL,
      amount TEXT NOT NULL, currency TEXT NOT NULL, status TEXT NOT NULL, createdAt TEXT NOT NULL,
      PRIMARY KEY(id,mode)
    );

CREATE TABLE billing_subscription (
      organizationId TEXT NOT NULL, mode TEXT NOT NULL, orderId TEXT NOT NULL,
      productId TEXT NOT NULL, status TEXT NOT NULL, currency TEXT NOT NULL,
      amount TEXT NOT NULL, interval TEXT NOT NULL, currentPeriodStart TEXT,
      currentPeriodEnd TEXT, updatedAt TEXT NOT NULL,
      PRIMARY KEY(organizationId,mode), UNIQUE(orderId,mode)
    );

CREATE TABLE billing_webhook (
      id TEXT PRIMARY KEY, mode TEXT NOT NULL, eventType TEXT NOT NULL, payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
      receivedAt TEXT NOT NULL, processedAt TEXT, lastError TEXT
    );

CREATE TABLE email_report_delivery (
      deliveryKey TEXT PRIMARY KEY, status TEXT NOT NULL,
      createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
    );

CREATE TABLE "invitation" ("id" text not null primary key, "organizationId" text not null references "organization" ("id") on delete cascade, "email" text not null, "role" text, "teamId" text, "status" text not null, "expiresAt" date not null, "createdAt" date not null, "inviterId" text not null references "user" ("id") on delete cascade, "hasRestrictedSiteAccess" integer, "siteIds" text, "siteRole" text);

CREATE TABLE "jwks" ("id" text not null primary key, "publicKey" text not null, "privateKey" text not null, "createdAt" date not null, "expiresAt" date, "alg" text, "crv" text);

CREATE TABLE "member" ("id" text not null primary key, "organizationId" text not null references "organization" ("id") on delete cascade, "userId" text not null references "user" ("id") on delete cascade, "role" text not null, "createdAt" date not null, "hasRestrictedSiteAccess" integer);

CREATE TABLE member_site_access (
      memberId TEXT NOT NULL, propertyId TEXT NOT NULL, role TEXT,
      PRIMARY KEY(memberId, propertyId)
    );

CREATE TABLE "oauthAccessTokenV2" ("id" text not null primary key, "token" text not null unique, "clientId" text not null references "oauthClient" ("clientId") on delete cascade, "sessionId" text references "session" ("id") on delete set null, "userId" text references "user" ("id") on delete cascade, "referenceId" text, "authorizationCodeId" text, "resources" text, "requestedUserInfoClaims" text, "refreshId" text references "oauthRefreshToken" ("id") on delete cascade, "expiresAt" date not null, "createdAt" date not null, "revoked" date, "confirmation" text, "scopes" text not null);

CREATE TABLE "oauthClient" ("id" text not null primary key, "clientId" text not null unique, "clientSecret" text, "clientDiscoveryId" text, "disabled" integer, "skipConsent" integer, "enableEndSession" integer, "subjectType" text, "scopes" text, "clientCredentialsScopes" text, "userId" text references "user" ("id") on delete cascade, "createdAt" date, "updatedAt" date, "name" text, "uri" text, "icon" text, "contacts" text, "tos" text, "policy" text, "softwareId" text, "softwareVersion" text, "softwareStatement" text, "redirectUris" text not null, "postLogoutRedirectUris" text, "backchannelLogoutUri" text, "backchannelLogoutSessionRequired" integer, "tokenEndpointAuthMethod" text, "applicationType" text, "jwks" text, "jwksUri" text, "grantTypes" text, "responseTypes" text, "requirePKCE" integer, "dpopBoundAccessTokens" integer, "referenceId" text, "metadata" text);

CREATE TABLE "oauthClientAssertion" ("id" text not null primary key, "expiresAt" date not null);

CREATE TABLE "oauthClientResource" ("id" text not null primary key, "clientId" text not null references "oauthClient" ("clientId") on delete cascade, "resourceId" text not null references "oauthResource" ("identifier") on delete cascade, "metadata" text, "createdAt" date);

CREATE TABLE "oauthConsentV2" ("id" text not null primary key, "clientId" text not null references "oauthClient" ("clientId") on delete cascade, "userId" text references "user" ("id") on delete cascade, "referenceId" text, "resources" text, "requestedUserInfoClaims" text, "scopes" text not null, "createdAt" date not null, "updatedAt" date not null);

CREATE TABLE "oauthRefreshToken" ("id" text not null primary key, "token" text not null unique, "clientId" text not null references "oauthClient" ("clientId") on delete cascade, "sessionId" text references "session" ("id") on delete set null, "userId" text not null references "user" ("id") on delete cascade, "referenceId" text, "authorizationCodeId" text, "resources" text, "requestedUserInfoClaims" text, "expiresAt" date not null, "createdAt" date not null, "revoked" date, "rotatedAt" date, "rotationReplayResponse" text, "rotationReplayExpiresAt" date, "authTime" date, "confirmation" text, "scopes" text not null);

CREATE TABLE "oauthResource" ("id" text not null primary key, "identifier" text not null unique, "name" text not null, "accessTokenTtl" integer, "refreshTokenTtl" integer, "signingAlgorithm" text, "signingKeyId" text, "allowedScopes" text, "customClaims" text, "dpopBoundAccessTokensRequired" integer, "disabled" integer, "createdAt" date, "updatedAt" date, "policyVersion" integer, "metadata" text);

CREATE TABLE "organization" ("id" text not null primary key, "name" text not null, "slug" text not null unique, "logo" text, "createdAt" date not null, "metadata" text);

CREATE TABLE property_access (
      propertyId TEXT PRIMARY KEY, organizationId TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '', domain TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '[]'
    );

CREATE TABLE "rateLimit" ("id" text not null primary key, "key" text not null unique, "count" integer not null, "lastRequest" bigint not null);

CREATE TABLE "session" ("id" text not null primary key, "expiresAt" date not null, "token" text not null unique, "createdAt" date not null, "updatedAt" date not null, "ipAddress" text, "userAgent" text, "userId" text not null references "user" ("id") on delete cascade, "impersonatedBy" text, "activeOrganizationId" text, "activeTeamId" text);

CREATE TABLE site_transfer (
      id TEXT PRIMARY KEY, propertyId TEXT NOT NULL, sourceOrganizationId TEXT NOT NULL,
      targetEmail TEXT NOT NULL, createdBy TEXT NOT NULL, createdAt TEXT NOT NULL, expiresAt TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
    );

CREATE TABLE "team" ("id" text not null primary key, "name" text not null, "memberCount" integer not null, "organizationId" text not null references "organization" ("id") on delete cascade, "createdAt" date not null, "updatedAt" date);

CREATE TABLE "teamMember" ("id" text not null primary key, "teamId" text not null references "team" ("id") on delete cascade, "userId" text not null references "user" ("id") on delete cascade, "membershipKey" text unique, "createdAt" date);

CREATE TABLE team_site_access (
      teamId TEXT NOT NULL, propertyId TEXT NOT NULL, role TEXT,
      PRIMARY KEY(teamId, propertyId)
    );

CREATE TABLE "user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" integer not null, "image" text, "createdAt" date not null, "updatedAt" date not null, "role" text, "banned" integer, "banReason" text, "banExpires" date, "sendAutoEmailReports" integer);

CREATE TABLE "verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" date not null, "createdAt" date not null, "updatedAt" date not null);

CREATE INDEX "account_userId_idx" on "account" ("userId");

CREATE INDEX analysis_scope ON analysis_object(kind, organizationId, propertyId);

CREATE INDEX "apikey_configId_idx" on "apikey" ("configId");

CREATE INDEX "apikey_key_idx" on "apikey" ("key");

CREATE INDEX "apikey_referenceId_idx" on "apikey" ("referenceId");

CREATE INDEX billing_checkout_order ON billing_checkout(mode,orderId);

CREATE INDEX billing_payment_org ON billing_payment(organizationId,mode,createdAt);

CREATE UNIQUE INDEX billing_pending_org ON billing_checkout(organizationId,mode)
      WHERE status IN ('creating','pending');

CREATE INDEX billing_webhook_queue ON billing_webhook(mode,status,receivedAt);

CREATE INDEX "invitation_email_idx" on "invitation" ("email");

CREATE INDEX "invitation_organizationId_idx" on "invitation" ("organizationId");

CREATE INDEX "member_organizationId_idx" on "member" ("organizationId");

CREATE INDEX "member_userId_idx" on "member" ("userId");

CREATE UNIQUE INDEX membership_identity ON member(organizationId,userId);

CREATE INDEX "oauthAccessTokenV2_authorizationCodeId_idx" on "oauthAccessTokenV2" ("authorizationCodeId");

CREATE INDEX "oauthAccessTokenV2_clientId_idx" on "oauthAccessTokenV2" ("clientId");

CREATE INDEX "oauthAccessTokenV2_refreshId_idx" on "oauthAccessTokenV2" ("refreshId");

CREATE INDEX "oauthAccessTokenV2_sessionId_idx" on "oauthAccessTokenV2" ("sessionId");

CREATE INDEX "oauthAccessTokenV2_userId_idx" on "oauthAccessTokenV2" ("userId");

CREATE INDEX "oauthClientResource_clientId_idx" on "oauthClientResource" ("clientId");

CREATE UNIQUE INDEX "oauthClientResource_clientId_resourceId_uidx" on "oauthClientResource" ("clientId", "resourceId");

CREATE INDEX "oauthClientResource_resourceId_idx" on "oauthClientResource" ("resourceId");

CREATE INDEX "oauthClient_userId_idx" on "oauthClient" ("userId");

CREATE INDEX "oauthConsentV2_clientId_idx" on "oauthConsentV2" ("clientId");

CREATE INDEX "oauthConsentV2_userId_idx" on "oauthConsentV2" ("userId");

CREATE INDEX "oauthRefreshToken_authorizationCodeId_idx" on "oauthRefreshToken" ("authorizationCodeId");

CREATE INDEX "oauthRefreshToken_clientId_idx" on "oauthRefreshToken" ("clientId");

CREATE INDEX "oauthRefreshToken_sessionId_idx" on "oauthRefreshToken" ("sessionId");

CREATE INDEX "oauthRefreshToken_userId_idx" on "oauthRefreshToken" ("userId");

CREATE INDEX property_org ON property_access(organizationId);

CREATE INDEX "session_userId_idx" on "session" ("userId");

CREATE INDEX "teamMember_teamId_idx" on "teamMember" ("teamId");

CREATE INDEX "teamMember_userId_idx" on "teamMember" ("userId");

CREATE UNIQUE INDEX team_membership_identity ON teamMember(teamId,userId);

CREATE INDEX "team_organizationId_idx" on "team" ("organizationId");

CREATE INDEX "verification_identifier_idx" on "verification" ("identifier");

CREATE TRIGGER member_access_cleanup AFTER DELETE ON member BEGIN
      DELETE FROM member_site_access WHERE memberId=OLD.id;
      DELETE FROM teamMember WHERE userId=OLD.userId AND teamId IN (SELECT id FROM team WHERE organizationId=OLD.organizationId);
    END;

CREATE TRIGGER team_access_cleanup AFTER DELETE ON team BEGIN
      DELETE FROM team_site_access WHERE teamId=OLD.id;
    END;

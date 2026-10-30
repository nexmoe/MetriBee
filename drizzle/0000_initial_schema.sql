-- Adopt existing pre-Drizzle tables without replacing their data.
CREATE TABLE IF NOT EXISTS `account` (
	`id` text PRIMARY KEY NOT NULL,
	`accountId` text NOT NULL,
	`providerId` text NOT NULL,
	`userId` text NOT NULL,
	`accessToken` text,
	`refreshToken` text,
	`idToken` text,
	`accessTokenExpiresAt` date,
	`refreshTokenExpiresAt` date,
	`scope` text,
	`password` text,
	`createdAt` date NOT NULL,
	`updatedAt` date NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `account_userId_idx` ON `account` (`userId`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `analysis_object` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`propertyId` text,
	`organizationId` text NOT NULL,
	`userId` text,
	`payload` text NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `analysis_scope` ON `analysis_object` (`kind`,`organizationId`,`propertyId`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `apikey` (
	`id` text PRIMARY KEY NOT NULL,
	`configId` text NOT NULL,
	`name` text,
	`start` text,
	`referenceId` text NOT NULL,
	`prefix` text,
	`key` text NOT NULL,
	`refillInterval` integer,
	`refillAmount` integer,
	`lastRefillAt` date,
	`enabled` integer,
	`rateLimitEnabled` integer,
	`rateLimitTimeWindow` integer,
	`rateLimitMax` integer,
	`requestCount` integer,
	`remaining` integer,
	`lastRequest` date,
	`expiresAt` date,
	`createdAt` date NOT NULL,
	`updatedAt` date NOT NULL,
	`permissions` text,
	`metadata` text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `apikey_referenceId_idx` ON `apikey` (`referenceId`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `apikey_key_idx` ON `apikey` (`key`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `apikey_configId_idx` ON `apikey` (`configId`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `app_document` (
	`kind` text NOT NULL,
	`propertyId` text NOT NULL,
	`payload` text NOT NULL,
	`updatedAt` text NOT NULL,
	PRIMARY KEY(`kind`, `propertyId`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `app_migration` (
	`id` text PRIMARY KEY NOT NULL,
	`appliedAt` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `app_setting` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `billing_checkout` (
	`id` text PRIMARY KEY NOT NULL,
	`organizationId` text NOT NULL,
	`userId` text NOT NULL,
	`mode` text NOT NULL,
	`productId` text NOT NULL,
	`productType` text NOT NULL,
	`status` text NOT NULL,
	`sessionId` text,
	`checkoutUrl` text,
	`expiresAt` text,
	`createdAt` text NOT NULL,
	`orderId` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `billing_pending_org` ON `billing_checkout` (`organizationId`,`mode`) WHERE status IN ('creating','pending');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `billing_checkout_order` ON `billing_checkout` (`mode`,`orderId`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `billing_payment` (
	`id` text NOT NULL,
	`mode` text NOT NULL,
	`organizationId` text NOT NULL,
	`orderId` text NOT NULL,
	`amount` text NOT NULL,
	`currency` text NOT NULL,
	`status` text NOT NULL,
	`createdAt` text NOT NULL,
	PRIMARY KEY(`id`, `mode`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `billing_payment_org` ON `billing_payment` (`organizationId`,`mode`,`createdAt`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `billing_subscription` (
	`organizationId` text NOT NULL,
	`mode` text NOT NULL,
	`orderId` text NOT NULL,
	`productId` text NOT NULL,
	`status` text NOT NULL,
	`currency` text NOT NULL,
	`amount` text NOT NULL,
	`interval` text NOT NULL,
	`currentPeriodStart` text,
	`currentPeriodEnd` text,
	`updatedAt` text NOT NULL,
	PRIMARY KEY(`organizationId`, `mode`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `billing_subscription_orderId_mode_unique` ON `billing_subscription` (`orderId`,`mode`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `billing_webhook` (
	`id` text PRIMARY KEY NOT NULL,
	`mode` text NOT NULL,
	`eventType` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`receivedAt` text NOT NULL,
	`processedAt` text,
	`lastError` text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `billing_webhook_queue` ON `billing_webhook` (`mode`,`status`,`receivedAt`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `email_report_delivery` (
	`deliveryKey` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `invitation` (
	`id` text PRIMARY KEY NOT NULL,
	`organizationId` text NOT NULL,
	`email` text NOT NULL,
	`role` text,
	`teamId` text,
	`status` text NOT NULL,
	`expiresAt` date NOT NULL,
	`createdAt` date NOT NULL,
	`inviterId` text NOT NULL,
	`hasRestrictedSiteAccess` integer,
	`siteIds` text,
	`siteRole` text,
	FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`inviterId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `invitation_organizationId_idx` ON `invitation` (`organizationId`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `invitation_email_idx` ON `invitation` (`email`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `jwks` (
	`id` text PRIMARY KEY NOT NULL,
	`publicKey` text NOT NULL,
	`privateKey` text NOT NULL,
	`createdAt` date NOT NULL,
	`expiresAt` date,
	`alg` text,
	`crv` text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `member` (
	`id` text PRIMARY KEY NOT NULL,
	`organizationId` text NOT NULL,
	`userId` text NOT NULL,
	`role` text NOT NULL,
	`createdAt` date NOT NULL,
	`hasRestrictedSiteAccess` integer,
	FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `membership_identity` ON `member` (`organizationId`,`userId`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `member_userId_idx` ON `member` (`userId`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `member_organizationId_idx` ON `member` (`organizationId`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `member_site_access` (
	`memberId` text NOT NULL,
	`propertyId` text NOT NULL,
	`role` text,
	PRIMARY KEY(`memberId`, `propertyId`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `oauthAccessTokenV2` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`clientId` text NOT NULL,
	`sessionId` text,
	`userId` text,
	`referenceId` text,
	`authorizationCodeId` text,
	`resources` text,
	`requestedUserInfoClaims` text,
	`refreshId` text,
	`expiresAt` date NOT NULL,
	`createdAt` date NOT NULL,
	`revoked` date,
	`confirmation` text,
	`scopes` text NOT NULL,
	FOREIGN KEY (`clientId`) REFERENCES `oauthClient`(`clientId`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sessionId`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`refreshId`) REFERENCES `oauthRefreshToken`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `oauthAccessTokenV2_token_unique` ON `oauthAccessTokenV2` (`token`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `oauthAccessTokenV2_userId_idx` ON `oauthAccessTokenV2` (`userId`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `oauthAccessTokenV2_sessionId_idx` ON `oauthAccessTokenV2` (`sessionId`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `oauthAccessTokenV2_refreshId_idx` ON `oauthAccessTokenV2` (`refreshId`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `oauthAccessTokenV2_clientId_idx` ON `oauthAccessTokenV2` (`clientId`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `oauthAccessTokenV2_authorizationCodeId_idx` ON `oauthAccessTokenV2` (`authorizationCodeId`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `oauthClient` (
	`id` text PRIMARY KEY NOT NULL,
	`clientId` text NOT NULL,
	`clientSecret` text,
	`clientDiscoveryId` text,
	`disabled` integer,
	`skipConsent` integer,
	`enableEndSession` integer,
	`subjectType` text,
	`scopes` text,
	`clientCredentialsScopes` text,
	`userId` text,
	`createdAt` date,
	`updatedAt` date,
	`name` text,
	`uri` text,
	`icon` text,
	`contacts` text,
	`tos` text,
	`policy` text,
	`softwareId` text,
	`softwareVersion` text,
	`softwareStatement` text,
	`redirectUris` text NOT NULL,
	`postLogoutRedirectUris` text,
	`backchannelLogoutUri` text,
	`backchannelLogoutSessionRequired` integer,
	`tokenEndpointAuthMethod` text,
	`applicationType` text,
	`jwks` text,
	`jwksUri` text,
	`grantTypes` text,
	`responseTypes` text,
	`requirePKCE` integer,
	`dpopBoundAccessTokens` integer,
	`referenceId` text,
	`metadata` text,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `oauthClient_clientId_unique` ON `oauthClient` (`clientId`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `oauthClient_userId_idx` ON `oauthClient` (`userId`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `oauthClientAssertion` (
	`id` text PRIMARY KEY NOT NULL,
	`expiresAt` date NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `oauthClientResource` (
	`id` text PRIMARY KEY NOT NULL,
	`clientId` text NOT NULL,
	`resourceId` text NOT NULL,
	`metadata` text,
	`createdAt` date,
	FOREIGN KEY (`clientId`) REFERENCES `oauthClient`(`clientId`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resourceId`) REFERENCES `oauthResource`(`identifier`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `oauthClientResource_resourceId_idx` ON `oauthClientResource` (`resourceId`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `oauthClientResource_clientId_resourceId_uidx` ON `oauthClientResource` (`clientId`,`resourceId`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `oauthClientResource_clientId_idx` ON `oauthClientResource` (`clientId`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `oauthConsentV2` (
	`id` text PRIMARY KEY NOT NULL,
	`clientId` text NOT NULL,
	`userId` text,
	`referenceId` text,
	`resources` text,
	`requestedUserInfoClaims` text,
	`scopes` text NOT NULL,
	`createdAt` date NOT NULL,
	`updatedAt` date NOT NULL,
	FOREIGN KEY (`clientId`) REFERENCES `oauthClient`(`clientId`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `oauthConsentV2_userId_idx` ON `oauthConsentV2` (`userId`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `oauthConsentV2_clientId_idx` ON `oauthConsentV2` (`clientId`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `oauthRefreshToken` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`clientId` text NOT NULL,
	`sessionId` text,
	`userId` text NOT NULL,
	`referenceId` text,
	`authorizationCodeId` text,
	`resources` text,
	`requestedUserInfoClaims` text,
	`expiresAt` date NOT NULL,
	`createdAt` date NOT NULL,
	`revoked` date,
	`rotatedAt` date,
	`rotationReplayResponse` text,
	`rotationReplayExpiresAt` date,
	`authTime` date,
	`confirmation` text,
	`scopes` text NOT NULL,
	FOREIGN KEY (`clientId`) REFERENCES `oauthClient`(`clientId`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sessionId`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `oauthRefreshToken_token_unique` ON `oauthRefreshToken` (`token`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `oauthRefreshToken_userId_idx` ON `oauthRefreshToken` (`userId`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `oauthRefreshToken_sessionId_idx` ON `oauthRefreshToken` (`sessionId`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `oauthRefreshToken_clientId_idx` ON `oauthRefreshToken` (`clientId`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `oauthRefreshToken_authorizationCodeId_idx` ON `oauthRefreshToken` (`authorizationCodeId`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `oauthResource` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`name` text NOT NULL,
	`accessTokenTtl` integer,
	`refreshTokenTtl` integer,
	`signingAlgorithm` text,
	`signingKeyId` text,
	`allowedScopes` text,
	`customClaims` text,
	`dpopBoundAccessTokensRequired` integer,
	`disabled` integer,
	`createdAt` date,
	`updatedAt` date,
	`policyVersion` integer,
	`metadata` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `oauthResource_identifier_unique` ON `oauthResource` (`identifier`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `organization` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`logo` text,
	`createdAt` date NOT NULL,
	`metadata` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `organization_slug_unique` ON `organization` (`slug`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `property_access` (
	`propertyId` text PRIMARY KEY NOT NULL,
	`organizationId` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`domain` text DEFAULT '' NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `property_org` ON `property_access` (`organizationId`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `rateLimit` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`count` integer NOT NULL,
	`lastRequest` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `rateLimit_key_unique` ON `rateLimit` (`key`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expiresAt` date NOT NULL,
	`token` text NOT NULL,
	`createdAt` date NOT NULL,
	`updatedAt` date NOT NULL,
	`ipAddress` text,
	`userAgent` text,
	`userId` text NOT NULL,
	`impersonatedBy` text,
	`activeOrganizationId` text,
	`activeTeamId` text,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `session_userId_idx` ON `session` (`userId`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `site_transfer` (
	`id` text PRIMARY KEY NOT NULL,
	`propertyId` text NOT NULL,
	`sourceOrganizationId` text NOT NULL,
	`targetEmail` text NOT NULL,
	`createdBy` text NOT NULL,
	`createdAt` text NOT NULL,
	`expiresAt` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `team` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`memberCount` integer NOT NULL,
	`organizationId` text NOT NULL,
	`createdAt` date NOT NULL,
	`updatedAt` date,
	FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `team_organizationId_idx` ON `team` (`organizationId`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `teamMember` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`userId` text NOT NULL,
	`membershipKey` text,
	`createdAt` date,
	FOREIGN KEY (`teamId`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `teamMember_membershipKey_unique` ON `teamMember` (`membershipKey`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `team_membership_identity` ON `teamMember` (`teamId`,`userId`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `teamMember_userId_idx` ON `teamMember` (`userId`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `teamMember_teamId_idx` ON `teamMember` (`teamId`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `team_site_access` (
	`teamId` text NOT NULL,
	`propertyId` text NOT NULL,
	`role` text,
	PRIMARY KEY(`teamId`, `propertyId`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`emailVerified` integer NOT NULL,
	`image` text,
	`createdAt` date NOT NULL,
	`updatedAt` date NOT NULL,
	`role` text,
	`banned` integer,
	`banReason` text,
	`banExpires` date,
	`sendAutoEmailReports` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expiresAt` date NOT NULL,
	`createdAt` date NOT NULL,
	`updatedAt` date NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `verification_identifier_idx` ON `verification` (`identifier`);
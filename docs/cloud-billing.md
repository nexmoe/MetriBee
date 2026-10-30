# Cloud billing with Waffo Pancake

Self-hosted is the default. It needs no payment credentials and hides billing navigation, upgrade prompts and subscription queries. Billing pages, payment APIs and webhooks return 404, and no payment reconciliation worker runs. Existing payment credentials or billing rows in a restored database do not enable Cloud or impose subscription restrictions on self-hosted organizations. Only the exact server setting `CLOUD=true` enables billing; browser parameters cannot enable it. The same frontend build supports both modes.

The supplied Docker Compose file explicitly sets `CLOUD=false`, overriding `.env` for self-hosting. Cloud deployments must explicitly override that environment setting in their own deployment configuration. Set `CLOUD=true` to expose organization billing in Settings and the avatar menu.

Cloud subscriptions belong to an organization, not an individual or team. Organization owners manage checkout, plan changes, cancellation, payment details and invoices. Personal API keys and MCP OAuth credentials cannot access billing endpoints. Team/site permissions and GA4 quota protection continue to apply independently.

| Plan | Monthly | Annual |
| --- | ---: | ---: |
| Standard | USD 19 | USD 199 |
| Pro | USD 29 | USD 299 |

These are fixed organization fees. There is no event-volume slider or per-member/resource billing. Taxes and any plan-change adjustment are confirmed on Waffo's hosted checkout. This integration does not introduce an analytics paywall or different feature entitlements for the two plans.

## Credentials and sandbox setup

The only required payment credentials are in the root `.env`:

```dotenv
WAFFO_MERCHANT_ID=MER_xxx
WAFFO_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
```

Copy the **Merchant ID**, not a store ID, from Dashboard → API & Development → Create an API Key → the first row above the key list. Create a dedicated **test** API key in that section. Private keys remain server-side; never put them in frontend environment variables or key files.

For a Cloud sandbox preview also set:

```dotenv
CLOUD=true
WAFFO_MODE=test
```

Create the test catalog using the official `@waffo/pancake-ts` SDK:

```sh
node scripts/waffo.mjs setup --monthly 19.00 --yearly 199.00 --pro-monthly 29.00 --pro-yearly 299.00 --test-product
```

The script selects the only merchant store automatically, creates one if none exists, and requires an explicit `--store-id STO_xxx` when multiple stores exist. Store IDs, product IDs and prices are stored in SQLite `app_setting`; they are not additional required environment variables. Repeating setup reuses configured products and explicit provider idempotency keys. No products are published to production.

Setup creates missing products; it does not reprice existing ones. For price changes, update the existing products through Waffo, then import their catalog to refresh SQLite prices. Waffo retains product IDs and creates new product versions; existing subscriptions and checkout sessions keep their original pricing.

The normal billing page reuses Rybbit’s plan rows, invoice table and three-step cancellation dialog. The sandbox checkout tool is kept out of that page. Cancellation reasons are saved privately to SQLite when the provider accepts cancellation.

The optional one-time USD 1 test product verifies `order.completed`; it never grants a recurring subscription. Use test card `4576750000000110`, any future expiry and any CVC. Subscription first payment emits `subscription.activated` and payment events; it is distinct from `order.completed`.

## Webhooks and subscription state

Register a public HTTPS endpoint (use ngrok locally, preserving `X-Waffo-Signature`):

```sh
node scripts/waffo.mjs webhook --url https://YOUR_HOST/api/rybbit/billing/webhook
```

Only the webhook endpoint needs public access for local testing. Do not expose a test database's account or analytics routes through a temporary tunnel. A reverse proxy or access gateway must let Waffo POST this endpoint without interactive login.

Fastify preserves the exact request body in an encapsulated parser. The SDK verifies the signature and replay window against the configured environment. The handler also checks the store and persists a deduplicated inbox record **before** responding 200. Background processing reads the authoritative Waffo order, verifies the checkout/organization/customer binding, then updates SQLite atomically. Redirecting back from checkout cannot grant a subscription. Duplicate and delayed events do not duplicate payment records or overwrite a newer subscription with an older order.

Subscription activation, renewal, cancellation, reactivation, plan changes, past-due states and refunds are handled. Cancellation leaves the subscription available through the provider's current period; an organization with a live subscription or pending checkout cannot be deleted. Invoices and payment-method management open Waffo's customer portal with the backend-authenticated organization identity.

Failed processing remains durable, with up to 12 automatic attempts across minute-based worker runs and restarts. Inspect or retry after fixing an outage/configuration issue:

```sh
node scripts/waffo.mjs status
node scripts/waffo.mjs retry
```

SQLite persists catalog configuration, checkout attempts, subscriptions, payment history and the webhook inbox. Keep the application database volume and backups; a restart does not require rebuilding payment configuration. Existing self-hosted installations receive additive billing tables and retain their existing data.

## Production configuration

Production requires a separate Waffo production API key, approved merchant setup, reviewed/published products and a stable HTTPS webhook URL. `WAFFO_MODE=prod` selects local production state and production webhook verification; it does not turn a test key into a production key. This setup workflow never publishes products automatically.

Import existing reviewed products with an administrator-owned JSON catalog:

```json
{
  "storeId": "STO_xxx",
  "plans": [
    {"id": "standard-monthly", "productId": "PROD_xxx", "name": "Standard", "currency": "USD"}
  ]
}
```

Include all four monthly/annual product mappings for Standard and Pro. Put them in a Waffo subscription product group to enable self-service plan changes. The import validates product ownership/status, reads prices and billing intervals from Waffo, and persists them in SQLite:

```sh
node scripts/waffo.mjs import --catalog /path/to/catalog.json --mode prod
node scripts/waffo.mjs webhook --url https://YOUR_HOST/api/rybbit/billing/webhook --mode prod
```

Restart after changing `.env`. Test and production checkouts, subscription states, payments and webhook records are separated by mode. The current integration was exercised in the sandbox only.

# MetriBee MCP

Streamable HTTP MCP server exposing Google Analytics Admin + Data API tools.
Uses the latest stable MCP TypeScript SDK v2 (`@modelcontextprotocol/server`
2.3.1) and the 2026-07-28 protocol, with stateless compatibility for 2025 clients.
One `pnpm install` at the root covers it, and it reads credentials from the root `.env`.

## Setup

Set `GA4_CLIENT_EMAIL` and `GA4_PRIVATE_KEY` in the root `.env` (see
[SETUP.md](../SETUP.md), or open `/setup` in the dashboard). Check them with
`pnpm setup:check`. Start the dashboard with `pnpm start`: MCP is available at
`http://localhost:5483/api/mcp` on the same port, including in Docker. No second process is needed.

For MCP without the dashboard, run `pnpm mcp`. Its URL defaults to
`http://127.0.0.1:5484/api/mcp`; configure it with `MCP_HOST` and `MCP_PORT`.
`GET /healthz` checks the standalone process without calling Google.

## Registering with Claude Code

From the project where you want the tools:

```bash
claude mcp add ga4 --transport http --scope project http://localhost:5483/api/mcp
```

`--scope project` writes `.mcp.json` in that project. Use `--scope user` to
have it in every project. If `ga4` already uses stdio, run
`claude mcp remove ga4 --scope project` first (use its existing scope).
Keep the dashboard or standalone HTTP process running; the client connects by URL.

Equivalent `.mcp.json`:

```json
{
  "mcpServers": {
    "ga4": {
      "type": "http",
      "url": "http://localhost:5483/api/mcp"
    }
  }
}
```

Clients must support Streamable HTTP. The stdio entry point and the old
HTTP+SSE `/sse` + `/messages` transport are not served.

`claude mcp list` should show `ga4` as Connected. Tools appear in a session
after a restart.

## Credentials

The private key lives only in the root `.env` (gitignored). The MCP client
config holds just the HTTP URL, never Google credentials.

Create the first administrator in the dashboard before connecting. MCP requests
require an OAuth token or an `Authorization: Bearer <API key>` header. Personal
and organization keys can restrict scopes and inherit current property grants.
Dashboard and standalone MCP share `DATABASE_PATH`; the standalone process uses
the dashboard's `BASE_URL` for browser authorization. OAuth requires HTTPS or a
loopback origin; API keys also work on private HTTP LAN deployments.

## Personal connections and permissions

Open **Settings → Account → Connect AI tools** to copy the configured MCP URL or connection commands for Claude Code, Codex and JSON clients. Sign in through the client’s OAuth prompt; no key is embedded in these examples. Non-TLS LAN deployments show personal-key header instructions instead.

Everyone connects to the same `/api/mcp` URL using their own OAuth login or personal API key. The original `/mcp` URL remains compatible, including OAuth discovery and token audiences. Create personal keys under **Settings → Account**, and organization keys under **Settings → Organization**. Both key managers, their permission picker and the OAuth consent/login pages reuse the native Rybbit UI.

Personal connections inherit current organization membership, direct site grants and team grants. The effective permission is the user's current role intersected with the credential's scopes; `write` implies `read` on that resource and never elevates a role. Membership, team, role, ban and key changes are checked on subsequent requests. Browser organization selection does not silently change a personal connection. Organization keys act as their organization, survive member departures and cannot access other organizations; do not share one as a substitute for individual connections.

Start with `list_sites`: it returns organizations, roles, visible sites, effective site permissions and team grants from local SQLite, without Google calls. Its minimal discovery remains available for scoped keys. Other tools are filtered from `tools/list` by credential scopes; backend API checks still enforce roles, ownership and scopes on calls.

The native organization tools are `list_members`, `add_member`, `update_member_site_access`, `list_teams`, `create_team`, `update_team` and `delete_team`. They proxy to the existing dashboard API in process. Writes require explicit user intent; team deletion requires confirmation. No separate MCP membership or permission database exists. The standalone process uses the same handlers in a private Fastify gateway and shares the dashboard SQLite file.

## HTTP behavior and reverse proxies

The endpoint uses the v2 `createMcpHandler` with a fresh server for each request;
Google clients, caches and quota guards remain shared. Responses stream over SSE
inside Streamable HTTP, with no sticky sessions or `Mcp-Session-Id` required.
2025 clients can still initialize and call tools. Legacy session GET/DELETE
requests return 405; no persistent GET event stream is required.

Host and Origin validation allow localhost by default. For a private proxy, set
only `MCP_PUBLIC_URL=https://ga4.example.com/mcp` and restart the server. Its
hostname is automatically allowed for both request Hosts and browser Origins;
configure MCP clients with the same public URL. With Docker Compose,
recreate the container with `docker compose up -d --force-recreate dashboard`
to load changed environment values.

Advanced deployments can use `MCP_ALLOWED_HOSTS` and `MCP_ALLOWED_ORIGINS` to add
extra comma-separated hostnames without ports. They extend the localhost and
public hostname defaults; other hosts and origins remain blocked. Requests
without Origin are accepted with bearer authentication. Cookie authentication
also requires a trusted browser Origin. Preserve request/response
streaming through the proxy (`X-Accel-Buffering: no` is sent).

`MCP_PUBLIC_URL` must be an absolute HTTP or HTTPS URL without credentials. It
does not change the listening address or path. The public hostname is read from
configuration, never learned from a request's Host or forwarded headers.

Reference: [HTTP serving](https://ts.sdk.modelcontextprotocol.io/v2/serving/http.html).

## Tools

Start with `get_setup_status`, `get_capabilities` and `list_properties`. The
catalog reads the current analytics recipe definitions, supported segments,
filters and widget configuration, without exposing UI icon/style metadata.
The original GA4 tools remain compatible, alongside focused dashboard tools and native organization/team tools. All tools declare read/write, destructive and
idempotency hints. Successful object results have both text and
`structuredContent`; logical failures set `isError`.

### Native dashboard tools

| Tool | Purpose |
|---|---|
| `get_capabilities` | Current report IDs, segment names, filters, widget metrics/defaults, budgets and data limitations; no Google call |
| `list_properties` | Current site/account names, domains, search and pagination; shares the five-minute property metadata refresh |
| `get_cached_sites_report` | Multi-site status and account grouping from saved daily snapshots and cached metadata only; missing dates stay unknown, no Google requests |
| `get_search_console_connection` | Inspect one website's GSC connection and property/hostname match without exposing credentials |
| `get_search_analytics_report` | Native GA4 + GSC country/device joins, unknown unmatched values, sorting and pagination; GSC failures preserve GA4 data |
| `get_search_console_report` | GSC summary, daily trends and query/page/country/device top rows, comparison and pagination |
| `get_search_console_quota` | Published GSC limits and process-local observations; no Google requests |
| `get_dashboard_report` | Native overview/time series and all analytics catalog reports: acquisition, audience, technology, content, revenue/key events, traffic quality, visitor segments, what changed, referral diagnostics and live spikes |
| `get_pages_report` | Page/landing-page metrics, directory grouping, search, sorting and pagination |
| `get_events_report` | Custom-event names and trends, aggregates by event type and outbound links |
| `get_event_activity` | Hourly aggregate activity for one event name; never individual event logs |
| `get_journeys_report` | Default aggregate page transitions; `mode=sessions` uses optional GA4 BigQuery exports for real 2–10-step paths, summary, goals and exact-path sessions. Up to 31 days; explicit scan/daily budgets. Session lists require `sessions:read`. |
| `get_retention_report` | Native first-visit cohorts, weighted retention and previous-period summaries; property time zone, no audience filters |
| `get_site_status` | One property's homepage status, time buckets, comparison and fully covered saved AdSense values |
| `list_saved_funnels` | Search/paginate local funnel definitions, without report calls |
| `get_funnel` | One saved definition with metadata and pageable ordered steps |
| `validate_funnel` | Validate and normalize steps without saving or running reports |
| `save_funnel` | Create a named funnel, or partially update name, description and/or steps; omitted fields survive concurrent edits |
| `duplicate_funnel` | Copy one saved funnel in the same property |
| `import_funnels` | Atomic, rule-deduplicated JSON import into one property; optional write-free `dryRun` |
| `export_funnels` | Pageable native definitions whose returned `data` can be passed directly to `import_funnels.definitions` |
| `get_funnel_events` | Native event picker: event names and total users, guarded through the core quota pool |
| `get_funnel_summary` | Native saved-funnel conversions and union entrants for up to nine funnels per page; optional comparison shares the 20-call budget |
| `delete_funnel` | Delete one local funnel definition |
| `analyze_funnel` | Analyze a saved ID or an ad hoc sequence through ordered, closed GA4 funnel active users |
| `list_saved_widgets` | Search/paginate native saved metric widget definitions |
| `save_widget` | Create/update a local metric widget using the native builder's validator |
| `delete_widget` | Delete one saved widget; its existing URL stops working |
| `get_widget_report` | Private preview of a saved widget or config, with native totals, comparison, trends, percentage and currency handling |
| `refresh_property_quota` | Explicitly query one property's quota snapshot and update all three shared pools |
| `get_setup_status` | GA4/OAuth, GSC and PageSpeed configuration plus ordered-session availability, without secrets; `verify=true` checks GA4 authentication and property access |

`save_funnel`, `duplicate_funnel`, `import_funnels`, `delete_funnel`, `save_widget` and `delete_widget` change durable
local application data and must only be called at the user's request. They
do not modify GA4. Widget preview/management never enables site-wide sharing
or generates sharing keys.

Standard analyses accept `propertyId`, `range` (`today`, `7d`, `28d`, `30d`,
`90d`) and optional ISO `startDate`/`endDate`, resolved in the property's time
zone. Audience filters use the same `parameter`, `type` and `value` array as
the dashboard. Retention does not accept filters; funnel filters use the
subset listed by `get_capabilities`. Event activity uses a preset and day
offset. Widget configs use their own native presets, limited to 366 days.
Live spikes always cover the last 30 minutes and reject audience filters.

Historical dashboard, page, event, journey, retention, funnel and GSC reports
accept `comparison: "previous_period"`, `"previous_year"`, or
`{ "startDate": "2026-09-01", "endDate": "2026-09-07" }`. Both windows share
one 20-call GA4 budget. Responses include `comparison.previous` and changes
for scalar metrics and matching table rows; zero baselines produce an unknown
percentage, and unmatched top rows are not assumed to be zero. If comparison
is refused, successful current data remains available with
`comparison.unavailable: true`. Site status uses the chosen comparison in its
native `data.comparison`/site metrics instead. Realtime reports refuse historical
comparisons. Rolling windows support the preceding equal window only.

Dashboard, event, GSC, joined search, exported definitions and cache-only
portfolio results accept `offset` and `limit`. Dashboard `collection` selects
one collection, such as `rows` or `countries.rows`. `_pagination` records its
path, `returned`, `nextOffset`, `totalAvailable` and `sourceTruncated`. Follow
`nextOffset` using the same report arguments; the transport recalculates it
when byte limits shorten a page. `sourceTruncated` marks the end of the available
upstream top rows, not a promise of further Google pagination. Pages also
accept an exact `offset`, overriding `page`, for byte-budget continuation.
`get_funnel` uses `offset`/`limit` for steps, so even a large definition can be
read completely. A record that cannot fit must be narrowed using the detail
tool. Report caches always retain the original complete native result.

For the complete funnel workflow, discover events with `get_funnel_events`,
check rules with `validate_funnel`, create with `save_funnel`, then inspect
with `get_funnel` or `list_saved_funnels`. Rename with
`{ "propertyId": "123", "funnelId": 1, "name": "New name" }`; existing steps
and description are retained. Empty `description` clears it. Use
`duplicate_funnel`, or `export_funnels` followed by `import_funnels` for JSON
transfer. Imports validate the entire batch before one atomic commit,
preserve existing definitions, resolve name conflicts and skip duplicate rules.
`get_funnel_summary` reports union entrants for the selected page only; do not
sum them across pages. `analyze_funnel` analyzes a saved ID or temporary steps.
`delete_funnel` removes only the selected property's local definition.

Example arguments for `get_dashboard_report`:

```json
{
  "propertyId": "123456789",
  "report": "traffic-sources",
  "range": "7d",
  "limit": 20,
  "filters": [{ "parameter": "country", "type": "equals", "value": ["IN"] }]
}
```

These tools call the native controllers in-process, never a self-HTTP endpoint.
They preserve the dashboard's complete-query cache keys and calculations;
MCP pagination/output trimming happens after analysis, so shortened results
cannot poison the UI's caches. Results preserve `reportStatus`/`fetchedAt`,
sampling and privacy flags, with `dataQuality`, current `quota` and `apiCalls`.
`apiCalls` counts scoped analysis requests; site discovery can separately
refresh Admin metadata. Identical concurrent analyses share one in-flight
operation. Cached reports remain usable when quota is low.

At most 20 scoped Google calls are allowed per analysis, each going through
the MCP property-spread, reserve, cooldown, concurrency and rate-limit checks.
Predefined dashboard queries keep their native limits to preserve accurate
totals; the stricter raw-query caps below continue to apply to `run_report`.
Choose one short, focused report; whole-site directory analyses and long daily
cohorts can cost several calls. Only `refresh_property_quota` deliberately
bypasses the reserve gate to discover recovered quota; project cooldowns remain.

Resources: `ga4://capabilities` and `ga4://query-guide`. The `analyze_property`
prompt accepts `propertyId` and `question` and plans a focused read-only analysis.

### Low-level and inspection tools

| Tool | Purpose |
|---|---|
| `get_account_summaries` | All GA4 accounts + properties visible to the credentials |
| `get_property_details` | Display name, timezone, currency, etc. for one property |
| `list_google_ads_links` | Google Ads accounts linked to a property |
| `run_report` | Core report: dimensions x metrics over a date range, with `orderBys`, `limit`/`offset` and `dimensionFilter(s)` so filtering and sorting happen server-side |
| `run_funnel_report` | Step-by-step funnel completion over a date range |
| `get_custom_dimensions_and_metrics` | Custom dimensions/metrics defined on a property |
| `run_realtime_report` | Active users right now, last up to 30 minutes |
| `run_pagespeed_insights` | Lighthouse scores + Core Web Vitals for one URL: needs `PSI_API_KEY` |
| `request_indexing` | Ask Google to recrawl a URL after a deploy: needs Search Console owner access, see below |
| `get_cache_status` | What's cached, how old, still fresh? (no API call) |
| `get_rate_limit_status` | GA4 quota left per property and pool, optionally filtered by propertyId/pool, plus local throttle state (no GA4 tokens) |

`get_search_console_report` reads the same Google Search reports shown in Analytics: summary, daily trends and top queries/pages/countries/devices. It matches the chosen GA4 website to an accessible GSC property and shares its cache. Configure `GSC_CLIENT_EMAIL` and `GSC_PRIVATE_KEY` separately from GA4. Reports use `webmasters.readonly`, final Pacific-calendar data, hostname scoping and page aggregation. They spend no GA4 tokens. Private queries are omitted, tables are bounded, and unsupported GA4 audience filters are refused explicitly. The Indexing API action remains separate and uses the GA4 account's existing permissions.

`get_search_console_quota` reads the same local observations as the Search Console tab on `/quota`, with no Google requests: Search Analytics attempts, sites.list attempts, report cache hits, errors, rate limits and current cooldown. Counters cover this process only, reset on restart/credential changes, and use Pacific calendar days. A standalone MCP process has its own observations. Published default limits are reference values; actual project-wide remaining quota and query load are unknown. Check Google Cloud for complete project usage.

### PageSpeed Insights setup

Needs a `PSI_API_KEY`: a plain API key (not the GA service account), since
PSI auth is key-based, not OAuth. The GCP project already has one
(`pagespeed`, restricted to `pagespeedonline.googleapis.com`):

```bash
gcloud services api-keys get-key-string \
  projects/<PROJECT_ID>/locations/global/keys/<KEY_ID>
```

Put the output in the root `.env` as `PSI_API_KEY=...`.

### Indexing API setup

The GA service account (`<SERVICE_ACCOUNT_EMAIL>`)
currently has **no Search Console access on any property**: confirmed live: `request_indexing` returns
`403 Permission denied. Failed to verify the URL ownership.` until you fix this.

To enable it per site: Search Console → that property → Settings → Users and
permissions → Add user → paste the service account email above → **Owner**.
Do this for each domain you want `request_indexing` to work on.

## Rate limiting and quota

GA4 counts tokens per property per pool (core, realtime, funnel): 200k/day,
40k/hour, and 14k per hour for the whole GCP project. The dashboard uses the
same project, so both write Google's `propertyQuota` to one shared ledger
(`.data/quota-ledger.json`, override with `QUOTA_LEDGER_FILE`). Every GA4
result carries `quota: {cost, projectHourLeft, hourLeft, dayLeft, status}`;
`get_rate_limit_status` shows the ledger without spending tokens.

On a cache miss, each GA4 call passes these checks in order (a cache hit skips them):

1. **Report caps** (`run_report`): max 4 dimensions, 6 metrics, limit 250,
   93-day range. `pagePath`, `pageLocation`, `pageTitle`, `landingPage*`,
   `customEvent:*`, `customUser:*` need `orderBys` and limit 50 or less.
   Refusal: `report_too_big`.
2. **Property spread**: more than `MCP_MAX_PROPERTIES_PER_WINDOW` (3) distinct
   properties in `MCP_PROPERTY_WINDOW_MIN` (10) minutes is refused
   (`too_many_properties`). A property already in the window always passes.
3. **Quota gate**: when the ledger says the pool is `low` (project-hour under
   `QUOTA_RESERVE_PROJECT_HOUR_PCT` 30%, hour under `QUOTA_RESERVE_HOUR_PCT`
   20%, day under `QUOTA_RESERVE_DAY_PCT` 20%) or `critical` (under 10%), the
   call is refused with `quota_low` and a `retryAfter`, so the dashboard keeps
   its share.
4. **Concurrency**: at most `MCP_MAX_INFLIGHT_PER_PROPERTY` (3) calls per
   property at once; the rest queue.
5. **Local throttle**: one token bucket per API family (`admin`, `data`,
   `realtime`, `alpha`, `psi`, `indexing`; defaults 2/8/4/2/1/0.1 req/sec,
   `RATE_LIMIT_*_RPS`). Calls over it wait, never drop.

Retries: token exhaustion is never retried; concurrency exhaustion,
UNAVAILABLE and HTTP 500/503 retry once. Results larger than
`MCP_MAX_RESULT_BYTES` (12000) trim whole rows/records from the end and set
`truncated`, with paths/omitted counts for nested results. Oversized scalar
metadata produces a bounded `result_too_large` error. Retained event time/count
pairs stay together. This budget applies to each JSON result representation;
the MCP envelope includes both text and structured content.

## Caching

Low-level read tools cache responses in `mcp-server/.cache/` (gitignored) and
memory, keyed by tool name + params. TTL tiers (override via
`CACHE_TTL_*_SEC`):

- `realtime`: 60s (active users change by the minute)
- `report`: 1h (historical reports rarely change mid-day)
- `metadata`: 6h (custom dimension/metric definitions and Google Ads links)
- `properties`: 5min (account summaries and property names/details, matching metadata refresh)
- `psi`: 30min (a real Lighthouse run is expensive; long enough to avoid
  re-running on every question, short enough to catch a post-deploy regression)

High-level tools reuse the native `.cache/reports/` namespaces (including
events, retention and widgets); their freshness is returned by the domain
handlers. `get_cache_status` inspects the low-level MCP cache. Funnel/widget
definitions are durable application data, never report cache entries.
`request_indexing` and local definition writes are not cached. Demo MCP tool
caches use a separate `demo/` directory and never read/write live quota entries.

Every response carries a `_cache: { hit, ageSeconds, ttlSeconds }` field so
the caller always knows whether the data is fresh or served from cache.
`get_cache_status` inspects the whole cache without calling any API.

`run_report` and `run_realtime_report` also carry `currencyCode` (the
property's own currency, piggybacked on the cached `get_property_details`
metadata call): revenue metrics like `totalRevenue`/`totalAdRevenue` are
returned in the property's local currency, not normalized to USD. Properties
in this account mix INR and USD; comparing raw revenue numbers across
properties without checking `currencyCode` first will silently produce
nonsense (e.g. a property billing in INR can look like it out-earns a much
bigger USD property by 10x when it doesn't).

## Other APIs enabled on this GCP project (not built here)

`gcloud services list --enabled --project=<PROJECT_ID>` shows the following APIs are enabled on the GCP project, but this MCP server does not call them:

- Search Console reads use their separately configured service account/project (see SETUP.md).
- `maps-backend`, `maps-embed-backend`, `places-backend`, `geocoding-backend`: used by the
  existing globe view's city lookups, not analytics-shaped, no MCP need
- `telemetry.googleapis.com`: GCP-internal, auto-enabled, nothing to call

### Native saved analysis

`list_analysis_definitions`, `save_analysis_definition` and `delete_analysis_definition` manage native `segments`, `annotations`, `goals` and `dashboards` in SQLite. Supply one `propertyId`, `kind`, an optional numeric definition `id`, and the native UI `definition` body for writes. These tools enforce the same creator/organization/property permissions and never alter GA4.

`get_goals_report` reads up to 16 selected `goalIds` (newest by default), with explicit truncation and session conversion rates. `run_dashboard_card` executes one GA4 JSON report definition with `dimensions`, `metrics`, optional `filters`, `limit`, `orderBy` and `direction`; see `get_capabilities.analysisObjects`. Both share native report caches and the 20-call analysis budget. PDF downloads and email delivery remain dashboard operations.

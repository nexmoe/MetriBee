# Changelog

All notable changes to this project are listed here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Run MetriBee from its own ready-made Docker image on Intel/AMD or ARM computers.

- Main integrates its four GSC metrics into the top clickable metric card, switching the existing line chart with period comparison, saved metric selection and weighted daily/week/month/year search trends.

- Restores the four GSC summary metrics on Main and Pages while retaining the integrated search tables and whole-period shares.

- Pages adds GSC clicks, impressions, whole-period click/impression shares, CTR and weighted position to the native page and directory rows, with global search sorting, pagination, missing-value handling and matching MCP support.

- Rybbit’s 12-language interface, with URL-based language switching, additional Chinese GA4 labels and a MetriBee footer linking to releases, source, feedback and upstream attribution. Language changes preserve report parameters and private sharing paths.

- The live-user drawer shows five-minute GA4 totals and country, device and page breakdowns, sharing cached totals with the toolbar and exposing the same aggregates through MCP.

- Analytics merges Google Search Console metrics into the existing page, country and device tables, with keywords in the Sources card. Expanded tables combine GA4 and GSC columns with search, sorting and CSV export; summaries, comparisons and daily reports remain available through MCP. Automatic domain matching, read-only caches and explicit source/date/privacy limits apply.

- MCP adds native dashboard analysis for pages, events, journeys, cohorts, site status, saved funnels and metric widgets; searchable current properties, capability resources, a focused analysis prompt, structured results, scoped quota refresh, per-analysis budgets and Demo cache/quota isolation.

- A standalone Widgets management page replaces the former embed-settings tabs with one custom component builder sharing the Funnels editor. Widgets select up to six of 13 GA4 metrics, natural/rolling/custom periods, comparisons, filters, formats and card/inline layouts, with search, live previews, durable definitions, stable iframe URLs, automatic sizing and per-widget disable/delete controls. Inline badges fit their contents and wrap on narrow screens. Existing visitor-badge and private-dashboard iframe URLs remain supported.

- Analytics restores What changed and Spikes, including equal-period changes, suspected bots, live traffic surges and notable sources. Revenue and Key Events combines monetary totals with key-event counts and names. All three panels sit at the bottom of the overview.

- API quota adds “Fetch latest quota from GA4”, querying all connected properties through Google's quota snapshot API and updating Core, Realtime and Funnel balances, with partial-failure feedback.

- All data pages show compact relative update times that refresh automatically. Analytics places the time beside Filter. Analytics, homepage cards, pages, events, journeys, retention and funnels preserve original fetch times.

- API quota shows remaining-token progress bars and percentages for each hourly and daily budget, with low and critical reserve indicators.

- Retention workspace with real GA4 daily and weekly cohorts, weighted retention curves, previous-period comparisons, user/percent heatmaps, cell details and CSV export. Partial periods and GA4's first-session definition are explained on the page.

- Analytics adds native GA4 regions, cities, browser languages, operating systems and screen resolutions, plus a country sessions map. Technology reports use sessions consistently. Visitor time zones are not inferred.

- Pages analytics: directory grouping, landing pages, search, sorting, daily trends, exact date ranges, period comparisons and CSV export, backed by GA4 Data API reports. Metric notes explain engagement, bounce and the unavailable exit-page data.

- Journeys workspace with a page-transition Sankey, page filters, folder grouping, previous-period comparison and CSV export. Uses GA4 same-site referrer pairs, with clear limits for full session paths and partial reporting data.

- Events workspace with GA4 event summaries, type and name trends, previous-period comparisons, search, CSV export and hourly activity drilldowns. Individual event logs require BigQuery export.
- Home property cards can show the last 30 minutes, today, the last 7 days or the last 28 days. The browser remembers the selected range.
- Home groups active, quiet and failed properties by their GA4 account across all time ranges.

### Changed

- The dashboard now uses the MetriBee name throughout the interface.

- Data pages use TanStack Query cache-first loading with 30-minute cache retention and session restoration for historical reports. Stale results refresh in the background and remain visible if a refresh fails; shared pages and public embeds keep server-side access checks.

- Primary buttons use bee yellow with dark text in both themes.

- The project as a whole is now declared AGPL-3.0-only, matching the Rybbit code it includes. The original GA4-Dashboard-MCP MIT license moves to `LICENSES/`, and a root `NOTICE` lists both sources. The Docker image and `/ui-source.tar.gz` now include `LICENSE`, `NOTICE` and `LICENSES/`.

- Setup exposes the Streamable HTTP MCP URL, project client configuration, Claude Code command, verification steps and current report capabilities. Optional Search Console and supplemental OAuth instructions now appear alongside GA4 setup, sourced from SETUP.md.

- MCP moves from stdio and the v1 SDK to the latest stable v2 SDK and Streamable HTTP. The dashboard serves all 11 existing tools at `/mcp`; `pnpm mcp` provides a standalone HTTP endpoint. Client setup, Docker and connection prompts use HTTP URLs, with shared authentication, caching and quota protection.

- Account grouping moves from Realtime to an optional Home control shared by Cards, Status, Table and Heatmap.

- Home combines the original site cards with Status, Table and Heatmap views sharing search, date filters and comparison periods. View tabs, update time and date controls share one toolbar row. Reports, status thresholds, trends and CSV exports follow the selected dates; optional AdSense values require full period coverage. Existing Sites links open the matching homepage view.

- API quota groups Core, Realtime and Funnel rows under each site, with collapsible groups and no repeated site names.

- Globe restores the original full-viewport map, floating live summary and event feed, stacked city avatars, and floating city details, alongside the existing icon sidebar. Complete city, country, device and platform reports remain available from All summaries.

- Workspace pages show only the primary navigation; secondary report navigation is reserved for property details.

- Default Home directly reuses the original Rybbit Home and SiteCards. The GA4 realtime overview remains at `/realtime`; Sites, Globe, API quota, connection and the complete GA4 report catalog use the same copied components. User and Documentation menus are removed. Per-property homepage failures do not hide successful cards.

- Main, Pages, Events, Journeys and Retention now directly reuse the Rybbit React theme, Radix controls, stat bands, Sankey and cohort visualizations in one analytics workspace. GA4 APIs remain on the Express server; original UI source licenses are preserved and downloadable.
- Analytics date windows are inclusive and consistent across the workspace, with 30-day and 90-day support.

- Analytics layout: property and page sidebar with a Main entry, a full-width overview, and six groups of tabbed reports. Card headers contain only tabs and export actions. Mobile stacks navigation above the reports. Report links, CSV exports and keyboard navigation remain available.

### Fixed

- Entering Home or a property report no longer waits for the five-minute GA4 property metadata refresh. Historical report caches remain available during background revalidation, with shared requests, failure backoff and bounded refresh polling.

- Sidebar and logo imports consistently resolve to the shared MetriBee components across workspace pages.

- Subdomains without a favicon automatically use their main domain's icon, sharing cached results while respecting public and private suffix boundaries.

- Property and account names refresh automatically every five minutes instead of remaining in an indefinitely reused metadata cache. Home can sync names immediately, and cached realtime metrics use the latest property names.

- API quota only shows currently connected properties, excluding old ledger entries for disconnected sites while preserving active project-wide cooldowns.

- Sites and API quota tables follow the native Rybbit analytics layout, with flush headers, compact rows, aligned numbers and visible sort direction.

- Globe city details show device counts and last-seen activity time, matching the original dashboard.

- Globe reuses cached data for its selected or automatic refresh interval, shares one client cache across interval changes, and labels its manual fetch action “Fetch latest data from GA4”.

- Analytics pages share one sidebar component with the same menu order, active state and property selector. Navigation preserves the selected property and supported date presets across Main, Pages, Events, Journeys and Retention.

- GA4 clients use REST on networks that cannot establish gRPC connections. Local TLS and DNS failures no longer count toward the GA4 server-error cooldown.
- Home offers retry when every property report fails.

### Removed

- Redundant soft refresh buttons from Sites, API quota and the realtime overview.

- Global footer from all pages.

## [2.1.0] - 2026-10-12

### Added

- MCP quota guardrails: server instructions for agents, a quota gate that reads `propertyQuota` from each response, a limit of 3 distinct properties in 10 minutes, report size caps, at most 3 requests in flight per property, and a 12 KB output cap. A GA4 RESOURCE_EXHAUSTED error returns `quota_exhausted` with the reset time.
- Shared quota ledger (`.data/quota-ledger.json`): the dashboard and the MCP server both record what GA4 reports, so the MCP leaves about 30% of the project-hour budget for the dashboard. `get_rate_limit_status` reads it without spending tokens.
- Boot progress page: while the server starts, any page shows the boot steps live and opens by itself when ready.
- Console: numbered boot steps, a "still running..." line for slow steps, and one quota line per pool (after boot, then every 5 min when tokens were spent) instead of a line per request.

### Changed

- `/analytics` opens with 7 GA4 calls instead of 20. The other cards load when you scroll to them.
- A restart within 60 s reuses the last globe and live counts, so it spends no GA4 tokens.
- Country data comes only from the bundled list. restcountries.com v3.1 was deprecated and returned an error on every boot.

### Fixed

- First boot: opening a page other than `/` before the properties list was cached failed or showed an empty globe.
- AutopaginateTrueWarning in the console when listing properties.

## [2.0.0] - 2026-10-10

### Added

- Demo mode (`pnpm demo` or `DEMO=1`): generated data for 8 fictional sites, no Google account needed. A "Demo data" badge shows in the bar.
- `/setup` page: until credentials work, every page opens it. It has a prompt for your AI agent, a live checklist that moves on as each step passes, and the manual steps as a stepper with screenshots. Commands match how you run the app (pnpm or Docker).
- `pnpm setup:check`: checks the credentials from the terminal. Exit codes tell you which step failed.
- `GET /healthz` for uptime checks and the Docker health check.
- Docker image (`node:22-alpine`, about 222 MB, runs as a non-root user, health check, port 5483) and `docker-compose.yml`, which publishes the port on `127.0.0.1` only.
- Release workflow: a `v*` tag builds a multi-arch image (amd64, arm64) to GHCR and creates a GitHub release from this file.
- Home cards: per-minute charts and Open GA4 / Report / Visit site actions.
- Home live strip: a mini globe with live visitor dots that spins to the busiest city.
- Spike rule you can adjust in Settings > Spike rule. Spike alerts on Home can be collapsed, and the browser remembers the state.
- README: private access with Cloudflare Tunnel plus Access, or Tailscale.
- Report page extras: referrers by platform, source and medium split, suspected bot traffic, revenue and key events.
- Globe: day and night shade, local time on city cards, country flags from `/api/flag/:cc` (cached in `.data/flags`), site favicons (cached in `.data/favicons`).

### Changed

- Credentials come from env only: `GA4_CLIENT_EMAIL` and `GA4_PRIVATE_KEY` in the root `.env`, with the read-only Analytics scope. The server re-reads `.env`, so no restart is needed after setup.
- The MCP server is part of the root package. It reads the same `.env`, and one `pnpm install` covers both.
- Globe rebuilt on MapLibre (OpenFreeMap tiles) with a canvas fallback. Every map uses India's official boundary (Natural Earth 10m India POV).
- Analytics page rebuilt: trend chart, what changed, deltas against the previous period.
- Top navigation is a command bar: Ctrl K jump box, page icons, settings menu with theme and GA4 quota. Light theme by default.
- Spike detection compares live users with the same hour on past days (z-score), so normal peak hours no longer show as spikes. When the property time zone is unknown, it falls back to the usual busiest half hour over 7 days.
- Report stats use GA4 totals. Failed time zone lookups are retried.
- Inter Variable is self-hosted (`public/fonts`). The app makes no Google Fonts requests.
- TypeScript controllers compile at build time (`pnpm build`), so the Docker image has no TypeScript tooling.
- The app is named MetriBee (interim name).

### Fixed

- Inline JSON in pages escapes `<`, so data cannot close the script tag.
- Favicon fetches check every redirect hop, not only the first URL.
- Spike totals no longer count a user once per page viewed.

### Removed

- Key-file credentials: `ga4dataapi-*.json`, `GA4_CREDENTIALS_PATH` and `GOOGLE_APPLICATION_CREDENTIALS` are no longer read.
- The separate `mcp-server` package (its own `package.json`, lockfile and `.env`).
- Syne and DM Mono web fonts.

### Upgrading from 1.x

1. Open your service account JSON key (`ga4dataapi-*.json`).
2. Copy `client_email` to `GA4_CLIENT_EMAIL` and `private_key` to `GA4_PRIVATE_KEY` in the root `.env`. Keep the key in double quotes, with the `\n` sequences as they are in the file.
3. Run `pnpm install` at the root, then `pnpm setup:check`.
4. When the check passes, delete the JSON key file and `mcp-server/.env`.

# Changelog

All notable changes to this project are listed here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [2.3.1] - 2026-10-30

### Improvements

- Finish signup by naming your workspace, without entering a domain or installing a tracking code. Sites continue to sync from connected GA4 properties.
- Login, signup and account recovery stay readable when privacy mode was enabled previously.

## [2.3.0] - 2026-10-30

### What's New

- Sign in with an email address or a configured Google/GitHub account, recover access by email, and manage your account from the native settings pages.
- Create organizations, invite people, organize teams and choose which properties each person can access. Move properties between organizations or transfer them to another person.
- Connect AI assistants through a consent screen or scoped access keys, with the same property access rules as the dashboard.
- Enable Public Analytics for individual properties and share a read-only dashboard, with immediate revocation and existing private links preserved.
- Save segments and chart annotations, track Goals, and arrange custom Dashboards using your GA4 reports.
- Export analytics as PDF reports and receive weekly summaries by email for the properties you can access.
- Connect a GA4 BigQuery export to explore real journeys of up to ten steps, inspect matching visits and event timelines, and set query spending limits.
- Use optional Cloud organization subscriptions with hosted checkout, plan changes, cancellation and invoices. Self-hosted installations keep billing disabled by default.

### Improvements

- Existing funnels, widgets and private links are retained when upgrading, with online backups available for accounts and saved settings.
- Open Journeys on GA4-only connections without encountering unavailable session controls.
- Continue using open tabs when the interface updates, with a reload option if startup fails.
- Updates follow published stable versions so routine development changes do not replace the current release.

### Important Changes

- Signing in is now required to access private analytics. When upgrading an installation without accounts, create the first account privately to become its administrator. Existing properties and saved definitions are retained.

## [2.2.1] - 2026-10-25

### Improvements

- Connect AI assistants through your private domain by setting its public connection address once, without maintaining separate domain lists. Existing access restrictions and additional allowed domains are preserved.

## [2.2.0] - 2026-10-25

### What's New

- Explore traffic, pages, events, funnels, journeys and retention in a shared Rybbit workspace with consistent navigation and date controls.
- Use the interface in 12 languages. Switching languages keeps your selected property, dates, filters and shared report links.
- See Google Search Console clicks, impressions, click-through rates, search positions and keywords alongside Google Analytics traffic. Switch the main chart to search trends and compare periods.
- Group pages into directories, sort and search across traffic and search measurements, and export expanded reports.
- Create and manage property-specific widgets with selected measurements, trends, comparisons, date ranges and display styles. Existing embedded visitor badges and shared dashboards continue to work.
- Switch Home between Cards, Status, Table and Heatmap views, with shared search, dates, comparisons and optional account grouping.
- Inspect live visitors by country, device and page, and explore a full-screen globe with city details and a live activity feed.
- Explore retention by day or week, compare periods, inspect individual groups and export the results.
- Review revenue, key events, notable traffic changes and unusual activity from the property overview.
- Ask connected assistants to analyze your reports, compare periods, manage saved funnels and widgets, and check connection health using 42 available tools.
- Check remaining usage allowances by site and refresh the latest balances from Google Analytics.
- Get a dismissible notice when a newer MetriBee release is available, and run MetriBee using ready-made Docker images for Intel/AMD and ARM computers.

### Improvements

- Funnels load with fewer repeated requests. Previously loaded figures remain visible during updates, and the current overview appears without waiting for the comparison period.
- A failed funnel no longer hides other successful results. Retry unavailable figures while keeping the results that have already loaded.
- Opening Home and property reports no longer waits for property names to refresh. Reports remain visible during background updates and temporary connection failures.
- Property and account names update every five minutes, with a manual sync action on Home.
- Report update times reflect when the figures were originally fetched and remain consistent across pages.
- Navigation preserves the selected property and reporting period. Older Sites links open the corresponding Home view.
- Improved connections on networks where Google Analytics requests previously failed, and sites without a subdomain icon can use their main website's icon.
- New properties start without unrelated funnel presets; existing saved funnels are preserved.
- The Connection page links directly to the public source repository.

### Important Changes

- MetriBee is distributed under GNU AGPL v3, matching the included Rybbit interface. The original GA4-Dashboard-MCP license and attribution are retained.

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

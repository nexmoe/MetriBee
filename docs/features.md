# MetriBee features in detail

The [README](../README.md) has the overview. This page covers how each part behaves.

## Report time windows

Home, Analytics, Pages, Events and Journeys use Rybbit's native time presets, including **Last 24 Hours** (shortcut **H**), **Last 30 Minutes**, and typed windows such as `6h`. Rolling windows query GA4 using property-local `dateHourMinute` filters at whole-minute precision. Summary users/sessions come from GA4's filtered aggregate, and comparisons use a separate equal-duration window. Hourly charts align property time to UTC. These historical reports still have GA4 processing delay; `/realtime` supplies live traffic. Retention, native GA4 funnels and Search Console require calendar days; they never silently widen a rolling window. Saved daily AdSense earnings remain unknown for partial-day ranges. MCP's corresponding report tools accept `pastMinutes: 1440` for the same 24-hour window.

## Realtime overview

`/realtime` shows one unified property list for the latest 30-minute GA4 window, independently of historical report dates. Account grouping is available on Home. The feed refreshes every two minutes while auto refresh is enabled. Spike alerts retain the original z-score and lift rules, sensitivity presets, custom thresholds, baseline markers and collapsible banners. Rules rescore the loaded feed locally; source/page context is requested only for the two displayed alerts. Source context is today's historical traffic, not a realtime attribution claim.

Properties can be searched, sorted by unusualness, active users or name. Inactive properties and failed requests remain visible as compact links. The settings menu contains privacy, auto refresh, property-list refresh and API quota. Preferences stay in browser storage. Charts reuse Rybbit's `SiteSessionChart` with an active-users label and a fixed minute bucket; unavailable minute reports are shown as unavailable instead of zero traffic.

Privacy mode applies across the dashboard. Use the eye button at the bottom of the left rail or press **P** outside text fields and dialogs. Realtime and Globe controls share the same preference, including across tabs and reloads. Property/account names and IDs, domains, favicons, page addresses and connection email are visually blurred; statistics remain readable. The preference reuses `pb_privacy` from Realtime. It affects presentation only, so API data and exports retain their original values.

## Widgets

Open **Widgets** from a Home site card, the property's sidebar or the command palette. Widgets has its own page at `/widgets?prop=PROPERTY_ID`, with a property selector, searchable definitions, creation/editing, duplication, enable/disable controls and copyable iframe code. It replaces the former widget settings tabs with one custom component manager. The **Public embeds** switch controls publishing for the selected property; drafts can be configured and previewed before publishing.

**Create widget** opens the same configuration-and-preview editor used by Funnels. Create a component with one to six of 13 GA4 metrics, including active users, pageviews, bounce rate, engagement, events and revenue. Configure labels, number formats, decimal places, date ranges, comparisons, exact page/country/device filters, chart intervals, colors, themes, transparency, columns and width. Cards with trend charts, metrics-only components and inline badges are layouts of the same custom widget. The default is this month's active users, pageviews and bounce rate.

Natural months follow the property's timezone. This month compares the same elapsed dates in the previous month; last month compares the two complete calendar months. Rolling 7/30/90-day ranges, year-to-date, the last 12 months and custom ranges up to 366 days are available. GA4 supplies distinct users and rates for the whole period, and monthly trends query monthly buckets directly. Historical reports are cached for five minutes across previews and iframes.

Widgets can be edited, duplicated, disabled or deleted. Editing keeps the same `/widget/PROPERTY_ID/WIDGET_ID` URL and updates existing embeds on their next refresh. Inline badges fit their contents, treating the configured width as a maximum, and wrap on narrow screens. The copyable HTML automatically adjusts iframe width and height and validates the sending iframe and origin. Definitions are stored with the site's other embed settings; disabling either the site-wide widget switch or an individual component blocks subsequent widget requests.

Embed settings and private keys live in `.data/embeds/PROPERTY_ID.json` (override with `GA4_EMBEDS_DIR`). Back up this directory alongside saved funnels; retain the `/app/.data` Docker volume. These are local dashboard settings and do not change GA4 or require new Google scopes.

Existing visitor-badge and private-dashboard iframe URLs remain supported. Legacy visitor badges retain their realtime/historical windows and minute refresh interval. Private dashboards remain read-only, property-scoped and revocable; the former visitor-badge and dashboard-embed configurator tabs are no longer shown in the UI.

## Saved funnels

`/funnels?prop=PROPERTY_ID` saves named event/page sequences in the dashboard and queries ordered active users directly from GA4 `runFunnelReport`. The page supports creating, editing, cloning and deleting definitions; event steps support exact string/number parameter conditions. Definitions are scoped to each connected property, independent of the selected report dates and filters.

Rules live in `.data/funnels/PROPERTY_ID.json` (override the directory with `GA4_FUNNELS_DIR`). Back up this directory as application data; clearing report caches must not remove it. In Docker, retain the `/app/.data` volume. Saving definitions makes no changes to GA4 and needs no additional Google OAuth scopes. Funnel statistics are not written to these files or the report cache.

New properties start without preset funnels. Saved definitions are preserved across restarts and report cache cleanup.

## MCP server

MCP includes the original low-level tools and focused tools for native dashboard reports, pages, events, journeys, retention, site health, saved funnels and metric widgets. It shares page calculations, caches, authentication and quota protection. Start with `get_capabilities` and `list_properties`; results include structured content, freshness, quota and truncation details. Tools can save local definitions when requested; previews do not enable sharing or generate keys. Tool details and HTTP client configuration: [mcp-server/README.md](../mcp-server/README.md). Connection steps: [SETUP.md](../SETUP.md#use-with-ai-mcp).

## Google Search Console in Analytics

Main includes the four GSC metrics in its top metric card: clicking clicks, impressions, CTR or average position switches the existing chart to search data, with the selected comparison period. Selection persists in the URL. Search trends support daily, weekly, monthly and yearly buckets; CTR and rank are recalculated from each bucket's underlying measurements. Pages retains its four GSC summary cells alongside the integrated table.

The standalone Pages page also adds search clicks and impressions with their shares of the whole-period GSC totals, plus CTR and average position, in the native traffic table. Search sorting happens before pagination; directory expansion uses the same metrics. Directory counts are marked with ≥ when the top 500 search-page limit makes them partial. Missing matches stay unknown, and GSC failures leave the GA4 table usable. The MCP `get_pages_report` tool exposes the same columns with `includeSearch: true`.

Analytics automatically matches each GA4 website to an accessible Search Console property using a separate read-only service account (`GSC_CLIENT_EMAIL`, `GSC_PRIVATE_KEY`; see [SETUP.md](../SETUP.md)). Search clicks, impressions, CTR and average position are integrated into the existing Pages, Countries and Devices tables: select a search metric in the column-header menu, or expand the existing table to view GA4 and GSC columns side by side, search, sort and export CSV. Keywords live in the existing Sources card. Page URLs join by path (URL variants combine with impression-weighted position and recalculated CTR); countries join by ISO code and devices by category. Unmatched measurements remain unavailable rather than becoming zero. Reports use the selected calendar dates and supported page/hostname/device/country filters. Summary and daily trend reports remain available over MCP.

GSC uses Pacific calendar days and final data, so recent days can be delayed. Reports are scoped to the website hostname and use page aggregation: each result page counts an impression. Search clicks differ from GA4 sessions. Private queries and API limits mean dimension rows are not property totals; tables contain at most the top 500 results by clicks. Reports cache for one hour, property access for 15 minutes, with two requests at a time and a one-minute cooldown after HTTP 429. Unsupported GA4 audience filters show an explicit explanation. GSC is available only in the private workspace, and Demo never requests live GSC data. The MCP tool `get_search_console_report` reuses the same reports and cache without spending GA4 tokens.

## Homepage reports and optional snapshots

The homepage Cards, Status, Table and Heatmap views share the selected dates and comparison period. They reuse the same cached GA4 report queries, with bounded concurrency and per-property failure states. Status thresholds scale with the selected duration, and the heatmap fills missing time buckets. CSV exports include the selected dates and trend values.

The optional daily snapshot at `data/snapshots/latest.json` is written by `pnpm snapshot:sessions` (14 days of daily sessions per property; run it daily with cron or a systemd timer). It remains available through `/api/sites-snapshot` and provides property matching for optional AdSense data.

Optional AdSense earnings: put a file at `data/snapshots/adsense-latest.json` and the page adds earnings columns and an earnings drop flag. Any tool can write it:

```json
{ "generatedAt": "2026-10-19T06:00:00Z", "currency": "USD",
  "domains": { "www.example.com": { "daily": { "20261018": { "earnings": 12.34, "pageViews": 5678 } } } } }
```

A property matches a domain by its web stream URL host (exact first, then ignoring a leading `www.`). Without the file, nothing about earnings shows. Earnings and RPM are summed only over the selected dates; periods not fully covered by the saved file show an unavailable value.

## Analytics UI internals

The default `/` directly uses Rybbit’s original Home and SiteCards, with Status, Table and Heatmap report tabs sharing its dates and comparison. The site overview (`/analytics`) composes Rybbit’s native MainSection, section cards, tabs and expanded dialogs. GA4 growth and hourly reports join the existing main chart, with new-user, active-user, revenue and key-event metrics and period comparisons. Repeated source, page, geography and technology reports join their existing panels; revenue, traffic quality, visitor segments and referral diagnostics share the overview’s dates and filters. `/analytics/reports` redirects old bookmarks to this overview. Pages (`/analytics/pages`), Events, Journeys and Retention reuse the original pages. Other GA4 screens compose the same copied components: `/realtime` preserves the account-level realtime overview and spike rules, the homepage report tabs query the selected GA4 dates and optionally attach AdSense earnings, `/globe` preserves realtime city data and 3D/2D maps, and `/quota` shows per-property quota pools and cooldowns. The backend remains Express; there is no separate UI server in production.

- Install: `pnpm install`
- Build everything: `pnpm build`
- Frontend only: `pnpm build:ui`
- Watch frontend changes: `pnpm dev:ui` alongside the existing `pnpm dev`
- Type check: `pnpm typecheck:ui`

Build the UI before starting a fresh checkout. Docker builds it automatically. The imported Rybbit UI retains its AGPL-3.0 license, source attribution and original third-party notices in `frontend/third-party/`. The Connection page links the corresponding application source archive. `frontend/rybbit/upstream.json` records the original source hashes; `node scripts/rybbit-source.js` verifies copied files and recorded GA4 adaptations. The old `frontend/src/` prototype is retained locally but is not used or bundled. GA4 auth, MCP, quota tracking and report caching continue to use the existing server implementation.

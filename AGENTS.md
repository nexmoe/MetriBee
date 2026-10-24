# GA4 Dashboard

## Design
@DESIGN.md

Every UI change (views/, public/css, new components) MUST follow DESIGN.md: colors, type, radii, spacing tokens. No ad hoc palette or font choices.

## Stack

Express serves GA4 APIs and the analytics workspace. Following the owner's October 22, 2026 instruction, all user-facing pages use the native Rybbit React UI in `frontend/`, built by Vite into `public/ui/`. Reuse imported `frontend/rybbit/src/components/ui`, site, journeys and retention components; do not recreate controls in Handlebars or mix in the legacy panel palette. GA4 controllers and quota/auth logic remain on the server. Home (including Sites report views), Globe, quota, connection and GA4-specific reports compose those same components in `frontend/adapter/`. Preserve every GA4 data capability when adapting presentation. Do not add user-account or Documentation menus.

Home combines the original Rybbit site cards with Status, Table and Heatmap tabs. All four views share search, tag/team filters, date selection and comparison periods. Keep the view tabs, update time and date controls in one desktop toolbar row. Status, Table and Heatmap query the shared GA4 report cache for the selected dates; saved AdSense values appear only when they fully cover the selected period. Home offers optional account grouping across all four views; Realtime stays ungrouped. Property names/account metadata refresh every five minutes independently of report caches, with a manual Sync properties action on Home. Legacy `/sites` links redirect to the matching Home tab.

The site overview merges GA4 reports into its existing topical cards. Homepage previews share the original `StandardSection/Row.tsx` row component, native bar styling, 24px rows, 8px row gaps, loading and empty states. Extra metrics use the native column-header menu; full tables live in expanded dialogs. Monetary summaries use the same flat rows. Reusing only Card wrappers is insufficient.

GSC metrics enrich the existing Pages, Countries and Devices rows through the section renderer, with keywords in the Sources card. Keep GA4 and search columns together in expanded tables. Main integrates the four GSC metrics (clicks, impressions, CTR and average position) into its top metric card; clicking them switches the existing chart to GSC with selected-period comparison. Reuse the native metric tiles and chart; do not duplicate a summary below the chart. Pages retains its four GSC summary cells. Search trends use daily-or-coarser Pacific calendar data, recalculated CTR and impression-weighted rank. Missing source matches remain unknown, and page URL variants use weighted search position and recalculated CTR.

The standalone Pages table includes GSC metrics on native page and directory rows. Click/impression shares use whole-period search totals, independent of pagination and text search. Sort before pagination; mark partial directory counts when GSC top rows are truncated. GSC errors must not block GA4 reports or private sharing guards.

Widgets are managed on their own property-scoped `/widgets?prop=ID` page, reachable from Home cards, the property sidebar and command palette. Keep one custom component manager: inline badges, metrics-only components and trend cards are layouts within it. Do not restore the former Widget Embeds / Custom widgets / Dashboard Embed settings tabs. Existing iframe endpoints stay compatible.

Run `pnpm build:ui` after changing frontend source, `pnpm dev:ui` to watch, and `pnpm typecheck:ui` to check it. `pnpm build` builds both server TypeScript and UI. Imported code and modifications retain their Rybbit AGPL license and attribution in `frontend/third-party/`.

## Credentials
Env only, never a key file. Both the app and `mcp-server/` read `GA4_CLIENT_EMAIL` and `GA4_PRIVATE_KEY` (quoted, `\n` escaped) from the root `.env` through `lib/credentials.js`. Optional: `PSI_API_KEY`, `PORT`.
- Until both are set (or `DEMO=1`), pages redirect to `/setup` and `/api/*` returns 503 `not_configured` (gate in `app.js`). The server re-reads `.env` on each check, so no restart is needed.
- Check: `pnpm setup:check` (exit 0 connected, 1 env missing, 2 key rejected, 3 no properties, 4 GA4 request failed), `GET /api/setup/status`, `GET /healthz`.
- Setup prompt, manual steps and MCP prompt live in `SETUP.md` between markers; `/setup` reads them from there. Edit text there, not in the view.
- One `pnpm install` at the root covers the MCP server (`pnpm mcp`).
- MCP uses the stable v2 SDK and Streamable HTTP only. The dashboard mounts `/mcp` before its setup/boot gates; `pnpm mcp` serves the same tools separately on `MCP_HOST`/`MCP_PORT` (default `127.0.0.1:5484`). Client configs use an HTTP URL, never a node/stdio command. Keep the per-request server factory and shared cache/quota modules.
- High-level MCP tools in `mcp-server/lib/dashboard.js` reuse native dashboard controllers, caches, funnel/widget stores and GA4 clients. New analytics features should be reflected in the MCP capability catalog and tools. Guard every uncached GA4 call, keep each analysis on one property, and never bypass quota protection through native helpers. Results include structured content and explicit truncation; local definition writes need read/write annotations. Demo MCP data must not read/write live quota or mix with live tool caches. Sharing keys and enablement are not MCP operations.

Optional supplemental user OAuth lives in lib/supplementalAuth.js and is shared by the dashboard,
MCP server and snapshot script. Credentials stay in .env. Only explicit numeric account/property
allowlists use OAuth; its only scope is analytics.readonly. See SETUP.md.

## Tests
`pnpm test` runs mocha on `test/**/*.test.js`. Run once before commit, not after every edit.

## Maps
Every map (globe, flat, future) uses India's officially approved boundary (PoK, Gilgit-Baltistan, Aksai Chin, Arunachal Pradesh as India). Source: Natural Earth 10m India POV. Never ship default Natural Earth, world-atlas, or globe.gl country data.

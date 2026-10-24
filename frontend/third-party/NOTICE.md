# Rybbit source attribution

The entire Rybbit client source tree, shared source and message catalogs were copied from the local Rybbit repository at commit `9cee0e9007ecb574533a4a2f28623b78f84b18a1` (https://github.com/rybbit-io/rybbit), into `frontend/rybbit/`. Original asset folders were copied into `public/`.

The GNU Affero General Public License v3.0 is preserved in `RYBBIT-LICENSE.md`. MIT notices for interior.dev adaptations remain beside their source. `upstream.json` records the SHA256 of every original source file. `adaptations.json` records the locally modified files; `node scripts/rybbit-source.js` checks both lists.

Rybbit's native `server/src/services/favicon/favicon.ts` and `server/src/lib/publicHttpFetch.ts` are also copied into `controllers/rybbitFavicon.ts` and `controllers/publicHttpFetch.ts`, with an Express endpoint bridge in `controllers/favicons.js`. Their upstream and adapted SHA256 hashes are recorded in `server-upstream.json`; the service uses the host application's debug logger. `controllers/faviconDns.ts` resolves synthetic proxy DNS answers over HTTPS before the original public-address validation and connection pinning.

The favicon service additionally tries Google's cached favicon after native discovery, with a separate five-second deadline so a slow homepage cannot exhaust the fallback. When a subdomain has no icon, it falls back to its registrable main domain using `tldts` public and private suffix boundaries, sharing the main domain's cached result and expiry. The HTTP transport permits up to 64 KiB of response headers for Google sites' large CSP policies. Native byte limits, image signature checks, public-address restrictions, DNS pinning, cache lifetimes and concurrency queue remain in use.

Native analytics pages, Sankey, retention grid, tables, buttons, icons (Lucide), tooltips, sheets, date controls, chart theme, CSS tokens, sidebar primitives and logo are reused directly. Native Next.js imports are bridged by `frontend/adapter/` to the Express/Vite runtime. Adaptations remove unsupported collector/auth/billing features, account and Documentation menus, connect GA4 aggregates, and make their labels accurate. The rail and navigation retain Rybbit's styling with GA4 destinations. Home, Sites, Globe, API quota, connection and the complete GA4 report catalog are composed from the same imported components. The globe renderer preserves the original GA4 MapLibre/D3 engines and approved India-POV boundaries.

The native Button's `accent` and `success` variants share MetriBee's bee-yellow primary-button tokens with dark text in both themes. Other semantic colors and native button behavior are preserved under the same AGPL-3.0-only license.

The running application offers the corresponding application source at `/ui-source.tar.gz`, linked from the Connection page. It excludes credentials, caches, snapshots and installed dependencies.

Rybbit's visitor iframe renderer (`client/src/app/widget/[siteId]/route.ts`) is adapted to Express in `controllers/rybbitWidget.ts`, preserving its card/inline markup, styles, branding and refresh behavior for existing iframe URLs. Its source hashes are recorded in `server-upstream.json`. Imported `EmbedTab` and `DashboardEmbedTab` sources are retained, while the application exposes one standalone Widgets page using the custom builder and native code-copy controls. Settings are stored locally; Google Analytics remains read-only.

`ConfigurationEditorLayout` is extracted from Rybbit's `FunnelForm` and shared by the existing funnel editor and the custom metric widget editor. Generic widgets reuse Rybbit's `StatBand`, `Delta`, `SiteSessionChart`, controls, theme and code-copy UI. Optional transparent cells and chart colors/value formatters preserve those components' existing defaults. Widget definitions follow the funnel store's property-scoped, serialized, atomic save/edit/delete pattern and live alongside the other embed settings.

The analytics query adapters opt historical reports into TanStack Query session persistence. Native page, journey, retention, event and section components retain their last successful results during background refresh failures; section loading indicators allow interaction with cached rows. These adaptations retain Rybbit's AGPL-3.0-only license.

Analytics query hooks also recheck server-side background report refreshes with a bounded polling interval, replacing stale results when the shared refresh completes. Report freshness preserves original fetch times throughout revalidation.

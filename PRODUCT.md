# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Open-source self-hosters: people who clone the repo, drop in a Google service-account key, and run the dashboard against their own GA4 properties (localhost or a small server). First run must work with no hand-holding, and the screens must explain themselves.

The maintainer's own multi-site portfolio (dozens of sites, several GA4 properties that link to each other) is the working reference case. Interlinked traffic between one owner's own sites is a first-class question, not an edge case.

Other audiences (teams, agencies) are not confirmed.

## Product Purpose

A lightweight GA4 command center: see what is happening across all your properties right now, spot spikes and anomalies, understand who the visitors are, and drill into one property without opening the GA4 console. It also ships a standalone MCP server so AI assistants can query the same properties.

Success: a self-hoster goes from clone to a useful screen in minutes, and a returning owner answers "anything unusual across my sites?" in seconds while spending as little GA4 API quota as possible.

## Positioning

Realtime globe, spike detection with referral classification, and an MCP server in one small self-hosted app. Nothing about it depends on a hosted SaaS: data stays on the owner's machine, and the direction of travel is a local historical store so analysis stops depending on live API calls.

## Operating Context

- Data source is the GA4 Data API and Admin API through a service-account JSON key. Quota is scarce, so short caches are deliberate and the dashboard is near-real-time, not tick-by-tick live.
- Runs on localhost by default, with an optional auth gate and configurable HOST for remote deploys. Both modes are supported.
- The MCP server (`mcp-server/`) is independent of the dashboard and has its own cache.

## Capabilities and Constraints

Existing screens: home (property cards, live active users, quota, card detail modal), analytics (overview KPIs, reports, spikes, recipes per property and range: today, 7d, 28d), globe (3D live traffic by country and city), setup (first-run credentials guide).

Existing features to preserve: property comparison, traffic recipes, spike detection with source categories, new vs returning visitor personas, device and geography breakdowns, privacy shield (URL params and query strings redacted), disk and in-memory report cache, first-run setup page.

Constraints:
- No React (none exists today). Keep third-party dependencies to what earns its place. Server stays Express on Node.
- UI must be fast on first paint and lazy-load secondary data, to cut API fan-out.
- The UI talks to stable JSON contracts so the data source can move from live GA4 calls to a local historical store without redesigning screens.
- Terminology: property, realtime (last 30 min), range (today, 7d, 28d), spike, recipe, persona, quota.
- Maps: every map (globe, flat Mercator, any future one) uses India's officially approved boundary. Jammu and Kashmir, Ladakh, PoK, Gilgit-Baltistan, Aksai Chin and Arunachal Pradesh are drawn as India, and the Kalapani-Lipulekh-Limpiyadhura area with them. Source: Natural Earth 10m India point of view (`ne_10m_admin_0_countries_ind`, public domain). Never ship the default Natural Earth, world-atlas or globe.gl country data.

Roadmap the UI must make room for now (all confirmed):
- Local historical trends (daily snapshots stored locally, history first, API only for the gap).
- Cross-linked data (click any country, source, page or campaign to pivot the whole view, across properties).
- Understanding interlinked data between the owner's own sites.
- MCP / AI activity surfaced in the UI.
- Alerts and digests for spikes, quota and anomalies.

## Brand Commitments

Author: Amit Yadav (TheTechBasket), MIT licensed. Logo at `public/logo.png`. The owner ruled out themed or quirky visual worlds for the rewrite (2026-09-21): the dashboard must look like a familiar, polished, mainstream product that most users like at first glance and that feels smooth (60fps motion, no layout shift, fast). References to sit beside: Linear, Vercel dashboard, Plausible/PostHog, Stripe dashboard. Shipped system: self-hosted Inter Variable, sharp 2-3px radii, borderless cards, dithered chart fills. DESIGN.md is rewritten at finish (in progress) to record this system in full.

## Evidence on Hand

- Screenshots: `ss/*.webp`, used in the README.
- Real cached API payloads: `.cache/` (properties, countries, globe, per-property report cards for 7d and 28d) usable as design fixtures.
- Tests under `test/` for recipes, privacy, visitor insights, spike detection.
- No testimonials, user counts, or adoption numbers exist. Do not invent any.

## Product Principles

- A self-hoster reaches a useful screen with zero explanation; empty, error and stale states are designed, not afterthoughts.
- Spend the API quota once, show it everywhere: screens read cached or stored data first and say how fresh it is.
- Every number is a doorway: any dimension value can pivot the view, within and across properties.
- Privacy by default: nothing sensitive is shown or exposed that the owner did not choose to.
- Small and legible beats clever: few dependencies, plain files, no build step the reader cannot follow.

## Accessibility & Inclusion

No product-specific standard was established. Treat WCAG AA contrast, full keyboard operation, and `prefers-reduced-motion` support as baseline for a public open-source tool.

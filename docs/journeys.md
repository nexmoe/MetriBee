# Journeys

The main `/journeys?prop=<property-id>` page opens the available report automatically. Ordinary GA4 connections open the page-transitions Sankey and table directly. Connections with ordered session events, including Demo, use Rybbit's native Journey page, controls, Sankey, pinned-path panel, paths table, session sheet and save-as-funnel dialog. The reference is `/Users/nexmoe/Documents/GitHub/rybbit` at `9cee0e9007ecb574533a4a2f28623b78f84b18a1`, also recorded in `frontend/rybbit/upstream.json`. The public [Journeys demo](https://demo.rybbit.com/81/journeys?timeMode=day&wellKnown=today&bucket=hour&stat=users) supplies the interaction reference, not data for connected GA4 properties.

The page defaults to four steps, supports two through ten, and initially shows the top 15 paths. Native interactions include start/end and per-step page patterns, section grouping, period comparison, goal reach, hover highlighting, pin/unpin, page links, table search and expansion, path sessions with pagination and replay filtering, and the prefilled funnel editor. Path controls retain the reference page's in-memory state behavior. The separate GA4 page-transitions report is selected with `journeyView=transitions`; switching reports preserves the property, dates and audience filters.

## Ordered-session semantics

`controllers/sessionJourneys.js` adapts Rybbit's `journeyPaths.ts`, `getJourneys.ts`, `getJourneySummary.ts` and `getJourneySessions.ts` semantics:

- Sort pageview events by timestamp within each session and compact consecutive repeated pages.
- Select sessions with at least two compacted pages before grouping or filtering paths.
- Use the first N pages, with N between two and ten. Section grouping maps `/docs/api/events` to `/docs/**` and compacts adjacent repeated sections.
- `*` matches one nonempty path segment; `**` matches any number. Other characters are literal, and matching covers the whole path.
- An end-page pattern truncates at its first matching visit after the entry page, within the selected depth. This truncation hides the chart's session-exit styling, as in the reference.
- Step filters apply to the shaped path. Filters beyond the current depth are inactive. Shares use all multi-page sessions before step filters and top-N limiting.
- Summary path length and top exit use each session's full compacted page sequence, independently of the chart depth and step filters. A goal counts membership across the whole session.
- A path's session drawer matches exactly the same shaped sequence as its report row. Details retain repeated pageviews and show the original event timeline.

Native hooks explicitly send `mode=sessions` to `/api/rybbit/sites/:id/journeys`, `journeys/summary` and `journeys/sessions`. `journeys/context` supplies the total sessions and top entry from that same source, so session figures are never mixed with GA4 aggregate totals. Property and private-link authorization runs before source access. `journeys/capabilities` reports availability without a GA4 report call.

## Source availability

By default, production connections have GA4 Data API aggregates. Optional GA4 BigQuery export enables ordered-session reports for explicitly mapped properties; see [configuration steps](../SETUP.md#optional-multi-step-journeys-with-bigquery). Without that mapping, native session API requests return HTTP 422 with `code=journey_source_required`, while the page opens the working GA4 page-transitions report directly, without unavailable multi-step controls or a return button to the missing report. A failed capability lookup also falls back to page transitions. Explicit `journeyView=transitions` links remain supported; a return to session journeys is offered only when that source is available. The report never joins aggregate A→B and B→C counts into an invented session A→B→C.

`controllers/bigqueryJourneys.js` aggregates real GA4 exported events in BigQuery. Session identity combines `stream_id`, `user_pseudo_id` and the `ga_session_id` event parameter; events missing any of these identifiers are excluded. Page paths come from `page_location`, without query strings or fragments. Events sort by microsecond timestamp, available GA4 batch ordering fields and a deterministic event/page tie break. Older exports without batch fields cannot resolve all tied-event ordering. Results use pseudonymous hashed user/session identifiers, not raw GA4 user identifiers.

The selected window bounds both export tables and event timestamps. Paths therefore describe **events inside the selected window**, including partial sessions crossing its boundaries; they are not claims about the session's entire lifetime or GA4-attributed session counts. Daily tables supersede same-day intraday tables to avoid duplicate counting. Missing export days and intraday coverage are returned explicitly; dates before the first available export are rejected. GA4 late arrivals and export delays remain visible. This source supports web `page_view` events, not app screen journeys.

The same native shaping rules run in SQL without sampling or pulling a truncated raw population into MetriBee. Default paths, summary and context share a cached query bundle. Exact-path session lists and paged timelines query the same property/window, with at most 100 rows/events per page. Session detail IDs carry that bounded window and are validated against the authorized property. No replay, IP location, raw traits or collector-specific dimensions are invented. Supported audience filters cover export geography, device/browser/OS/language, entry/exit, hostname, referrer, hashed user ID and collected UTM fields. Unsupported filters such as channel, screen dimensions and latitude/longitude fail explicitly. These export fields are not GA4 Data API attribution reports; collected UTM values can differ from GA4 session attribution.

Saved goals match exported event names/parameters and page URL patterns within that same window. GA4 automatic/enhanced events are available only when the stream exports them; custom button/copy/form parameters require matching instrumentation. Goal definition permissions still apply. Public and private share links do not grant the BigQuery event-level source; they retain aggregate transitions. Path reports require `analytics:read`, and individual session endpoints require `sessions:read` before source/cache access.

`lib/bigquery.js` owns a separate service-account client, dry-run estimates, hard `maximumBytesBilled`, bounded jobs, best-effort timeout/cancellation and transactional per-project UTC-day budgets in SQLite. It does not widen supplemental OAuth scopes. Metadata checks never run billed queries. Five-minute report caches are bounded to 100 entries / 32 MiB and do not persist event data. Wildcard table queries cannot rely on BigQuery's result cache, so the application cache and scan budgets govern repeat costs.

The existing internal `createRybbitHandler({ journeySessions })` normalized-session injection remains supported for tests or other complete ordered sources. It is independent of the production BigQuery aggregate provider and never receives GA4 referrer pairs.

With `DEMO=1`, independent deterministic synthetic session events exercise the complete Journey interaction. The page explicitly labels them as demo session events. Records belong to the selected fictional property and period, and include long paths, short paths, repeated views, section paths and a sample page goal. Session IDs encode the property and period so detail requests reproduce the same event timeline without persistence. These records never use GA4 report clients, live caches or live quota. No synthetic session has a replay, so the native replay pivot returns an honest empty list.

## Existing GA4 page transitions

`/journeys?prop=<property-id>&journeyView=transitions` retains the real aggregate report using native controls, stat band, Sankey and table primitives. Its measures are internal page views, property-wide views per session, top referring page and top destination. Referring/current page filters, section grouping, top-N, comparison, pinning, page links, table search and saving a pair as a funnel remain available. Counts and tooltips say page views, with session exits omitted.

Requests without `mode=sessions` to the Rybbit adapter preserve the existing two-page response contract. They use dimensions `hostName`, `pageReferrer`, `pagePath` and metric `screenPageViews`, filtered to `eventName=page_view`. Only same-site HTTP(S) referrers are counted; query strings and fragments are removed. These pairs cannot identify session starts, full sequences, exits or individual visitors. Requests for unsupported multi-step aggregate paths or session details fail explicitly.

The legacy `GET /api/journeys/:propertyId` endpoint also remains compatible, using the existing GA4 client, supplemental access policy, quota protection and disk cache. It retains its bounded 10,000-row report, cache sharing, comparison and data-quality metadata.

## MCP

`get_journeys_report` defaults to `mode=transitions`, preserving its page-view pair response. `mode=sessions` adds native depth, per-step patterns, end-page truncation, goals and the shared summary/context. Passing `path` instead returns that path's matching session list, with offset, replay filtering and explicit truncation. It uses the same authorized controller, BigQuery cache and scan budgets as the dashboard. Unconfigured properties retain the source-unavailable response. Capabilities and setup inspection disclose optional BigQuery configuration separately from actual per-property export availability; reports include coverage, fetch time and query usage. Demo results explicitly disclose synthetic data.

Sources for the GA4 distinction: [Data API schema](https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema), [Data API methods](https://developers.google.com/analytics/devguides/reporting/data/v1), [BigQuery export schema](https://support.google.com/analytics/answer/7029846).

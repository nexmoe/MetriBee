# Journeys

The main `/journeys?prop=<property-id>` page uses Rybbit's native Journey page, controls, Sankey, pinned-path panel, paths table, session sheet and save-as-funnel dialog. The reference is `/Users/nexmoe/Documents/GitHub/rybbit` at `9cee0e9007ecb574533a4a2f28623b78f84b18a1`, also recorded in `frontend/rybbit/upstream.json`. The public [Journeys demo](https://demo.rybbit.com/81/journeys?timeMode=day&wellKnown=today&bucket=hour&stat=users) supplies the interaction reference, not data for connected GA4 properties.

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

Production connections currently have GA4 Data API aggregates, with no ordered-session source configured. Native session requests return HTTP 422 with `code=journey_source_required`. The page shows unknown summary values and a source-required state, plus an entry to the existing GA4 page-transitions report. It never joins aggregate A→B and B→C counts into an invented session A→B→C.

`createRybbitHandler({ journeySessions })` accepts an internal provider receiving one authorized `{ property, dateRange, timeZone }`. It must return that property's complete ordered-event population for the selected window, in the normalized session format used by `controllers/sessionJourneys.js`. No BigQuery/Rybbit connection, export creation or external collector is configured by this change. A production integration still requires an actual event source; the public Rybbit demo does not provide events for these GA4 properties.

With `DEMO=1`, independent deterministic synthetic session events exercise the complete Journey interaction. The page explicitly labels them as demo session events. Records belong to the selected fictional property and period, and include long paths, short paths, repeated views, section paths and a sample page goal. Session IDs encode the property and period so detail requests reproduce the same event timeline without persistence. These records never use GA4 report clients, live caches or live quota. No synthetic session has a replay, so the native replay pivot returns an honest empty list.

## Existing GA4 page transitions

`/journeys?prop=<property-id>&journeyView=transitions` retains the real aggregate report using native controls, stat band, Sankey and table primitives. Its measures are internal page views, property-wide views per session, top referring page and top destination. Referring/current page filters, section grouping, top-N, comparison, pinning, page links, table search and saving a pair as a funnel remain available. Counts and tooltips say page views, with session exits omitted.

Requests without `mode=sessions` to the Rybbit adapter preserve the existing two-page response contract. They use dimensions `hostName`, `pageReferrer`, `pagePath` and metric `screenPageViews`, filtered to `eventName=page_view`. Only same-site HTTP(S) referrers are counted; query strings and fragments are removed. These pairs cannot identify session starts, full sequences, exits or individual visitors. Requests for unsupported multi-step aggregate paths or session details fail explicitly.

The legacy `GET /api/journeys/:propertyId` endpoint also remains compatible, using the existing GA4 client, supplemental access policy, quota protection and disk cache. It retains its bounded 10,000-row report, cache sharing, comparison and data-quality metadata.

## MCP

`get_journeys_report` defaults to `mode=transitions`, preserving its page-view pair response. `mode=sessions` adds native depth, per-step patterns, end-page truncation, goals and the shared summary/context. Passing `path` instead returns that path's matching session list, with offset, replay filtering and explicit truncation. It uses the same authorized controller and returns the same source-unavailable condition in production. Capabilities identify ordered demo sessions separately from GA4 aggregates; demo results explicitly disclose synthetic data.

Sources for the GA4 distinction: [Data API schema](https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema), [Data API methods](https://developers.google.com/analytics/devguides/reporting/data/v1), [BigQuery export schema](https://support.google.com/analytics/answer/7029846).

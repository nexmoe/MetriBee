# Journeys data

`/journeys?prop=<property-id>&range=30d` follows the Rybbit Journeys layout with a property sidebar, four metrics, a Sankey, source/destination filters, folder grouping, comparison and a paths table. CSV exports all matching pairs, independently of the chart's top-N limit. Filters are preserved in the URL.

## What works with the existing credentials

`GET /api/journeys/:propertyId?range=today|7d|28d|30d&compare=previous|none` uses the existing read-only GA4 client, supplemental property access policy, quota ledger and disk cache. It requests:

- Dimensions: `hostName`, `pageReferrer`, `pagePath`.
- Metric: `screenPageViews`, filtered to `eventName = page_view`.
- Property-wide summary: `sessions`, `screenPageViews` (views per session).

Only HTTP(S) referrers matching the page's hostname are counted, allowing the www variant. Subdomains and other domains are excluded. Queries and fragments are removed. Repeated visits to the same page are retained. Different hostnames are kept separate even if paths match.

Two sequential reports are needed per period, four with comparison. Results are cached for one hour; concurrent requests share the same fetch. Refresh bypass is limited to once per minute per property/range/comparison. Changing page filters, grouping, search or top-N makes no GA4 requests. The bounded query retrieves up to 10,000 rows, ordered by views; truncation, sampling, thresholds and high-cardinality loss are disclosed. Shares refer to all retrieved internal views, not just visible paths. A failed comparison or summary does not discard valid current transitions.

## Why the chart has two steps

The Data API reports aggregates. The documented `pageReferrer` is the referring URL on an event; it is not an ordered session event stream. Joining A→B and B→C aggregates would not prove that any person took A→B→C. Referrers may also be affected by tracking implementation or SPA navigation.

Therefore this page does not calculate multi-page sessions, session starts, exits, multi-step path lengths or deduplicated people from these pairs. The four metrics are internal page views, property-wide views per session, top referring page and top destination page.

Complete session sequences require raw GA4 events (normally a BigQuery export), ordered by timestamp and event/batch ordering and grouped by user and session. This implementation does not create exports or query BigQuery.

Sources: [Data API schema](https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema), [Data API methods](https://developers.google.com/analytics/devguides/reporting/data/v1), [BigQuery export schema](https://support.google.com/analytics/answer/7029846).

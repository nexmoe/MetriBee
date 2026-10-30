import type { DashboardCardMapping, DashboardVizType } from "@rybbit/shared";
export type DashboardExample = { id: string; title: string; description: string; category: string; beyondPrebuilt?: boolean; sql: string; vizType: DashboardVizType; mapping: DashboardCardMapping };
// GA4 report definitions in the native Rybbit preset picker.
export const DASHBOARD_EXAMPLES: DashboardExample[] = [
  {
    "id": "pageviews",
    "title": "Total pageviews",
    "description": "Whole-period GA4 total.",
    "category": "Overview",
    "vizType": "stat",
    "mapping": {
      "valueColumn": "pageviews",
      "valueFormat": "number"
    },
    "sql": "{\n  \"dimensions\": [],\n  \"metrics\": [\n    \"pageviews\"\n  ],\n  \"limit\": 100\n}"
  },
  {
    "id": "sessions",
    "title": "Total sessions",
    "description": "Whole-period GA4 total.",
    "category": "Overview",
    "vizType": "stat",
    "mapping": {
      "valueColumn": "sessions",
      "valueFormat": "number"
    },
    "sql": "{\n  \"dimensions\": [],\n  \"metrics\": [\n    \"sessions\"\n  ],\n  \"limit\": 100\n}"
  },
  {
    "id": "users",
    "title": "Unique users",
    "description": "Whole-period GA4 total.",
    "category": "Overview",
    "vizType": "stat",
    "mapping": {
      "valueColumn": "users",
      "valueFormat": "number"
    },
    "sql": "{\n  \"dimensions\": [],\n  \"metrics\": [\n    \"users\"\n  ],\n  \"limit\": 100\n}"
  },
  {
    "id": "bounce",
    "title": "Bounce rate",
    "description": "Whole-period GA4 total.",
    "category": "Overview",
    "vizType": "stat",
    "mapping": {
      "valueColumn": "bounce_rate",
      "valueFormat": "percent"
    },
    "sql": "{\n  \"dimensions\": [],\n  \"metrics\": [\n    \"bounce_rate\"\n  ],\n  \"limit\": 100\n}"
  },
  {
    "id": "duration",
    "title": "Avg. session duration",
    "description": "Whole-period GA4 total.",
    "category": "Overview",
    "vizType": "stat",
    "mapping": {
      "valueColumn": "session_duration",
      "valueFormat": "duration"
    },
    "sql": "{\n  \"dimensions\": [],\n  \"metrics\": [\n    \"session_duration\"\n  ],\n  \"limit\": 100\n}"
  },
  {
    "id": "revenue",
    "title": "Total revenue",
    "description": "Whole-period GA4 total.",
    "category": "Overview",
    "vizType": "stat",
    "mapping": {
      "valueColumn": "revenue",
      "valueFormat": "number"
    },
    "sql": "{\n  \"dimensions\": [],\n  \"metrics\": [\n    \"revenue\"\n  ],\n  \"limit\": 100\n}"
  },
  {
    "id": "key-events",
    "title": "Key events",
    "description": "Whole-period GA4 total.",
    "category": "Overview",
    "vizType": "stat",
    "mapping": {
      "valueColumn": "key_events",
      "valueFormat": "number"
    },
    "sql": "{\n  \"dimensions\": [],\n  \"metrics\": [\n    \"key_events\"\n  ],\n  \"limit\": 100\n}"
  },
  {
    "id": "traffic-line",
    "title": "Traffic line",
    "description": "Sessions and pageviews over the selected period.",
    "category": "Trends",
    "vizType": "line",
    "mapping": {
      "xColumn": "time",
      "yColumns": [
        "sessions",
        "pageviews"
      ]
    },
    "sql": "{\n  \"dimensions\": [\n    \"time\"\n  ],\n  \"metrics\": [\n    \"sessions\",\n    \"pageviews\"\n  ],\n  \"limit\": 100\n}"
  },
  {
    "id": "traffic-area",
    "title": "Traffic area",
    "description": "Sessions and pageviews over the selected period.",
    "category": "Trends",
    "vizType": "area",
    "mapping": {
      "xColumn": "time",
      "yColumns": [
        "sessions",
        "pageviews"
      ]
    },
    "sql": "{\n  \"dimensions\": [\n    \"time\"\n  ],\n  \"metrics\": [\n    \"sessions\",\n    \"pageviews\"\n  ],\n  \"limit\": 100\n}"
  },
  {
    "id": "traffic-bar",
    "title": "Traffic bar",
    "description": "Sessions and pageviews over the selected period.",
    "category": "Trends",
    "vizType": "bar",
    "mapping": {
      "xColumn": "time",
      "yColumns": [
        "sessions",
        "pageviews"
      ]
    },
    "sql": "{\n  \"dimensions\": [\n    \"time\"\n  ],\n  \"metrics\": [\n    \"sessions\",\n    \"pageviews\"\n  ],\n  \"limit\": 100\n}"
  },
  {
    "id": "pages",
    "title": "Top pages",
    "description": "GA4 audience breakdown.",
    "category": "Breakdowns",
    "vizType": "table",
    "mapping": {
      "xColumn": "pathname",
      "valueColumn": "sessions"
    },
    "sql": "{\n  \"dimensions\": [\n    \"pathname\"\n  ],\n  \"metrics\": [\n    \"sessions\"\n  ],\n  \"limit\": 100\n}"
  },
  {
    "id": "sources",
    "title": "Top sources",
    "description": "GA4 audience breakdown.",
    "category": "Breakdowns",
    "vizType": "hbar",
    "mapping": {
      "xColumn": "referrer",
      "valueColumn": "sessions"
    },
    "sql": "{\n  \"dimensions\": [\n    \"referrer\"\n  ],\n  \"metrics\": [\n    \"sessions\"\n  ],\n  \"limit\": 100\n}"
  },
  {
    "id": "devices",
    "title": "Devices",
    "description": "GA4 audience breakdown.",
    "category": "Breakdowns",
    "vizType": "pie",
    "mapping": {
      "xColumn": "device_type",
      "valueColumn": "sessions"
    },
    "sql": "{\n  \"dimensions\": [\n    \"device_type\"\n  ],\n  \"metrics\": [\n    \"sessions\"\n  ],\n  \"limit\": 100\n}"
  },
  {
    "id": "countries",
    "title": "Countries",
    "description": "GA4 audience breakdown.",
    "category": "Breakdowns",
    "vizType": "map",
    "mapping": {
      "xColumn": "country",
      "valueColumn": "sessions",
      "countryColumn": "country"
    },
    "sql": "{\n  \"dimensions\": [\n    \"country\"\n  ],\n  \"metrics\": [\n    \"sessions\"\n  ],\n  \"limit\": 100\n}"
  },
  {
    "id": "events",
    "title": "Events",
    "description": "GA4 audience breakdown.",
    "category": "Breakdowns",
    "vizType": "table",
    "mapping": {
      "xColumn": "event_name",
      "valueColumn": "sessions"
    },
    "sql": "{\n  \"dimensions\": [\n    \"event_name\"\n  ],\n  \"metrics\": [\n    \"events\"\n  ],\n  \"limit\": 100\n}"
  },
  {
    "id": "calendar",
    "title": "Traffic calendar",
    "description": "Daily traffic on a calendar. Select a daily bucket.",
    "category": "Trends",
    "vizType": "calendar",
    "mapping": {
      "dateColumn": "time",
      "valueColumn": "sessions"
    },
    "sql": "{\n  \"dimensions\": [\n    \"time\"\n  ],\n  \"metrics\": [\n    \"sessions\"\n  ],\n  \"limit\": 1000\n}"
  }
];
export const DASHBOARD_EXAMPLE_CATEGORIES = ["Overview", "Trends", "Breakdowns"];

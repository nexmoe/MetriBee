const { failure } = require("../lib/access");
const { z } = require("zod");
const { utmPresenceFilter } = require("../lib/utm");
const and = (...items) => {
  const expressions = items.filter(Boolean);
  return expressions.length > 1
    ? { andGroup: { expressions } }
    : expressions[0];
};
const exact = (fieldName, value) => ({
  filter: {
    fieldName,
    stringFilter: {
      matchType: "EXACT",
      value: String(value),
      caseSensitive: true,
    },
  },
});
function patternFilter(fieldName, pattern) {
  if (typeof pattern !== "string" || !pattern || pattern.length > 512)
    throw failure("Choose a valid matching pattern.", 400);
  const parts = pattern.split(/(\*\*|\*)/);
  const value = parts
    .map((part) =>
      part === "**"
        ? ".*"
        : part === "*"
        ? "[^/]*"
        : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    )
    .join("");
  return {
    filter: {
      fieldName,
      stringFilter: {
        matchType: "FULL_REGEXP",
        value: `^${value}$`,
        caseSensitive: true,
      },
    },
  };
}
function goalFilter(goal) {
  const config = goal.config || {};
  let filter;
  if (goal.goalType === "path") {
    if (!config.pathPattern?.startsWith("/"))
      throw failure("Choose a path such as /checkout/complete.", 400);
    filter = and(
      exact("eventName", "page_view"),
      patternFilter("pagePath", config.pathPattern)
    );
  } else if (goal.goalType === "event") {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(config.eventName || ""))
      throw failure("Choose a GA4 event name.", 400);
    filter = exact("eventName", config.eventName);
  } else {
    const names = {
      outbound: "click",
      button_click: "button_click",
      form_submit: "form_submit",
      copy: "copy",
    };
    if (!names[goal.goalType]) throw failure("Unsupported goal type.", 400);
    const fields = {
      outbound: "linkUrl",
      button_click: "customEvent:text",
      form_submit: "customEvent:form_name",
      copy: "customEvent:text",
    };
    filter = and(
      exact("eventName", names[goal.goalType]),
      config.valuePattern &&
        patternFilter(fields[goal.goalType], config.valuePattern)
    );
  }
  const properties = [...(config.propertyFilters || [])];
  if (config.eventPropertyKey) {
    if (config.eventPropertyValue === undefined)
      throw failure("Choose a property value.", 400);
    properties.push({
      key: config.eventPropertyKey,
      value: config.eventPropertyValue,
    });
  }
  if (properties.length > 10)
    throw failure("Choose up to 10 property conditions.", 400);
  return and(
    filter,
    ...properties.map(({ key, value }) => {
      if (!/^[A-Za-z][A-Za-z0-9_]{0,99}$/.test(key))
        throw failure(
          "Use a GA4 parameter name for each property condition.",
          400
        );
      if (goal.goalType === "path") {
        const escape = (part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return {
          filter: {
            fieldName: "pageLocation",
            stringFilter: {
              matchType: "PARTIAL_REGEXP",
              value: `[?&]${escape(encodeURIComponent(key))}=${escape(
                encodeURIComponent(String(value))
              )}(?:&|$)`,
              caseSensitive: true,
            },
          },
        };
      }
      return exact(`customEvent:${key}`, value);
    })
  );
}
const number = (row, i = 0) => Number(row?.metricValues?.[i]?.value) || 0;
const dimension = (row, i = 0) => row?.dimensionValues?.[i]?.value || "";
const DIMENSIONS = {
  pathname: "pagePath",
  page_title: "pageTitle",
  country: "countryId",
  region: "region",
  city: "city",
  device_type: "deviceCategory",
  browser: "browser",
  operating_system: "operatingSystem",
  referrer: "sessionSource",
  channel: "sessionDefaultChannelGroup",
  event_name: "eventName",
  hostname: "hostName",
  language: "languageCode",
  utm_source: "sessionManualSource",
  utm_medium: "sessionManualMedium",
  utm_campaign: "sessionManualCampaignName",
};
const METRICS = {
  sessions: "sessions",
  pageviews: "screenPageViews",
  users: "totalUsers",
  new_users: "newUsers",
  active_users: "activeUsers",
  events: "eventCount",
  key_events: "keyEvents",
  revenue: "totalRevenue",
  bounce_rate: "bounceRate",
  session_duration: "averageSessionDuration",
  pages_per_session: "screenPageViewsPerSession",
  engagement_rate: "engagementRate",
};
const querySchema = z
  .object({
    dimensions: z
      .array(z.enum(["time", ...Object.keys(DIMENSIONS)]))
      .max(3)
      .default([]),
    metrics: z
      .array(z.enum(Object.keys(METRICS)))
      .min(1)
      .max(8),
    filters: z
      .array(
        z
          .object({
            parameter: z.string(),
            type: z.string(),
            value: z
              .array(z.union([z.string().max(500), z.number().finite()]))
              .max(50),
          })
          .strict()
      )
      .max(20)
      .default([]),
    limit: z.number().int().min(1).max(1000).default(100),
    orderBy: z.string().optional(),
    direction: z.enum(["asc", "desc"]).default("desc"),
  })
  .strict();
function parseCardQuery(raw) {
  let query;
  try {
    query = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    throw failure(
      "Choose GA4 dimensions and metrics in the query builder.",
      400
    );
  }
  const result = querySchema.safeParse(query);
  if (!result.success) throw failure(result.error.issues[0].message, 400);
  query = result.data;
  if (
    new Set(query.dimensions).size !== query.dimensions.length ||
    new Set(query.metrics).size !== query.metrics.length
  )
    throw failure("Choose distinct dimensions and metrics.", 400);
  if (
    query.orderBy &&
    ![...query.dimensions, ...query.metrics].includes(query.orderBy)
  )
    throw failure("Sort by a selected column.", 400);
  require("./rybbit").filtersFor(query.filters);
  return query;
}
async function dashboardCard({ raw, q, report, pointTime, timeDimension }) {
  const query = parseCardQuery(raw);
  const bucket = ["minute", "hour", "day", "week", "month", "year"].includes(
    q.bucket
  )
    ? q.bucket
    : "day";
  const dimensions = query.dimensions.map((key) =>
    key === "time" ? timeDimension(bucket) : DIMENSIONS[key]
  );
  const metrics = query.metrics.map((key) => METRICS[key]);
  const sort =
    query.orderBy ||
    (query.dimensions.includes("time") ? "time" : query.metrics[0]);
  const orderBys = [
    {
      ...(query.dimensions.includes(sort)
        ? {
            dimension: {
              dimensionName:
                sort === "time" ? timeDimension(bucket) : DIMENSIONS[sort],
            },
          }
        : { metric: { metricName: METRICS[sort] } }),
      desc: query.orderBy ? query.direction !== "asc" : sort !== "time",
    },
  ];
  const result = await report(
    dimensions,
    metrics,
    and(require("./rybbit").filtersFor(query.filters), ...query.dimensions.map(utmPresenceFilter)),
    { limit: query.limit, orderBys }
  );
  const data = (result.rows || []).map((row) =>
    Object.fromEntries([
      ...query.dimensions.map((key, i) => [
        key,
        key === "time"
          ? pointTime(dimension(row, i), bucket)
          : dimension(row, i),
      ]),
      ...query.metrics.map((key, i) => [
        key,
        number(row, i) *
          (["bounce_rate", "engagement_rate"].includes(key) ? 100 : 1),
      ]),
    ])
  );
  return {
    data,
    meta: {
      rowCount: data.length,
      maxRows: query.limit,
      totalRows: Number(result.rowCount) || data.length,
      truncated: Number(result.rowCount) > data.length,
      source: "ga4",
    },
  };
}
async function goalsReport({
  store,
  action,
  q,
  body,
  report,
  pointTime,
  timeDimension,
}) {
  let all = store.list("goals");
  const totalGoals = all.length;
  if (action === "goals/summary" && q.goal_ids !== undefined) {
    let ids;
    try {
      ids = JSON.parse(q.goal_ids);
    } catch {
      throw failure("Choose valid goal ids.", 400);
    }
    if (
      !Array.isArray(ids) ||
      ids.length > 50 ||
      ids.some((id) => !Number.isSafeInteger(id) || id <= 0)
    )
      throw failure("Choose up to 50 goal ids.", 400);
    all = all.filter((goal) => ids.includes(goal.goalId));
  }
  const bucket = ["minute", "hour", "day", "week", "month", "year"].includes(
    q.bucket
  )
    ? q.bucket
    : "day";
  const dateDimension = timeDimension(bucket);
  const totals = async () => number((await report([], ["sessions"])).rows?.[0]);
  const count = async (goal) =>
    number((await report([], ["sessions"], goalFilter(goal))).rows?.[0]);
  const metrics = (goal, conversions, total) => ({
    ...goal,
    total_conversions: conversions,
    total_sessions: total,
    conversion_rate: total ? conversions / total : 0,
  });
  if (action === "goals/preview") {
    const goal = require("../lib/analysisStore").parse("goals", body);
    const filter = goalFilter(goal);
    const [total, conversions, result] = await Promise.all([
      totals(),
      count(goal),
      report([dateDimension], ["sessions"], filter),
    ]);
    return {
      data: {
        conversions,
        total_sessions: total,
        conversion_rate: total ? conversions / total : 0,
        series: (result.rows || [])
          .map((row) => ({
            time: pointTime(dimension(row), bucket),
            conversions: number(row),
          }))
          .sort((a, b) => a.time.localeCompare(b.time)),
      },
    };
  }
  if (/^goals\/\d+\/sessions$/.test(action))
    throw failure(
      "GA4 Data API supplies aggregate conversions. Individual converting sessions require an ordered event source.",
      422
    );
  if (action === "goals/time-series") {
    let ids;
    try {
      ids = Array.isArray(q.goal_ids)
        ? q.goal_ids
        : JSON.parse(q.goal_ids || "[]");
    } catch {
      ids = String(q.goal_ids || "").split(",");
    }
    if (!Array.isArray(ids) || ids.length > 20)
      throw failure("Choose up to 20 goals for the chart.", 400);
    const selected = all.filter((goal) =>
      ids.map(Number).includes(goal.goalId)
    );
    if (!selected.length) return { data: [] };
    const totalRows = (await report([dateDimension], ["sessions"])).rows || [];
    const series = [];
    for (const goal of selected) {
      const result = await report(
        [dateDimension],
        ["sessions"],
        goalFilter(goal)
      );
      const byTime = new Map(
        (result.rows || []).map((row) => [dimension(row), number(row)])
      );
      for (const row of totalRows) {
        const conversions = byTime.get(dimension(row)) || 0,
          total = number(row);
        series.push({
          time: pointTime(dimension(row), bucket),
          goal_id: goal.goalId,
          conversions,
          total_sessions: total,
          conversion_rate: total ? conversions / total : 0,
        });
      }
    }
    return {
      data: series.sort(
        (a, b) => a.time.localeCompare(b.time) || a.goal_id - b.goal_id
      ),
    };
  }
  const total = all.length ? await totals() : 0;
  const rows = [];
  // Bound fan-out; every call still runs through the shared cache and quota queue.
  for (const goal of all) rows.push(metrics(goal, await count(goal), total));
  if (action === "goals/summary") {
    const converting = all.length
      ? number(
          (
            await report([], ["sessions"], {
              orGroup: { expressions: all.map(goalFilter) },
            })
          ).rows?.[0]
        )
      : 0;
    return {
      data: {
        goals: rows.sort(
          (a, b) =>
            b.total_conversions - a.total_conversions || b.goalId - a.goalId
        ),
        total_sessions: total,
        converting_sessions: converting,
        total_goals: totalGoals,
      },
      truncated: all.length < totalGoals,
    };
  }
  const sort = ["goalId", "name", "goalType", "createdAt"].includes(q.sort)
    ? q.sort
    : "createdAt";
  rows.sort(
    (a, b) =>
      (typeof a[sort] === "number"
        ? a[sort] - b[sort]
        : String(a[sort] || "").localeCompare(String(b[sort] || ""))) *
        (q.order === "asc" ? 1 : -1) || b.goalId - a.goalId
  );
  const page = Math.max(1, Math.floor(Number(q.page) || 1)),
    pageSize = Math.min(
      100,
      Math.max(1, Math.floor(Number(q.page_size) || 10))
    );
  return {
    data: rows.slice((page - 1) * pageSize, page * pageSize),
    meta: {
      total: rows.length,
      page,
      pageSize,
      totalPages: Math.ceil(rows.length / pageSize),
    },
  };
}
module.exports = {
  DIMENSIONS,
  METRICS,
  goalFilter,
  patternFilter,
  goalsReport,
  dashboardCard,
  parseCardQuery,
};

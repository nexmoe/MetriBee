const { z } = require("zod");
const { failure } = require("./access");
const { storage } = require("./requestContext");

const text = (max) => z.string().trim().min(1).max(max);
const optionalText = (max) => z.string().trim().max(max).nullable().optional();
const scope = z.enum(["site", "organization"]).optional();
const date = z
  .string()
  .max(40)
  .refine(
    (value) =>
      /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2}))?$/.test(
        value
      ) && require("luxon").DateTime.fromISO(value).isValid,
    "Choose an ISO date with a timezone."
  )
  .transform((value) => new Date(value).toISOString());
const propertyFilter = z
  .object({
    key: text(100),
    value: z.union([z.string().max(500), z.number().finite(), z.boolean()]),
  })
  .strict();
const schemas = {
  segments: z
    .object({
      name: text(80),
      description: optionalText(500),
      filters: z
        .array(
          z
            .object({
              parameter: text(100),
              type: text(40),
              value: z
                .array(z.union([z.string().max(500), z.number().finite()]))
                .max(50),
            })
            .strict()
        )
        .min(1)
        .max(20),
      isPublic: z.boolean().optional(),
      scope,
    })
    .strict(),
  annotations: z
    .object({
      title: text(120),
      description: optionalText(2000),
      date,
      endDate: date.nullable().optional(),
      color: z
        .enum(["amber", "rose", "sky", "violet", "lime"])
        .nullable()
        .optional(),
      icon: optionalText(16),
      isPublic: z.boolean().optional(),
      scope,
    })
    .strict(),
  goals: z
    .object({
      name: z.string().trim().max(120).optional(),
      goalType: z.enum([
        "path",
        "event",
        "outbound",
        "button_click",
        "form_submit",
        "copy",
      ]),
      config: z
        .object({
          pathPattern: z.string().max(512).optional(),
          eventName: z.string().max(100).optional(),
          valuePattern: z.string().max(512).optional(),
          eventPropertyKey: z.string().max(100).optional(),
          eventPropertyValue: z
            .union([z.string().max(500), z.number().finite(), z.boolean()])
            .optional(),
          propertyFilters: z.array(propertyFilter).max(10).optional(),
        })
        .strict(),
    })
    .strict(),
  dashboards: z
    .object({
      name: text(120),
      config: z
        .object({
          cards: z
            .array(
              z
                .object({
                  id: text(100),
                  title: z.string().max(200),
                  sql: z.string().max(20000),
                  vizType: z.enum([
                    "table",
                    "line",
                    "area",
                    "bar",
                    "hbar",
                    "pie",
                    "stat",
                    "map",
                    "calendar",
                  ]),
                  mapping: z
                    .object({
                      xColumn: z.string().max(100).optional(),
                      yColumns: z.array(z.string().max(100)).max(10).optional(),
                      seriesColumn: z.string().max(100).optional(),
                      valueColumn: z.string().max(100).optional(),
                      valueFormat: z
                        .enum(["number", "percent", "duration", "bytes"])
                        .optional(),
                      countryColumn: z.string().max(100).optional(),
                      dateColumn: z.string().max(100).optional(),
                    })
                    .strict(),
                  gridPos: z
                    .object({
                      x: z.number().int().min(0).max(12),
                      y: z.number().int().min(0).max(10000),
                      w: z.number().int().min(1).max(12),
                      h: z.number().int().min(1).max(100),
                    })
                    .strict(),
                })
                .strict()
            )
            .max(20),
        })
        .strict()
        .optional(),
    })
    .strict(),
};
const idKeys = {
  segments: "segmentId",
  annotations: "annotationId",
  goals: "goalId",
  dashboards: "dashboardId",
};
function parse(kind, body, partial = false) {
  // Native goal updates carry their route ids too; they are never trusted for scope.
  if (kind === "goals" && partial) {
    const { siteId, goalId, ...fields } = body || {};
    body = fields;
  }
  const result = (partial ? schemas[kind].partial() : schemas[kind]).safeParse(
    body
  );
  if (!result.success) throw failure(result.error.issues[0].message, 400);
  return result.data;
}
function createAnalysisStore({ access, identity, propertyId, shared = false }) {
  access ||= storage.getStore()?.access;
  identity ||= storage.getStore()?.identity;
  if (!access) throw failure("Application storage is unavailable.", 503);
  const db = access.db;
  propertyId = String(propertyId);
  const property = db
    .prepare("SELECT * FROM property_access WHERE propertyId=?")
    .get(propertyId);
  if (!property) throw failure("Property not found.", 404);
  const organizationId = property.organizationId;
  function requirePermission(kind, write = false) {
    if (shared) {
      if (write || !["segments", "annotations", "goals"].includes(kind))
        throw failure(
          "This endpoint requires an authenticated workspace.",
          403
        );
    } else {
      if (!identity) throw failure("Authentication required.", 401);
      access.requireSite(
        identity,
        propertyId,
        `${kind}:${write ? "write" : "read"}`
      );
    }
  }
  function visible(row) {
    return (
      row &&
      row.organizationId === organizationId &&
      (row.propertyId === propertyId ||
        (row.propertyId === null &&
          ["annotations", "segments"].includes(row.kind))) &&
      (!shared || !!JSON.parse(row.payload).isPublic || row.kind === "goals")
    );
  }
  function canEdit(row) {
    if (shared || !identity) return false;
    try {
      requirePermission(row.kind, true);
      if (row.propertyId === null)
        access.requireOrg(identity, organizationId, `${row.kind}:manage`);
      else if (
        ["annotations", "segments"].includes(row.kind) &&
        row.userId !== identity.userId
      )
        access.requireSite(identity, propertyId, `${row.kind}:manage`);
      return true;
    } catch {
      return false;
    }
  }
  function decode(row) {
    const value = {
      ...JSON.parse(row.payload),
      [idKeys[row.kind]]: row.id,
      siteId: row.propertyId === null ? null : Number(row.propertyId),
      organizationId: row.organizationId,
      userId: row.userId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
    delete value.scope;
    if (row.kind === "segments") {
      value.type = "segment";
      value.canEdit = canEdit(row);
    }
    if (row.kind === "annotations")
      value.userName =
        db.prepare("SELECT name FROM user WHERE id=?").get(row.userId)?.name ||
        null;
    if (shared && storage.getStore()?.publicSiteId) {
      value.organizationId = null;
      value.userId = null;
      if (row.kind === "annotations") value.userName = null;
    }
    return value;
  }
  function rows(kind) {
    requirePermission(kind);
    return db
      .prepare(
        "SELECT * FROM analysis_object WHERE kind=? AND organizationId=? AND (propertyId=? OR propertyId IS NULL) ORDER BY id DESC"
      )
      .all(kind, organizationId, propertyId)
      .filter(visible);
  }
  function row(kind, id) {
    requirePermission(kind);
    const record = db
      .prepare("SELECT * FROM analysis_object WHERE kind=? AND id=?")
      .get(kind, Number(id));
    if (!visible(record)) throw failure("Definition not found.", 404);
    return record;
  }
  function validate(kind, body) {
    if (kind === "segments")
      require("../controllers/rybbit").filtersFor(body.filters);
    if (kind === "annotations") {
      if (body.endDate && body.endDate <= body.date)
        throw failure("End date must be after the start date.", 400);
      if (
        body.icon &&
        [
          ...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
            body.icon
          ),
        ].length !== 1
      )
        throw failure("Choose one emoji or character.", 400);
    }
    if (kind === "goals")
      require("../controllers/analysisReports").goalFilter(body);
    if (kind === "dashboards") {
      body.config ||= { cards: [] };
      if (
        new Set(body.config.cards.map((c) => c.id)).size !==
        body.config.cards.length
      )
        throw failure("Card ids must be unique.", 400);
    }
  }
  function save(kind, body, id) {
    requirePermission(kind, true);
    return db
      .transaction(() => {
        const previous = id == null ? null : row(kind, id);
        if (previous && !canEdit(previous))
          throw failure("You cannot edit this definition.", 403);
        const input = parse(kind, body, !!previous);
        const value = {
          ...(previous ? JSON.parse(previous.payload) : { isPublic: false }),
          ...input,
        };
        if (!["annotations", "segments"].includes(kind)) delete value.isPublic;
        const nextScope =
          input.scope ||
          (previous?.propertyId === null ? "organization" : "site");
        if (nextScope === "organization")
          access.requireOrg(identity, organizationId, `${kind}:manage`);
        validate(kind, value);
        value.scope = nextScope;
        const at = new Date().toISOString();
        const targetProperty = nextScope === "organization" ? null : propertyId;
        if (previous)
          db.prepare(
            "UPDATE analysis_object SET payload=?,propertyId=?,updatedAt=? WHERE id=?"
          ).run(JSON.stringify(value), targetProperty, at, previous.id);
        else {
          if (rows(kind).length >= (kind === "goals" ? 50 : 200))
            throw failure(
              "Definition limit reached. Remove an unused definition first.",
              422
            );
          id = Number(
            db
              .prepare(
                "INSERT INTO analysis_object(kind,propertyId,organizationId,userId,payload,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?)"
              )
              .run(
                kind,
                targetProperty,
                organizationId,
                identity.userId || null,
                JSON.stringify(value),
                at,
                at
              ).lastInsertRowid
          );
        }
        return decode(row(kind, id));
      })
      .immediate();
  }
  return {
    list: (kind) => rows(kind).map(decode),
    get: (kind, id) => decode(row(kind, id)),
    save,
    remove(kind, id) {
      return db
        .transaction(() => {
          const record = row(kind, id);
          if (!canEdit(record))
            throw failure("You cannot delete this definition.", 403);
          db.prepare("DELETE FROM analysis_object WHERE id=?").run(record.id);
          return { success: true };
        })
        .immediate();
    },
  };
}
module.exports = { createAnalysisStore, parse };

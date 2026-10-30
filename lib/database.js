const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

const connections = new Map();
const databasePath = () =>
  process.env.DATABASE_PATH ||
  path.resolve(
    __dirname,
    process.env.DEMO === "1"
      ? "../.data/metribee-demo.sqlite"
      : "../.data/metribee.sqlite"
  );
function openDatabase(filename = databasePath()) {
  if (connections.has(filename)) return connections.get(filename);
  if (filename !== ":memory:")
    fs.mkdirSync(path.dirname(path.resolve(filename)), {
      recursive: true,
      mode: 0o700,
    });
  const db = new Database(filename);
  db.pragma("busy_timeout = 5000");
  // Two fresh dashboard/MCP processes can race while changing the journal mode.
  // SQLite does not always invoke its busy handler for this transition.
  const deadline = Date.now() + 5000;
  for (;;) {
    try {
      db.pragma("journal_mode = WAL");
      break;
    } catch (error) {
      if (error.code !== "SQLITE_BUSY" || Date.now() >= deadline) {
        db.close();
        throw error;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_migration (id TEXT PRIMARY KEY, appliedAt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS property_access (
      propertyId TEXT PRIMARY KEY, organizationId TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '', domain TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '[]'
    );
    CREATE INDEX IF NOT EXISTS property_org ON property_access(organizationId);
    CREATE TABLE IF NOT EXISTS member_site_access (
      memberId TEXT NOT NULL, propertyId TEXT NOT NULL, role TEXT,
      PRIMARY KEY(memberId, propertyId)
    );
    CREATE TABLE IF NOT EXISTS team_site_access (
      teamId TEXT NOT NULL, propertyId TEXT NOT NULL, role TEXT,
      PRIMARY KEY(teamId, propertyId)
    );
    CREATE TABLE IF NOT EXISTS app_document (
      kind TEXT NOT NULL, propertyId TEXT NOT NULL, payload TEXT NOT NULL,
      updatedAt TEXT NOT NULL, PRIMARY KEY(kind, propertyId)
    );
    CREATE TABLE IF NOT EXISTS app_setting (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS analysis_object (
      id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL,
      propertyId TEXT, organizationId TEXT NOT NULL, userId TEXT,
      payload TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS analysis_scope ON analysis_object(kind, organizationId, propertyId);
    CREATE TABLE IF NOT EXISTS email_report_delivery (
      deliveryKey TEXT PRIMARY KEY, status TEXT NOT NULL,
      createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS site_transfer (
      id TEXT PRIMARY KEY, propertyId TEXT NOT NULL, sourceOrganizationId TEXT NOT NULL,
      targetEmail TEXT NOT NULL, createdBy TEXT NOT NULL, createdAt TEXT NOT NULL, expiresAt TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
    );
  `);
  if (
    !db
      .pragma("table_info(site_transfer)")
      .some((column) => column.name === "createdAt")
  )
    db.exec(
      "ALTER TABLE site_transfer ADD COLUMN createdAt TEXT NOT NULL DEFAULT ''"
    );
  if (filename !== ":memory:")
    for (const file of [filename, `${filename}-wal`, `${filename}-shm`])
      if (fs.existsSync(file)) fs.chmodSync(file, 0o600);
  connections.set(filename, db);
  return db;
}

function usesApplicationDatabase(kind, directory, defaultDirectory) {
  if (!directory || path.resolve(directory) === path.resolve(defaultDirectory))
    return true;
  const configured =
    kind === "funnels"
      ? process.env.GA4_FUNNELS_DIR
      : kind === "embeds"
      ? process.env.GA4_EMBEDS_DIR
      : undefined;
  return !!configured && path.resolve(directory) === path.resolve(configured);
}

function documentStore(kind, directory, defaultDirectory) {
  // Environment overrides locate legacy JSON; application writes belong to
  // the same SQLite database as accounts and the migration.
  const custom = !usesApplicationDatabase(kind, directory, defaultDirectory);
  const connection = () =>
    custom
      ? openDatabase(path.join(directory, "store.sqlite"))
      : require("./requestContext").storage.getStore()?.access?.db ||
        openDatabase();
  return {
    read(propertyId, fallback) {
      const db = connection();
      const row = db
        .prepare(
          "SELECT payload FROM app_document WHERE kind=? AND propertyId=?"
        )
        .get(kind, String(propertyId));
      if (row) return JSON.parse(row.payload);
      if (!custom && process.env.DEMO === "1") return fallback();
      if (
        !custom &&
        db
          .prepare("SELECT 1 FROM app_migration WHERE id=?")
          .get("001-legacy-documents")
      )
        return fallback();
      const legacy = path.join(
        directory || defaultDirectory,
        `${propertyId}.json`
      );
      if (!fs.existsSync(legacy)) return fallback();
      const data = JSON.parse(fs.readFileSync(legacy, "utf8"));
      this.write(propertyId, data);
      return data;
    },
    write(propertyId, data) {
      const db = connection();
      db.prepare(
        `INSERT INTO app_document(kind,propertyId,payload,updatedAt) VALUES(?,?,?,?)
        ON CONFLICT(kind,propertyId) DO UPDATE SET payload=excluded.payload,updatedAt=excluded.updatedAt`
      ).run(
        kind,
        String(propertyId),
        JSON.stringify(data),
        new Date().toISOString()
      );
    },
    transaction(task) {
      return connection().transaction(task).immediate();
    },
  };
}

function migrateLegacyDocuments(db = openDatabase()) {
  if (process.env.DEMO === "1") return;
  if (
    db
      .prepare("SELECT 1 FROM app_migration WHERE id=?")
      .get("001-legacy-documents")
  )
    return;
  const documents = [];
  for (const [kind, directory] of [
    [
      "funnels",
      process.env.GA4_FUNNELS_DIR ||
        path.resolve(__dirname, "../.data/funnels"),
    ],
    [
      "embeds",
      process.env.GA4_EMBEDS_DIR || path.resolve(__dirname, "../.data/embeds"),
    ],
  ]) {
    if (!fs.existsSync(directory)) continue;
    for (const file of fs.readdirSync(directory)) {
      const match = /^(\d+)\.json$/.exec(file);
      if (!match) continue;
      const data = JSON.parse(
        fs.readFileSync(path.join(directory, file), "utf8")
      );
      if (
        kind === "funnels" &&
        (data?.version !== 1 ||
          !Array.isArray(data.funnels) ||
          !Number.isSafeInteger(data.nextId))
      )
        throw new Error(`Invalid legacy funnel definitions: ${file}`);
      if (
        kind === "embeds" &&
        (typeof data?.embedEnabled !== "boolean" ||
          (data.privateLinkKey !== null &&
            !/^[a-f0-9]{12}$/.test(data.privateLinkKey)))
      )
        throw new Error(`Invalid legacy embed settings: ${file}`);
      documents.push([
        kind,
        match[1],
        JSON.stringify(data),
        new Date().toISOString(),
      ]);
    }
  }
  db.transaction(() => {
    for (const document of documents)
      db.prepare("INSERT OR IGNORE INTO app_document VALUES(?,?,?,?)").run(
        ...document
      );
    db.prepare("INSERT OR IGNORE INTO app_migration VALUES(?,?)").run(
      "001-legacy-documents",
      new Date().toISOString()
    );
  }).immediate();
}
// Read-only previews and import backups must not create a database or change application data.
function readDocumentSnapshot(kind, propertyId, directory, defaultDirectory) {
  const filename = usesApplicationDatabase(kind, directory, defaultDirectory)
    ? databasePath()
    : path.join(directory, "store.sqlite");
  if (fs.existsSync(filename)) {
    const db = new Database(filename, { readonly: true, fileMustExist: true });
    try {
      const row = db
        .prepare(
          "SELECT payload FROM app_document WHERE kind=? AND propertyId=?"
        )
        .get(kind, String(propertyId));
      if (row) return row.payload;
    } finally {
      db.close();
    }
  }
  const legacy = path.join(directory, `${propertyId}.json`);
  return fs.existsSync(legacy) ? fs.readFileSync(legacy, "utf8") : null;
}
function closeDatabases() {
  for (const db of connections.values()) db.close();
  connections.clear();
}
module.exports = {
  openDatabase,
  databasePath,
  documentStore,
  readDocumentSnapshot,
  migrateLegacyDocuments,
  closeDatabases,
};

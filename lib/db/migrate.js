const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");
const { execFileSync } = require("node:child_process");
const { drizzle } = require("drizzle-orm/better-sqlite3");
const { migrate } = require("drizzle-orm/better-sqlite3/migrator");
const { readMigrationFiles } = require("drizzle-orm/migrator");
const schema = require("./schema");

const instances = new WeakMap();
const migrated = new WeakSet();
const defaultMigrationsFolder = path.resolve(__dirname, "../../drizzle");

function getOrm(db) {
  if (!instances.has(db)) instances.set(db, drizzle(db, { schema }));
  return instances.get(db);
}

// Serialize the whole migrator, including its journal read, using a separate
// SQLite lock database. OS locks work across processes and container PID
// namespaces and are released automatically on a crash. This file has no data.
function withMigrationLock(db, task) {
  if (!db.name || db.name === ":memory:") return task();
  const filename = `${fs.realpathSync(db.name)}.migration-lock.sqlite`;
  const lock = new Database(filename);
  try {
    fs.chmodSync(filename, 0o600);
    lock.pragma("busy_timeout = 30000");
    return lock.transaction(task).exclusive();
  } finally {
    lock.close();
  }
}

function migrateDatabase(
  db,
  { migrationsFolder = defaultMigrationsFolder } = {}
) {
  const orm = getOrm(db);
  if (migrated.has(db)) return orm;
  withMigrationLock(db, () => {
    prepareLegacyDatabase(db, migrationsFolder);
    migrate(orm, { migrationsFolder });
  });
  migrated.add(db);
  return orm;
}

function prepareLegacyDatabase(db, migrationsFolder) {
  // A pre-Drizzle release added this field conditionally. Apply that historic
  // upgrade through its own journal before adopting the complete baseline.
  const transfer = db.pragma("table_info(site_transfer)");
  if (
    transfer.length &&
    !transfer.some((column) => column.name === "createdAt")
  ) {
    migrate(getOrm(db), {
      migrationsFolder: path.join(migrationsFolder, "legacy"),
      migrationsTable: "__drizzle_legacy_migrations",
    });
  }
}

function migrateWithKit(db) {
  if (!db.name || db.name === ":memory:")
    throw new Error("Drizzle Kit migrations require a database file.");
  withMigrationLock(db, () => {
    prepareLegacyDatabase(db, defaultMigrationsFolder);
    execFileSync(
      process.execPath,
      [
        path.join(path.dirname(require.resolve("drizzle-kit")), "bin.cjs"),
        "migrate",
        "--config=drizzle.config.js",
      ],
      {
        cwd: path.resolve(__dirname, "../.."),
        env: { ...process.env, DATABASE_PATH: path.resolve(db.name) },
        stdio: "inherit",
      }
    );
    assertDatabaseReady(db);
  });
}

function assertDatabaseReady(db) {
  const latest = readMigrationFiles({
    migrationsFolder: defaultMigrationsFolder,
  }).at(-1);
  const journal = db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'"
    )
    .get();
  const applied =
    journal &&
    db
      .prepare(
        "SELECT hash,created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1"
      )
      .get();
  if (
    !applied ||
    Number(applied.created_at) !== latest.folderMillis ||
    applied.hash !== latest.hash
  ) {
    throw new Error(
      "Database migrations are pending. Run pnpm db:migrate or start through docker-entrypoint.sh."
    );
  }
}

module.exports = {
  getOrm,
  migrateDatabase,
  migrateWithKit,
  assertDatabaseReady,
};

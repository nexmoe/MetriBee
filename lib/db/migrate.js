const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");
const { drizzle } = require("drizzle-orm/better-sqlite3");
const { migrate } = require("drizzle-orm/better-sqlite3/migrator");
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
    // A pre-Drizzle release added this field conditionally. Apply that historic
    // upgrade through its own journal before adopting the complete baseline.
    const transfer = db.pragma("table_info(site_transfer)");
    if (
      transfer.length &&
      !transfer.some((column) => column.name === "createdAt")
    ) {
      migrate(orm, {
        migrationsFolder: path.join(migrationsFolder, "legacy"),
        migrationsTable: "__drizzle_legacy_migrations",
      });
    }
    migrate(orm, { migrationsFolder });
  });
  migrated.add(db);
  return orm;
}

module.exports = { getOrm, migrateDatabase };

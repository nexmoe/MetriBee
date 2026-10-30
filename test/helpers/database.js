const database = require("../../lib/database");

// Tests create isolated fixtures explicitly; opening the production database
// no longer performs deployment migrations as a side effect.
module.exports = {
  ...database,
  openDatabase(filename) {
    const db = database.openDatabase(filename);
    database.migrateDatabase(db);
    return db;
  },
};

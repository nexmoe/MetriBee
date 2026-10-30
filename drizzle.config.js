const { defineConfig } = require("drizzle-kit");
const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

// Generation/checking is offline. The container entrypoint runs Drizzle Kit
// migrations before starting the server or standalone MCP process.
module.exports = defineConfig({
  schema: "./lib/db/schema.js",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url:
      process.env.DATABASE_PATH ||
      path.join(
        __dirname,
        ".data",
        process.env.DEMO === "1" ? "metribee-demo.sqlite" : "metribee.sqlite"
      ),
  },
});

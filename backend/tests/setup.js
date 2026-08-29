const path = require("node:path");

const { config: loadEnv } = require("dotenv");

// Required first by every test file, before anything under src/ is loaded, because src/config/env.js
// reads process.env at require time.
loadEnv({
  path: path.join(__dirname, "..", ".env"),
  quiet: true,
});

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  throw new Error(
    "TEST_DATABASE_URL is not set. The test suite needs a local throwaway PostgreSQL; see backend/.env.example.",
  );
}

// The suite is allowed to reset data destructively, so running it against Supabase would destroy
// real records. Only a loopback host is accepted, and this runs before any connection can open.
const { hostname } = new URL(testDatabaseUrl);
const localHostnames = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

if (!localHostnames.has(hostname)) {
  throw new Error(
    `Refusing to run tests against host "${hostname}". TEST_DATABASE_URL must point at a local database.`,
  );
}

// The application reads DATABASE_URL and nothing else, so rebinding it here is what lets the tests
// exercise the real application code unchanged rather than a test-only variant of it.
process.env.DATABASE_URL = testDatabaseUrl;
process.env.NODE_ENV = "test";

module.exports = { testDatabaseUrl };

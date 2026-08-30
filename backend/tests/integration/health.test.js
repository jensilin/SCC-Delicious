require("../setup");

const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");

const { prisma } = require("../../src/config/prisma");
const { checkDatabaseConnection } = require("../../src/services/health.service");
const { startTestServer, stopTestServer } = require("../helpers/server");

let server;
let baseUrl;

before(async () => {
  ({ server, baseUrl } = await startTestServer());
});

after(async () => {
  await stopTestServer(server);
  await prisma.$disconnect();
});

test("the health service completes a round trip to PostgreSQL", async () => {
  await assert.doesNotReject(checkDatabaseConnection());
});

test("the database it reaches is the local test database", async () => {
  const [row] = await prisma.$queryRaw`SELECT current_database() AS name`;

  assert.equal(row.name, "scc_delicious_test");
});

test("the migrated schema is present in that database", async () => {
  // Confirms the connection reaches a database the migration has been applied to, rather than
  // merely an empty PostgreSQL that answers SELECT 1.
  const [row] = await prisma.$queryRaw`
    SELECT count(*)::int AS total
    FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT LIKE '\_prisma%'
  `;

  assert.equal(row.total, 8);
});

test("GET /health reports application and database as healthy", async () => {
  const response = await fetch(`${baseUrl}/health`);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
  assert.deepEqual(await response.json(), { status: "ok", database: "up" });
});

test("GET /health exposes no connection detail", async () => {
  const body = await (await fetch(`${baseUrl}/health`)).text();

  assert.ok(!/postgres(ql)?:\/\//.test(body), "response must not contain a connection string");
  assert.ok(!body.includes("5433"), "response must not name the database port");
});

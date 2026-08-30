const { prisma } = require("../../src/config/prisma");

const localHostnames = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

// tests/setup.js already refuses a non-local TEST_DATABASE_URL, but this is the function that
// actually destroys data, so it re-checks rather than trusting that it was loaded. The two costs
// nothing and removes any arrangement of imports in which the guard is skipped.
function assertLocalDatabase() {
  const url = new URL(process.env.DATABASE_URL);

  if (!localHostnames.has(url.hostname)) {
    throw new Error(`Refusing to truncate a database on host "${url.hostname}".`);
  }

  return url.pathname.replace(/^\//, "");
}

// Empties every application table between runs so that one test's users cannot satisfy another
// test's assertions. The table list is read from the database rather than written out here, so a
// table added by a later migration is included without anyone remembering to update this.
async function resetDatabase() {
  const expectedDatabase = assertLocalDatabase();
  const [{ name }] = await prisma.$queryRaw`SELECT current_database() AS name`;

  // Catches the case where DATABASE_URL passed the host check but the open connection goes
  // somewhere else entirely.
  if (name !== expectedDatabase) {
    throw new Error(`Connected to "${name}" but TEST_DATABASE_URL names "${expectedDatabase}".`);
  }

  const tables = await prisma.$queryRaw`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT LIKE '\_prisma%'
  `;

  if (tables.length === 0) {
    throw new Error(`Database "${name}" has no application tables; has the migration been applied?`);
  }

  // One statement, so foreign keys between the tables cannot make the order matter.
  const targets = tables.map((table) => `"public"."${table.tablename}"`).join(", ");

  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${targets} RESTART IDENTITY CASCADE`);
}

module.exports = { resetDatabase };

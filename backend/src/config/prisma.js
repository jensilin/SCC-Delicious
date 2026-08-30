const { PrismaPg } = require("@prisma/adapter-pg");
const { PrismaClient } = require("@prisma/client");

const { env } = require("./env");

// Prisma 7 takes its runtime connection from a driver adapter. It accepts no url, datasources, or
// datasourceUrl option, and schema.prisma carries no connection string either, so this is the only
// place the application's database URL enters Prisma.
//
// It must be the pooled DATABASE_URL. DIRECT_URL is the session connection reserved for the CLI's
// migrations, and prisma.config.mjs is where that one is configured.
const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

// Silent under test because a rejected query is sometimes the behaviour being asserted — a
// duplicate registration is meant to violate the unique index — and Prisma logs a full stack for
// each one, which buries the test output. Nothing is lost: the error still reaches the code that
// throws or the assertion that fails, carrying the same message.
const logLevels = {
  development: ["warn", "error"],
  production: ["error"],
  test: [],
};

// One client, and therefore one connection pool, for the whole process. A second instance would
// open a second pool against the same pooler.
const prisma = new PrismaClient({
  adapter,
  log: logLevels[env.NODE_ENV],
});

module.exports = { prisma };

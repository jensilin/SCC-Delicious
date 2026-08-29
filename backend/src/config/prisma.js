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

// One client, and therefore one connection pool, for the whole process. A second instance would
// open a second pool against the same pooler.
const prisma = new PrismaClient({
  adapter,
  log: env.NODE_ENV === "production" ? ["error"] : ["warn", "error"],
});

module.exports = { prisma };

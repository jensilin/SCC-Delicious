const { prisma } = require("../config/prisma");

// Controllers never touch Prisma, so the database probe lives here.
//
// A round-trip query is the point of the check. $connect() can succeed against the pooler without
// proving the database behind it answers, which is the failure this endpoint exists to catch.
// Throws whatever Prisma throws; the caller decides what to do with it.
async function checkDatabaseConnection() {
  await prisma.$queryRaw`SELECT 1`;
}

module.exports = { checkDatabaseConnection };

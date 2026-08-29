const { createApp } = require("./app");
const { env } = require("./config/env");
const { prisma } = require("./config/prisma");

const app = createApp();

const server = app.listen(env.PORT, () => {
  console.log(`Listening on port ${env.PORT} in ${env.NODE_ENV} mode`);
});

// Stop accepting connections first, let in-flight requests finish, and release the database pool
// only then. Disconnecting Prisma while a request is still running would fail that request
// instead of completing it.
function shutdown(signal) {
  console.log(`Received ${signal}, shutting down`);

  server.close(async (error) => {
    if (error) {
      console.error("Error while closing the server", error);
    }

    await prisma.$disconnect();

    process.exit(error ? 1 : 0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

module.exports = { server };

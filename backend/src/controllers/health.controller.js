const { checkDatabaseConnection } = require("../services/health.service");

// A database that does not answer is an expected outcome for this endpoint rather than an
// unexpected fault, so it is answered here with 503 instead of being passed to the error handler:
// the process is up but cannot serve requests, and a load balancer needs to see that difference.
//
// Only the error's name and code are logged. Prisma's connection errors quote the host and port in
// their message, and none of that belongs in a log line or a response body.
async function getHealth(request, response) {
  try {
    await checkDatabaseConnection();

    response.status(200).json({ status: "ok", database: "up" });
  } catch (error) {
    console.error("Health check failed", { name: error.name, code: error.code });

    response.status(503).json({ status: "error", database: "down" });
  }
}

module.exports = { getHealth };

// Started as a child process by health-failure.test.js.
//
// A separate process is the honest way to test this: src/config/prisma.js builds its client once
// at require time, so the failure path cannot be produced inside a process that has already loaded
// the module pointing at a working database.
require("../../setup");

// Deliberately after setup, which points DATABASE_URL at the working test database. Port 1 has
// nothing listening on it, so the connection is refused immediately and no real database is
// involved in this test at all.
process.env.DATABASE_URL = "postgresql://nobody:nothing@127.0.0.1:1/postgres";

const { createApp } = require("../../../src/app");

const server = createApp().listen(0, () => {
  // The parent reads this line to learn where to send its requests.
  process.stdout.write(`PORT=${server.address().port}\n`);
});

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});

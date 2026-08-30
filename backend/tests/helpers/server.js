const { once } = require("node:events");

const { createApp } = require("../../src/app");

// Port 0 lets the operating system pick a free port, so the suite cannot collide with a development
// server already on 3000, and two test files running at once cannot collide with each other.
async function startTestServer() {
  const server = createApp().listen(0);

  await once(server, "listening");

  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

async function stopTestServer(server) {
  await new Promise((resolve) => server.close(resolve));
}

module.exports = { startTestServer, stopTestServer };

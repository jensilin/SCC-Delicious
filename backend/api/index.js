const { createApp } = require("../src/app");

// The entry point Vercel invokes, and the only file in the repository that exists because of where
// the application is deployed rather than because of what it does.
//
// It is a second entry beside src/server.js, not a replacement for it. server.js owns a port and a
// shutdown sequence, which is exactly what a serverless platform must not be given: the platform
// listens, routes one request into this handler, and may freeze or discard the process afterwards,
// so a listener would never be reached and a SIGTERM handler would never run. What the two entries
// share is createApp(), so both serve the same middleware chain, the same routers and the same error
// handler — there is no Vercel-only variant of the application to keep in step.
//
// An Express application is itself a (request, response) function, which is the shape the Node
// runtime expects, so it is exported directly. The module is evaluated once per cold start and the
// exported app is reused for every request the warm instance then handles; src/config/prisma.js is
// module state under it, so that reuse is also what keeps one connection pool per instance rather
// than one per request.
module.exports = createApp();

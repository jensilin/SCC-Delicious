const cookieParser = require("cookie-parser");
const cors = require("cors");
const express = require("express");

const { env } = require("./config/env");
const { errorHandler } = require("./middleware/error-handler.middleware");
const { notFound } = require("./middleware/not-found.middleware");
const authRoute = require("./routes/auth.route");
const healthRoute = require("./routes/health.route");
const shopRoute = require("./routes/shop.route");

// Construction only. Nothing here listens on a port, so a test can exercise the application
// without starting a server and both paths use one definition of it.
//
// The middleware order is fixed deliberately and is part of the architecture: cross-origin
// handling, cookie parsing, body parsing, routes, the not-found handler, and the error handler
// last.
function createApp() {
  const app = express();

  // Express advertises itself in a response header by default, which tells an unauthenticated
  // caller what to look up vulnerabilities for. This removes a header rather than adding one, so
  // it is not the security-header work v1 leaves out.
  app.disable("x-powered-by");

  // An explicit origin with credentials enabled rather than a wildcard, because the refresh
  // cookie the authentication phase adds requires credentialed cross-origin requests, and a
  // wildcard origin is not permitted with credentials.
  app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));

  // The refresh cookie is the only cookie in the design, and the refresh endpoint is the only
  // reader of it. Unsigned: the value is a JWT whose own signature is verified before it is
  // trusted, so a second signature over the cookie would add a key to manage and prove nothing new.
  app.use(cookieParser());

  // A size limit is part of the documented posture. The value is not specified anywhere, and
  // 100kb is far more than any endpoint in this design needs.
  app.use(express.json({ limit: "100kb" }));

  // Outside /api/v1 on purpose. The prefix versions the resource API, and an operational probe is
  // not a resource that could ever need a second version.
  app.use("/health", healthRoute);

  app.use("/api/v1/auth", authRoute);

  // Foods are nested beneath their shop and have no router of their own, so that a food is only
  // ever reachable through the shop that owns it.
  app.use("/api/v1/shops", shopRoute);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };

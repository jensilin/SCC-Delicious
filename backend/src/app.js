const cookieParser = require("cookie-parser");
const cors = require("cors");
const express = require("express");

const { env } = require("./config/env");
const { errorHandler } = require("./middleware/error-handler.middleware");
const { notFound } = require("./middleware/not-found.middleware");
const authRoute = require("./routes/auth.route");
const cartRoute = require("./routes/cart.route");
const healthRoute = require("./routes/health.route");
const orderAdminRoute = require("./routes/order-admin.route");
const orderRoute = require("./routes/order.route");
const shopAdminRoute = require("./routes/shop-admin.route");
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

  // The same base path, deliberately, so one resource keeps one URL. Two routers rather than one
  // because browsing is open to both roles and writing is not, and role middleware attaches once
  // per router. Browsing must stay first: this router's requireRole("ADMIN") applies to everything
  // that enters it, so mounting it first would close the catalogue to students.
  app.use("/api/v1/shops", shopAdminRoute);

  // Singular because the cart is one per user and is never addressed by an identifier: the caller's
  // token names it, so there is no collection here to paginate or to enumerate.
  app.use("/api/v1/cart", cartRoute);

  // STUDENT-only: checkout, the caller's own orders, and cancelling one of them. The router carries a
  // router-level STUDENT check, so an ADMIN reaching any path beneath this base path is refused.
  app.use("/api/v1/orders", orderRoute);

  // Which is why the administrative half is a base path of its own rather than a second router here.
  // A role check attached to a router applies to everything entering it, so an ADMIN never gets past
  // the check above to reach a router mounted behind it. `admin` is the one path segment in v1 that
  // names a privilege rather than a resource, and the mount order of these two does not matter
  // because neither path is a prefix of the other.
  app.use("/api/v1/admin/orders", orderAdminRoute);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };

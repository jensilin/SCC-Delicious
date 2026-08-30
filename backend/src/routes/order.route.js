const { Router } = require("express");

const { postOrder } = require("../controllers/order.controller");
const { authenticate } = require("../middleware/authenticate.middleware");
const { requireRole } = require("../middleware/require-role.middleware");
const { validate } = require("../middleware/validate.middleware");
const { checkoutHeadersSchema } = require("../validators/order.validator");

const router = Router();

// Both middleware are attached once for the whole router rather than per handler, so a route added to
// this file later cannot be left unprotected by omission.
router.use(authenticate);

// Placing an order is a STUDENT capability: the Authorization section grants "place orders" to that
// role, and grants an ADMIN only the reading and advancing of orders. An ADMIN therefore receives
// 403 FORBIDDEN here, which is consistent with holding no cart to order from in the first place.
//
// This is also why the router is mounted before the admin order router a later phase adds. A role
// check attached to a router applies to everything that enters it, so an ADMIN-only router sharing
// this base path and mounted first would close checkout to students — the same ordering that keeps
// the catalogue open to them.
router.use(requireRole("STUDENT"));

// No path parameter and no body. The idempotency key is the only thing this request carries and it
// travels in a header; the cart, its shop, the quantities, the prices, and the buyer are all server
// state, so there is no cart id for a client to substitute.
router.post("/", validate({ headers: checkoutHeadersSchema }), postOrder);

module.exports = router;

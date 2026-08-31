const { Router } = require("express");

const {
  getMyOrder,
  getMyOrders,
  postMyOrderCancellation,
  postOrder,
} = require("../controllers/order.controller");
const { authenticate } = require("../middleware/authenticate.middleware");
const { requireRole } = require("../middleware/require-role.middleware");
const { validate } = require("../middleware/validate.middleware");
const { checkoutHeadersSchema, orderParamsSchema } = require("../validators/order.validator");

const router = Router();

// Both middleware are attached once for the whole router rather than per handler, so a route added to
// this file later cannot be left unprotected by omission.
router.use(authenticate);

// Every route here is a STUDENT capability: the Authorization section grants placing an order,
// reading one's own orders, and cancelling one's own order to that role. An ADMIN receives
// 403 FORBIDDEN on all of them and works through /api/v1/admin/orders instead, which exists as a
// separate base path precisely because this check applies to everything entering this router.
router.use(requireRole("STUDENT"));

// No path parameter and no body. The idempotency key is the only thing this request carries and it
// travels in a header; the cart, its shop, the quantities, the prices, and the buyer are all server
// state, so there is no cart id for a client to substitute.
router.post("/", validate({ headers: checkoutHeadersSchema }), postOrder);

// No collection parameters. Which orders these are is decided by the token, and the list is the
// caller's own orders newest first; filtering and pagination are not part of v1.
router.get("/", getMyOrders);

router.get("/:orderId", validate({ params: orderParamsSchema }), getMyOrder);

// A dedicated endpoint rather than a status field, because a student has exactly one move available.
// A { status } body would accept four values it would then have to refuse, describing a choice the
// caller does not have. It carries no body at all, and cancellation is full-order only: an order item
// is immutable and holds no state of its own, so there is no line for a request to name.
router.post("/:orderId/cancel", validate({ params: orderParamsSchema }), postMyOrderCancellation);

module.exports = router;

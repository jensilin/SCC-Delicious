const { Router } = require("express");

const {
  getOrderById,
  getOrders,
  patchOrderStatus,
} = require("../controllers/order-admin.controller");
const { authenticate } = require("../middleware/authenticate.middleware");
const { requireRole } = require("../middleware/require-role.middleware");
const { validate } = require("../middleware/validate.middleware");
const { orderParamsSchema, statusChangeSchema } = require("../validators/order.validator");

const router = Router();

// Mounted at /api/v1/admin/orders rather than beside the student routes on /api/v1/orders, and that
// is the one place in v1 where a path segment names a privilege instead of a resource.
//
// The reason is mechanical. A role check attached with router.use applies to every method and every
// path beneath the mount, so the STUDENT gate on /api/v1/orders refuses an ADMIN before a second
// router at that base path is ever reached. Catalogue administration can share /api/v1/shops only
// because the browsing router it sits behind gates no role at all; orders cannot copy that, because
// both roles need GET / and GET /:orderId with different scoping and different fields.
router.use(authenticate);

// Attached once for the whole router, as everywhere else, so a route added to this file later cannot
// be left open to students by omission.
router.use(requireRole("ADMIN"));

// Every order, newest first. Filtering by status or by shop is an open decision and is deliberately
// absent: the route accepts no query parameters, so a client cannot come to depend on one.
router.get("/", getOrders);

router.get("/:orderId", validate({ params: orderParamsSchema }), getOrderById);

// The only endpoint that changes an order's status. CANCELLED is one of the values the body accepts,
// because an administrative cancellation is a transition like any other.
router.patch(
  "/:orderId",
  validate({ params: orderParamsSchema, body: statusChangeSchema }),
  patchOrderStatus,
);

module.exports = router;

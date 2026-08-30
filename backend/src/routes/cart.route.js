const { Router } = require("express");

const {
  addCartItem,
  deleteCart,
  deleteCartItem,
  getMyCart,
  updateCartItem,
} = require("../controllers/cart.controller");
const { authenticate } = require("../middleware/authenticate.middleware");
const { requireRole } = require("../middleware/require-role.middleware");
const { validate } = require("../middleware/validate.middleware");
const {
  addCartItemSchema,
  cartItemParamsSchema,
  updateCartItemSchema,
} = require("../validators/cart.validator");

const router = Router();

// Both middleware are attached once for the whole router rather than per handler, so a route added
// to this file later cannot be left unprotected by omission.
router.use(authenticate);

// Holding a cart is a STUDENT capability: the Authorization section grants "manage their own cart"
// to that role and does not list a cart among what an ADMIN may do.
router.use(requireRole("STUDENT"));

// The cart is a per-user singleton with no identifier in the path, so this family is named for the
// single thing it addresses rather than as a collection — the second such exception in v1, after
// authentication. There is deliberately no route naming a cart id: with the caller's own cart as
// the only reachable one, there is nothing for a client to substitute.
router.get("/", getMyCart);
router.delete("/", deleteCart);

// Lines are addressed by their food, which is unique within a cart and is the identifier the client
// already holds from the catalogue.
router.post("/items", validate({ body: addCartItemSchema }), addCartItem);
router.patch(
  "/items/:foodId",
  validate({ params: cartItemParamsSchema, body: updateCartItemSchema }),
  updateCartItem,
);
router.delete("/items/:foodId", validate({ params: cartItemParamsSchema }), deleteCartItem);

module.exports = router;

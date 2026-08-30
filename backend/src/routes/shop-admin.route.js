const { Router } = require("express");

const {
  deleteFoodById,
  deleteShopById,
  patchFood,
  patchFoodStock,
  patchShop,
  postFood,
  postShop,
} = require("../controllers/shop-admin.controller");
const { authenticate } = require("../middleware/authenticate.middleware");
const { requireRole } = require("../middleware/require-role.middleware");
const { validate } = require("../middleware/validate.middleware");
const {
  createFoodSchema,
  createShopSchema,
  foodParamsSchema,
  shopParamsSchema,
  stockDeltaSchema,
  updateFoodSchema,
  updateShopSchema,
} = require("../validators/shop-admin.validator");

const router = Router();

// The second router at /api/v1/shops. Browsing declares the GET routes on its own router and is
// open to both roles; this one declares the writes and is closed to everyone but an administrator.
// Splitting them is what allows both middleware below to attach once for the whole router, so a
// write route added to this file later cannot be left unguarded by omission.
//
// It is mounted after the browsing router in app.js, and that order matters: mounted first, this
// role check would run for every GET as well and no STUDENT could browse.
router.use(authenticate);
router.use(requireRole("ADMIN"));

router.post("/", validate({ body: createShopSchema }), postShop);
router.patch("/:shopId", validate({ params: shopParamsSchema, body: updateShopSchema }), patchShop);
router.delete("/:shopId", validate({ params: shopParamsSchema }), deleteShopById);

// Foods are addressed beneath their shop for writes exactly as they are for reads, so the shop in
// the path is what every food query is scoped by.
router.post("/:shopId/foods", validate({ params: shopParamsSchema, body: createFoodSchema }), postFood);
router.patch(
  "/:shopId/foods/:foodId",
  validate({ params: foodParamsSchema, body: updateFoodSchema }),
  patchFood,
);
router.delete("/:shopId/foods/:foodId", validate({ params: foodParamsSchema }), deleteFoodById);

// Stock has its own endpoint because it is the one field that may not be replaced with an absolute
// value: it moves by a signed delta, applied as a conditional update.
router.patch(
  "/:shopId/foods/:foodId/stock",
  validate({ params: foodParamsSchema, body: stockDeltaSchema }),
  patchFoodStock,
);

module.exports = router;

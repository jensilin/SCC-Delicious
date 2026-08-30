const { Router } = require("express");

const {
  getShopById,
  getShopFoodById,
  getShopFoods,
  getShops,
} = require("../controllers/shop.controller");
const { authenticate } = require("../middleware/authenticate.middleware");
const { validate } = require("../middleware/validate.middleware");
const { foodParamsSchema, shopParamsSchema } = require("../validators/shop.validator");

const router = Router();

// Browsing requires a signed-in caller, and both roles may do it, so authentication is attached
// once for the whole router and no role check is needed. Mounting it here rather than per handler
// means a route added to this file later cannot be left open by omission.
router.use(authenticate);

router.get("/", getShops);
router.get("/:shopId", validate({ params: shopParamsSchema }), getShopById);

// Foods are addressed only beneath their shop. There is deliberately no top-level /foods route:
// without a parent in the path there is nothing for the service to scope the lookup by.
router.get("/:shopId/foods", validate({ params: shopParamsSchema }), getShopFoods);
router.get("/:shopId/foods/:foodId", validate({ params: foodParamsSchema }), getShopFoodById);

module.exports = router;

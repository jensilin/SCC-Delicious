const {
  getFoodInShop,
  getShop,
  listFoodsForShop,
  listShops,
} = require("../services/shop.service");

// Collections are returned as plain arrays and single resources as the object itself. There is no
// success envelope, and no pagination in v1.
//
// As in the authentication controllers, nothing is caught here: Express 5 forwards a rejected
// promise to the central error handler, which is the only place an error response is shaped.

async function getShops(request, response) {
  response.status(200).json(await listShops());
}

async function getShopById(request, response) {
  const { shopId } = request.validated.params;

  response.status(200).json(await getShop(shopId));
}

async function getShopFoods(request, response) {
  const { shopId } = request.validated.params;

  response.status(200).json(await listFoodsForShop(shopId));
}

async function getShopFoodById(request, response) {
  const { shopId, foodId } = request.validated.params;

  response.status(200).json(await getFoodInShop(shopId, foodId));
}

module.exports = { getShopById, getShopFoodById, getShopFoods, getShops };

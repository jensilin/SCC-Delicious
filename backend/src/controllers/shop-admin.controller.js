const {
  adjustFoodStock,
  createFoodInShop,
  createShop,
  deleteFoodInShop,
  deleteShop,
  updateFoodInShop,
  updateShop,
} = require("../services/shop.service");

// The write half of the catalogue over HTTP. As in every other controller here, nothing is caught:
// Express 5 forwards a rejected promise to the central error handler, which is the only place an
// error response is shaped. Authorization is not checked here either — the router carries it.

async function postShop(request, response) {
  response.status(201).json(await createShop(request.validated.body));
}

async function patchShop(request, response) {
  const { shopId } = request.validated.params;

  response.status(200).json(await updateShop(shopId, request.validated.body));
}

async function deleteShopById(request, response) {
  await deleteShop(request.validated.params.shopId);

  response.status(204).end();
}

async function postFood(request, response) {
  const { shopId } = request.validated.params;

  response.status(201).json(await createFoodInShop(shopId, request.validated.body));
}

async function patchFood(request, response) {
  const { shopId, foodId } = request.validated.params;

  response.status(200).json(await updateFoodInShop(shopId, foodId, request.validated.body));
}

async function deleteFoodById(request, response) {
  const { shopId, foodId } = request.validated.params;

  await deleteFoodInShop(shopId, foodId);

  response.status(204).end();
}

// The updated food is returned rather than the delta that was applied, because the caller's next
// question is what the quantity now is, and only the database can answer that.
async function patchFoodStock(request, response) {
  const { shopId, foodId } = request.validated.params;
  const { delta } = request.validated.body;

  response.status(200).json(await adjustFoodStock(shopId, foodId, delta));
}

module.exports = {
  deleteFoodById,
  deleteShopById,
  patchFood,
  patchFoodStock,
  patchShop,
  postFood,
  postShop,
};

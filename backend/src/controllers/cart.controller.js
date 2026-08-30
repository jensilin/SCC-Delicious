const {
  addItem,
  clearCart,
  getCart,
  removeItem,
  updateItemQuantity,
} = require("../services/cart.service");

// The caller's identity comes from request.auth, which the access-token middleware fills from the
// verified token. No handler here reads an owner from the path or the body, so there is no
// identifier a client could change to reach another user's cart.
//
// As in the other controllers, nothing is caught: Express 5 forwards a rejected promise to the
// central error handler, which is the only place an error response is shaped.

async function getMyCart(request, response) {
  response.status(200).json(await getCart(request.auth.userId));
}

// The whole cart is returned rather than the line that changed, because every write moves the
// totals and a client that received only the line would have to fetch the cart to redraw anyway.
async function addCartItem(request, response) {
  response.status(201).json(await addItem(request.auth.userId, request.validated.body));
}

async function updateCartItem(request, response) {
  const { foodId } = request.validated.params;
  const { quantity } = request.validated.body;

  response.status(200).json(await updateItemQuantity(request.auth.userId, foodId, quantity));
}

async function deleteCartItem(request, response) {
  await removeItem(request.auth.userId, request.validated.params.foodId);

  response.status(204).end();
}

async function deleteCart(request, response) {
  await clearCart(request.auth.userId);

  response.status(204).end();
}

module.exports = { addCartItem, deleteCart, deleteCartItem, getMyCart, updateCartItem };

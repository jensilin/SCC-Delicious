const { placeOrder } = require("../services/order.service");
const { IDEMPOTENCY_KEY_HEADER } = require("../validators/order.validator");

// The buyer comes from request.auth, which the access-token middleware fills from the verified token,
// and the cart is found by that id. No identifier reaches this handler from the path or the body, so
// there is nothing a client could change to order from someone else's cart.
//
// As in the other controllers, nothing is caught: Express 5 forwards a rejected promise to the central
// error handler, which is the only place an error response is shaped.
//
// 201 when this request created the order, 200 when it returned one an earlier request with the same
// key had already created. The body is identical either way, so a client that branches only on 2xx is
// correct without knowing which it received.
async function postOrder(request, response) {
  const { order, created } = await placeOrder(
    request.auth.userId,
    request.validated.headers[IDEMPOTENCY_KEY_HEADER],
  );

  response.status(created ? 201 : 200).json(order);
}

module.exports = { postOrder };

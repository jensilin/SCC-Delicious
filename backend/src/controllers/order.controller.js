const {
  cancelOwnOrder,
  getOwnOrder,
  listOwnOrders,
  placeOrder,
} = require("../services/order.service");
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

// The order id is the only thing these three read from the request besides the caller's identity,
// and it is never enough on its own: the service pairs it with request.auth.userId, so an id
// belonging to another student's order simply matches nothing.
async function getMyOrders(request, response) {
  response.status(200).json(await listOwnOrders(request.auth.userId));
}

async function getMyOrder(request, response) {
  const { orderId } = request.validated.params;

  response.status(200).json(await getOwnOrder(request.auth.userId, orderId));
}

// 200 with the cancelled order rather than 204, because what the caller needs next is the status the
// order now carries, and returning it avoids a follow-up read that could observe a further change.
//
// A cancellation is not idempotent and deliberately carries no key: a repeated request finds the
// order already cancelled and is refused with ORDER_STATUS_CONFLICT, which is the honest answer —
// unlike a repeated checkout, a repeated cancellation cannot create anything.
async function postMyOrderCancellation(request, response) {
  const { orderId } = request.validated.params;

  response.status(200).json(await cancelOwnOrder(request.auth.userId, orderId));
}

module.exports = { getMyOrder, getMyOrders, postMyOrderCancellation, postOrder };

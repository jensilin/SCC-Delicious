const { getAnyOrder, listAllOrders, setOrderStatus } = require("../services/order.service");

// The administrative half of order management. Nothing here is scoped to the caller: an ADMIN is
// platform-wide in v1, so the order id from the path is the whole of what identifies an order, and
// every response carries the buyer's email because handing an order over requires knowing whose it
// is.
//
// As in the other controllers, nothing is caught: Express 5 forwards a rejected promise to the
// central error handler, which is the only place an error response is shaped.

async function getOrders(request, response) {
  response.status(200).json(await listAllOrders());
}

async function getOrderById(request, response) {
  const { orderId } = request.validated.params;

  response.status(200).json(await getAnyOrder(orderId));
}

// PATCH rather than a verb-shaped endpoint per move, because status is the one column of an order
// that changes and this request replaces it. The body names the status being asked for; whether the
// order may go there from where it stands is the transition table's answer, not this handler's.
//
// 200 with the updated order, in the same shape a read returns, so a client that has just advanced an
// order holds exactly what it would have fetched.
async function patchOrderStatus(request, response) {
  const { orderId } = request.validated.params;
  const { status } = request.validated.body;

  response.status(200).json(await setOrderStatus(orderId, status));
}

module.exports = { getOrderById, getOrders, patchOrderStatus };

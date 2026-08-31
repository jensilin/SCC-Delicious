import { api } from "../../lib/api-client";

// ADMIN only, and mounted on its own base path — /api/v1/admin/orders — because the role check applies
// to a whole router. A STUDENT calling any of these is refused with 403 FORBIDDEN.
//
// Nothing here is scoped to the caller. An administrator is platform-wide in v1, so an order id is the
// whole of what identifies an order, and an order that does not exist is 404 rather than 403.

/**
 * An order as an administrator sees it: exactly the student's shape plus the buyer's address.
 *
 * `buyerEmail` is the only thing joined from the user, and the one place in v1 where one account's
 * address is shown to another — handing an order over requires knowing whose it is. There is no
 * userId, because an administrator has no use for one.
 *
 * @typedef {import("../orders/api").Order & { buyerEmail: string }} AdminOrder
 */

/**
 * Every order in the system, newest first by placedAt.
 *
 * The endpoint takes no query parameters: there is no server-side filtering, sorting or pagination in
 * v1. Narrowing the queue is therefore done in the browser, over this whole list.
 *
 * @returns {Promise<AdminOrder[]>} 200. An empty array when there are none.
 */
function listAllOrders() {
  return api.get("/admin/orders");
}

/**
 * @param {string} orderId
 * @returns {Promise<AdminOrder>} 200, or 404 NOT_FOUND.
 */
function getOrder(orderId) {
  return api.get(`/admin/orders/${orderId}`);
}

/**
 * Moves an order to a new status. Advancing and cancelling are the same request — cancellation is the
 * one target that also returns stock to the shelf — so there is no separate cancel endpoint here.
 *
 * Whether the move is legal from where the order stands is decided by the server's transition table,
 * applied as a conditional update. An illegal move and a move somebody else made first are both
 * answered with 409 ORDER_STATUS_CONFLICT, because the client's next step is the same either way: read
 * the order and show what it actually says.
 *
 * It carries no Idempotency-Key. A repeated transition cannot create anything, so it is refused rather
 * than replayed.
 *
 * @param {string} orderId
 * @param {import("../orders/api").OrderStatus} status
 * @returns {Promise<AdminOrder>} 200 with the updated order.
 */
function setOrderStatus(orderId, status) {
  return api.patch(`/admin/orders/${orderId}`, { status });
}

export { getOrder, listAllOrders, setOrderStatus };

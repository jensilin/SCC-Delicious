import { api } from "../../lib/api-client";

// STUDENT only, and every lookup is scoped to the order id *and* the caller's id. Another student's
// order is therefore not found rather than forbidden: answering 403 would confirm that it exists.
//
// An ADMIN receives 403 here and works through /api/v1/admin/orders instead.

/**
 * @typedef {"PLACED" | "PREPARING" | "READY" | "COMPLETED" | "CANCELLED"} OrderStatus
 */

/**
 * A line of an order, and an immutable record of what was bought.
 *
 * `name` and `priceMinor` are snapshots taken at checkout, so a rename, a reprice or a deletion
 * afterwards never rewrites a past order. `foodId` is null once that food has been deleted, and the
 * snapshots survive — a line with a null foodId cannot be linked back to the catalogue.
 *
 * @typedef {object} OrderItem
 * @property {string | null} foodId
 * @property {string} name Snapshot of the food's name at purchase time.
 * @property {number} priceMinor Snapshot of the unit price, integer minor units.
 * @property {number} quantity
 * @property {number} lineTotalMinor
 */

/**
 * An order. Immutable apart from its status.
 *
 * There is deliberately no shop **name** here, only `shopId`: the response never joins to shops,
 * which is what keeps a past order truthful after a rename. The shop is resolved client-side through
 * the shop directory, which is reliable because a shop referenced by an order cannot be deleted.
 *
 * No payment fields are exposed by any endpoint. A payment row is written inside the checkout
 * transaction and is always SUCCEEDED, but no order response carries it — and because v1 has no
 * representation of a refund, a cancelled order keeps its payment recorded against it. There is
 * therefore no Payment type to define here, and the UI must not promise a refund.
 *
 * Also absent, deliberately: userId, the idempotency key, createdAt and updatedAt.
 *
 * @typedef {object} Order
 * @property {string} id UUID.
 * @property {string} shopId UUID. Always resolvable through the shop directory.
 * @property {OrderStatus} status
 * @property {number} totalMinor Integer minor units, computed by the server.
 * @property {string} placedAt ISO 8601 timestamp.
 * @property {OrderItem[]} items Ordered by the name snapshot.
 */

/**
 * The caller's own orders, newest first by placedAt, each with its full items.
 *
 * @returns {Promise<Order[]>} 200. An empty array when there are none, never a 404.
 */
function listMyOrders() {
  return api.get("/orders");
}

/**
 * @param {string} orderId
 * @returns {Promise<Order>} 200, or 404 NOT_FOUND for an unknown order or another student's.
 */
function getMyOrder(orderId) {
  return api.get(`/orders/${orderId}`);
}

/**
 * Cancels the caller's own order. Full-order only — an order item is immutable and holds no state of
 * its own, so there is no line for a request to name — and permitted from PLACED alone, which is the
 * one status in which the shop has not started work. Stock is restored inside the same transaction.
 *
 * It carries no body and takes no Idempotency-Key: a repeat cannot create anything, so a second
 * request is refused with 409 ORDER_STATUS_CONFLICT rather than replayed. That conflict is the
 * ordinary answer to a stale screen and should be handled by refetching, not shown as a failure.
 *
 * @param {string} orderId
 * @returns {Promise<Order>} 200 with the cancelled order.
 */
function cancelMyOrder(orderId) {
  return api.post(`/orders/${orderId}/cancel`);
}

export { cancelMyOrder, getMyOrder, listMyOrders };

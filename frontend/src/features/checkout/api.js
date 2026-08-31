import { api } from "../../lib/api-client";

// Checkout is a single endpoint that takes no body. Everything it needs is already server state: the
// cart, its shop, the quantities, the prices and the buyer. A client cannot send a price or a total,
// which is what makes it impossible for one to be wrong.

/**
 * Places an order from the caller's cart.
 *
 * The response is an Order, identical whether this request created it or replayed an earlier one — the
 * API answers 201 for the first and 200 for a replay, and the body is the same either way, so nothing
 * here needs to branch on which happened.
 *
 * The refusals it can answer with, all of which the checkout screen handles by name:
 * - 409 CART_EMPTY — nothing to order.
 * - 409 INSUFFICIENT_STOCK — a food is short, with `details` naming which one.
 * - 409 CART_MODIFIED — a line's quantity changed while the order was being built.
 * - 409 IDEMPOTENCY_KEY_CONFLICT — the key belongs to somebody else's order.
 * - 404 NOT_FOUND — a food in the cart was deleted mid-checkout.
 * - 400 VALIDATION_ERROR — the key itself is malformed.
 *
 * @param {string} idempotencyKey From newIdempotencyKey, and stable across retries of one attempt.
 * @returns {Promise<import("../orders/api").Order>}
 */
function placeOrder(idempotencyKey) {
  return api.post("/orders", undefined, {
    headers: { "Idempotency-Key": idempotencyKey },
  });
}

export { placeOrder };

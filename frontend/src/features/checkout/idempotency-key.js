// The key that makes checkout safe to repeat.
//
// It identifies one attempt to place an order, not one request. If a request is sent and the answer
// never arrives — a dropped connection, a reload at the wrong moment — resending the same key returns
// the order the first request created instead of creating a second one. That only works if the key
// outlives the request, which is why the checkout screen holds one across retries and mints a new one
// only once an order has actually been placed.

/**
 * A fresh key for a new checkout attempt.
 *
 * A UUID satisfies the API's rule with room to spare: 36 characters against a range of 16 to 128, and
 * hyphens are within the permitted letters, digits, hyphens and underscores. The server treats the
 * value as opaque and only ever compares it for equality, so nothing here encodes meaning into it.
 *
 * `crypto.randomUUID` needs a secure context, which http://localhost is. There is deliberately no
 * fallback to Math.random: the key's uniqueness is what prevents a duplicate order, and
 * orders.idempotency_key is unique across the whole table rather than per user, so a weak generator
 * could collide with a key another account already used and have this order refused.
 *
 * @returns {string}
 */
function newIdempotencyKey() {
  return crypto.randomUUID();
}

export { newIdempotencyKey };

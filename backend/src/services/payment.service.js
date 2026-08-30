// Payment in v1 is simulated and there is no provider, so this module has one function and no
// abstraction over it. It exists as a module rather than as three lines inside checkout because the
// architecture puts the simulation in one place — which is where a real gateway would later be
// introduced, and the one place to look when it is.
//
// `client` is the checkout transaction's client, never the shared one. A payment recorded outside
// that transaction could survive an order that rolled back, and the one-to-one relationship with
// Order would then be describing a row that does not exist.
//
// The amount is the order total as already computed, not recomputed from the line items. A second
// arithmetic path could disagree with the first, and the agreement between the line totals, the
// order total, and the payment amount is a property the tests assert rather than two independent
// calculations hoping to match.
//
// SUCCEEDED is the only value PaymentStatus permits: a failure anywhere in checkout rolls the whole
// transaction back, so a failed or pending payment row is unreachable by construction.
function recordPayment(client, { orderId, amountMinor }) {
  return client.payment.create({
    data: { orderId, status: "SUCCEEDED", amountMinor },
    select: { id: true },
  });
}

module.exports = { recordPayment };

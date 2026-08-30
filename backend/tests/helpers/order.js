const crypto = require("node:crypto");

const { prisma } = require("../../src/config/prisma");

// A key of the shape the validator accepts. A UUID is 36 characters of exactly the permitted
// alphabet, and randomUUID is the cryptographically random source the contract asks a client for.
function idempotencyKey() {
  return crypto.randomUUID();
}

// Used where an order has to exist without checkout having created it — the catalogue tests that
// prove a shop with orders cannot be deleted, and that an order item outlives its food. Checkout's
// own tests place orders over HTTP instead, because how the order comes to exist is what they check.
async function createOrder({ userId, shopId, food, quantity = 1 }) {
  const unitPriceMinorSnapshot = food?.priceMinor ?? 1000;
  const lineTotalMinor = unitPriceMinorSnapshot * quantity;

  return prisma.order.create({
    data: {
      userId,
      shopId,
      status: "PLACED",
      totalMinor: lineTotalMinor,
      idempotencyKey: crypto.randomUUID(),
      items: food
        ? {
            create: [
              {
                foodId: food.id,
                foodNameSnapshot: food.name,
                unitPriceMinorSnapshot,
                quantity,
                lineTotalMinor,
              },
            ],
          }
        : undefined,
    },
  });
}

// Payments first, then items, then orders. Nothing cascades to an order or an order item — both
// relations are onDelete: Restrict — which is exactly the protection that keeps a historical order
// intact, and it means the order here has to be explicit.
async function resetOrders() {
  await prisma.payment.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
}

module.exports = { createOrder, idempotencyKey, resetOrders };

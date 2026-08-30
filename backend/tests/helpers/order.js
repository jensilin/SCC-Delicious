const crypto = require("node:crypto");

const { prisma } = require("../../src/config/prisma");

// Checkout is a later phase, so no endpoint can create an order. Tests that need one — deleting a
// shop past orders reference, and confirming an order item survives its food — create it through
// Prisma, the same way shops and foods are created.
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

module.exports = { createOrder, resetOrders };

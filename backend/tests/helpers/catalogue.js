const crypto = require("node:crypto");

const { prisma } = require("../../src/config/prisma");

// Created through Prisma because no endpoint can create a shop or a food: catalogue administration
// is a later phase. This is the same reason the user factory does not register through the API.
async function createShop({ name } = {}) {
  return prisma.shop.create({
    data: { name: name ?? `Shop ${crypto.randomUUID().slice(0, 8)}` },
  });
}

async function createFood(shopId, { name, priceMinor = 25000, stockQuantity = 10 } = {}) {
  return prisma.food.create({
    data: {
      shopId,
      name: name ?? `Food ${crypto.randomUUID().slice(0, 8)}`,
      priceMinor,
      stockQuantity,
    },
  });
}

// Narrower than resetDatabase on purpose. Catalogue tests sign in once in `before`, and a full
// truncation between tests would delete those users and force a bcrypt hash per test — seconds of
// work to remove rows the catalogue tests never touch. Deleting foods first keeps the intent
// explicit rather than relying on the cascade from shops.
async function resetCatalogue() {
  await prisma.food.deleteMany();
  await prisma.shop.deleteMany();
}

module.exports = { createFood, createShop, resetCatalogue };

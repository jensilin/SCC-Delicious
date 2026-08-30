const { prisma } = require("../config/prisma");
const { httpError } = require("../lib/http-error");

// Selected explicitly rather than returning whole rows, so a column added by a later migration is
// not published by accident. These are the documented fields for each entity and nothing else.
const shopFields = {
  id: true,
  name: true,
  createdAt: true,
  updatedAt: true,
};

// priceMinor and stockQuantity are returned as the integers they are stored as. Formatting a price
// is a presentation concern, and doing it here would put a second, lossy representation of money
// into the API.
const foodFields = {
  id: true,
  shopId: true,
  name: true,
  priceMinor: true,
  stockQuantity: true,
  createdAt: true,
  updatedAt: true,
};

// Ordered so that a collection is stable between requests. Without an explicit order PostgreSQL is
// free to return rows in any sequence, which makes both the interface and the tests unpredictable.
const byName = { name: "asc" };

function shopNotFound() {
  return httpError(404, "NOT_FOUND", "Shop not found");
}

function foodNotFound() {
  return httpError(404, "NOT_FOUND", "Food not found");
}

async function listShops() {
  return prisma.shop.findMany({ select: shopFields, orderBy: byName });
}

async function getShop(shopId) {
  const shop = await prisma.shop.findUnique({ where: { id: shopId }, select: shopFields });

  if (!shop) {
    throw shopNotFound();
  }

  return shop;
}

// Read through the shop rather than querying foods by shopId, so the parent is part of the query
// itself. A missing shop is then a 404 rather than an empty list, which would otherwise claim a
// shop exists and simply has no menu.
async function listFoodsForShop(shopId) {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { foods: { select: foodFields, orderBy: byName } },
  });

  if (!shop) {
    throw shopNotFound();
  }

  return shop.foods;
}

// The scoping rule this phase exists to establish: the food is looked up *within* its shop, so the
// query cannot return a food belonging to a different one. A fetch-then-compare would give the same
// answer today and the wrong answer the first time someone forgets the comparison.
async function getFoodInShop(shopId, foodId) {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { foods: { where: { id: foodId }, select: foodFields } },
  });

  if (!shop) {
    throw shopNotFound();
  }

  const [food] = shop.foods;

  if (!food) {
    throw foodNotFound();
  }

  return food;
}

module.exports = { getFoodInShop, getShop, listFoodsForShop, listShops };

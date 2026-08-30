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

const FOREIGN_KEY_VIOLATION = "P2003";
const RECORD_NOT_FOUND = "P2025";

function isPrismaError(error, code) {
  return error?.code === code;
}

function shopNotFound() {
  return httpError(404, "NOT_FOUND", "Shop not found");
}

function foodNotFound() {
  return httpError(404, "NOT_FOUND", "Food not found");
}

function shopHasOrders() {
  return httpError(
    409,
    "SHOP_HAS_ORDERS",
    "This shop cannot be deleted while past orders reference it",
  );
}

function insufficientStock() {
  return httpError(409, "INSUFFICIENT_STOCK", "That change would leave stock below zero");
}

// Throws rather than returning a boolean, because every caller's next step on a missing shop is
// the same 404 and the check is only ever made in order to raise it. It exists so that writing to
// a food under a shop that does not exist reports the missing shop, matching what browsing does.
async function assertShopExists(shopId) {
  const shop = await prisma.shop.findUnique({ where: { id: shopId }, select: { id: true } });

  if (!shop) {
    throw shopNotFound();
  }
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

// --- Administration -----------------------------------------------------------------------------
//
// The write half of the catalogue, reachable only through the ADMIN router. It lives beside the
// read half so that both share one definition of which columns exist and which are published; a
// second module would duplicate the field selections and the not-found errors above, and the two
// copies would eventually disagree.

async function createShop(data) {
  return prisma.shop.create({ data, select: shopFields });
}

async function updateShop(shopId, data) {
  try {
    return await prisma.shop.update({ where: { id: shopId }, data, select: shopFields });
  } catch (error) {
    if (isPrismaError(error, RECORD_NOT_FOUND)) {
      throw shopNotFound();
    }

    throw error;
  }
}

async function deleteShop(shopId) {
  try {
    await prisma.shop.delete({ where: { id: shopId } });
  } catch (error) {
    if (isPrismaError(error, RECORD_NOT_FOUND)) {
      throw shopNotFound();
    }

    // Order.shop is the only inbound relation declared onDelete: Restrict — foods cascade and a
    // cart's reference is nulled — so the database refusing this delete means past orders point at
    // the shop. Translating the refusal here is what stops a constraint reaching the client as an
    // unhandled fault, and it is why the orders keep their attribution.
    if (isPrismaError(error, FOREIGN_KEY_VIOLATION)) {
      throw shopHasOrders();
    }

    throw error;
  }
}

async function createFoodInShop(shopId, data) {
  await assertShopExists(shopId);

  try {
    return await prisma.food.create({ data: { ...data, shopId }, select: foodFields });
  } catch (error) {
    // The shop was removed between the check above and this insert.
    if (isPrismaError(error, FOREIGN_KEY_VIOLATION)) {
      throw shopNotFound();
    }

    throw error;
  }
}

// Scoped by the shop from the path, exactly as reading a food is. A food id that is real but
// belongs to a different shop matches no row, so it is reported missing rather than written to —
// the same scoping rule as browsing, on the side where getting it wrong corrupts rather than leaks.
async function updateFoodInShop(shopId, foodId, data) {
  await assertShopExists(shopId);

  const scope = { id: foodId, shopId };
  const updated = await prisma.food.updateMany({ where: scope, data });

  if (updated.count === 0) {
    throw foodNotFound();
  }

  return readFoodInScope(scope);
}

async function deleteFoodInShop(shopId, foodId) {
  await assertShopExists(shopId);

  // Always permitted. OrderItem.food is onDelete: SetNull and its descriptive and price columns are
  // snapshots, so a past order keeps what it says was bought; cart items cascade away, because a
  // cart is transient working state.
  const deleted = await prisma.food.deleteMany({ where: { id: foodId, shopId } });

  if (deleted.count === 0) {
    throw foodNotFound();
  }
}

// The reusable inventory primitive, and the only place a stock quantity moves.
//
// One statement. The row is matched only when the resulting quantity would not be negative, and
// the arithmetic is applied by the database, so the current quantity is never read into JavaScript
// and there is no window in which two callers both decide the same last unit is available. Zero
// affected rows means the change was refused rather than that the row is missing; the caller
// distinguishes those.
//
// `client` takes either the shared Prisma client or a transaction client, and `where` scopes the
// row, so the order-management phase can call this inside checkout's transaction — with a negative
// delta to consume stock and a positive one to restore it on cancellation — without a second
// implementation of the same rule.
function applyStockDelta(client, where, delta) {
  return client.food.updateMany({
    where: { ...where, stockQuantity: { gte: -delta } },
    data: { stockQuantity: { increment: delta } },
  });
}

async function adjustFoodStock(shopId, foodId, delta) {
  await assertShopExists(shopId);

  const scope = { id: foodId, shopId };
  const changed = await applyStockDelta(prisma, scope, delta);

  if (changed.count === 0) {
    // Nothing moved for one of two reasons, and only a second look can say which: either the food
    // is not in this shop, or it is and the delta would have taken it below zero.
    const food = await prisma.food.findFirst({ where: scope, select: { id: true } });

    throw food ? insufficientStock() : foodNotFound();
  }

  return readFoodInScope(scope);
}

// Reads a food back after a write, still scoped, so a row removed between the two is reported as
// missing rather than returned as null.
async function readFoodInScope(scope) {
  const food = await prisma.food.findFirst({ where: scope, select: foodFields });

  if (!food) {
    throw foodNotFound();
  }

  return food;
}

module.exports = {
  adjustFoodStock,
  applyStockDelta,
  createFoodInShop,
  createShop,
  deleteFoodInShop,
  deleteShop,
  getFoodInShop,
  getShop,
  listFoodsForShop,
  listShops,
  updateFoodInShop,
  updateShop,
};

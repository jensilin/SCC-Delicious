const { prisma } = require("../config/prisma");
const { httpError } = require("../lib/http-error");

// Every read is keyed on the caller's userId, never on a cart id supplied by the client. There is
// no endpoint that names a cart, so there is no cart belonging to someone else for a request to
// reach: ownership is a property of the query rather than a check that could be forgotten.
//
// The cart stores quantity and nothing else. Name, price, and every total below are read from the
// food row at the moment of the request, so a price change is reflected immediately and a stale
// figure cannot be quoted back.
const cartSelect = {
  id: true,
  shopId: true,
  items: {
    select: {
      foodId: true,
      quantity: true,
      food: { select: { name: true, priceMinor: true } },
    },
    // Ordered so a response is stable between requests, matching the catalogue.
    orderBy: { food: { name: "asc" } },
  },
};

const UNIQUE_VIOLATION = "P2002";

function foodNotFound() {
  return httpError(404, "NOT_FOUND", "Food not found");
}

function cartItemNotFound() {
  return httpError(404, "NOT_FOUND", "Cart item not found");
}

function shopMismatch() {
  return httpError(
    409,
    "CART_SHOP_MISMATCH",
    "The cart already contains items from a different shop",
  );
}

// Money is computed here and returned as the integer minor units it is stored in. Line totals are
// included so the client is never the only place a total exists, which is what would let a
// mismatched arithmetic bug reach checkout unnoticed.
function toCartView(cart) {
  // A user who has never added anything has no cart row. Creating one to answer a read would write
  // on a GET, and a 404 would report an ordinary state as an error, so the empty cart is described
  // directly instead. A null id says the cart does not exist server-side yet.
  if (!cart) {
    return { id: null, shopId: null, items: [], totalMinor: 0 };
  }

  const items = cart.items.map((item) => ({
    foodId: item.foodId,
    name: item.food.name,
    priceMinor: item.food.priceMinor,
    quantity: item.quantity,
    lineTotalMinor: item.food.priceMinor * item.quantity,
  }));

  return {
    id: cart.id,
    shopId: cart.shopId,
    items,
    totalMinor: items.reduce((total, item) => total + item.lineTotalMinor, 0),
  };
}

// Two simultaneous first-time writes race to create the same row: the cart itself, or a line for a
// food not in it yet. The unique indexes decide which one wins, which is what they are for, and the
// loser is retried rather than reported — on a second pass the row it lost to exists and the same
// operation becomes an increment.
//
// The retry wraps the whole transaction because a failed statement aborts a PostgreSQL transaction:
// it cannot be caught and recovered from inside one.
async function retryOnUniqueViolation(operation) {
  try {
    return await operation();
  } catch (error) {
    if (error?.code !== UNIQUE_VIOLATION) {
      throw error;
    }

    return operation();
  }
}

async function findOrCreateCart(tx, userId) {
  const existing = await tx.cart.findUnique({ where: { userId }, select: { id: true } });

  return existing ?? tx.cart.create({ data: { userId }, select: { id: true } });
}

// `client` takes either the shared Prisma client or a transaction client, so checkout can read the
// cart inside its own transaction without a second definition of what a cart holds. The scoping by
// userId stays here rather than at the call site, which is what keeps ownership a property of the
// query for every caller rather than a check each one has to remember.
function findCartForUser(client, userId) {
  return client.cart.findUnique({ where: { userId }, select: cartSelect });
}

async function getCart(userId) {
  return toCartView(await findCartForUser(prisma, userId));
}

async function addItem(userId, { foodId, quantity }) {
  await retryOnUniqueViolation(() =>
    prisma.$transaction(async (tx) => {
      // The food must exist, and its shop is what decides whether this addition is allowed. Reading
      // it inside the transaction keeps the shop it reports and the shop claimed below consistent.
      const food = await tx.food.findUnique({ where: { id: foodId }, select: { shopId: true } });

      if (!food) {
        throw foodNotFound();
      }

      const cart = await findOrCreateCart(tx, userId);

      // The single-shop rule as one conditional update rather than a read followed by a write.
      // Matching on "unclaimed, or already this shop" is what makes it safe under concurrency: two
      // simultaneous additions from different shops cannot both succeed, because the second waits
      // on the row lock, re-reads the shop the first just claimed, matches nothing, and is refused.
      //
      // This rule spans two tables and so cannot be a check constraint. It is enforced here and
      // covered by a test, which is exactly the obligation the architecture places on this layer.
      const claimed = await tx.cart.updateMany({
        where: { id: cart.id, OR: [{ shopId: null }, { shopId: food.shopId }] },
        data: { shopId: food.shopId },
      });

      if (claimed.count === 0) {
        throw shopMismatch();
      }

      // A food already in the cart gains quantity rather than a second line: the unique index on
      // (cart_id, food_id) means there is one line per food, and increment applies the change in
      // the database rather than writing back a total computed from a value read earlier.
      await tx.cartItem.upsert({
        where: { cartId_foodId: { cartId: cart.id, foodId } },
        create: { cartId: cart.id, foodId, quantity },
        update: { quantity: { increment: quantity } },
      });
    }),
  );

  return getCart(userId);
}

// Stock is deliberately not consulted here or anywhere else in the cart. Adding to the cart does
// not reserve inventory; availability is confirmed at checkout, which is where the conditional
// decrement lives.
async function updateItemQuantity(userId, foodId, quantity) {
  const cart = await prisma.cart.findUnique({ where: { userId }, select: { id: true } });

  if (!cart) {
    throw cartItemNotFound();
  }

  // Scoped to the caller's own cart, so a food id taken from someone else's cart matches no row
  // and is reported as missing rather than updated.
  const updated = await prisma.cartItem.updateMany({
    where: { cartId: cart.id, foodId },
    data: { quantity },
  });

  if (updated.count === 0) {
    throw cartItemNotFound();
  }

  return getCart(userId);
}

async function removeItem(userId, foodId) {
  await prisma.$transaction(async (tx) => {
    const cart = await tx.cart.findUnique({
      where: { userId },
      select: { id: true, shopId: true },
    });

    if (!cart) {
      throw cartItemNotFound();
    }

    // Writing the shop reference back unchanged takes the same cart row lock that adding an item
    // takes when it claims the shop, so the two operations cannot interleave. Without it an
    // addition could insert a line between the count below and the update that follows it, leaving
    // a cart that holds items but names no shop.
    await tx.cart.update({ where: { id: cart.id }, data: { shopId: cart.shopId } });

    const deleted = await tx.cartItem.deleteMany({ where: { cartId: cart.id, foodId } });

    if (deleted.count === 0) {
      throw cartItemNotFound();
    }

    // The documented invariant: the shop reference is null while the cart is empty. Releasing it
    // here is what lets the next addition come from any shop.
    if ((await tx.cartItem.count({ where: { cartId: cart.id } })) === 0) {
      await tx.cart.update({ where: { id: cart.id }, data: { shopId: null } });
    }
  });
}

// Emptying a cart that was never created is not an error: the outcome asked for already holds, and
// there is no cart to create in order to say so.
async function clearCart(userId) {
  const cart = await prisma.cart.findUnique({ where: { userId }, select: { id: true } });

  if (!cart) {
    return;
  }

  // One nested write, so removing the items and releasing the shop are a single transaction and the
  // cart is never observed holding items from a shop it no longer names.
  await prisma.cart.update({
    where: { id: cart.id },
    data: { shopId: null, items: { deleteMany: {} } },
  });
}

module.exports = {
  addItem,
  clearCart,
  findCartForUser,
  getCart,
  removeItem,
  updateItemQuantity,
};

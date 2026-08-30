require("../setup");

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { after, before, beforeEach, test } = require("node:test");

const { prisma } = require("../../src/config/prisma");
const { hashPassword } = require("../../src/lib/password");
const { signAccessToken } = require("../../src/lib/token");
const { authorizationHeader, createSignedInUser } = require("../helpers/auth");
const { resetCarts } = require("../helpers/cart");
const { createFood, createShop, resetCatalogue } = require("../helpers/catalogue");
const { resetDatabase } = require("../helpers/database");
const { idempotencyKey, resetOrders } = require("../helpers/order");
const { startTestServer, stopTestServer } = require("../helpers/server");

let server;
let baseUrl;
let student;
let otherStudent;
let admin;
let crowd;

// Signed in once, because a bcrypt hash per test would add seconds without exercising anything
// checkout owns.
before(async () => {
  ({ server, baseUrl } = await startTestServer());

  await resetDatabase();

  student = await createSignedInUser(baseUrl, { role: "STUDENT" });
  otherStudent = await createSignedInUser(baseUrl, { role: "STUDENT" });
  admin = await createSignedInUser(baseUrl, { role: "ADMIN" });

  // The concurrency tests need ten distinct buyers. They share one password hash and are given tokens
  // directly rather than signing in, because ten hashes and ten verifies would cost more than the
  // tests they serve — and neither hashing nor sign-in is what those tests are about.
  crowd = await manyStudents(10);
});

// Orders first: a shop cannot be deleted while an order references it, so the catalogue reset below
// would be refused while any survive. Carts before the catalogue, so lines go before their foods.
beforeEach(async () => {
  await resetOrders();
  await resetCarts();
  await resetCatalogue();
});

after(async () => {
  await stopTestServer(server);
  await prisma.$disconnect();
});

async function manyStudents(count) {
  const passwordHash = await hashPassword("test-password-123");

  return Promise.all(
    Array.from({ length: count }, async () => {
      const user = await prisma.user.create({
        data: {
          email: `crowd-${crypto.randomUUID()}@example.com`,
          passwordHash,
          role: "STUDENT",
        },
      });

      return { user, accessToken: await signAccessToken({ userId: user.id, role: user.role }) };
    }),
  );
}

function request(method, path, { token = student.accessToken, body, key } = {}) {
  return fetch(`${baseUrl}/api/v1${path}`, {
    method,
    headers: {
      ...(token === null ? {} : authorizationHeader(token)),
      ...(key === undefined ? {} : { "idempotency-key": key }),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function checkout({ key = idempotencyKey(), ...options } = {}) {
  return request("POST", "/orders", { ...options, key });
}

function addItem(foodId, quantity, options = {}) {
  return request("POST", "/cart/items", { ...options, body: { foodId, quantity } });
}

async function cartOf(options = {}) {
  return (await request("GET", "/cart", options)).json();
}

function stockOf(foodId) {
  return prisma.food
    .findUnique({ where: { id: foodId }, select: { stockQuantity: true } })
    .then((food) => food?.stockQuantity);
}

function orderCount() {
  return prisma.order.count();
}

// A shop with one food, and that food already in the caller's cart.
async function aCartWith({ quantity = 2, ...overrides } = {}, options = {}) {
  const shop = await createShop();
  const food = await createFood(shop.id, overrides);

  await addItem(food.id, quantity, options);

  return { shop, food };
}

// --- Authentication and role ---------------------------------------------------------------------

test("checkout requires a token", async () => {
  const response = await checkout({ token: null });

  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, "UNAUTHENTICATED");
});

test("a malformed or forged token is refused", async () => {
  for (const token of ["not-a-token", "a.b.c", `${student.accessToken}x`]) {
    const response = await checkout({ token });

    assert.equal(response.status, 401, `expected ${token} to be refused`);
  }
});

test("an ADMIN may not place an order", async () => {
  const response = await checkout({ token: admin.accessToken });

  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, "FORBIDDEN");
});

test("an ADMIN is refused before the cart is even considered", async () => {
  // The role check is attached to the router, so it runs ahead of any cart state. An ADMIN with
  // nothing in a cart still sees 403 rather than 409.
  await checkout({ token: admin.accessToken });

  assert.equal(await orderCount(), 0);
});

// --- The idempotency key over HTTP ---------------------------------------------------------------

test("a checkout without the Idempotency-Key header is a validation failure", async () => {
  const response = await request("POST", "/orders");
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.error.code, "VALIDATION_ERROR");
  assert.deepEqual(
    body.error.details.map((detail) => detail.field),
    ["idempotency-key"],
  );
});

test("a key that breaks the format is refused before any cart work happens", async () => {
  await aCartWith();

  for (const key of ["short", "0123456789abcde!", `${"a".repeat(129)}`, ""]) {
    const response = await checkout({ key });

    assert.equal(response.status, 400, `expected ${JSON.stringify(key)} to be refused`);
  }

  assert.equal(await orderCount(), 0);
  assert.equal((await cartOf()).items.length, 1, "the cart is untouched by a rejected request");
});

test("a request body is ignored, so a client cannot name its own price or total", async () => {
  const { food } = await aCartWith({ priceMinor: 500, quantity: 2 });

  const response = await checkout({
    body: { priceMinor: 1, totalMinor: 1, status: "COMPLETED", userId: otherStudent.user.id },
  });
  const order = await response.json();

  assert.equal(response.status, 201);
  assert.equal(order.totalMinor, 1000, "the server's own arithmetic, not the client's");
  assert.equal(order.items[0].priceMinor, 500);
  assert.equal(order.status, "PLACED");
  assert.equal(order.items[0].foodId, food.id);

  const stored = await prisma.order.findUnique({ where: { id: order.id } });

  assert.equal(stored.userId, student.user.id, "the buyer is the authenticated caller");
});

// --- Empty cart ----------------------------------------------------------------------------------

test("checking out with no cart row at all is CART_EMPTY", async () => {
  const response = await checkout();

  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, "CART_EMPTY");
});

test("checking out an existing but empty cart is the same answer", async () => {
  const { food } = await aCartWith({ quantity: 1 });

  await request("DELETE", `/cart/items/${food.id}`);

  const response = await checkout();

  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, "CART_EMPTY");
});

test("an empty-cart checkout writes nothing at all", async () => {
  await checkout();

  assert.equal(await orderCount(), 0);
  assert.equal(await prisma.orderItem.count(), 0);
  assert.equal(await prisma.payment.count(), 0);
  assert.equal(await prisma.cart.count(), 0, "no cart row is created to answer a checkout");
});

// --- A successful checkout -----------------------------------------------------------------------

test("a single-item checkout creates the order and returns it", async () => {
  const { shop, food } = await aCartWith({ priceMinor: 25000, quantity: 2 });

  const response = await checkout();
  const order = await response.json();

  assert.equal(response.status, 201);
  assert.equal(order.shopId, shop.id);
  assert.equal(order.status, "PLACED");
  assert.equal(order.totalMinor, 50000);
  assert.ok(Date.parse(order.placedAt), "placedAt is a timestamp");
  assert.deepEqual(order.items, [
    {
      foodId: food.id,
      name: food.name,
      priceMinor: 25000,
      quantity: 2,
      lineTotalMinor: 50000,
    },
  ]);
});

test("the response carries exactly the settled fields and nothing else", async () => {
  await aCartWith();

  const order = await (await checkout()).json();

  assert.deepEqual(Object.keys(order).sort(), [
    "id",
    "items",
    "placedAt",
    "shopId",
    "status",
    "totalMinor",
  ]);
  assert.deepEqual(Object.keys(order.items[0]).sort(), [
    "foodId",
    "lineTotalMinor",
    "name",
    "priceMinor",
    "quantity",
  ]);
});

test("the response exposes no ownership, payment, or bookkeeping fields", async () => {
  await aCartWith();

  const order = await (await checkout()).json();

  for (const field of [
    "userId",
    "idempotencyKey",
    "createdAt",
    "updatedAt",
    "payment",
    "shop",
    "user",
  ]) {
    assert.equal(order[field], undefined, `${field} must not be exposed`);
  }

  assert.equal(order.items[0].foodNameSnapshot, undefined);
  assert.equal(order.items[0].unitPriceMinorSnapshot, undefined);
});

test("a multi-item checkout records every line and their sum", async () => {
  const shop = await createShop();
  const foods = await Promise.all([
    createFood(shop.id, { name: "Cake", priceMinor: 1000, stockQuantity: 10 }),
    createFood(shop.id, { name: "Aloo Roll", priceMinor: 450, stockQuantity: 10 }),
    createFood(shop.id, { name: "Bun", priceMinor: 200, stockQuantity: 10 }),
  ]);

  await addItem(foods[0].id, 1);
  await addItem(foods[1].id, 2);
  await addItem(foods[2].id, 3);

  const order = await (await checkout()).json();

  assert.equal(order.items.length, 3);
  assert.deepEqual(
    order.items.map((item) => item.name),
    ["Aloo Roll", "Bun", "Cake"],
    "ordered by name, as the cart orders its lines",
  );
  assert.equal(order.totalMinor, 1000 + 900 + 600);
  assert.equal(
    order.totalMinor,
    order.items.reduce((total, item) => total + item.lineTotalMinor, 0),
  );
});

// --- Stock ---------------------------------------------------------------------------------------

test("stock falls by exactly the quantity ordered", async () => {
  const { food } = await aCartWith({ stockQuantity: 10, quantity: 3 });

  await checkout();

  assert.equal(await stockOf(food.id), 7);
});

test("stock falls per food across a multi-item order", async () => {
  const shop = await createShop();
  const first = await createFood(shop.id, { stockQuantity: 5 });
  const second = await createFood(shop.id, { stockQuantity: 8 });

  await addItem(first.id, 2);
  await addItem(second.id, 5);

  await checkout();

  assert.equal(await stockOf(first.id), 3);
  assert.equal(await stockOf(second.id), 3);
});

test("ordering the entire remaining stock succeeds and leaves zero", async () => {
  const { food } = await aCartWith({ stockQuantity: 4, quantity: 4 });

  const response = await checkout();

  assert.equal(response.status, 201);
  assert.equal(await stockOf(food.id), 0);
});

test("ordering one more than exists is INSUFFICIENT_STOCK and names the food", async () => {
  const { food } = await aCartWith({ stockQuantity: 3, quantity: 4 });

  const response = await checkout();
  const body = await response.json();

  assert.equal(response.status, 409);
  assert.equal(body.error.code, "INSUFFICIENT_STOCK");
  assert.deepEqual(body.error.details, [
    { foodId: food.id, name: food.name, message: "Insufficient stock" },
  ]);
});

test("an insufficient-stock refusal leaks no stock figure", async () => {
  const { food } = await aCartWith({ stockQuantity: 3, quantity: 4 });

  const body = await (await checkout()).json();

  assert.ok(
    !JSON.stringify(body).includes('"stockQuantity"'),
    "the response says which line failed, not how much the shop holds",
  );
  assert.equal(await stockOf(food.id), 3, "and nothing moved");
});

test("a checkout the cart has outgrown leaves order, payment, stock, and cart alone", async () => {
  const { food } = await aCartWith({ stockQuantity: 1, quantity: 2 });

  await checkout();

  assert.equal(await orderCount(), 0);
  assert.equal(await prisma.orderItem.count(), 0);
  assert.equal(await prisma.payment.count(), 0);
  assert.equal(await stockOf(food.id), 1);
  assert.equal((await cartOf()).items.length, 1);
});

// --- Rollback ------------------------------------------------------------------------------------

test("a failure on the second line rolls back the first line's stock", async () => {
  // The mandatory scenario: a forced failure mid-checkout leaves no order, no payment row, no stock
  // movement, and the cart unchanged. The first food is deducted before the second is refused, so an
  // order that survived would be an order whose stock had partly moved.
  const shop = await createShop();
  const plenty = await createFood(shop.id, { name: "Aloo Roll", stockQuantity: 10 });
  const scarce = await createFood(shop.id, { name: "Bun", stockQuantity: 1 });

  await addItem(plenty.id, 2);
  await addItem(scarce.id, 5);

  const response = await checkout();

  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, "INSUFFICIENT_STOCK");

  assert.equal(await orderCount(), 0, "no order");
  assert.equal(await prisma.orderItem.count(), 0, "no order items");
  assert.equal(await prisma.payment.count(), 0, "no payment");
  assert.equal(await stockOf(plenty.id), 10, "the first food is untouched");
  assert.equal(await stockOf(scarce.id), 1, "and so is the second");

  const cart = await cartOf();

  assert.equal(cart.items.length, 2, "the cart is exactly as it was");
  assert.equal(cart.shopId, shop.id);
});

test("a food deleted between the cart and the checkout is a 404", async () => {
  // Deleting a food cascades to every cart line holding it, so the cart is emptied rather than left
  // pointing at nothing — which is why this is CART_EMPTY unless something else remains.
  const shop = await createShop();
  const staying = await createFood(shop.id, { stockQuantity: 5 });
  const going = await createFood(shop.id, { stockQuantity: 5 });

  await addItem(staying.id, 1);
  await addItem(going.id, 1);

  await prisma.food.delete({ where: { id: going.id } });

  const response = await checkout();
  const order = await response.json();

  assert.equal(response.status, 201, "the surviving line is still orderable");
  assert.equal(order.items.length, 1);
  assert.equal(order.items[0].foodId, staying.id);
});

// --- Payment -------------------------------------------------------------------------------------

test("checkout records exactly one succeeded payment for the order total", async () => {
  await aCartWith({ priceMinor: 1200, quantity: 3 });

  const order = await (await checkout()).json();
  const payments = await prisma.payment.findMany();

  assert.equal(payments.length, 1);
  assert.equal(payments[0].orderId, order.id);
  assert.equal(payments[0].status, "SUCCEEDED");
  assert.equal(payments[0].amountMinor, 3600);
});

test("line totals sum to the order total and to the payment amount", async () => {
  const shop = await createShop();
  const first = await createFood(shop.id, { priceMinor: 333, stockQuantity: 10 });
  const second = await createFood(shop.id, { priceMinor: 777, stockQuantity: 10 });

  await addItem(first.id, 3);
  await addItem(second.id, 2);

  const order = await (await checkout()).json();

  const items = await prisma.orderItem.findMany({ where: { orderId: order.id } });
  const stored = await prisma.order.findUnique({ where: { id: order.id } });
  const payment = await prisma.payment.findUnique({ where: { orderId: order.id } });
  const lineSum = items.reduce((total, item) => total + item.lineTotalMinor, 0);

  assert.equal(lineSum, stored.totalMinor);
  assert.equal(stored.totalMinor, payment.amountMinor);
  assert.equal(lineSum, 333 * 3 + 777 * 2);
});

// --- Price and name snapshots --------------------------------------------------------------------

test("the price charged is the food's price at checkout, not when it was added", async () => {
  const { food } = await aCartWith({ priceMinor: 1000, quantity: 2 });

  await prisma.food.update({ where: { id: food.id }, data: { priceMinor: 1500 } });

  const order = await (await checkout()).json();

  assert.equal(order.items[0].priceMinor, 1500);
  assert.equal(order.totalMinor, 3000);
});

test("renaming or repricing a food afterwards does not rewrite the order", async () => {
  const { food } = await aCartWith({ name: "Chicken Roll", priceMinor: 450, quantity: 2 });

  const created = await (await checkout()).json();

  await prisma.food.update({
    where: { id: food.id },
    data: { name: "Chicken Roll (large)", priceMinor: 900 },
  });

  const items = await prisma.orderItem.findMany({ where: { orderId: created.id } });

  assert.equal(items[0].foodNameSnapshot, "Chicken Roll");
  assert.equal(items[0].unitPriceMinorSnapshot, 450);
  assert.equal(items[0].lineTotalMinor, 900);
});

test("deleting the food afterwards leaves the order item intact with a null reference", async () => {
  const { shop, food } = await aCartWith({ name: "Chicken Roll", priceMinor: 450, quantity: 2 });

  const created = await (await checkout()).json();

  await prisma.food.delete({ where: { id: food.id } });

  const items = await prisma.orderItem.findMany({ where: { orderId: created.id } });
  const stored = await prisma.order.findUnique({ where: { id: created.id } });

  assert.equal(items.length, 1);
  assert.equal(items[0].foodId, null, "the reference is nulled");
  assert.equal(items[0].foodNameSnapshot, "Chicken Roll", "the name survives");
  assert.equal(items[0].unitPriceMinorSnapshot, 450, "and so does the price");
  assert.equal(stored.shopId, shop.id, "and the order still knows its shop");
});

test("a shop with a checkout-created order cannot be deleted", async () => {
  const { shop } = await aCartWith();

  await checkout();

  const response = await request("DELETE", `/shops/${shop.id}`, { token: admin.accessToken });

  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, "SHOP_HAS_ORDERS");
});

// --- The cart after checkout ---------------------------------------------------------------------

test("a successful checkout empties the cart and releases its shop", async () => {
  await aCartWith();

  await checkout();

  const cart = await cartOf();

  assert.deepEqual(cart.items, []);
  assert.equal(cart.shopId, null);
  assert.equal(cart.totalMinor, 0);
});

test("the emptied cart can then hold a different shop's food", async () => {
  await aCartWith();
  await checkout();

  const other = await createShop();
  const food = await createFood(other.id);

  assert.equal((await addItem(food.id, 1)).status, 201);
});

// --- Ownership -----------------------------------------------------------------------------------

test("checkout uses the caller's own cart and leaves another's alone", async () => {
  const shop = await createShop();
  const mine = await createFood(shop.id, { stockQuantity: 10 });
  const theirs = await createFood(shop.id, { stockQuantity: 10 });

  await addItem(mine.id, 1);
  await addItem(theirs.id, 4, { token: otherStudent.accessToken });

  const order = await (await checkout()).json();

  assert.deepEqual(
    order.items.map((item) => item.foodId),
    [mine.id],
    "only the caller's line is ordered",
  );
  assert.equal(await stockOf(theirs.id), 10, "the other cart's food is untouched");

  const theirCart = await cartOf({ token: otherStudent.accessToken });

  assert.equal(theirCart.items.length, 1, "and their cart still holds it");
});

test("the created order belongs to the authenticated caller", async () => {
  await aCartWith();

  const order = await (await checkout()).json();
  const stored = await prisma.order.findUnique({ where: { id: order.id } });

  assert.equal(stored.userId, student.user.id);
  assert.notEqual(stored.userId, otherStudent.user.id);
});

test("two students checking out get separate orders", async () => {
  const shop = await createShop();
  const food = await createFood(shop.id, { stockQuantity: 10 });

  await addItem(food.id, 1);
  await addItem(food.id, 2, { token: otherStudent.accessToken });

  const mine = await (await checkout()).json();
  const theirs = await (await checkout({ token: otherStudent.accessToken })).json();

  assert.notEqual(mine.id, theirs.id);
  assert.equal(mine.totalMinor * 2, theirs.totalMinor);
  assert.equal(await orderCount(), 2);
});

// --- Idempotency ---------------------------------------------------------------------------------

test("the same key twice creates one order and replays it with 200", async () => {
  const { food } = await aCartWith({ stockQuantity: 10, quantity: 2 });
  const key = idempotencyKey();

  const first = await checkout({ key });
  const firstBody = await first.json();

  const second = await checkout({ key });
  const secondBody = await second.json();

  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.deepEqual(secondBody, firstBody, "the replay is identical to the original");
  assert.equal(await orderCount(), 1);
  assert.equal(await stockOf(food.id), 8, "stock moved once");
  assert.equal(await prisma.payment.count(), 1, "and there is one payment");
});

test("a replay returns the original order even though the cart has since been refilled", async () => {
  const { food } = await aCartWith({ stockQuantity: 10, quantity: 1 });
  const key = idempotencyKey();

  const original = await (await checkout({ key })).json();

  await addItem(food.id, 3);

  const replay = await checkout({ key });

  assert.equal(replay.status, 200);
  assert.deepEqual(await replay.json(), original);
  assert.equal(await orderCount(), 1);
  assert.equal(await stockOf(food.id), 9, "the replay moved no stock");

  const cart = await cartOf();

  assert.equal(cart.items[0].quantity, 3, "and left the new cart alone");
});

test("a different key from the same user creates a second order", async () => {
  const { food } = await aCartWith({ stockQuantity: 10, quantity: 1 });

  await checkout();
  await addItem(food.id, 1);
  await checkout();

  assert.equal(await orderCount(), 2);
  assert.equal(await stockOf(food.id), 8);
});

test("another user's key is a conflict that discloses nothing", async () => {
  const shop = await createShop();
  const food = await createFood(shop.id, { stockQuantity: 10 });
  const key = idempotencyKey();

  await addItem(food.id, 1);

  const mine = await (await checkout({ key })).json();

  await addItem(food.id, 1, { token: otherStudent.accessToken });

  const response = await checkout({ key, token: otherStudent.accessToken });
  const body = await response.json();

  assert.equal(response.status, 409);
  assert.equal(body.error.code, "IDEMPOTENCY_KEY_CONFLICT");

  const serialized = JSON.stringify(body);

  for (const secret of [mine.id, student.user.id, shop.id, String(mine.totalMinor), "PLACED"]) {
    assert.ok(!serialized.includes(secret), `the response must not carry ${secret}`);
  }

  assert.equal(await orderCount(), 1, "no order was created for the second user");
  assert.equal(await stockOf(food.id), 9, "and no stock moved for them");
  assert.equal(
    (await cartOf({ token: otherStudent.accessToken })).items.length,
    1,
    "their cart is untouched",
  );
});

test("a key freed by a failed checkout can be used again", async () => {
  const { food } = await aCartWith({ stockQuantity: 1, quantity: 5 });
  const key = idempotencyKey();

  assert.equal((await checkout({ key })).status, 409, "not enough stock");

  await prisma.food.update({ where: { id: food.id }, data: { stockQuantity: 10 } });

  const retry = await checkout({ key });

  assert.equal(retry.status, 201, "the same key is a fresh attempt, not a replay");
  assert.equal(await orderCount(), 1);
});

test("a key rejected for its format never reaches the database", async () => {
  await aCartWith();

  await checkout({ key: "too-short" });

  const retry = await checkout({ key: "too-short-but-now-long-enough" });

  assert.equal(retry.status, 201);
});

// --- Database constraints ------------------------------------------------------------------------

test("the database refuses a second order carrying a used idempotency key", async () => {
  await aCartWith();

  const order = await (await checkout()).json();
  const stored = await prisma.order.findUnique({ where: { id: order.id } });

  await assert.rejects(
    prisma.order.create({
      data: {
        userId: otherStudent.user.id,
        shopId: stored.shopId,
        status: "PLACED",
        totalMinor: 1,
        idempotencyKey: stored.idempotencyKey,
      },
    }),
    (error) => error.code === "P2002",
    "the global unique constraint is what makes the key an arbiter",
  );
});

test("the database refuses a second payment for one order", async () => {
  await aCartWith();

  const order = await (await checkout()).json();

  await assert.rejects(
    prisma.payment.create({
      data: { orderId: order.id, status: "SUCCEEDED", amountMinor: 1 },
    }),
    (error) => error.code === "P2002",
  );
});

// --- Concurrency ---------------------------------------------------------------------------------

test("two simultaneous requests with one key produce exactly one order", async () => {
  const { food } = await aCartWith({ stockQuantity: 10, quantity: 2 });
  const key = idempotencyKey();

  const [first, second] = await Promise.all([checkout({ key }), checkout({ key })]);
  const bodies = await Promise.all([first.json(), second.json()]);

  assert.deepEqual(
    [first.status, second.status].sort(),
    [200, 201],
    "one created it and one replayed it",
  );
  assert.deepEqual(bodies[0], bodies[1], "both received the same order");
  assert.equal(await orderCount(), 1);
  assert.equal(await prisma.orderItem.count(), 1);
  assert.equal(await prisma.payment.count(), 1);
  assert.equal(await stockOf(food.id), 8, "stock was deducted exactly once");
  assert.deepEqual((await cartOf()).items, [], "and the cart was cleared exactly once");
});

test("ten simultaneous buyers cannot oversell five units", async () => {
  // The mandatory concurrency scenario. Each buyer has their own cart, so the only contention is the
  // food row, and the conditional decrement is the whole of the protection.
  const shop = await createShop();
  const food = await createFood(shop.id, { stockQuantity: 5 });

  await Promise.all(
    crowd.map(({ accessToken }) => addItem(food.id, 1, { token: accessToken })),
  );

  const responses = await Promise.all(
    crowd.map(({ accessToken }) => checkout({ token: accessToken })),
  );
  const statuses = responses.map((response) => response.status);

  assert.equal(statuses.filter((status) => status === 201).length, 5, "exactly five succeed");
  assert.equal(statuses.filter((status) => status === 409).length, 5, "exactly five are refused");
  assert.ok(
    statuses.every((status) => status === 201 || status === 409),
    `unexpected statuses: ${statuses.join(", ")}`,
  );
  assert.equal(await stockOf(food.id), 0);
  assert.equal(await orderCount(), 5);
  assert.equal(await prisma.payment.count(), 5);
});

test("simultaneous checkouts over several shared foods do not deadlock", async () => {
  // Every checkout deducts in ascending food id, so eight buyers holding the same four foods acquire
  // those row locks in one sequence. In differing sequences PostgreSQL would break the cycle by
  // killing a transaction, which would surface here as a 500 rather than a 409.
  const shop = await createShop();
  const foods = await Promise.all(
    Array.from({ length: 4 }, () => createFood(shop.id, { stockQuantity: 8 })),
  );
  const buyers = crowd.slice(0, 8);

  await Promise.all(
    buyers.map(async ({ accessToken }) => {
      // Deliberately added in a different order per buyer, so nothing but the service's own sorting
      // decides the lock sequence.
      for (const food of [...foods].sort(() => Math.random() - 0.5)) {
        await addItem(food.id, 1, { token: accessToken });
      }
    }),
  );

  const responses = await Promise.all(
    buyers.map(({ accessToken }) => checkout({ token: accessToken })),
  );
  const statuses = responses.map((response) => response.status);

  assert.deepEqual([...new Set(statuses)], [201], `unexpected statuses: ${statuses.join(", ")}`);

  for (const food of foods) {
    assert.equal(await stockOf(food.id), 0);
  }
});

test("a checkout racing an administrator's stock change leaves stock consistent", async () => {
  const shop = await createShop();
  const food = await createFood(shop.id, { stockQuantity: 5 });

  await addItem(food.id, 2);

  const [checkoutResponse, adminResponse] = await Promise.all([
    checkout(),
    request("PATCH", `/shops/${shop.id}/foods/${food.id}/stock`, {
      token: admin.accessToken,
      body: { delta: -3 },
    }),
  ]);

  assert.equal(adminResponse.status, 200);
  assert.ok([201, 409].includes(checkoutResponse.status));

  const remaining = await stockOf(food.id);

  assert.ok(remaining >= 0, `stock went negative: ${remaining}`);
  assert.equal(remaining, checkoutResponse.status === 201 ? 0 : 2, "both writes are accounted for");
});

test("a checkout racing an addition to the same cart loses no line", async () => {
  // Adding an item writes the cart row, so it waits on the lock checkout holds. Whichever way the two
  // land, every line is either ordered or still in the cart — never neither.
  const shop = await createShop();
  const ordered = await createFood(shop.id, { stockQuantity: 10 });
  const late = await createFood(shop.id, { stockQuantity: 10 });

  await addItem(ordered.id, 1);

  const [checkoutResponse] = await Promise.all([checkout(), addItem(late.id, 1)]);

  assert.equal(checkoutResponse.status, 201);

  const order = await checkoutResponse.json();
  const cart = await cartOf();
  const seen = [...order.items.map((item) => item.foodId), ...cart.items.map((item) => item.foodId)];

  assert.ok(seen.includes(ordered.id), "the first line was ordered or is still held");
  assert.ok(seen.includes(late.id), "and so is the late one");
  assert.equal(new Set(seen).size, seen.length, "and neither was both ordered and kept");
});

test("a checkout racing a quantity change either orders what it read or refuses", async () => {
  // The one cart write that does not take the cart row lock, which is what the conditional delete is
  // there for. Either outcome is correct; what must never happen is an order for one quantity while a
  // line holding another is silently discarded.
  const shop = await createShop();

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await resetOrders();
    await resetCarts();

    const food = await createFood(shop.id, { priceMinor: 100, stockQuantity: 100 });

    await addItem(food.id, 2);

    const [checkoutResponse] = await Promise.all([
      checkout(),
      request("PATCH", `/cart/items/${food.id}`, { body: { quantity: 5 } }),
    ]);

    const cart = await cartOf();

    if (checkoutResponse.status === 201) {
      const order = await checkoutResponse.json();
      const quantity = order.items[0].quantity;

      assert.ok([2, 5].includes(quantity), `ordered an unread quantity: ${quantity}`);
      assert.equal(await stockOf(food.id), 100 - quantity, "stock matches what was ordered");
      assert.deepEqual(cart.items, [], "and the cart was cleared");
    } else {
      assert.equal(checkoutResponse.status, 409);
      assert.equal((await checkoutResponse.json()).error.code, "CART_MODIFIED");
      assert.equal(await orderCount(), 0, "nothing was created");
      assert.equal(await prisma.payment.count(), 0);
      assert.equal(await stockOf(food.id), 100, "and no stock moved");
      assert.equal(cart.items.length, 1, "the cart still holds its line");
    }
  }
});

test("a checkout racing a cart clear leaves nothing half-done", async () => {
  const shop = await createShop();
  const food = await createFood(shop.id, { stockQuantity: 10 });

  await addItem(food.id, 2);

  const [checkoutResponse, clearResponse] = await Promise.all([
    checkout(),
    request("DELETE", "/cart"),
  ]);

  assert.equal(clearResponse.status, 204);
  assert.ok([201, 409].includes(checkoutResponse.status));

  const orders = await orderCount();

  if (checkoutResponse.status === 201) {
    assert.equal(orders, 1);
    assert.equal(await prisma.payment.count(), 1);
    assert.equal(await stockOf(food.id), 8);
  } else {
    assert.equal(orders, 0);
    assert.equal(await prisma.payment.count(), 0);
    assert.equal(await stockOf(food.id), 10);
  }

  assert.deepEqual((await cartOf()).items, [], "either way the cart ends empty");
});

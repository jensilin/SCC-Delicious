require("../setup");

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { after, before, beforeEach, test } = require("node:test");

const { prisma } = require("../../src/config/prisma");
const { authorizationHeader, createSignedInUser } = require("../helpers/auth");
const { resetCarts } = require("../helpers/cart");
const { createFood, createShop, resetCatalogue } = require("../helpers/catalogue");
const { resetDatabase } = require("../helpers/database");
const { createOrder, idempotencyKey, resetOrders } = require("../helpers/order");
const { startTestServer, stopTestServer } = require("../helpers/server");

// The student half of order management: reading one's own orders, and cancelling one from PLACED.
// The administrative endpoints appear here only where a student's behaviour needs an order that has
// moved on — advancing to PREPARING is the only way to reach the status a student may not cancel
// from — and are covered in their own file.

let server;
let baseUrl;
let student;
let otherStudent;
let admin;

before(async () => {
  ({ server, baseUrl } = await startTestServer());

  await resetDatabase();

  student = await createSignedInUser(baseUrl, { role: "STUDENT" });
  otherStudent = await createSignedInUser(baseUrl, { role: "STUDENT" });
  admin = await createSignedInUser(baseUrl, { role: "ADMIN" });
});

// Orders first: a shop cannot be deleted while an order references it, so the catalogue reset would
// be refused while any survive. Carts before the catalogue, so lines go before their foods.
beforeEach(async () => {
  await resetOrders();
  await resetCarts();
  await resetCatalogue();
});

after(async () => {
  await stopTestServer(server);
  await prisma.$disconnect();
});

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

function addItem(foodId, quantity, options = {}) {
  return request("POST", "/cart/items", { ...options, body: { foodId, quantity } });
}

function cancel(orderId, options = {}) {
  return request("POST", `/orders/${orderId}/cancel`, options);
}

function setStatus(orderId, status) {
  return request("PATCH", `/admin/orders/${orderId}`, {
    token: admin.accessToken,
    body: { status },
  });
}

function stockOf(foodId) {
  return prisma.food
    .findUnique({ where: { id: foodId }, select: { stockQuantity: true } })
    .then((food) => food?.stockQuantity);
}

function statusOf(orderId) {
  return prisma.order
    .findUnique({ where: { id: orderId }, select: { status: true } })
    .then((order) => order?.status);
}

// A real order, placed the way a student places one, so the stock it consumed is the stock a
// cancellation has to return.
async function placeOrder({ quantity = 2, token, ...overrides } = {}) {
  const shop = await createShop();
  const food = await createFood(shop.id, overrides);
  const options = token === undefined ? {} : { token };

  await addItem(food.id, quantity, options);

  const response = await request("POST", "/orders", { ...options, key: idempotencyKey() });

  assert.equal(response.status, 201, "the arrangement needs a placed order");

  return { shop, food, order: await response.json() };
}

// Reached by the moves an administrator actually has, rather than by writing the column directly, so
// a status a student meets in these tests is one the API can really produce.
async function advanceTo(orderId, status) {
  const steps = {
    PREPARING: ["PREPARING"],
    READY: ["PREPARING", "READY"],
    COMPLETED: ["PREPARING", "READY", "COMPLETED"],
  };

  for (const step of steps[status]) {
    assert.equal((await setStatus(orderId, step)).status, 200, `could not advance to ${step}`);
  }
}

// --- Authentication and role ---------------------------------------------------------------------

test("reading orders requires a token", async () => {
  for (const response of [
    await request("GET", "/orders", { token: null }),
    await request("GET", `/orders/${crypto.randomUUID()}`, { token: null }),
    await cancel(crypto.randomUUID(), { token: null }),
  ]) {
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, "UNAUTHENTICATED");
  }
});

test("an ADMIN is refused on every student order route", async () => {
  // The role check is attached to the router, so it applies to the reads and the cancellation exactly
  // as it applies to checkout. An administrator works through /api/v1/admin/orders instead.
  const { order } = await placeOrder();

  for (const response of [
    await request("GET", "/orders", { token: admin.accessToken }),
    await request("GET", `/orders/${order.id}`, { token: admin.accessToken }),
    await cancel(order.id, { token: admin.accessToken }),
  ]) {
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, "FORBIDDEN");
  }

  assert.equal(await statusOf(order.id), "PLACED", "and nothing moved");
});

// --- Listing ------------------------------------------------------------------------------------

test("a student with no orders gets an empty array, not a 404", async () => {
  const response = await request("GET", "/orders");

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), []);
});

test("the list holds the caller's own orders and no one else's", async () => {
  const mine = await placeOrder();
  const theirs = await placeOrder({ token: otherStudent.accessToken });

  const list = await (await request("GET", "/orders")).json();

  assert.deepEqual(
    list.map((order) => order.id),
    [mine.order.id],
  );

  const theirList = await (
    await request("GET", "/orders", { token: otherStudent.accessToken })
  ).json();

  assert.deepEqual(
    theirList.map((order) => order.id),
    [theirs.order.id],
  );
});

test("the list is newest first by placedAt", async () => {
  const first = await placeOrder();
  const second = await placeOrder();
  const third = await placeOrder();

  const list = await (await request("GET", "/orders")).json();

  assert.deepEqual(
    list.map((order) => order.id),
    [third.order.id, second.order.id, first.order.id],
  );
});

test("the ordering follows placedAt itself, not the order rows were written in", async () => {
  const shop = await createShop();
  const [older, newer] = await Promise.all([
    createOrder({ userId: student.user.id, shopId: shop.id }),
    createOrder({ userId: student.user.id, shopId: shop.id }),
  ]);

  // The row written second is given the earlier timestamp, so insertion order and placedAt disagree.
  await prisma.order.update({
    where: { id: newer.id },
    data: { placedAt: new Date("2020-01-01T00:00:00.000Z") },
  });
  await prisma.order.update({
    where: { id: older.id },
    data: { placedAt: new Date("2030-01-01T00:00:00.000Z") },
  });

  const list = await (await request("GET", "/orders")).json();

  assert.deepEqual(
    list.map((order) => order.id),
    [older.id, newer.id],
  );
});

test("each entry in the list carries its full items", async () => {
  const shop = await createShop();
  const foods = await Promise.all([
    createFood(shop.id, { name: "Cake", priceMinor: 1000, stockQuantity: 10 }),
    createFood(shop.id, { name: "Aloo Roll", priceMinor: 450, stockQuantity: 10 }),
  ]);

  await addItem(foods[0].id, 1);
  await addItem(foods[1].id, 2);

  await request("POST", "/orders", { key: idempotencyKey() });

  const [order] = await (await request("GET", "/orders")).json();

  assert.equal(order.items.length, 2);
  assert.deepEqual(
    order.items.map((item) => item.name),
    ["Aloo Roll", "Cake"],
    "ordered by the name the order recorded, as checkout returns them",
  );
  assert.equal(order.totalMinor, 1000 + 900);
});

test("a listed order is identical to what checkout returned for it", async () => {
  const { order } = await placeOrder();

  const [listed] = await (await request("GET", "/orders")).json();

  assert.deepEqual(listed, order);
});

// --- Reading one order ---------------------------------------------------------------------------

test("a student reads their own order by id", async () => {
  const { order } = await placeOrder();

  const response = await request("GET", `/orders/${order.id}`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), order);
});

test("the read exposes exactly the settled fields, and no buyer identity", async () => {
  const { order } = await placeOrder();

  const read = await (await request("GET", `/orders/${order.id}`)).json();

  assert.deepEqual(Object.keys(read).sort(), [
    "id",
    "items",
    "placedAt",
    "shopId",
    "status",
    "totalMinor",
  ]);

  for (const field of ["userId", "buyerEmail", "idempotencyKey", "createdAt", "updatedAt", "user"]) {
    assert.equal(read[field], undefined, `${field} must not be exposed to a student`);
  }
});

test("another student's order is a 404, not a 403", async () => {
  // Answering "forbidden" would confirm that the order exists. The query is scoped to the caller, so
  // the row is never read at all.
  const { order } = await placeOrder({ token: otherStudent.accessToken });

  const response = await request("GET", `/orders/${order.id}`);
  const body = await response.json();

  assert.equal(response.status, 404);
  assert.equal(body.error.code, "NOT_FOUND");
  assert.ok(!JSON.stringify(body).includes(otherStudent.user.email));
});

test("an order id that exists nowhere is the same 404", async () => {
  const response = await request("GET", `/orders/${crypto.randomUUID()}`);

  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, "NOT_FOUND");
});

test("a malformed order id is a validation failure naming the parameter", async () => {
  const response = await request("GET", "/orders/not-a-uuid");
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.error.code, "VALIDATION_ERROR");
  assert.deepEqual(
    body.error.details.map((detail) => detail.field),
    ["orderId"],
  );
});

// --- Cancellation ------------------------------------------------------------------------------

test("a student cancels their own PLACED order and receives it back", async () => {
  const { order } = await placeOrder();

  const response = await cancel(order.id);
  const cancelled = await response.json();

  assert.equal(response.status, 200);
  assert.equal(cancelled.status, "CANCELLED");
  assert.deepEqual({ ...cancelled, status: "PLACED" }, order, "the same shape, one field changed");
  assert.equal(await statusOf(order.id), "CANCELLED");
});

test("cancellation returns exactly the stock the order took", async () => {
  const { food, order } = await placeOrder({ stockQuantity: 10, quantity: 3 });

  assert.equal(await stockOf(food.id), 7, "checkout consumed it");

  await cancel(order.id);

  assert.equal(await stockOf(food.id), 10);
});

test("cancellation restores every line of a multi-item order", async () => {
  const shop = await createShop();
  const first = await createFood(shop.id, { stockQuantity: 10 });
  const second = await createFood(shop.id, { stockQuantity: 8 });

  await addItem(first.id, 2);
  await addItem(second.id, 5);

  const order = await (await request("POST", "/orders", { key: idempotencyKey() })).json();

  assert.equal(await stockOf(first.id), 8);
  assert.equal(await stockOf(second.id), 3);

  await cancel(order.id);

  assert.equal(await stockOf(first.id), 10);
  assert.equal(await stockOf(second.id), 8);
});

test("cancelling twice is refused the second time and restores stock once", async () => {
  const { food, order } = await placeOrder({ stockQuantity: 10, quantity: 4 });

  assert.equal((await cancel(order.id)).status, 200);

  const second = await cancel(order.id);

  assert.equal(second.status, 409);
  assert.equal((await second.json()).error.code, "ORDER_STATUS_CONFLICT");
  assert.equal(await stockOf(food.id), 10, "the stock came back exactly once");
});

test("a repeated cancellation is a conflict rather than a silent replay, with or without a key", async () => {
  // Status changes take no idempotency key: a repeat cannot create anything, so the honest answer is
  // that the move is no longer available. A key on the request is not part of this endpoint's
  // contract and changes nothing.
  const { order } = await placeOrder();

  assert.equal((await cancel(order.id)).status, 200);

  const repeat = await cancel(order.id, { key: idempotencyKey() });

  assert.equal(repeat.status, 409);
  assert.equal((await repeat.json()).error.code, "ORDER_STATUS_CONFLICT");
});

test("a student may not cancel an order that is being prepared", async () => {
  const { food, order } = await placeOrder({ stockQuantity: 10, quantity: 3 });

  await advanceTo(order.id, "PREPARING");

  const response = await cancel(order.id);

  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, "ORDER_STATUS_CONFLICT");
  assert.equal(await statusOf(order.id), "PREPARING", "the order did not move");
  assert.equal(await stockOf(food.id), 7, "and no stock came back");
});

test("a student may not cancel from READY, COMPLETED, or CANCELLED either", async () => {
  for (const status of ["READY", "COMPLETED", "CANCELLED"]) {
    await resetOrders();
    await resetCarts();
    await resetCatalogue();

    const { food, order } = await placeOrder({ stockQuantity: 10, quantity: 2 });

    if (status === "CANCELLED") {
      await cancel(order.id);
    } else {
      await advanceTo(order.id, status);
    }

    const expectedStock = status === "CANCELLED" ? 10 : 8;
    const response = await cancel(order.id);

    assert.equal(response.status, 409, `cancelling from ${status} must be refused`);
    assert.equal((await response.json()).error.code, "ORDER_STATUS_CONFLICT");
    assert.equal(await statusOf(order.id), status);
    assert.equal(await stockOf(food.id), expectedStock, `stock moved while cancelling ${status}`);
  }
});

test("cancelling another student's order is a 404 and leaves it untouched", async () => {
  const { food, order } = await placeOrder({
    token: otherStudent.accessToken,
    stockQuantity: 10,
    quantity: 3,
  });

  const response = await cancel(order.id);

  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, "NOT_FOUND");
  assert.equal(await statusOf(order.id), "PLACED");
  assert.equal(await stockOf(food.id), 7, "and their stock stayed consumed");
});

test("cancelling an order that exists nowhere is a 404, and a malformed id a 400", async () => {
  const missing = await cancel(crypto.randomUUID());

  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error.code, "NOT_FOUND");

  const malformed = await cancel("not-a-uuid");

  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error.code, "VALIDATION_ERROR");
});

test("a cancelled order keeps its payment row", async () => {
  // No refund exists in v1: PaymentStatus permits only SUCCEEDED, so the payment stands and is
  // deliberately left alone rather than deleted or rewritten.
  const { order } = await placeOrder({ priceMinor: 1200, quantity: 2 });

  await cancel(order.id);

  const payment = await prisma.payment.findUnique({ where: { orderId: order.id } });

  assert.equal(payment.status, "SUCCEEDED");
  assert.equal(payment.amountMinor, 2400);
});

test("a cancelled order keeps its items and its shop", async () => {
  const { shop, food, order } = await placeOrder({ name: "Chicken Roll", priceMinor: 450 });

  await cancel(order.id);

  const stored = await prisma.order.findUnique({
    where: { id: order.id },
    include: { items: true },
  });

  assert.equal(stored.shopId, shop.id);
  assert.equal(stored.items.length, 1);
  assert.equal(stored.items[0].foodId, food.id);
  assert.equal(stored.items[0].foodNameSnapshot, "Chicken Roll");
  assert.equal(stored.items[0].unitPriceMinorSnapshot, 450);
});

test("a cancelled order still prevents its shop from being deleted", async () => {
  const { shop, order } = await placeOrder();

  await cancel(order.id);

  const response = await request("DELETE", `/shops/${shop.id}`, { token: admin.accessToken });

  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, "SHOP_HAS_ORDERS");
});

test("a line whose food was deleted is skipped and the cancellation still succeeds", async () => {
  const shop = await createShop();
  const staying = await createFood(shop.id, { stockQuantity: 10 });
  const going = await createFood(shop.id, { stockQuantity: 10 });

  await addItem(staying.id, 2);
  await addItem(going.id, 3);

  const order = await (await request("POST", "/orders", { key: idempotencyKey() })).json();

  await prisma.food.delete({ where: { id: going.id } });

  const response = await cancel(order.id);

  assert.equal(response.status, 200, "refusing would trap the order in PLACED forever");
  assert.equal(await statusOf(order.id), "CANCELLED");
  assert.equal(await stockOf(staying.id), 10, "the surviving line was restored");

  const items = await prisma.orderItem.findMany({ where: { orderId: order.id } });
  const orphan = items.find((item) => item.foodId === null);

  assert.equal(items.length, 2);
  assert.equal(orphan.quantity, 3, "and the skipped line keeps its snapshot");
});

test("an order every one of whose foods is gone still cancels", async () => {
  const { food, order } = await placeOrder({ quantity: 2 });

  await prisma.food.delete({ where: { id: food.id } });

  const response = await cancel(order.id);

  assert.equal(response.status, 200);
  assert.equal(await statusOf(order.id), "CANCELLED");
  assert.equal((await response.json()).items[0].foodId, null);
});

// --- Concurrency ---------------------------------------------------------------------------------

test("two simultaneous cancellations restore stock exactly once", async () => {
  // The conditional update is the whole of the protection: the loser matches no row, because the
  // winner already moved the status out of PLACED, and its transaction ends before any stock moves.
  const { food, order } = await placeOrder({ stockQuantity: 10, quantity: 3 });

  const [first, second] = await Promise.all([cancel(order.id), cancel(order.id)]);
  const statuses = [first.status, second.status].sort();

  assert.deepEqual(statuses, [200, 409]);

  const refused = first.status === 409 ? first : second;

  assert.equal((await refused.json()).error.code, "ORDER_STATUS_CONFLICT");
  assert.equal(await stockOf(food.id), 10, "restored once, not twice");
  assert.equal(await statusOf(order.id), "CANCELLED");
});

test("many simultaneous cancellations of one order still restore stock once", async () => {
  const { food, order } = await placeOrder({ stockQuantity: 20, quantity: 5 });

  const responses = await Promise.all(Array.from({ length: 6 }, () => cancel(order.id)));
  const statuses = responses.map((response) => response.status);

  assert.equal(statuses.filter((status) => status === 200).length, 1, "exactly one succeeds");
  assert.equal(statuses.filter((status) => status === 409).length, 5);
  assert.equal(await stockOf(food.id), 20);
});

test("a cancellation racing a checkout for the same food keeps stock exact", async () => {
  const shop = await createShop();
  const food = await createFood(shop.id, { stockQuantity: 10 });

  await addItem(food.id, 4);

  const placed = await (await request("POST", "/orders", { key: idempotencyKey() })).json();

  assert.equal(await stockOf(food.id), 6);

  // The other student buys three while the first cancels four. Both movements go through the one
  // conditional update, in the same ascending food id order, so neither is lost and neither deadlocks.
  await addItem(food.id, 3, { token: otherStudent.accessToken });

  const [cancellation, checkout] = await Promise.all([
    cancel(placed.id),
    request("POST", "/orders", { token: otherStudent.accessToken, key: idempotencyKey() }),
  ]);

  assert.equal(cancellation.status, 200);
  assert.equal(checkout.status, 201);
  assert.equal(await stockOf(food.id), 7, "6 + 4 restored - 3 sold");
});

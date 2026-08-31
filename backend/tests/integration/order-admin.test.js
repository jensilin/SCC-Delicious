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

// The administrative half of order management: reading every order, advancing one a step at a time,
// and cancelling one before it is completed.

// The largest value the stock column can hold. Used to force a restore to fail, which is the only
// realistic way to make a cancellation fail after it has already begun moving stock.
const MAX_INT32 = 2_147_483_647;

const EVERY_STATUS = ["PLACED", "PREPARING", "READY", "COMPLETED", "CANCELLED"];

// The settled transition table, written out independently of the service so that the test asserts
// the design rather than the implementation's own idea of it.
const LEGAL = new Set([
  "PLACED->PREPARING",
  "PREPARING->READY",
  "READY->COMPLETED",
  "PLACED->CANCELLED",
  "PREPARING->CANCELLED",
  "READY->CANCELLED",
]);

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

beforeEach(async () => {
  await resetOrders();
  await resetCarts();
  await resetCatalogue();
});

after(async () => {
  await stopTestServer(server);
  await prisma.$disconnect();
});

function request(method, path, { token = admin.accessToken, body, key } = {}) {
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

function setStatus(orderId, status, options = {}) {
  return request("PATCH", `/admin/orders/${orderId}`, { ...options, body: { status } });
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

// An order sitting in a chosen status, arranged directly. That the API can really reach each of these
// is what the advancement tests below prove; this is only the starting position for a refusal.
async function anOrderIn(status, { userId = student.user.id } = {}) {
  const shop = await createShop();
  const food = await createFood(shop.id);
  const order = await createOrder({ userId, shopId: shop.id, food, quantity: 1 });

  if (status === "PLACED") {
    return order;
  }

  return prisma.order.update({ where: { id: order.id }, data: { status } });
}

// A real order placed by a student, so the stock it consumed is the stock a cancellation must return.
async function placedByStudent({ quantity = 2, token = student.accessToken, ...overrides } = {}) {
  const shop = await createShop();
  const food = await createFood(shop.id, overrides);

  await request("POST", "/cart/items", { token, body: { foodId: food.id, quantity } });

  const response = await request("POST", "/orders", { token, key: idempotencyKey() });

  assert.equal(response.status, 201, "the arrangement needs a placed order");

  return { shop, food, order: await response.json() };
}

// --- Authentication and role ---------------------------------------------------------------------

test("every administrative order route requires a token", async () => {
  for (const response of [
    await request("GET", "/admin/orders", { token: null }),
    await request("GET", `/admin/orders/${crypto.randomUUID()}`, { token: null }),
    await setStatus(crypto.randomUUID(), "PREPARING", { token: null }),
  ]) {
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, "UNAUTHENTICATED");
  }
});

test("a STUDENT is refused on every administrative order route", async () => {
  const order = await anOrderIn("PLACED");

  for (const response of [
    await request("GET", "/admin/orders", { token: student.accessToken }),
    await request("GET", `/admin/orders/${order.id}`, { token: student.accessToken }),
    await setStatus(order.id, "PREPARING", { token: student.accessToken }),
  ]) {
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, "FORBIDDEN");
  }

  assert.equal(await statusOf(order.id), "PLACED", "and nothing moved");
});

test("the role check runs before the order is even looked for", async () => {
  // Attached to the router, so a student probing a real order id and a made-up one get the same
  // answer, and neither tells them whether the order exists.
  const response = await setStatus(crypto.randomUUID(), "PREPARING", {
    token: student.accessToken,
  });

  assert.equal(response.status, 403);
});

test("nothing else lives under /api/v1/admin", async () => {
  const response = await request("GET", "/admin/shops");

  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, "NOT_FOUND");
});

// --- Listing every order -------------------------------------------------------------------------

test("an administrator sees every buyer's orders", async () => {
  const mine = await placedByStudent();
  const theirs = await placedByStudent({ token: otherStudent.accessToken });

  const response = await request("GET", "/admin/orders");
  const list = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(
    list.map((order) => order.id).sort(),
    [mine.order.id, theirs.order.id].sort(),
  );
});

test("the list is empty rather than absent when there are no orders", async () => {
  assert.deepEqual(await (await request("GET", "/admin/orders")).json(), []);
});

test("each order carries the buyer's email", async () => {
  await placedByStudent();
  await placedByStudent({ token: otherStudent.accessToken });

  const list = await (await request("GET", "/admin/orders")).json();

  assert.deepEqual(
    list.map((order) => order.buyerEmail).sort(),
    [student.user.email, otherStudent.user.email].sort(),
  );
});

test("the administrative shape is the student shape plus the buyer's email", async () => {
  const { order } = await placedByStudent();

  const read = await (await request("GET", `/admin/orders/${order.id}`)).json();

  assert.deepEqual(Object.keys(read).sort(), [
    "buyerEmail",
    "id",
    "items",
    "placedAt",
    "shopId",
    "status",
    "totalMinor",
  ]);
  assert.deepEqual({ ...read, buyerEmail: undefined }, { ...order, buyerEmail: undefined });

  for (const field of ["userId", "idempotencyKey", "createdAt", "updatedAt", "user", "payment"]) {
    assert.equal(read[field], undefined, `${field} must not be exposed`);
  }
});

test("the list is newest first by placedAt and carries full items", async () => {
  const first = await placedByStudent({ quantity: 1 });
  const second = await placedByStudent({ quantity: 3 });

  const list = await (await request("GET", "/admin/orders")).json();

  assert.deepEqual(
    list.map((order) => order.id),
    [second.order.id, first.order.id],
  );
  assert.equal(list[0].items.length, 1);
  assert.equal(list[0].items[0].quantity, 3);
  assert.deepEqual(Object.keys(list[0].items[0]).sort(), [
    "foodId",
    "lineTotalMinor",
    "name",
    "priceMinor",
    "quantity",
  ]);
});

test("an administrator reads an order belonging to any student", async () => {
  const { order } = await placedByStudent({ token: otherStudent.accessToken });

  const response = await request("GET", `/admin/orders/${order.id}`);
  const read = await response.json();

  assert.equal(response.status, 200);
  assert.equal(read.id, order.id);
  assert.equal(read.buyerEmail, otherStudent.user.email);
});

test("an unknown order is a 404 and a malformed id a 400", async () => {
  const missing = await request("GET", `/admin/orders/${crypto.randomUUID()}`);

  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error.code, "NOT_FOUND");

  const malformed = await request("GET", "/admin/orders/not-a-uuid");
  const body = await malformed.json();

  assert.equal(malformed.status, 400);
  assert.deepEqual(
    body.error.details.map((detail) => detail.field),
    ["orderId"],
  );
});

// --- The body of a status change -----------------------------------------------------------------

test("a status outside the enum is a validation failure", async () => {
  const order = await anOrderIn("PLACED");

  for (const status of ["banana", "placed", "preparing", "", null, 42]) {
    const response = await setStatus(order.id, status);
    const body = await response.json();

    assert.equal(response.status, 400, `expected ${JSON.stringify(status)} to be refused`);
    assert.equal(body.error.code, "VALIDATION_ERROR");
    assert.deepEqual(
      body.error.details.map((detail) => detail.field),
      ["status"],
    );
  }

  assert.equal(await statusOf(order.id), "PLACED");
});

test("a body with no status at all is a validation failure", async () => {
  const order = await anOrderIn("PLACED");

  const response = await request("PATCH", `/admin/orders/${order.id}`, { body: {} });

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "VALIDATION_ERROR");
});

test("anything else in the body is discarded rather than acted on", async () => {
  const { order } = await placedByStudent({ priceMinor: 500, quantity: 2 });

  const updated = await (
    await request("PATCH", `/admin/orders/${order.id}`, {
      body: { status: "PREPARING", totalMinor: 1, userId: otherStudent.user.id, items: [] },
    })
  ).json();

  assert.equal(updated.status, "PREPARING");
  assert.equal(updated.totalMinor, 1000);
  assert.equal(updated.buyerEmail, student.user.email);
  assert.equal(updated.items.length, 1);
});

// --- Advancement ---------------------------------------------------------------------------------

test("an order advances PLACED, PREPARING, READY, COMPLETED one step at a time", async () => {
  const { food, order } = await placedByStudent({ stockQuantity: 10, quantity: 3 });

  for (const status of ["PREPARING", "READY", "COMPLETED"]) {
    const response = await setStatus(order.id, status);
    const updated = await response.json();

    assert.equal(response.status, 200);
    assert.equal(updated.status, status);
    assert.equal(updated.id, order.id);
    assert.equal(updated.buyerEmail, student.user.email);
    assert.equal(await statusOf(order.id), status);
  }

  assert.equal(await stockOf(food.id), 7, "advancing an order moves no stock");
});

test("a successful advance returns the order in the same shape a read returns", async () => {
  const { order } = await placedByStudent();

  const updated = await (await setStatus(order.id, "PREPARING")).json();
  const read = await (await request("GET", `/admin/orders/${order.id}`)).json();

  assert.deepEqual(updated, read);
});

test("statuses cannot be skipped", async () => {
  const order = await anOrderIn("PLACED");

  for (const status of ["READY", "COMPLETED"]) {
    const response = await setStatus(order.id, status);

    assert.equal(response.status, 409, `PLACED must not jump to ${status}`);
    assert.equal((await response.json()).error.code, "ORDER_STATUS_CONFLICT");
    assert.equal(await statusOf(order.id), "PLACED");
  }
});

test("an order can never be moved back to PLACED", async () => {
  // PLACED is a status only checkout can produce, so it appears in the table as no move's target.
  for (const from of ["PLACED", "PREPARING", "READY"]) {
    const order = await anOrderIn(from);
    const response = await setStatus(order.id, "PLACED");

    assert.equal(response.status, 409, `${from} must not be moved back to PLACED`);
    assert.equal((await response.json()).error.code, "ORDER_STATUS_CONFLICT");
    assert.equal(await statusOf(order.id), from);
  }
});

test("every move the transition table does not permit is refused", async () => {
  for (const from of EVERY_STATUS) {
    for (const to of EVERY_STATUS) {
      if (LEGAL.has(`${from}->${to}`)) {
        continue;
      }

      const order = await anOrderIn(from);
      const response = await setStatus(order.id, to);

      assert.equal(response.status, 409, `${from} -> ${to} must be refused`);
      assert.equal((await response.json()).error.code, "ORDER_STATUS_CONFLICT");
      assert.equal(await statusOf(order.id), from, `${from} -> ${to} moved the order`);
    }
  }
});

test("every move the transition table permits is accepted", async () => {
  for (const move of LEGAL) {
    const [from, to] = move.split("->");
    const order = await anOrderIn(from);
    const response = await setStatus(order.id, to);

    assert.equal(response.status, 200, `${from} -> ${to} must be permitted`);
    assert.equal((await response.json()).status, to);
    assert.equal(await statusOf(order.id), to);
  }
});

test("COMPLETED and CANCELLED are terminal", async () => {
  for (const terminal of ["COMPLETED", "CANCELLED"]) {
    for (const to of EVERY_STATUS) {
      const order = await anOrderIn(terminal);
      const response = await setStatus(order.id, to);

      assert.equal(response.status, 409, `${terminal} must not move to ${to}`);
      assert.equal(await statusOf(order.id), terminal);
    }
  }
});

test("advancing an order that exists nowhere is a 404, whatever status is asked for", async () => {
  for (const status of ["PREPARING", "CANCELLED", "PLACED"]) {
    const response = await setStatus(crypto.randomUUID(), status);

    assert.equal(response.status, 404, `expected a 404 when asking for ${status}`);
    assert.equal((await response.json()).error.code, "NOT_FOUND");
  }
});

// --- Administrative cancellation -----------------------------------------------------------------

test("an administrator cancels from PLACED, PREPARING, and READY, restoring stock each time", async () => {
  for (const from of ["PLACED", "PREPARING", "READY"]) {
    await resetOrders();
    await resetCarts();
    await resetCatalogue();

    const { food, order } = await placedByStudent({ stockQuantity: 10, quantity: 4 });

    if (from === "PREPARING") {
      await setStatus(order.id, "PREPARING");
    } else if (from === "READY") {
      await setStatus(order.id, "PREPARING");
      await setStatus(order.id, "READY");
    }

    assert.equal(await stockOf(food.id), 6, "checkout consumed it");

    const response = await setStatus(order.id, "CANCELLED");
    const cancelled = await response.json();

    assert.equal(response.status, 200, `cancelling from ${from} must be permitted`);
    assert.equal(cancelled.status, "CANCELLED");
    assert.equal(cancelled.buyerEmail, student.user.email);
    assert.equal(await stockOf(food.id), 10, `stock was not restored from ${from}`);
  }
});

test("a completed order cannot be cancelled, so consumed stock is never returned", async () => {
  const { food, order } = await placedByStudent({ stockQuantity: 10, quantity: 3 });

  await setStatus(order.id, "PREPARING");
  await setStatus(order.id, "READY");
  await setStatus(order.id, "COMPLETED");

  const response = await setStatus(order.id, "CANCELLED");

  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, "ORDER_STATUS_CONFLICT");
  assert.equal(await statusOf(order.id), "COMPLETED");
  assert.equal(await stockOf(food.id), 7, "the stock stays consumed");
});

test("an administrative cancellation leaves the payment row alone", async () => {
  const { order } = await placedByStudent({ priceMinor: 900, quantity: 2 });

  await setStatus(order.id, "CANCELLED");

  const payment = await prisma.payment.findUnique({ where: { orderId: order.id } });

  assert.equal(payment.status, "SUCCEEDED");
  assert.equal(payment.amountMinor, 1800);
});

test("an administrator cancelling a deleted food's order skips that line", async () => {
  const shop = await createShop();
  const staying = await createFood(shop.id, { stockQuantity: 10 });
  const going = await createFood(shop.id, { stockQuantity: 10 });

  await request("POST", "/cart/items", {
    token: student.accessToken,
    body: { foodId: staying.id, quantity: 2 },
  });
  await request("POST", "/cart/items", {
    token: student.accessToken,
    body: { foodId: going.id, quantity: 4 },
  });

  const order = await (
    await request("POST", "/orders", { token: student.accessToken, key: idempotencyKey() })
  ).json();

  await prisma.food.delete({ where: { id: going.id } });

  const response = await setStatus(order.id, "CANCELLED");

  assert.equal(response.status, 200);
  assert.equal(await stockOf(staying.id), 10);
  assert.equal(await statusOf(order.id), "CANCELLED");
});

test("a cancelled order still prevents its shop from being deleted", async () => {
  const { shop, order } = await placedByStudent();

  await setStatus(order.id, "CANCELLED");

  const response = await request("DELETE", `/shops/${shop.id}`);

  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, "SHOP_HAS_ORDERS");
});

// --- Concurrency ---------------------------------------------------------------------------------

test("two simultaneous advances to the same status: one wins", async () => {
  const order = await anOrderIn("PLACED");

  const [first, second] = await Promise.all([
    setStatus(order.id, "PREPARING"),
    setStatus(order.id, "PREPARING"),
  ]);

  assert.deepEqual([first.status, second.status].sort(), [200, 409]);
  assert.equal(await statusOf(order.id), "PREPARING");
});

test("two simultaneous administrative cancellations restore stock exactly once", async () => {
  const { food, order } = await placedByStudent({ stockQuantity: 10, quantity: 3 });

  const [first, second] = await Promise.all([
    setStatus(order.id, "CANCELLED"),
    setStatus(order.id, "CANCELLED"),
  ]);

  assert.deepEqual([first.status, second.status].sort(), [200, 409]);
  assert.equal(await stockOf(food.id), 10);
});

test("a student cancellation racing an advance to PREPARING leaves one consistent outcome", async () => {
  // Both are conditional updates on the same row and both name PLACED as the predecessor, so exactly
  // one can match. Whichever lands, the status and the stock must agree with it.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await resetOrders();
    await resetCarts();
    await resetCatalogue();

    const { food, order } = await placedByStudent({ stockQuantity: 10, quantity: 2 });

    const [cancellation, advance] = await Promise.all([
      request("POST", `/orders/${order.id}/cancel`, { token: student.accessToken }),
      setStatus(order.id, "PREPARING"),
    ]);

    assert.deepEqual(
      [cancellation.status, advance.status].sort(),
      [200, 409],
      "exactly one of the two moves may land",
    );

    const status = await statusOf(order.id);
    const stock = await stockOf(food.id);

    if (cancellation.status === 200) {
      assert.equal(status, "CANCELLED");
      assert.equal(stock, 10, "the cancellation that won returned the stock");
    } else {
      assert.equal(status, "PREPARING");
      assert.equal(stock, 8, "the advance that won left it consumed");
    }
  }
});

test("a cancellation racing a checkout for the same food leaves stock exact", async () => {
  const shop = await createShop();
  const food = await createFood(shop.id, { stockQuantity: 10 });

  await request("POST", "/cart/items", {
    token: student.accessToken,
    body: { foodId: food.id, quantity: 5 },
  });

  const order = await (
    await request("POST", "/orders", { token: student.accessToken, key: idempotencyKey() })
  ).json();

  assert.equal(await stockOf(food.id), 5);

  await request("POST", "/cart/items", {
    token: otherStudent.accessToken,
    body: { foodId: food.id, quantity: 4 },
  });

  const [cancellation, checkout] = await Promise.all([
    setStatus(order.id, "CANCELLED"),
    request("POST", "/orders", { token: otherStudent.accessToken, key: idempotencyKey() }),
  ]);

  assert.equal(cancellation.status, 200);
  assert.equal(checkout.status, 201);

  const remaining = await stockOf(food.id);

  assert.ok(remaining >= 0, `stock went negative: ${remaining}`);
  assert.equal(remaining, 6, "5 + 5 restored - 4 sold");
});

test("cancellations of several orders sharing foods do not deadlock", async () => {
  // Every restore moves stock in ascending food id, the same sequence checkout consumes in, so four
  // simultaneous cancellations over the same three foods cannot hold what each other needs next.
  const shop = await createShop();
  const foods = await Promise.all(
    Array.from({ length: 3 }, () => createFood(shop.id, { stockQuantity: 100 })),
  );
  const buyers = [student, otherStudent];
  const orders = [];

  for (const buyer of buyers) {
    for (let round = 0; round < 2; round += 1) {
      for (const food of [...foods].sort(() => Math.random() - 0.5)) {
        await request("POST", "/cart/items", {
          token: buyer.accessToken,
          body: { foodId: food.id, quantity: 2 },
        });
      }

      const response = await request("POST", "/orders", {
        token: buyer.accessToken,
        key: idempotencyKey(),
      });

      orders.push(await response.json());
    }
  }

  for (const food of foods) {
    assert.equal(await stockOf(food.id), 92, "four orders took two of each");
  }

  const responses = await Promise.all(orders.map((order) => setStatus(order.id, "CANCELLED")));
  const statuses = responses.map((response) => response.status);

  assert.deepEqual([...new Set(statuses)], [200], `unexpected statuses: ${statuses.join(", ")}`);

  for (const food of foods) {
    assert.equal(await stockOf(food.id), 100, "and every unit came back");
  }
});

// --- Rollback ------------------------------------------------------------------------------------

test("a restore that fails rolls the whole cancellation back", async () => {
  // The mandatory scenario, forced by a real failure rather than a stub: the second food's quantity is
  // put one restore away from overflowing its column, so the database refuses that statement after the
  // first food has already been restored inside the transaction. Nothing may survive it — not the
  // status change, and not the restore that had already been applied.
  const shop = await createShop();
  const created = await Promise.all([
    createFood(shop.id, { stockQuantity: 10 }),
    createFood(shop.id, { stockQuantity: 10 }),
  ]);
  const [firstRestored, lastRestored] = [...created].sort((left, right) =>
    left.id.localeCompare(right.id),
  );

  for (const food of created) {
    await request("POST", "/cart/items", {
      token: student.accessToken,
      body: { foodId: food.id, quantity: 2 },
    });
  }

  const order = await (
    await request("POST", "/orders", { token: student.accessToken, key: idempotencyKey() })
  ).json();

  assert.equal(await stockOf(firstRestored.id), 8);
  assert.equal(await stockOf(lastRestored.id), 8);

  // Only reachable by writing the column directly: the stock endpoint refuses a delta this large, and
  // no ordinary sequence of requests can leave a food with no headroom.
  await prisma.food.update({
    where: { id: lastRestored.id },
    data: { stockQuantity: MAX_INT32 },
  });

  const response = await setStatus(order.id, "CANCELLED");

  // A database refusing its own column's range is a fault rather than a client error, so it is a 500
  // carrying the generic message every 5xx carries. What matters is what the database is left holding.
  assert.equal(response.status, 500);
  assert.equal((await response.json()).error.message, "Internal server error");

  assert.equal(await statusOf(order.id), "PLACED", "the status change was rolled back");
  assert.equal(
    await stockOf(firstRestored.id),
    8,
    "and so was the restore that had already been applied",
  );
  assert.equal(await stockOf(lastRestored.id), MAX_INT32);
  assert.equal(await prisma.payment.count(), 1, "the payment is untouched either way");
});

test("an order left in PLACED by a failed cancellation can still be cancelled afterwards", async () => {
  const { food, order } = await placedByStudent({ stockQuantity: 10, quantity: 2 });

  await prisma.food.update({ where: { id: food.id }, data: { stockQuantity: MAX_INT32 } });

  assert.equal((await setStatus(order.id, "CANCELLED")).status, 500);

  await prisma.food.update({ where: { id: food.id }, data: { stockQuantity: 8 } });

  const retry = await setStatus(order.id, "CANCELLED");

  assert.equal(retry.status, 200, "the failure left nothing behind that blocks a retry");
  assert.equal(await stockOf(food.id), 10);
});

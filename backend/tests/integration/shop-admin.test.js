require("../setup");

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { after, before, beforeEach, test } = require("node:test");

const { prisma } = require("../../src/config/prisma");
const { authorizationHeader, createSignedInUser } = require("../helpers/auth");
const { resetCarts } = require("../helpers/cart");
const { createFood, createShop, resetCatalogue } = require("../helpers/catalogue");
const { resetDatabase } = require("../helpers/database");
const { createOrder, resetOrders } = require("../helpers/order");
const { startTestServer, stopTestServer } = require("../helpers/server");

let server;
let baseUrl;
let student;
let admin;

before(async () => {
  ({ server, baseUrl } = await startTestServer());

  await resetDatabase();

  student = await createSignedInUser(baseUrl, { role: "STUDENT" });
  admin = await createSignedInUser(baseUrl, { role: "ADMIN" });
});

// Orders first: nothing cascades to them, so a shop cannot be removed while one still points at it.
beforeEach(async () => {
  await resetOrders();
  await resetCarts();
  await resetCatalogue();
});

after(async () => {
  await stopTestServer(server);
  await prisma.$disconnect();
});

function request(method, path, { token = admin.accessToken, body } = {}) {
  return fetch(`${baseUrl}/api/v1${path}`, {
    method,
    headers: {
      ...(token === null ? {} : authorizationHeader(token)),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

// Every write endpoint, with a body where one is required, for the authorization sweeps.
async function writeRoutes() {
  const shop = await createShop();
  const food = await createFood(shop.id);

  return [
    ["POST", "/shops", { name: "New" }],
    ["PATCH", `/shops/${shop.id}`, { name: "Renamed" }],
    ["DELETE", `/shops/${shop.id}`, undefined],
    ["POST", `/shops/${shop.id}/foods`, { name: "New", priceMinor: 1, stockQuantity: 1 }],
    ["PATCH", `/shops/${shop.id}/foods/${food.id}`, { name: "Renamed" }],
    ["DELETE", `/shops/${shop.id}/foods/${food.id}`, undefined],
    ["PATCH", `/shops/${shop.id}/foods/${food.id}/stock`, { delta: 1 }],
  ];
}

async function stockOf(foodId) {
  return (await prisma.food.findUnique({ where: { id: foodId } })).stockQuantity;
}

// --- Authorization -------------------------------------------------------------------------------

test("every administrative route rejects an unauthenticated caller", async () => {
  for (const [method, path, body] of await writeRoutes()) {
    const response = await request(method, path, { token: null, body });

    assert.equal(response.status, 401, `${method} ${path} must require a token`);
    assert.equal((await response.json()).error.code, "UNAUTHENTICATED");
  }
});

test("every administrative route rejects a STUDENT", async () => {
  for (const [method, path, body] of await writeRoutes()) {
    const response = await request(method, path, { token: student.accessToken, body });

    assert.equal(response.status, 403, `${method} ${path} must require ADMIN`);
    assert.equal((await response.json()).error.code, "FORBIDDEN");
  }
});

test("a STUDENT cannot change stock", async () => {
  const shop = await createShop();
  const food = await createFood(shop.id, { stockQuantity: 5 });

  const response = await request("PATCH", `/shops/${shop.id}/foods/${food.id}/stock`, {
    token: student.accessToken,
    body: { delta: 100 },
  });

  assert.equal(response.status, 403);
  assert.equal(await stockOf(food.id), 5, "a refused caller must not move stock");
});

test("an ADMIN may perform every administrative route", async () => {
  // Each route gets a fresh shop and food. Reusing one set would have the delete routes remove the
  // fixtures the later routes need, and the sweep would report the implementation as broken.
  const routeCount = (await writeRoutes()).length;

  for (let index = 0; index < routeCount; index += 1) {
    await resetCatalogue();

    const [method, path, body] = (await writeRoutes())[index];
    const response = await request(method, path, { body });

    assert.ok(
      response.status >= 200 && response.status < 300,
      `${method} ${path} answered ${response.status} for an ADMIN`,
    );
  }
});

test("browsing still works for both roles now that a second router shares the path", async () => {
  // The regression this phase could most easily cause: mounting the ADMIN router so that its role
  // check also covers the GET routes.
  const shop = await createShop({ name: "Alpha Cafe" });
  const food = await createFood(shop.id);

  const paths = [
    "/shops",
    `/shops/${shop.id}`,
    `/shops/${shop.id}/foods`,
    `/shops/${shop.id}/foods/${food.id}`,
  ];

  for (const caller of [student, admin]) {
    for (const path of paths) {
      const response = await request("GET", path, { token: caller.accessToken });

      assert.equal(response.status, 200, `${path} must stay readable by ${caller.user.role}`);
    }
  }
});

test("an unmatched path beneath /shops reaches the ADMIN role check", async () => {
  // A documented consequence of two routers on one path rather than an accident: browsing matches
  // nothing, the request falls through, and the administrative router answers first.
  assert.equal((await request("GET", "/shops/nonsense/path", { token: student.accessToken })).status, 403);
  assert.equal((await request("GET", "/shops/nonsense/path")).status, 404);
});

// --- Shops ----------------------------------------------------------------------------------------

test("a shop is created", async () => {
  const response = await request("POST", "/shops", { body: { name: "Alpha Cafe" } });
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.deepEqual(Object.keys(body).sort(), ["createdAt", "id", "name", "updatedAt"]);
  assert.equal(body.name, "Alpha Cafe");
  assert.equal(await prisma.shop.count(), 1);
});

test("a created shop is immediately visible to a browsing student", async () => {
  await request("POST", "/shops", { body: { name: "Alpha Cafe" } });

  const listed = await (await request("GET", "/shops", { token: student.accessToken })).json();

  assert.deepEqual(
    listed.map((shop) => shop.name),
    ["Alpha Cafe"],
  );
});

test("a shop name is trimmed before it is stored", async () => {
  const body = await (await request("POST", "/shops", { body: { name: "  Alpha Cafe  " } })).json();

  assert.equal(body.name, "Alpha Cafe");
});

test("a shop cannot be created without a name", async () => {
  const response = await request("POST", "/shops", { body: {} });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.error.code, "VALIDATION_ERROR");
  assert.deepEqual(
    body.error.details.map((detail) => detail.field),
    ["name"],
  );
});

test("duplicate shop names are allowed", async () => {
  // Deliberately not unique: nothing in the design asks for it, and two stalls can share a name.
  const first = await request("POST", "/shops", { body: { name: "Alpha Cafe" } });
  const second = await request("POST", "/shops", { body: { name: "Alpha Cafe" } });

  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.equal(await prisma.shop.count(), 2);
});

test("a shop is renamed", async () => {
  const shop = await createShop({ name: "Old" });

  const response = await request("PATCH", `/shops/${shop.id}`, { body: { name: "New" } });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.name, "New");
  assert.equal((await prisma.shop.findUnique({ where: { id: shop.id } })).name, "New");
});

test("renaming an unknown shop is a 404", async () => {
  const response = await request("PATCH", `/shops/${crypto.randomUUID()}`, { body: { name: "New" } });

  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, "NOT_FOUND");
});

test("an empty shop update is a validation error", async () => {
  const shop = await createShop();
  const response = await request("PATCH", `/shops/${shop.id}`, { body: {} });

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "VALIDATION_ERROR");
});

test("a malformed shop id is a validation error, not a 404", async () => {
  const response = await request("PATCH", "/shops/not-a-uuid", { body: { name: "New" } });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.deepEqual(
    body.error.details.map((detail) => detail.field),
    ["shopId"],
  );
});

test("a shop with no orders is deleted", async () => {
  const shop = await createShop();

  const response = await request("DELETE", `/shops/${shop.id}`);

  assert.equal(response.status, 204);
  assert.equal(await response.text(), "");
  assert.equal(await prisma.shop.count({ where: { id: shop.id } }), 0);
});

test("deleting a shop removes its foods", async () => {
  const shop = await createShop();

  await createFood(shop.id);
  await createFood(shop.id);

  await request("DELETE", `/shops/${shop.id}`);

  assert.equal(await prisma.food.count(), 0, "foods cascade with their shop");
});

test("deleting an unknown shop is a 404", async () => {
  const response = await request("DELETE", `/shops/${crypto.randomUUID()}`);

  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, "NOT_FOUND");
});

test("deleting a shop that past orders reference is a 409 SHOP_HAS_ORDERS", async () => {
  // Order.shop is onDelete: Restrict, so the database refuses. The point of this test is that the
  // refusal arrives as a deliberate, documented response rather than an unhandled 500.
  const shop = await createShop();

  await createOrder({ userId: student.user.id, shopId: shop.id });

  const response = await request("DELETE", `/shops/${shop.id}`);

  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, "SHOP_HAS_ORDERS");
  assert.equal(await prisma.shop.count({ where: { id: shop.id } }), 1, "the shop survives");
});

test("a shop becomes deletable once its orders are gone", async () => {
  const shop = await createShop();

  await createOrder({ userId: student.user.id, shopId: shop.id });

  assert.equal((await request("DELETE", `/shops/${shop.id}`)).status, 409);

  await resetOrders();

  assert.equal((await request("DELETE", `/shops/${shop.id}`)).status, 204);
});

// --- Foods -----------------------------------------------------------------------------------------

test("a food is created within its shop", async () => {
  const shop = await createShop();

  const response = await request("POST", `/shops/${shop.id}/foods`, {
    body: { name: "Samosa", priceMinor: 2500, stockQuantity: 7 },
  });
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.deepEqual(Object.keys(body).sort(), [
    "createdAt",
    "id",
    "name",
    "priceMinor",
    "shopId",
    "stockQuantity",
    "updatedAt",
  ]);
  assert.equal(body.shopId, shop.id);
  assert.equal(body.priceMinor, 2500);
  assert.equal(body.stockQuantity, 7, "stock is set absolutely at creation");
});

test("creating a food in an unknown shop is a 404", async () => {
  const response = await request("POST", `/shops/${crypto.randomUUID()}/foods`, {
    body: { name: "Samosa", priceMinor: 1, stockQuantity: 1 },
  });

  assert.equal(response.status, 404);
  assert.equal(await prisma.food.count(), 0);
});

test("a food cannot be created with a negative price or stock", async () => {
  const shop = await createShop();

  for (const body of [
    { name: "Samosa", priceMinor: -1, stockQuantity: 1 },
    { name: "Samosa", priceMinor: 1, stockQuantity: -1 },
  ]) {
    const response = await request("POST", `/shops/${shop.id}/foods`, { body });

    assert.equal(response.status, 400, `${JSON.stringify(body)} must be refused`);
    assert.equal((await response.json()).error.code, "VALIDATION_ERROR");
  }

  assert.equal(await prisma.food.count(), 0);
});

test("a food is updated within its shop", async () => {
  const shop = await createShop();
  const food = await createFood(shop.id, { name: "Old", priceMinor: 1000 });

  const response = await request("PATCH", `/shops/${shop.id}/foods/${food.id}`, {
    body: { name: "New", priceMinor: 1500 },
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.name, "New");
  assert.equal(body.priceMinor, 1500);
});

test("a normal food update cannot alter stock", async () => {
  // Stock has its own endpoint so that it can only ever move by a delta. A quantity sent here is
  // stripped by the schema before the service sees it.
  const shop = await createShop();
  const food = await createFood(shop.id, { stockQuantity: 4 });

  const response = await request("PATCH", `/shops/${shop.id}/foods/${food.id}`, {
    body: { name: "Renamed", stockQuantity: 9999 },
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.name, "Renamed");
  assert.equal(body.stockQuantity, 4);
  assert.equal(await stockOf(food.id), 4);
});

test("a food is deleted within its shop", async () => {
  const shop = await createShop();
  const food = await createFood(shop.id);

  const response = await request("DELETE", `/shops/${shop.id}/foods/${food.id}`);

  assert.equal(response.status, 204);
  assert.equal(await prisma.food.count(), 0);
});

test("an unknown food within a real shop is a 404", async () => {
  const shop = await createShop();

  for (const [method, body] of [
    ["PATCH", { name: "New" }],
    ["DELETE", undefined],
  ]) {
    const response = await request(method, `/shops/${shop.id}/foods/${crypto.randomUUID()}`, { body });

    assert.equal(response.status, 404, `${method} on an unknown food`);
  }
});

test("writing to a food under an unknown shop is a 404", async () => {
  const shop = await createShop();
  const food = await createFood(shop.id);

  const response = await request("PATCH", `/shops/${crypto.randomUUID()}/foods/${food.id}`, {
    body: { name: "New" },
  });

  assert.equal(response.status, 404);
});

// --- Parent scoping on writes -------------------------------------------------------------------------

test("a food belonging to another shop cannot be updated through the wrong shop", async () => {
  // The scoping rule browsing established, on the side where getting it wrong corrupts data rather
  // than leaking it. Both identifiers are real; only the pairing is wrong.
  const shop = await createShop();
  const otherShop = await createShop();
  const food = await createFood(otherShop.id, { name: "Theirs", priceMinor: 1000 });

  const response = await request("PATCH", `/shops/${shop.id}/foods/${food.id}`, {
    body: { name: "Hijacked", priceMinor: 1 },
  });

  assert.equal(response.status, 404);

  const stored = await prisma.food.findUnique({ where: { id: food.id } });

  assert.equal(stored.name, "Theirs", "the food is untouched");
  assert.equal(stored.priceMinor, 1000);
});

test("a food belonging to another shop cannot be deleted through the wrong shop", async () => {
  const shop = await createShop();
  const otherShop = await createShop();
  const food = await createFood(otherShop.id);

  const response = await request("DELETE", `/shops/${shop.id}/foods/${food.id}`);

  assert.equal(response.status, 404);
  assert.equal(await prisma.food.count({ where: { id: food.id } }), 1, "the food survives");
});

test("a food's stock cannot be changed through the wrong shop", async () => {
  const shop = await createShop();
  const otherShop = await createShop();
  const food = await createFood(otherShop.id, { stockQuantity: 3 });

  const response = await request("PATCH", `/shops/${shop.id}/foods/${food.id}/stock`, {
    body: { delta: 100 },
  });

  assert.equal(response.status, 404);
  assert.equal(await stockOf(food.id), 3);
});

test("the same food is writable through the shop that owns it", async () => {
  // The other half of the three tests above: the 404 is about the pairing, not a broken lookup.
  const otherShop = await createShop();
  const food = await createFood(otherShop.id, { name: "Theirs" });

  const response = await request("PATCH", `/shops/${otherShop.id}/foods/${food.id}`, {
    body: { name: "Renamed" },
  });

  assert.equal(response.status, 200);
  assert.equal((await response.json()).name, "Renamed");
});

// --- Historical orders survive catalogue changes ---------------------------------------------------

test("deleting a food leaves a past order's line intact", async () => {
  // The invariant the snapshot columns exist for. OrderItem.food is onDelete: SetNull, so the row
  // survives with what it recorded at purchase time.
  const shop = await createShop();
  const food = await createFood(shop.id, { name: "Samosa", priceMinor: 2500 });

  await createOrder({ userId: student.user.id, shopId: shop.id, food, quantity: 2 });

  assert.equal((await request("DELETE", `/shops/${shop.id}/foods/${food.id}`)).status, 204);

  const [line] = await prisma.orderItem.findMany();

  assert.equal(line.foodNameSnapshot, "Samosa");
  assert.equal(line.unitPriceMinorSnapshot, 2500);
  assert.equal(line.quantity, 2);
  assert.equal(line.lineTotalMinor, 5000);
  assert.equal(line.foodId, null, "the reference is cleared, the record is not");
});

test("renaming and repricing a food does not rewrite a past order", async () => {
  const shop = await createShop();
  const food = await createFood(shop.id, { name: "Samosa", priceMinor: 2500 });

  await createOrder({ userId: student.user.id, shopId: shop.id, food });

  await request("PATCH", `/shops/${shop.id}/foods/${food.id}`, {
    body: { name: "Renamed", priceMinor: 9999 },
  });

  const [line] = await prisma.orderItem.findMany();

  assert.equal(line.foodNameSnapshot, "Samosa");
  assert.equal(line.unitPriceMinorSnapshot, 2500);
});

// --- Stock ---------------------------------------------------------------------------------------------

test("a positive delta increases stock", async () => {
  const shop = await createShop();
  const food = await createFood(shop.id, { stockQuantity: 5 });

  const response = await request("PATCH", `/shops/${shop.id}/foods/${food.id}/stock`, {
    body: { delta: 7 },
  });

  assert.equal(response.status, 200);
  assert.equal((await response.json()).stockQuantity, 12);
  assert.equal(await stockOf(food.id), 12);
});

test("a negative delta decreases stock", async () => {
  const shop = await createShop();
  const food = await createFood(shop.id, { stockQuantity: 5 });

  const response = await request("PATCH", `/shops/${shop.id}/foods/${food.id}/stock`, {
    body: { delta: -3 },
  });

  assert.equal(response.status, 200);
  assert.equal((await response.json()).stockQuantity, 2);
});

test("a delta down to exactly zero is allowed", async () => {
  const shop = await createShop();
  const food = await createFood(shop.id, { stockQuantity: 5 });

  const response = await request("PATCH", `/shops/${shop.id}/foods/${food.id}/stock`, {
    body: { delta: -5 },
  });

  assert.equal(response.status, 200);
  assert.equal((await response.json()).stockQuantity, 0);
});

test("a delta that would go below zero is refused and moves nothing", async () => {
  const shop = await createShop();
  const food = await createFood(shop.id, { stockQuantity: 5 });

  const response = await request("PATCH", `/shops/${shop.id}/foods/${food.id}/stock`, {
    body: { delta: -6 },
  });

  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, "INSUFFICIENT_STOCK");
  assert.equal(await stockOf(food.id), 5, "a refused delta is not partially applied");
});

test("a zero delta is a validation error", async () => {
  const shop = await createShop();
  const food = await createFood(shop.id, { stockQuantity: 5 });

  const response = await request("PATCH", `/shops/${shop.id}/foods/${food.id}/stock`, {
    body: { delta: 0 },
  });

  assert.equal(response.status, 400);
  assert.deepEqual(
    (await response.json()).error.details.map((detail) => detail.field),
    ["delta"],
  );
});

test("changing stock on an unknown food is a 404", async () => {
  const shop = await createShop();
  const response = await request("PATCH", `/shops/${shop.id}/foods/${crypto.randomUUID()}/stock`, {
    body: { delta: 1 },
  });

  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, "NOT_FOUND");
});

// --- Stock concurrency ------------------------------------------------------------------------------------

test("concurrent decrements never oversell the last units", async () => {
  // The behaviour the conditional update exists for. Ten callers each ask for one unit of five. A
  // read, a comparison in JavaScript, and a write would let more than five through.
  const shop = await createShop();
  const food = await createFood(shop.id, { stockQuantity: 5 });

  const responses = await Promise.all(
    Array.from({ length: 10 }, () =>
      request("PATCH", `/shops/${shop.id}/foods/${food.id}/stock`, { body: { delta: -1 } }),
    ),
  );

  const statuses = responses.map((response) => response.status);

  assert.equal(statuses.filter((status) => status === 200).length, 5, "exactly five succeed");
  assert.equal(statuses.filter((status) => status === 409).length, 5, "exactly five are refused");
  assert.equal(await stockOf(food.id), 0);
});

test("stock never becomes negative under concurrent pressure", async () => {
  const shop = await createShop();
  const food = await createFood(shop.id, { stockQuantity: 3 });

  await Promise.all(
    Array.from({ length: 12 }, () =>
      request("PATCH", `/shops/${shop.id}/foods/${food.id}/stock`, { body: { delta: -2 } }),
    ),
  );

  const remaining = await stockOf(food.id);

  assert.ok(remaining >= 0, `stock went negative: ${remaining}`);
  assert.equal(remaining, 1, "three units, two at a time, leaves one");
});

test("concurrent increases and decreases all land, because the database does the arithmetic", async () => {
  // A read-then-write would lose some of these entirely. Every one of them is applied, so the
  // final quantity is the exact sum.
  const shop = await createShop();
  const food = await createFood(shop.id, { stockQuantity: 10 });

  const responses = await Promise.all([
    ...Array.from({ length: 5 }, () =>
      request("PATCH", `/shops/${shop.id}/foods/${food.id}/stock`, { body: { delta: 2 } }),
    ),
    ...Array.from({ length: 5 }, () =>
      request("PATCH", `/shops/${shop.id}/foods/${food.id}/stock`, { body: { delta: -1 } }),
    ),
  ]);

  assert.deepEqual([...new Set(responses.map((response) => response.status))], [200]);
  assert.equal(await stockOf(food.id), 10 + 10 - 5);
});

test("the database refuses negative stock even when the endpoint is bypassed", async () => {
  // CHECK (stock_quantity >= 0) is the boundary beneath the conditional update, and a constraint
  // that is never exercised is unverified.
  const shop = await createShop();
  const food = await createFood(shop.id, { stockQuantity: 1 });

  await assert.rejects(
    prisma.food.update({ where: { id: food.id }, data: { stockQuantity: -1 } }),
    /stock_quantity/i,
  );

  assert.equal(await stockOf(food.id), 1);
});

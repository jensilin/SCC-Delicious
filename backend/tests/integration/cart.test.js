require("../setup");

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { after, before, beforeEach, test } = require("node:test");

const { prisma } = require("../../src/config/prisma");
const { authorizationHeader, createSignedInUser } = require("../helpers/auth");
const { resetCarts } = require("../helpers/cart");
const { createFood, createShop, resetCatalogue } = require("../helpers/catalogue");
const { resetDatabase } = require("../helpers/database");
const { startTestServer, stopTestServer } = require("../helpers/server");

let server;
let baseUrl;
let student;
let otherStudent;
let admin;

// Signed in once. Hashing a password costs the configured bcrypt cost, so doing it per test would
// add seconds without exercising anything the cart owns.
before(async () => {
  ({ server, baseUrl } = await startTestServer());

  await resetDatabase();

  student = await createSignedInUser(baseUrl, { role: "STUDENT" });
  otherStudent = await createSignedInUser(baseUrl, { role: "STUDENT" });
  admin = await createSignedInUser(baseUrl, { role: "ADMIN" });
});

// Carts are emptied before the catalogue so that lines are gone before the foods they reference.
beforeEach(async () => {
  await resetCarts();
  await resetCatalogue();
});

after(async () => {
  await stopTestServer(server);
  await prisma.$disconnect();
});

function request(method, path, { token = student.accessToken, body } = {}) {
  return fetch(`${baseUrl}/api/v1${path}`, {
    method,
    headers: {
      ...(token === null ? {} : authorizationHeader(token)),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function addItem(foodId, quantity, options = {}) {
  return request("POST", "/cart/items", { ...options, body: { foodId, quantity } });
}

async function cartOf(options = {}) {
  return (await request("GET", "/cart", options)).json();
}

async function aFood(overrides = {}) {
  const shop = await createShop();

  return { shop, food: await createFood(shop.id, overrides) };
}

// --- Authentication and role -----------------------------------------------------------------

test("every cart route requires a token", async () => {
  const routes = [
    ["GET", "/cart"],
    ["DELETE", "/cart"],
    ["POST", "/cart/items"],
    ["PATCH", `/cart/items/${crypto.randomUUID()}`],
    ["DELETE", `/cart/items/${crypto.randomUUID()}`],
  ];

  for (const [method, path] of routes) {
    const response = await request(method, path, { token: null });

    assert.equal(response.status, 401, `${method} ${path} must require a token`);
    assert.equal((await response.json()).error.code, "UNAUTHENTICATED");
  }
});

test("a forged token does not reach the cart", async () => {
  const [header, payload] = student.accessToken.split(".");
  const response = await request("GET", "/cart", {
    token: `${header}.${payload}.wrong-signature`,
  });

  assert.equal(response.status, 401);
});

test("a signed-in STUDENT may read their cart", async () => {
  const response = await request("GET", "/cart");

  assert.equal(response.status, 200);
});

test("an ADMIN has no cart", async () => {
  // The Authorization section grants "manage their own cart" to STUDENT and lists no cart among
  // what an ADMIN may do, so the role check refuses before any handler runs.
  const response = await request("GET", "/cart", { token: admin.accessToken });

  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, "FORBIDDEN");
});

// --- Reading an empty cart -------------------------------------------------------------------

test("a user who has never added anything gets an empty cart, not a 404", async () => {
  const response = await request("GET", "/cart");
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body, { id: null, shopId: null, items: [], totalMinor: 0 });
});

test("reading an empty cart does not create a cart row", async () => {
  await request("GET", "/cart");

  assert.equal(await prisma.cart.count(), 0, "a read must not write");
});

// --- Adding an item ----------------------------------------------------------------------------

test("adding a food creates the cart and returns it", async () => {
  const { shop, food } = await aFood({ name: "Samosa", priceMinor: 2500 });

  const response = await addItem(food.id, 2);
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.shopId, shop.id);
  assert.equal(body.totalMinor, 5000);
  assert.deepEqual(body.items, [
    {
      foodId: food.id,
      name: "Samosa",
      priceMinor: 2500,
      quantity: 2,
      lineTotalMinor: 5000,
    },
  ]);
  assert.equal(await prisma.cart.count({ where: { userId: student.user.id } }), 1);
});

test("a cart exposes its documented fields and nothing else", async () => {
  const { food } = await aFood();

  await addItem(food.id, 1);

  const body = await cartOf();

  assert.deepEqual(Object.keys(body).sort(), ["id", "items", "shopId", "totalMinor"]);
  assert.deepEqual(Object.keys(body.items[0]).sort(), [
    "foodId",
    "lineTotalMinor",
    "name",
    "priceMinor",
    "quantity",
  ]);
});

test("a second food from the same shop is added alongside the first", async () => {
  const shop = await createShop();
  const first = await createFood(shop.id, { name: "Aloo Tikki", priceMinor: 2000 });
  const second = await createFood(shop.id, { name: "Chai", priceMinor: 1000 });

  await addItem(first.id, 1);

  const response = await addItem(second.id, 3);
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.shopId, shop.id);
  assert.deepEqual(
    body.items.map((item) => item.name),
    ["Aloo Tikki", "Chai"],
  );
  assert.equal(body.totalMinor, 2000 + 3000);
});

test("adding a food already in the cart increases its quantity on one line", async () => {
  const { food } = await aFood({ priceMinor: 1000 });

  await addItem(food.id, 2);

  const body = await (await addItem(food.id, 3)).json();

  assert.equal(body.items.length, 1, "a food occupies one line, not two");
  assert.equal(body.items[0].quantity, 5);
  assert.equal(body.totalMinor, 5000);
  assert.equal(await prisma.cartItem.count(), 1);
});

test("adding a food that does not exist is a 404", async () => {
  const response = await addItem(crypto.randomUUID(), 1);

  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, "NOT_FOUND");
  assert.equal(await prisma.cart.count(), 0, "a rejected addition creates nothing");
});

// --- The single-shop rule -----------------------------------------------------------------------

test("a food from another shop is refused with CART_SHOP_MISMATCH", async () => {
  const first = await aFood();
  const second = await aFood();

  await addItem(first.food.id, 1);

  const response = await addItem(second.food.id, 1);

  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, "CART_SHOP_MISMATCH");
});

test("a refused addition leaves the cart exactly as it was", async () => {
  const first = await aFood({ name: "Mine", priceMinor: 1500 });
  const second = await aFood({ name: "Theirs" });

  await addItem(first.food.id, 2);
  await addItem(second.food.id, 1);

  const body = await cartOf();

  assert.equal(body.shopId, first.shop.id);
  assert.deepEqual(
    body.items.map((item) => item.name),
    ["Mine"],
  );
  assert.equal(body.totalMinor, 3000);
});

test("the cart names no shop until something is in it", async () => {
  const { shop, food } = await aFood();

  assert.equal((await cartOf()).shopId, null);

  await addItem(food.id, 1);

  assert.equal((await cartOf()).shopId, shop.id);
});

test("emptying the cart releases its shop, so another shop may then be used", async () => {
  const first = await aFood();
  const second = await aFood();

  await addItem(first.food.id, 1);
  await request("DELETE", `/cart/items/${first.food.id}`);

  const released = await cartOf();

  assert.equal(released.shopId, null, "an empty cart holds no shop");
  assert.equal((await addItem(second.food.id, 1)).status, 201);
  assert.equal((await cartOf()).shopId, second.shop.id);
});

// --- Changing a quantity --------------------------------------------------------------------------

test("a quantity can be changed to an exact value", async () => {
  const { food } = await aFood({ priceMinor: 1000 });

  await addItem(food.id, 2);

  const response = await request("PATCH", `/cart/items/${food.id}`, { body: { quantity: 7 } });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.items[0].quantity, 7, "the value replaces the quantity rather than adding to it");
  assert.equal(body.totalMinor, 7000);
});

test("changing the quantity of a food that is not in the cart is a 404", async () => {
  const { food } = await aFood();
  const response = await request("PATCH", `/cart/items/${food.id}`, { body: { quantity: 1 } });

  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, "NOT_FOUND");
});

// --- Removing an item ------------------------------------------------------------------------------

test("an item can be removed", async () => {
  const shop = await createShop();
  const first = await createFood(shop.id, { name: "Aloo Tikki" });
  const second = await createFood(shop.id, { name: "Chai" });

  await addItem(first.id, 1);
  await addItem(second.id, 1);

  const response = await request("DELETE", `/cart/items/${first.id}`);

  assert.equal(response.status, 204);
  assert.equal(await response.text(), "");
  assert.deepEqual(
    (await cartOf()).items.map((item) => item.name),
    ["Chai"],
  );
});

test("removing a food that is not in the cart is a 404", async () => {
  const { food } = await aFood();
  const response = await request("DELETE", `/cart/items/${food.id}`);

  assert.equal(response.status, 404);
});

// --- Clearing the cart ------------------------------------------------------------------------------

test("the whole cart can be cleared", async () => {
  const shop = await createShop();
  const first = await createFood(shop.id);
  const second = await createFood(shop.id);

  await addItem(first.id, 1);
  await addItem(second.id, 2);

  const response = await request("DELETE", "/cart");

  assert.equal(response.status, 204);
  assert.deepEqual((await cartOf()).items, []);
  assert.equal((await cartOf()).shopId, null);
  assert.equal(await prisma.cartItem.count(), 0);
});

test("clearing a cart that was never created is not an error", async () => {
  const response = await request("DELETE", "/cart");

  assert.equal(response.status, 204);
  assert.equal(await prisma.cart.count(), 0, "clearing nothing must not create a cart");
});

// --- Validation --------------------------------------------------------------------------------------

test("a malformed food identifier in the path is a validation error, not a 404", async () => {
  const response = await request("DELETE", "/cart/items/not-a-uuid");
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.error.code, "VALIDATION_ERROR");
  assert.deepEqual(
    body.error.details.map((detail) => detail.field),
    ["foodId"],
  );
});

test("a malformed food identifier in the body is a validation error", async () => {
  const response = await addItem("not-a-uuid", 1);
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.deepEqual(
    body.error.details.map((detail) => detail.field),
    ["foodId"],
  );
});

test("a non-positive quantity is refused before it reaches the database", async () => {
  const { food } = await aFood();

  for (const quantity of [0, -3]) {
    const response = await addItem(food.id, quantity);
    const body = await response.json();

    assert.equal(response.status, 400, `quantity ${quantity} must be refused`);
    assert.equal(body.error.code, "VALIDATION_ERROR");
    assert.deepEqual(
      body.error.details.map((detail) => detail.field),
      ["quantity"],
    );
  }

  assert.equal(await prisma.cartItem.count(), 0);
});

test("a fractional or non-numeric quantity is refused", async () => {
  const { food } = await aFood();

  for (const quantity of [1.5, "2", null]) {
    assert.equal((await addItem(food.id, quantity)).status, 400, `${String(quantity)} is not a quantity`);
  }
});

test("an update to a non-positive quantity is refused", async () => {
  const { food } = await aFood();

  await addItem(food.id, 2);

  const response = await request("PATCH", `/cart/items/${food.id}`, { body: { quantity: 0 } });

  assert.equal(response.status, 400);
  assert.equal((await cartOf()).items[0].quantity, 2, "the stored quantity is untouched");
});

test("a missing body is a validation error rather than a crash", async () => {
  const response = await request("POST", "/cart/items", { body: {} });

  assert.equal(response.status, 400);
  assert.deepEqual(
    (await response.json()).error.details.map((detail) => detail.field).sort(),
    ["foodId", "quantity"],
  );
});

// --- Ownership isolation -------------------------------------------------------------------------------

test("each user sees only their own cart", async () => {
  const shop = await createShop();
  const mine = await createFood(shop.id, { name: "Mine" });
  const theirs = await createFood(shop.id, { name: "Theirs" });

  await addItem(mine.id, 1);
  await addItem(theirs.id, 1, { token: otherStudent.accessToken });

  assert.deepEqual(
    (await cartOf()).items.map((item) => item.name),
    ["Mine"],
  );
  assert.deepEqual(
    (await cartOf({ token: otherStudent.accessToken })).items.map((item) => item.name),
    ["Theirs"],
  );
});

test("a food in another user's cart cannot be changed or removed through your own", async () => {
  // The food identifier is real and the line exists — but in someone else's cart. Because every
  // query is scoped to the caller's cart, it matches nothing rather than being written.
  const { food } = await aFood();

  await addItem(food.id, 4, { token: otherStudent.accessToken });

  const patched = await request("PATCH", `/cart/items/${food.id}`, { body: { quantity: 99 } });
  const deleted = await request("DELETE", `/cart/items/${food.id}`);

  assert.equal(patched.status, 404);
  assert.equal(deleted.status, 404);
  assert.equal(
    (await cartOf({ token: otherStudent.accessToken })).items[0].quantity,
    4,
    "the other cart is untouched",
  );
});

test("clearing your cart does not touch anyone else's", async () => {
  const { food } = await aFood();

  await addItem(food.id, 1);
  await addItem(food.id, 1, { token: otherStudent.accessToken });

  await request("DELETE", "/cart");

  assert.deepEqual((await cartOf()).items, []);
  assert.equal((await cartOf({ token: otherStudent.accessToken })).items.length, 1);
});

test("two users may hold the same food from the same shop at once", async () => {
  const { food } = await aFood();

  assert.equal((await addItem(food.id, 1)).status, 201);
  assert.equal((await addItem(food.id, 1, { token: otherStudent.accessToken })).status, 201);
  assert.equal(await prisma.cartItem.count(), 2, "the unique index is per cart, not per food");
});

// --- Prices are never stored ------------------------------------------------------------------------------

test("totals follow the current food price rather than the price when it was added", async () => {
  const { food } = await aFood({ priceMinor: 2000 });

  await addItem(food.id, 3);

  await prisma.food.update({ where: { id: food.id }, data: { priceMinor: 2500 } });

  const body = await cartOf();

  assert.equal(body.items[0].priceMinor, 2500);
  assert.equal(body.items[0].lineTotalMinor, 7500);
  assert.equal(body.totalMinor, 7500);
});

test("a cart line stores quantity and no price at all", async () => {
  const { food } = await aFood({ priceMinor: 2000 });

  await addItem(food.id, 1);

  const [line] = await prisma.cartItem.findMany();

  assert.deepEqual(Object.keys(line).sort(), [
    "cartId",
    "createdAt",
    "foodId",
    "id",
    "quantity",
    "updatedAt",
  ]);
});

test("money is returned as unformatted integer minor units", async () => {
  const { food } = await aFood({ priceMinor: 25000 });

  await addItem(food.id, 2);

  const text = await (await request("GET", "/cart")).text();
  const body = JSON.parse(text);

  assert.equal(Number.isInteger(body.totalMinor), true);
  assert.equal(body.totalMinor, 50000);
  assert.ok(!/250\.00|500\.00|₹|\$/.test(text), "the server must not format money");
});

// --- Stock is not reserved ------------------------------------------------------------------------------

test("the cart does not consult or hold stock", async () => {
  // Adding to the cart does not reserve inventory; availability is confirmed at checkout. More may
  // therefore be held in a cart than the shop has, and the stock figure must not move.
  const { food } = await aFood({ stockQuantity: 1 });

  const response = await addItem(food.id, 5);

  assert.equal(response.status, 201);
  assert.equal((await response.json()).items[0].quantity, 5);
  assert.equal(
    (await prisma.food.findUnique({ where: { id: food.id } })).stockQuantity,
    1,
    "stock is untouched by a cart operation",
  );
});

test("a food with no stock left can still be added", async () => {
  const { food } = await aFood({ stockQuantity: 0 });

  assert.equal((await addItem(food.id, 1)).status, 201);
});

// --- The database remains the final boundary ------------------------------------------------------------

test("the database refuses a second line for the same food in one cart", async () => {
  const { food } = await aFood();

  await addItem(food.id, 1);

  const [cart] = await prisma.cart.findMany({ where: { userId: student.user.id } });

  await assert.rejects(
    prisma.cartItem.create({ data: { cartId: cart.id, foodId: food.id, quantity: 1 } }),
    (error) => error.code === "P2002",
    "the unique index on (cart_id, food_id) is what finally enforces one line per food",
  );
});

test("the database refuses a non-positive quantity even when validation is bypassed", async () => {
  const { food } = await aFood();

  await addItem(food.id, 1);

  const [cart] = await prisma.cart.findMany({ where: { userId: student.user.id } });

  await assert.rejects(
    prisma.cartItem.update({
      where: { cartId_foodId: { cartId: cart.id, foodId: food.id } },
      data: { quantity: 0 },
    }),
    /quantity/i,
    "CHECK (quantity > 0) is the final word on this, not the validator",
  );
});

test("a user may hold only one cart", async () => {
  const { food } = await aFood();

  await addItem(food.id, 1);

  await assert.rejects(
    prisma.cart.create({ data: { userId: student.user.id } }),
    (error) => error.code === "P2002",
  );
});

test("deleting a food removes it from every cart", async () => {
  const { food } = await aFood();

  await addItem(food.id, 1);
  await addItem(food.id, 2, { token: otherStudent.accessToken });

  await prisma.food.delete({ where: { id: food.id } });

  assert.deepEqual((await cartOf()).items, []);
  assert.equal(await prisma.cartItem.count(), 0, "the cascade is the database's, not the service's");
});

// --- Concurrency ---------------------------------------------------------------------------------------

test("two simultaneous additions of the same food sum rather than losing one", async () => {
  // The increment is applied by the database. A read of the quantity followed by a write of
  // read + n would let one of these two overwrite the other and report four as three.
  const { food } = await aFood({ priceMinor: 1000 });

  const responses = await Promise.all([addItem(food.id, 2), addItem(food.id, 3)]);

  assert.deepEqual(
    responses.map((response) => response.status),
    [201, 201],
  );

  const body = await cartOf();

  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].quantity, 5);
  assert.equal(await prisma.cartItem.count(), 1);
});

test("two simultaneous additions from different shops cannot both claim an empty cart", async () => {
  // The race the single-shop rule has to survive: both requests see a cart with no shop. The
  // conditional update settles it, so exactly one is accepted and the cart ends up coherent.
  const first = await aFood();
  const second = await aFood();

  const responses = await Promise.all([addItem(first.food.id, 1), addItem(second.food.id, 1)]);
  const statuses = responses.map((response) => response.status).sort();

  assert.deepEqual(statuses, [201, 409]);

  const body = await cartOf();

  assert.equal(body.items.length, 1, "exactly one addition survived");
  assert.ok(
    [first.shop.id, second.shop.id].includes(body.shopId),
    "the cart names the shop of the item it holds",
  );
  assert.equal(
    (await prisma.food.findUnique({ where: { id: body.items[0].foodId } })).shopId,
    body.shopId,
    "every line belongs to the shop the cart names",
  );
});

test("simultaneous first additions do not create two carts for one user", async () => {
  const shop = await createShop();
  const first = await createFood(shop.id);
  const second = await createFood(shop.id);

  const responses = await Promise.all([addItem(first.id, 1), addItem(second.id, 1)]);

  assert.deepEqual(
    responses.map((response) => response.status),
    [201, 201],
  );
  assert.equal(await prisma.cart.count({ where: { userId: student.user.id } }), 1);
  assert.equal((await cartOf()).items.length, 2);
});

require("../setup");

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { after, before, beforeEach, test } = require("node:test");

const { prisma } = require("../../src/config/prisma");
const { authorizationHeader, createSignedInUser } = require("../helpers/auth");
const { createFood, createShop, resetCatalogue } = require("../helpers/catalogue");
const { resetDatabase } = require("../helpers/database");
const { startTestServer, stopTestServer } = require("../helpers/server");

let server;
let baseUrl;
let student;
let admin;

// Both callers are signed in once. Hashing a password costs the configured bcrypt cost, so doing it
// per test would add seconds without testing anything the catalogue owns.
before(async () => {
  ({ server, baseUrl } = await startTestServer());

  await resetDatabase();

  student = await createSignedInUser(baseUrl, { role: "STUDENT" });
  admin = await createSignedInUser(baseUrl, { role: "ADMIN" });
});

beforeEach(resetCatalogue);

after(async () => {
  await stopTestServer(server);
  await prisma.$disconnect();
});

function get(path, { token = student.accessToken } = {}) {
  return fetch(`${baseUrl}/api/v1${path}`, {
    headers: token === null ? {} : authorizationHeader(token),
  });
}

// --- Authentication is required ----------------------------------------------------------------

test("browsing shops without a token is refused", async () => {
  const response = await get("/shops", { token: null });

  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, "UNAUTHENTICATED");
});

test("every catalogue route requires a token, not just the collection", async () => {
  const shop = await createShop();
  const food = await createFood(shop.id);

  const paths = [
    "/shops",
    `/shops/${shop.id}`,
    `/shops/${shop.id}/foods`,
    `/shops/${shop.id}/foods/${food.id}`,
  ];

  for (const path of paths) {
    assert.equal((await get(path, { token: null })).status, 401, `${path} must require a token`);
  }
});

test("a forged token does not reach the catalogue", async () => {
  const [header, payload] = student.accessToken.split(".");
  const response = await get("/shops", { token: `${header}.${payload}.wrong-signature` });

  assert.equal(response.status, 401);
});

// --- Shops --------------------------------------------------------------------------------------

test("an empty catalogue is an empty array, not an error", async () => {
  const response = await get("/shops");

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), []);
});

test("shops are listed", async () => {
  await createShop({ name: "Bravo Canteen" });
  await createShop({ name: "Alpha Cafe" });

  const response = await get("/shops");
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.ok(Array.isArray(body), "a collection is a plain array with no envelope");
  assert.deepEqual(
    body.map((shop) => shop.name),
    ["Alpha Cafe", "Bravo Canteen"],
  );
});

test("a shop exposes its documented fields and nothing else", async () => {
  const created = await createShop({ name: "Alpha Cafe" });
  const [shop] = await (await get("/shops")).json();

  assert.deepEqual(Object.keys(shop).sort(), ["createdAt", "id", "name", "updatedAt"]);
  assert.equal(shop.id, created.id);
});

test("a single shop can be fetched by id", async () => {
  const created = await createShop({ name: "Alpha Cafe" });
  const response = await get(`/shops/${created.id}`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.id, created.id);
  assert.equal(body.name, "Alpha Cafe");
});

test("an unknown shop is a 404", async () => {
  const response = await get(`/shops/${crypto.randomUUID()}`);

  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, "NOT_FOUND");
});

test("a malformed shop id is a validation error, not a 404", async () => {
  const response = await get("/shops/not-a-uuid");
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.error.code, "VALIDATION_ERROR");
  assert.deepEqual(
    body.error.details.map((detail) => detail.field),
    ["shopId"],
  );
});

// --- Foods within a shop -------------------------------------------------------------------------

test("a shop's foods are listed", async () => {
  const shop = await createShop();

  await createFood(shop.id, { name: "Samosa" });
  await createFood(shop.id, { name: "Chai" });

  const response = await get(`/shops/${shop.id}/foods`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(
    body.map((food) => food.name),
    ["Chai", "Samosa"],
  );
});

test("a shop with no foods returns an empty array", async () => {
  const shop = await createShop();

  assert.deepEqual(await (await get(`/shops/${shop.id}/foods`)).json(), []);
});

test("the food list contains only that shop's foods", async () => {
  const shop = await createShop();
  const otherShop = await createShop();

  await createFood(shop.id, { name: "Mine" });
  await createFood(otherShop.id, { name: "Theirs" });

  const body = await (await get(`/shops/${shop.id}/foods`)).json();

  assert.deepEqual(
    body.map((food) => food.name),
    ["Mine"],
  );
});

test("listing foods for an unknown shop is a 404, not an empty array", async () => {
  // An empty array would assert that the shop exists and has no menu, which is a different claim.
  const response = await get(`/shops/${crypto.randomUUID()}/foods`);

  assert.equal(response.status, 404);
});

test("a single food can be fetched through its shop", async () => {
  const shop = await createShop();
  const created = await createFood(shop.id, { name: "Samosa" });

  const response = await get(`/shops/${shop.id}/foods/${created.id}`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.id, created.id);
  assert.equal(body.shopId, shop.id);
});

test("a food exposes its documented fields and nothing else", async () => {
  const shop = await createShop();
  const created = await createFood(shop.id);

  const body = await (await get(`/shops/${shop.id}/foods/${created.id}`)).json();

  assert.deepEqual(Object.keys(body).sort(), [
    "createdAt",
    "id",
    "name",
    "priceMinor",
    "shopId",
    "stockQuantity",
    "updatedAt",
  ]);
});

test("an unknown food within a real shop is a 404", async () => {
  const shop = await createShop();
  const response = await get(`/shops/${shop.id}/foods/${crypto.randomUUID()}`);

  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, "NOT_FOUND");
});

test("a malformed food id is a validation error", async () => {
  const shop = await createShop();
  const response = await get(`/shops/${shop.id}/foods/not-a-uuid`);
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.error.code, "VALIDATION_ERROR");
  assert.deepEqual(
    body.error.details.map((detail) => detail.field),
    ["foodId"],
  );
});

// --- Parent scoping -------------------------------------------------------------------------------

test("a food that exists but belongs to another shop is a 404", async () => {
  // The rule this phase exists to establish. The food id is real and the shop id is real; only the
  // pairing is wrong, and that must not be readable.
  const shop = await createShop();
  const otherShop = await createShop();
  const foodInOtherShop = await createFood(otherShop.id, { name: "Theirs" });

  const response = await get(`/shops/${shop.id}/foods/${foodInOtherShop.id}`);

  assert.equal(response.status, 404);
  assert.ok(!(await response.text()).includes("Theirs"), "a mismatched pair must reveal nothing");
});

test("the same food is readable through the shop that owns it", async () => {
  // The other half of the previous test: the 404 is about the pairing, not a broken lookup.
  const otherShop = await createShop();
  const food = await createFood(otherShop.id, { name: "Theirs" });

  const response = await get(`/shops/${otherShop.id}/foods/${food.id}`);

  assert.equal(response.status, 200);
  assert.equal((await response.json()).name, "Theirs");
});

// --- Money ------------------------------------------------------------------------------------------

test("a price is an integer in minor units, unformatted", async () => {
  const shop = await createShop();
  const created = await createFood(shop.id, { priceMinor: 25000, stockQuantity: 3 });

  const body = await (await get(`/shops/${shop.id}/foods/${created.id}`)).json();

  assert.equal(body.priceMinor, 25000);
  assert.equal(Number.isInteger(body.priceMinor), true);
  assert.equal(Number.isInteger(body.stockQuantity), true);

  const text = await (await get(`/shops/${shop.id}/foods/${created.id}`)).text();

  assert.ok(!/250\.00|"250"|₹|\$/.test(text), "the server must not format money");
});

// --- Both roles browse ---------------------------------------------------------------------------------

test("an ADMIN browses the same catalogue as a STUDENT", async () => {
  const shop = await createShop({ name: "Alpha Cafe" });
  const food = await createFood(shop.id, { name: "Samosa" });

  for (const [role, caller] of [
    ["STUDENT", student],
    ["ADMIN", admin],
  ]) {
    const shops = await get("/shops", { token: caller.accessToken });
    const foods = await get(`/shops/${shop.id}/foods`, { token: caller.accessToken });
    const one = await get(`/shops/${shop.id}/foods/${food.id}`, { token: caller.accessToken });

    assert.equal(shops.status, 200, `${role} may list shops`);
    assert.equal(foods.status, 200, `${role} may list foods`);
    assert.equal(one.status, 200, `${role} may read a food`);
  }

  assert.equal(admin.user.role, "ADMIN");
  assert.equal(student.user.role, "STUDENT");
});

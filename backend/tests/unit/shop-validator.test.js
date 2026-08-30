require("../setup");

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { test } = require("node:test");

const { foodParamsSchema, shopParamsSchema } = require("../../src/validators/shop.validator");

const shopId = crypto.randomUUID();
const foodId = crypto.randomUUID();

test("a shop identifier of the right shape is accepted", () => {
  assert.deepEqual(shopParamsSchema.parse({ shopId }), { shopId });
});

test("a shop identifier that is not a UUID is rejected", () => {
  const result = shopParamsSchema.safeParse({ shopId: "not-a-uuid" });

  assert.equal(result.success, false);
  assert.equal(result.error.issues[0].path.join("."), "shopId");
  assert.match(result.error.issues[0].message, /UUID/i);
});

test("a missing shop identifier is rejected", () => {
  assert.equal(shopParamsSchema.safeParse({}).success, false);
});

test("a numeric identifier is rejected, so ids cannot be walked", () => {
  // UUIDs were chosen precisely so identifiers are not enumerable. Accepting "1" would invite
  // exactly the probing that choice avoids.
  assert.equal(shopParamsSchema.safeParse({ shopId: "1" }).success, false);
});

test("both identifiers are required together for a food", () => {
  assert.deepEqual(foodParamsSchema.parse({ shopId, foodId }), { shopId, foodId });
});

test("a food identifier without its shop is rejected", () => {
  const result = foodParamsSchema.safeParse({ foodId });

  assert.equal(result.success, false);
  assert.deepEqual(
    result.error.issues.map((issue) => issue.path.join(".")),
    ["shopId"],
  );
});

test("a malformed food identifier is rejected", () => {
  const result = foodParamsSchema.safeParse({ shopId, foodId: "not-a-uuid" });

  assert.equal(result.success, false);
  assert.equal(result.error.issues[0].path.join("."), "foodId");
});

test("both malformed identifiers are reported at once", () => {
  const result = foodParamsSchema.safeParse({ shopId: "nope", foodId: "also-nope" });

  assert.equal(result.success, false);
  assert.deepEqual(
    result.error.issues.map((issue) => issue.path.join(".")).sort(),
    ["foodId", "shopId"],
  );
});

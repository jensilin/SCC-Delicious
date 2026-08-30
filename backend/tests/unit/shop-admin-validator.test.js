require("../setup");

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { test } = require("node:test");

const {
  MAX_INT32,
  createFoodSchema,
  createShopSchema,
  stockDeltaSchema,
  updateFoodSchema,
  updateShopSchema,
} = require("../../src/validators/shop-admin.validator");

function fields(result) {
  return result.error.issues.map((issue) => issue.path.join(".")).sort();
}

// --- Shop creation -------------------------------------------------------------------------------

test("a shop name is accepted", () => {
  assert.deepEqual(createShopSchema.parse({ name: "Alpha Cafe" }), { name: "Alpha Cafe" });
});

test("a shop name is trimmed", () => {
  // Otherwise two names differing only by surrounding space become two distinct stored values.
  assert.deepEqual(createShopSchema.parse({ name: "  Alpha Cafe  " }), { name: "Alpha Cafe" });
});

test("an empty or whitespace-only shop name is rejected", () => {
  for (const name of ["", "   "]) {
    const result = createShopSchema.safeParse({ name });

    assert.equal(result.success, false, `${JSON.stringify(name)} is not a name`);
    assert.deepEqual(fields(result), ["name"]);
  }
});

test("a missing shop name is rejected", () => {
  assert.equal(createShopSchema.safeParse({}).success, false);
});

test("a non-string shop name is rejected rather than coerced", () => {
  for (const name of [1, null, true, [], {}]) {
    assert.equal(createShopSchema.safeParse({ name }).success, false, `${String(name)} is not a name`);
  }
});

test("an unknown field is discarded rather than rejected", () => {
  assert.deepEqual(createShopSchema.parse({ name: "Alpha Cafe", id: crypto.randomUUID() }), {
    name: "Alpha Cafe",
  });
});

// --- Shop update ---------------------------------------------------------------------------------

test("a partial shop update is accepted", () => {
  assert.deepEqual(updateShopSchema.parse({ name: "Renamed" }), { name: "Renamed" });
});

test("an empty shop update is rejected", () => {
  // A patch naming no field asks for no change while still reporting success, which hides a
  // client bug and moves updated_at for nothing.
  assert.equal(updateShopSchema.safeParse({}).success, false);
});

// --- Food creation -------------------------------------------------------------------------------

test("a food is accepted with a name, a price, and a stock quantity", () => {
  assert.deepEqual(createFoodSchema.parse({ name: "Samosa", priceMinor: 2500, stockQuantity: 10 }), {
    name: "Samosa",
    priceMinor: 2500,
    stockQuantity: 10,
  });
});

test("stock is settable at creation and only at creation", () => {
  assert.equal(createFoodSchema.safeParse({ name: "Samosa", priceMinor: 1, stockQuantity: 0 }).success, true);
});

test("all three food fields are required at creation", () => {
  const result = createFoodSchema.safeParse({});

  assert.equal(result.success, false);
  assert.deepEqual(fields(result), ["name", "priceMinor", "stockQuantity"]);
});

test("a negative price is rejected", () => {
  const result = createFoodSchema.safeParse({ name: "Samosa", priceMinor: -1, stockQuantity: 1 });

  assert.equal(result.success, false);
  assert.deepEqual(fields(result), ["priceMinor"]);
});

test("a free item is allowed, because nothing in the design forbids one", () => {
  assert.equal(createFoodSchema.safeParse({ name: "Water", priceMinor: 0, stockQuantity: 1 }).success, true);
});

test("a fractional price is rejected, because money is integer minor units", () => {
  assert.equal(
    createFoodSchema.safeParse({ name: "Samosa", priceMinor: 25.5, stockQuantity: 1 }).success,
    false,
  );
});

test("a price sent as a string is rejected rather than coerced", () => {
  assert.equal(
    createFoodSchema.safeParse({ name: "Samosa", priceMinor: "2500", stockQuantity: 1 }).success,
    false,
  );
});

test("a negative stock quantity is rejected", () => {
  const result = createFoodSchema.safeParse({ name: "Samosa", priceMinor: 1, stockQuantity: -1 });

  assert.equal(result.success, false);
  assert.deepEqual(fields(result), ["stockQuantity"]);
});

test("a price or stock beyond the stored integer range is rejected", () => {
  const base = { name: "Samosa", priceMinor: 1, stockQuantity: 1 };

  assert.equal(createFoodSchema.safeParse({ ...base, priceMinor: MAX_INT32 }).success, true);
  assert.equal(createFoodSchema.safeParse({ ...base, priceMinor: MAX_INT32 + 1 }).success, false);
  assert.equal(createFoodSchema.safeParse({ ...base, stockQuantity: MAX_INT32 + 1 }).success, false);
});

// --- Food update ---------------------------------------------------------------------------------

test("a food update accepts a name and a price", () => {
  assert.deepEqual(updateFoodSchema.parse({ name: "Renamed", priceMinor: 100 }), {
    name: "Renamed",
    priceMinor: 100,
  });
});

test("a food update discards a stock quantity", () => {
  // Stock has its own endpoint precisely so it cannot be replaced with an absolute value. Sending
  // it here must not reach the service, the same way a role sent to registration does not.
  assert.deepEqual(updateFoodSchema.parse({ name: "Renamed", stockQuantity: 9999 }), {
    name: "Renamed",
  });
});

test("a food update discards identifiers, so a food cannot be moved between shops", () => {
  assert.deepEqual(
    updateFoodSchema.parse({
      priceMinor: 100,
      id: crypto.randomUUID(),
      shopId: crypto.randomUUID(),
      foodId: crypto.randomUUID(),
    }),
    { priceMinor: 100 },
  );
});

test("an empty food update is rejected", () => {
  assert.equal(updateFoodSchema.safeParse({}).success, false);
});

test("a food update carrying only a stock quantity is rejected as empty", () => {
  // The stock field is stripped first, which leaves nothing to change.
  assert.equal(updateFoodSchema.safeParse({ stockQuantity: 5 }).success, false);
});

// --- Stock delta ---------------------------------------------------------------------------------

test("a positive and a negative delta are both accepted", () => {
  assert.deepEqual(stockDeltaSchema.parse({ delta: 5 }), { delta: 5 });
  assert.deepEqual(stockDeltaSchema.parse({ delta: -5 }), { delta: -5 });
});

test("a zero delta is rejected", () => {
  const result = stockDeltaSchema.safeParse({ delta: 0 });

  assert.equal(result.success, false);
  assert.deepEqual(fields(result), ["delta"]);
});

test("a missing delta is rejected", () => {
  assert.equal(stockDeltaSchema.safeParse({}).success, false);
});

test("a fractional or non-numeric delta is rejected", () => {
  for (const delta of [1.5, "3", null, true, []]) {
    assert.equal(stockDeltaSchema.safeParse({ delta }).success, false, `${String(delta)} is not a delta`);
  }
});

test("a delta beyond the stored integer range is rejected", () => {
  assert.equal(stockDeltaSchema.safeParse({ delta: MAX_INT32 }).success, true);
  assert.equal(stockDeltaSchema.safeParse({ delta: MAX_INT32 + 1 }).success, false);
});

test("an absolute stock quantity cannot be smuggled through the delta body", () => {
  assert.deepEqual(stockDeltaSchema.parse({ delta: 2, stockQuantity: 500 }), { delta: 2 });
});

require("../setup");

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { test } = require("node:test");

const {
  MAX_QUANTITY,
  addCartItemSchema,
  cartItemParamsSchema,
  updateCartItemSchema,
} = require("../../src/validators/cart.validator");

const foodId = crypto.randomUUID();

// --- Addressing a line ---------------------------------------------------------------------------

test("a food identifier of the right shape is accepted", () => {
  assert.deepEqual(cartItemParamsSchema.parse({ foodId }), { foodId });
});

test("a food identifier that is not a UUID is rejected", () => {
  const result = cartItemParamsSchema.safeParse({ foodId: "not-a-uuid" });

  assert.equal(result.success, false);
  assert.equal(result.error.issues[0].path.join("."), "foodId");
  assert.match(result.error.issues[0].message, /UUID/i);
});

test("a numeric identifier is rejected, so cart lines cannot be walked", () => {
  assert.equal(cartItemParamsSchema.safeParse({ foodId: "1" }).success, false);
});

// --- Adding an item ------------------------------------------------------------------------------

test("a well-formed addition is accepted", () => {
  assert.deepEqual(addCartItemSchema.parse({ foodId, quantity: 2 }), { foodId, quantity: 2 });
});

test("an addition without a food identifier is rejected", () => {
  const result = addCartItemSchema.safeParse({ quantity: 1 });

  assert.equal(result.success, false);
  assert.deepEqual(
    result.error.issues.map((issue) => issue.path.join(".")),
    ["foodId"],
  );
});

test("an addition without a quantity is rejected", () => {
  const result = addCartItemSchema.safeParse({ foodId });

  assert.equal(result.success, false);
  assert.deepEqual(
    result.error.issues.map((issue) => issue.path.join(".")),
    ["quantity"],
  );
});

test("both malformed fields are reported at once", () => {
  const result = addCartItemSchema.safeParse({ foodId: "nope", quantity: 0 });

  assert.equal(result.success, false);
  assert.deepEqual(
    result.error.issues.map((issue) => issue.path.join(".")).sort(),
    ["foodId", "quantity"],
  );
});

test("an unknown field in the body is discarded rather than rejected", () => {
  // Zod strips what it was not asked about, which is why a priceMinor sent by a client cannot
  // reach any code that might trust it.
  assert.deepEqual(addCartItemSchema.parse({ foodId, quantity: 1, priceMinor: 1 }), {
    foodId,
    quantity: 1,
  });
});

// --- Quantity ------------------------------------------------------------------------------------

test("a quantity of zero is rejected", () => {
  // The same rule the database states as CHECK (quantity > 0), applied early so it arrives as a
  // per-field validation failure rather than a constraint violation.
  const result = updateCartItemSchema.safeParse({ quantity: 0 });

  assert.equal(result.success, false);
  assert.equal(result.error.issues[0].path.join("."), "quantity");
});

test("a negative quantity is rejected", () => {
  assert.equal(updateCartItemSchema.safeParse({ quantity: -1 }).success, false);
});

test("a fractional quantity is rejected", () => {
  assert.equal(updateCartItemSchema.safeParse({ quantity: 1.5 }).success, false);
});

test("a quantity sent as a string is rejected rather than coerced", () => {
  assert.equal(updateCartItemSchema.safeParse({ quantity: "2" }).success, false);
});

test("a quantity beyond the stored integer range is rejected", () => {
  // Without this the value would reach PostgreSQL, overflow the integer column, and surface as an
  // unhandled failure instead of a validation error.
  assert.equal(updateCartItemSchema.safeParse({ quantity: MAX_QUANTITY }).success, true);
  assert.equal(updateCartItemSchema.safeParse({ quantity: MAX_QUANTITY + 1 }).success, false);
});

test("a quantity that is not a number at all is rejected", () => {
  for (const quantity of [null, true, [], {}, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(
      updateCartItemSchema.safeParse({ quantity }).success,
      false,
      `${String(quantity)} must be refused`,
    );
  }
});

test("an update body carrying a food identifier discards it", () => {
  // The path names the line. A body that disagreed with it must not be able to redirect the write.
  assert.deepEqual(updateCartItemSchema.parse({ quantity: 3, foodId }), { quantity: 3 });
});

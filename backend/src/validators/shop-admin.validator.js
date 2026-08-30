const { z } = require("zod");

// The path parameter schemas are shared with browsing rather than redeclared: an administrator
// addresses a shop and a food by exactly the same identifiers a student reads them by.
const { foodParamsSchema, shopParamsSchema } = require("./shop.validator");

// The range of the PostgreSQL integer column each of these is stored in. This is a storage bound,
// not a rule about what a price or a stock level may be — the architecture states neither, and
// inventing one here would put a product decision in a validator.
const MAX_INT32 = 2_147_483_647;
const MIN_INT32 = -2_147_483_648;

// Trimmed at the edge so that a name differing only by surrounding whitespace is not stored as a
// second distinct value. No maximum length: the column is text, the architecture sets no limit,
// and the 100kb body cap already bounds the request.
const nameSchema = z
  .string("must be a string")
  .trim()
  .min(1, "must not be empty");

// Non-negative rather than positive: a free item is not obviously an error, while a negative price
// contradicts what money is. Money stays an integer in minor units and is never formatted.
const priceMinorSchema = z
  .int("must be a whole number")
  .nonnegative("must not be negative")
  .max(MAX_INT32, `must be at most ${MAX_INT32}`);

// Mirrors CHECK (stock_quantity >= 0), which remains the final boundary. Only creation sets an
// absolute quantity; every later change is a delta.
const stockQuantitySchema = z
  .int("must be a whole number")
  .nonnegative("must not be negative")
  .max(MAX_INT32, `must be at most ${MAX_INT32}`);

// A signed change, not a replacement. Zero is refused because the request would then ask for
// nothing while still reporting success, which hides a client bug rather than surfacing it.
const stockDeltaSchema = z.object({
  delta: z
    .int("must be a whole number")
    .refine((value) => value !== 0, "must not be zero")
    .min(MIN_INT32, `must be at least ${MIN_INT32}`)
    .max(MAX_INT32, `must be at most ${MAX_INT32}`),
});

const createShopSchema = z.object({
  name: nameSchema,
});

// Every field optional, but at least one required: an empty patch describes no change and would
// otherwise move updated_at while doing nothing.
const updateShopSchema = createShopSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  "must change at least one field",
);

// stockQuantity is accepted here and only here. Zod strips unknown keys, so sending it to the
// update endpoint below discards it before any code can read it — the same protection that keeps a
// client-supplied role out of registration.
const createFoodSchema = z.object({
  name: nameSchema,
  priceMinor: priceMinorSchema,
  stockQuantity: stockQuantitySchema,
});

// shopId and foodId are absent on purpose as well as stockQuantity: a food does not move between
// shops, and the path already names which food is being changed.
const updateFoodSchema = z
  .object({
    name: nameSchema,
    priceMinor: priceMinorSchema,
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "must change at least one field");

module.exports = {
  MAX_INT32,
  MIN_INT32,
  createFoodSchema,
  createShopSchema,
  foodParamsSchema,
  shopParamsSchema,
  stockDeltaSchema,
  updateFoodSchema,
  updateShopSchema,
};

const { z } = require("zod");

// Identifiers reach these routes as path segments, which are always strings and always
// client-supplied. Checking the shape here means the service can hand the value straight to Prisma,
// and a caller probing with a non-identifier gets the standard validation response rather than a
// database error.
const identifier = z.uuid("must be a valid UUID");

const shopParamsSchema = z.object({
  shopId: identifier,
});

// A food is only ever addressed through its shop, so both identifiers are required together and
// the pair is what the service scopes on.
const foodParamsSchema = z.object({
  shopId: identifier,
  foodId: identifier,
});

module.exports = { foodParamsSchema, shopParamsSchema };

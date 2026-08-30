const { z } = require("zod");

const identifier = z.uuid("must be a valid UUID");

// A cart line is addressed by the food it holds rather than by its own row id. The cart is a
// singleton belonging to the caller and a food appears in it at most once, so the food identifier
// already names one line unambiguously — and it is the identifier the client already has from the
// catalogue, so nothing needs to be read back before an item can be changed or removed.
const cartItemParamsSchema = z.object({
  foodId: identifier,
});

// cart_items carries CHECK (quantity > 0), and that constraint remains the final word. Repeating
// the rule here turns what would surface as a database failure into the standard per-field
// validation response. The upper bound is the range of the PostgreSQL integer column the value is
// stored in, not a policy about how much anyone may order.
const MAX_QUANTITY = 2_147_483_647;

const quantitySchema = z
  .int("must be a whole number")
  .positive("must be greater than zero")
  .max(MAX_QUANTITY, `must be at most ${MAX_QUANTITY}`);

// quantity is the amount to add rather than the resulting total, because this is what an "add to
// cart" action reports: adding two of something already in the cart asks for two more of it.
const addCartItemSchema = z.object({
  foodId: identifier,
  quantity: quantitySchema,
});

// quantity here is the resulting total, not a change to it, because this endpoint exists for a
// quantity field the user typed a number into. Zod strips unknown keys, so a foodId sent in the
// body is discarded rather than allowed to disagree with the one in the path.
const updateCartItemSchema = z.object({
  quantity: quantitySchema,
});

module.exports = {
  MAX_QUANTITY,
  addCartItemSchema,
  cartItemParamsSchema,
  updateCartItemSchema,
};

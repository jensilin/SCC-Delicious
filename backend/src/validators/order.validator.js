const { OrderStatus } = require("@prisma/client");
const { z } = require("zod");

// The idempotency key travels in a header rather than in the body. Every value checkout uses — the
// cart, its shop, the quantities, the prices, the buyer — is server state, so a body field would be
// the only place in this API where the body carries transport metadata rather than resource data.
//
// Node lowercases incoming header names, so the schema key is the lowercase form. The per-field
// detail a validation failure produces therefore names the header as the client wrote it.
const IDEMPOTENCY_KEY_HEADER = "idempotency-key";

// The floor is not cosmetic. orders.idempotency_key is unique across the whole table rather than per
// user, so a one-character key would be consumed table-wide by whoever sent it first and every later
// user of it would be refused. Sixteen characters over this alphabet makes an accidental collision
// between independent clients negligible.
//
// The ceiling comes from storage rather than from policy: the value sits in a unique btree index,
// which cannot hold an arbitrarily long entry. 128 is far below that limit and comfortably above
// every real generator — a UUID is 36 characters and base64url of 32 random bytes is 43.
const MIN_IDEMPOTENCY_KEY_LENGTH = 16;
const MAX_IDEMPOTENCY_KEY_LENGTH = 128;

// The key is opaque: the server only ever compares it for equality, never parses it, so no format is
// imposed beyond what is safe to carry in a header and store in an index. A UUID satisfies this but
// is not required, because a client already holding a good random token should not have to convert
// it.
//
// The character rule is also what refuses a duplicated header. Node joins repeated request headers
// with ", ", and neither the comma nor the space is allowed here, so sending the header twice is a
// validation failure rather than a silent choice between the two values.
//
// Not trimmed and not case-folded, deliberately: both are silent transformations, and a key the
// server stored would then not be the key the client sent. Whitespace is refused rather than
// removed.
const idempotencyKeySchema = z
  .string("must be a string")
  .min(MIN_IDEMPOTENCY_KEY_LENGTH, `must be at least ${MIN_IDEMPOTENCY_KEY_LENGTH} characters`)
  .max(MAX_IDEMPOTENCY_KEY_LENGTH, `must be at most ${MAX_IDEMPOTENCY_KEY_LENGTH} characters`)
  .regex(/^[A-Za-z0-9_-]+$/, "must contain only letters, digits, hyphens, and underscores");

// Zod strips unknown keys, so every other header on the request is discarded before the handler
// runs and request.validated.headers holds this one value and nothing else.
const checkoutHeadersSchema = z.object({
  [IDEMPOTENCY_KEY_HEADER]: idempotencyKeySchema,
});

// --- Reading and moving an existing order --------------------------------------------------------

// An order id arrives as a path segment, which is always a string and always client-supplied.
// Checking its shape here means the service can hand the value straight to Prisma, and a caller
// probing with a non-identifier gets the standard validation response rather than a database error.
const orderParamsSchema = z.object({
  orderId: z.uuid("must be a valid UUID"),
});

// Read from the generated enum rather than written out again, so the statuses this API accepts
// cannot drift from the ones the column permits. Adding a value to the schema's enum adds it here.
const ORDER_STATUSES = Object.values(OrderStatus);

// Every member of the enum is accepted, including PLACED, which no transition targets. Whether a
// value is a status at all is this schema's question; whether a move to it is legal from where the
// order currently stands belongs to the transition table, which refuses with ORDER_STATUS_CONFLICT.
//
// Splitting that between the two would make the code a caller receives depend on which illegal move
// they attempted — 400 for asking to go back to PLACED, 409 for asking to skip to COMPLETED — when
// the answer to both is the same: that is not a move you can make on this order.
const statusChangeSchema = z.object({
  status: z.enum(ORDER_STATUSES, `must be one of ${ORDER_STATUSES.join(", ")}`),
});

module.exports = {
  IDEMPOTENCY_KEY_HEADER,
  MAX_IDEMPOTENCY_KEY_LENGTH,
  MIN_IDEMPOTENCY_KEY_LENGTH,
  ORDER_STATUSES,
  checkoutHeadersSchema,
  idempotencyKeySchema,
  orderParamsSchema,
  statusChangeSchema,
};

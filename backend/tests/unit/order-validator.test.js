require("../setup");

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { test } = require("node:test");

const {
  IDEMPOTENCY_KEY_HEADER,
  MAX_IDEMPOTENCY_KEY_LENGTH,
  MIN_IDEMPOTENCY_KEY_LENGTH,
  ORDER_STATUSES,
  checkoutHeadersSchema,
  orderParamsSchema,
  statusChangeSchema,
} = require("../../src/validators/order.validator");

function headers(key) {
  return { [IDEMPOTENCY_KEY_HEADER]: key };
}

function reject(key) {
  const result = checkoutHeadersSchema.safeParse(headers(key));

  assert.equal(result.success, false, `expected ${JSON.stringify(key)} to be rejected`);

  return result.error.issues;
}

// --- The key itself ------------------------------------------------------------------------------

test("a UUID is accepted, which is what a client is asked to generate", () => {
  const key = crypto.randomUUID();

  assert.deepEqual(checkoutHeadersSchema.parse(headers(key)), headers(key));
});

test("any opaque token of the permitted alphabet is accepted, not only a UUID", () => {
  for (const key of [
    crypto.randomBytes(16).toString("hex"),
    "abcdefghijklmnop",
    "A_B-c0123456789_",
    "-".repeat(MIN_IDEMPOTENCY_KEY_LENGTH),
  ]) {
    assert.deepEqual(checkoutHeadersSchema.parse(headers(key)), headers(key));
  }
});

test("a missing header is rejected", () => {
  const result = checkoutHeadersSchema.safeParse({});

  assert.equal(result.success, false);
  assert.equal(result.error.issues[0].path.join("."), IDEMPOTENCY_KEY_HEADER);
});

test("the failing field is named as the client wrote the header", () => {
  assert.equal(reject("")[0].path.join("."), "idempotency-key");
});

// --- Length -------------------------------------------------------------------------------------

test("one character below the minimum is rejected", () => {
  const issues = reject("a".repeat(MIN_IDEMPOTENCY_KEY_LENGTH - 1));

  assert.match(issues[0].message, new RegExp(`${MIN_IDEMPOTENCY_KEY_LENGTH}`));
});

test("exactly the minimum is accepted", () => {
  const key = "a".repeat(MIN_IDEMPOTENCY_KEY_LENGTH);

  assert.deepEqual(checkoutHeadersSchema.parse(headers(key)), headers(key));
});

test("exactly the maximum is accepted", () => {
  const key = "a".repeat(MAX_IDEMPOTENCY_KEY_LENGTH);

  assert.deepEqual(checkoutHeadersSchema.parse(headers(key)), headers(key));
});

test("one character above the maximum is rejected, because the value lives in a unique index", () => {
  const issues = reject("a".repeat(MAX_IDEMPOTENCY_KEY_LENGTH + 1));

  assert.match(issues[0].message, new RegExp(`${MAX_IDEMPOTENCY_KEY_LENGTH}`));
});

test("an empty key is rejected", () => {
  assert.ok(reject("").length > 0);
});

// --- Character rule -----------------------------------------------------------------------------

test("characters outside the alphabet are rejected", () => {
  for (const key of [
    "0123456789abcde!",
    "0123456789abcd.e",
    "0123456789abcd/e",
    "0123456789abcd:e",
    "key with spaces!!",
    '0123456789abcd"e',
  ]) {
    assert.ok(reject(key).length > 0, `expected ${key} to be rejected`);
  }
});

test("interior whitespace is rejected rather than trimmed away", () => {
  assert.ok(reject("0123456789 abcdef").length > 0);
});

test("surrounding whitespace is rejected, because the key is never trimmed", () => {
  const key = crypto.randomUUID();

  assert.ok(reject(` ${key}`).length > 0);
  assert.ok(reject(`${key} `).length > 0);
});

test("a duplicated header is rejected, because Node joins repeats with a comma and a space", () => {
  // Two Idempotency-Key headers on one request arrive as a single joined value. Neither the comma nor
  // the space is in the alphabet, so this is a validation failure rather than a silent choice between
  // the two keys the client sent.
  assert.ok(reject(`${crypto.randomUUID()}, ${crypto.randomUUID()}`).length > 0);
});

test("a non-string value is rejected", () => {
  for (const key of [42, null, undefined, {}, ["a".repeat(20)]]) {
    assert.equal(checkoutHeadersSchema.safeParse(headers(key)).success, false);
  }
});

// --- What the schema does not do ----------------------------------------------------------------

test("the key is returned exactly as sent: not trimmed, not case-folded", () => {
  const key = "AbCdEfGhIjKlMnOp";

  assert.equal(checkoutHeadersSchema.parse(headers(key))[IDEMPOTENCY_KEY_HEADER], key);
});

test("case is significant, so two keys differing only in case are two different keys", () => {
  const lower = "abcdefghijklmnop";
  const upper = lower.toUpperCase();

  assert.notEqual(
    checkoutHeadersSchema.parse(headers(lower))[IDEMPOTENCY_KEY_HEADER],
    checkoutHeadersSchema.parse(headers(upper))[IDEMPOTENCY_KEY_HEADER],
  );
});

test("every other header is stripped, so a handler cannot read unchecked input", () => {
  const key = crypto.randomUUID();
  const parsed = checkoutHeadersSchema.parse({
    ...headers(key),
    authorization: "Bearer something",
    "content-type": "application/json",
    "x-forwarded-for": "203.0.113.1",
  });

  assert.deepEqual(Object.keys(parsed), [IDEMPOTENCY_KEY_HEADER]);
});

// --- The order id in the path --------------------------------------------------------------------

test("a UUID is accepted as an order id", () => {
  const orderId = crypto.randomUUID();

  assert.deepEqual(orderParamsSchema.parse({ orderId }), { orderId });
});

test("anything that is not a UUID is rejected, and the failing field is named", () => {
  for (const orderId of ["", "1", "not-a-uuid", crypto.randomUUID().replace(/-/g, ""), 42, null]) {
    const result = orderParamsSchema.safeParse({ orderId });

    assert.equal(result.success, false, `expected ${JSON.stringify(orderId)} to be rejected`);
    assert.equal(result.error.issues[0].path.join("."), "orderId");
  }
});

test("a missing order id is rejected rather than treated as a collection request", () => {
  assert.equal(orderParamsSchema.safeParse({}).success, false);
});

// --- The status a change asks for ----------------------------------------------------------------

test("the accepted vocabulary is the database's own order statuses", () => {
  // Read from the generated enum rather than listed again, so this is the schema's five values and
  // not a copy that could fall behind it.
  assert.deepEqual([...ORDER_STATUSES].sort(), [
    "CANCELLED",
    "COMPLETED",
    "PLACED",
    "PREPARING",
    "READY",
  ]);
});

test("every status the column permits is accepted by the schema", () => {
  // Including PLACED, which no transition targets. Whether a value is a status at all is this
  // schema's question; whether the move is legal belongs to the transition table, which refuses with
  // ORDER_STATUS_CONFLICT rather than a validation failure.
  for (const status of ORDER_STATUSES) {
    assert.deepEqual(statusChangeSchema.parse({ status }), { status });
  }
});

test("a status outside the enum is rejected and the message lists the real ones", () => {
  const result = statusChangeSchema.safeParse({ status: "PREPARED" });

  assert.equal(result.success, false);
  assert.equal(result.error.issues[0].path.join("."), "status");

  for (const status of ORDER_STATUSES) {
    assert.match(result.error.issues[0].message, new RegExp(status));
  }
});

test("a status is case-sensitive and is never coerced", () => {
  for (const status of ["placed", "Cancelled", "READY ", " READY", 1, true, null, ["READY"]]) {
    assert.equal(
      statusChangeSchema.safeParse({ status }).success,
      false,
      `expected ${JSON.stringify(status)} to be rejected`,
    );
  }
});

test("a body with no status is rejected", () => {
  assert.equal(statusChangeSchema.safeParse({}).success, false);
});

test("every other field in the body is stripped, so nothing else can be patched", () => {
  const parsed = statusChangeSchema.parse({
    status: "PREPARING",
    totalMinor: 1,
    userId: crypto.randomUUID(),
    items: [],
  });

  assert.deepEqual(Object.keys(parsed), ["status"]);
});

require("../setup");

const assert = require("node:assert/strict");
const { test } = require("node:test");

const { env } = require("../../src/config/env");
const { MAX_PASSWORD_BYTES, hashPassword, verifyPassword } = require("../../src/lib/password");

const password = "test-password-123";

test("a hash is bcrypt output at the configured cost", async () => {
  const hash = await hashPassword(password);

  // The cost is embedded in the hash, so this asserts the configured value was actually applied
  // rather than a library default.
  assert.match(hash, new RegExp(`^\\$2[aby]\\$${env.BCRYPT_COST}\\$`));
});

test("a hash never contains the password", async () => {
  const hash = await hashPassword(password);

  assert.ok(!hash.includes(password));
});

test("the same password hashes differently every time", async () => {
  const [first, second] = await Promise.all([hashPassword(password), hashPassword(password)]);

  // Distinct salts. Equal hashes would mean identical passwords are identifiable across accounts.
  assert.notEqual(first, second);
});

test("the correct password verifies against its hash", async () => {
  assert.equal(await verifyPassword(password, await hashPassword(password)), true);
});

test("a wrong password does not verify", async () => {
  assert.equal(await verifyPassword("not-the-password", await hashPassword(password)), false);
});

test("verification is case sensitive", async () => {
  assert.equal(await verifyPassword(password.toUpperCase(), await hashPassword(password)), false);
});

test("bcrypt ignores input past its byte limit, which is why the schema caps it", async () => {
  // Not a bug being tested but the reason MAX_PASSWORD_BYTES exists: two different passwords
  // sharing a 72-byte prefix are interchangeable, so the validator refuses anything longer.
  const atLimit = "a".repeat(MAX_PASSWORD_BYTES);
  const pastLimit = `${atLimit}-a-completely-different-ending`;

  assert.equal(await verifyPassword(pastLimit, await hashPassword(atLimit)), true);
});

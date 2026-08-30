require("../setup");

const assert = require("node:assert/strict");
const { test } = require("node:test");

const { MAX_PASSWORD_BYTES } = require("../../src/lib/password");
const { loginSchema, registerSchema } = require("../../src/validators/auth.validator");

const validRegistration = { email: "Student@Example.com", password: "test-password-123" };

test("registration lower-cases the email", () => {
  const { email } = registerSchema.parse(validRegistration);

  assert.equal(email, "student@example.com");
});

test("registration trims surrounding whitespace from the email", () => {
  const { email } = registerSchema.parse({ ...validRegistration, email: "  Student@Example.com  " });

  assert.equal(email, "student@example.com");
});

test("registration rejects a malformed email", () => {
  const result = registerSchema.safeParse({ ...validRegistration, email: "not-an-email" });

  assert.equal(result.success, false);
  assert.deepEqual(
    result.error.issues.map((issue) => issue.path.join(".")),
    ["email"],
  );
});

test("registration rejects a password under 8 characters", () => {
  const result = registerSchema.safeParse({ ...validRegistration, password: "1234567" });

  assert.equal(result.success, false);
  assert.match(result.error.issues[0].message, /at least 8/);
});

test("registration accepts a password of exactly 8 characters", () => {
  assert.equal(registerSchema.safeParse({ ...validRegistration, password: "12345678" }).success, true);
});

test("registration imposes no character-composition rules", () => {
  // Deliberate: length is the requirement, and complexity rules were decided against.
  assert.equal(
    registerSchema.safeParse({ ...validRegistration, password: "aaaaaaaaaaaa" }).success,
    true,
  );
});

test("registration rejects a password longer than bcrypt reads", () => {
  const result = registerSchema.safeParse({
    ...validRegistration,
    password: "a".repeat(MAX_PASSWORD_BYTES + 1),
  });

  assert.equal(result.success, false);
});

test("the byte limit counts bytes, not characters", () => {
  // Each of these is one character and four bytes, so 18 of them exceed 72 bytes while looking
  // well short of the limit to anything counting characters.
  const result = registerSchema.safeParse({ ...validRegistration, password: "😀".repeat(19) });

  assert.equal(result.success, false);
});

test("registration discards a client-supplied role", () => {
  const parsed = registerSchema.parse({ ...validRegistration, role: "ADMIN" });

  assert.equal(parsed.role, undefined);
  assert.deepEqual(Object.keys(parsed).sort(), ["email", "password"]);
});

test("registration reports every invalid field at once", () => {
  const result = registerSchema.safeParse({ email: "nope", password: "short" });

  assert.equal(result.success, false);
  assert.deepEqual(
    result.error.issues.map((issue) => issue.path.join(".")).sort(),
    ["email", "password"],
  );
});

test("login lower-cases the email too", () => {
  const { email } = loginSchema.parse({ email: "Student@Example.com", password: "x" });

  assert.equal(email, "student@example.com");
});

test("login accepts a password that would fail registration", () => {
  // Sign-in must not apply the registration policy: it would reject accounts created under an
  // older rule, and it would let a caller discover the policy without authenticating.
  assert.equal(loginSchema.safeParse({ email: "student@example.com", password: "x" }).success, true);
});

test("login still requires a password to be present", () => {
  assert.equal(loginSchema.safeParse({ email: "student@example.com", password: "" }).success, false);
});

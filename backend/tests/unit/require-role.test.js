require("../setup");

const assert = require("node:assert/strict");
const { test } = require("node:test");

const { requireRole } = require("../../src/middleware/require-role.middleware");

// The middleware touches only request.auth and next, so a plain object stands in for the request.
function run(middleware, request) {
  return new Promise((resolve) => {
    middleware(request, {}, (error) => resolve(error));
  });
}

test("a caller with the required role passes through", async () => {
  const error = await run(requireRole("ADMIN"), { auth: { userId: "u", role: "ADMIN" } });

  assert.equal(error, undefined);
});

test("a STUDENT is refused from an ADMIN-only router", async () => {
  const error = await run(requireRole("ADMIN"), { auth: { userId: "u", role: "STUDENT" } });

  assert.equal(error.statusCode, 403);
  assert.equal(error.code, "FORBIDDEN");
});

test("any one of several permitted roles is accepted", async () => {
  const error = await run(requireRole("STUDENT", "ADMIN"), { auth: { userId: "u", role: "STUDENT" } });

  assert.equal(error, undefined);
});

test("an unauthenticated request is refused with 401, not 403", async () => {
  // Reachable only by mounting this without authenticate first. It must fail closed rather than
  // read a role from an absent identity.
  const error = await run(requireRole("ADMIN"), {});

  assert.equal(error.statusCode, 401);
  assert.equal(error.code, "UNAUTHENTICATED");
});

test("an unrecognised role is refused", async () => {
  const error = await run(requireRole("ADMIN"), { auth: { userId: "u", role: "SUPERUSER" } });

  assert.equal(error.statusCode, 403);
});

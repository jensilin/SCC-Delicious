require("../setup");

const assert = require("node:assert/strict");
const { after, before, beforeEach, test } = require("node:test");

const { prisma } = require("../../src/config/prisma");
const {
  DEFAULT_PASSWORD,
  authorizationHeader,
  createSignedInUser,
  createUser,
  refreshCookieHeader,
  refreshCookieValue,
  signIn,
} = require("../helpers/auth");
const { resetDatabase } = require("../helpers/database");
const { startTestServer, stopTestServer } = require("../helpers/server");

let server;
let baseUrl;

before(async () => {
  ({ server, baseUrl } = await startTestServer());
});

// Every test starts from an empty database, so no test can pass because of a row another one left.
beforeEach(resetDatabase);

after(async () => {
  await stopTestServer(server);
  await prisma.$disconnect();
});

function post(path, { body, headers } = {}) {
  return fetch(`${baseUrl}/api/v1/auth${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const credentials = { email: "student@example.com", password: DEFAULT_PASSWORD };

// --- Registration ---------------------------------------------------------------------------

test("registration creates a STUDENT and returns a session", async () => {
  const response = await post("/register", { body: credentials });
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.user.email, credentials.email);
  assert.equal(body.user.role, "STUDENT");
  assert.ok(body.accessToken, "an access token is returned so registration signs the user in");
});

test("the registered account is persisted as a STUDENT", async () => {
  await post("/register", { body: credentials });

  const stored = await prisma.user.findUnique({ where: { email: credentials.email } });

  assert.equal(stored.role, "STUDENT");
  assert.notEqual(stored.passwordHash, credentials.password, "the password must not be stored as given");
});

test("registration cannot be talked into creating an ADMIN", async () => {
  const response = await post("/register", { body: { ...credentials, role: "ADMIN" } });
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.user.role, "STUDENT");

  const stored = await prisma.user.findUnique({ where: { email: credentials.email } });

  assert.equal(stored.role, "STUDENT", "the role in the request body must be ignored entirely");
});

test("registration stores the email lower-cased", async () => {
  await post("/register", { body: { ...credentials, email: "Student@Example.COM" } });

  assert.ok(await prisma.user.findUnique({ where: { email: "student@example.com" } }));
});

test("a duplicate registration is refused and creates nothing", async () => {
  await post("/register", { body: credentials });

  const response = await post("/register", { body: credentials });
  const body = await response.json();

  assert.equal(response.status, 409);
  assert.equal(body.error.code, "EMAIL_ALREADY_REGISTERED");
  assert.equal(await prisma.user.count(), 1);
});

test("a duplicate is detected regardless of the capitalisation used", async () => {
  await post("/register", { body: credentials });

  const response = await post("/register", { body: { ...credentials, email: "STUDENT@EXAMPLE.COM" } });

  assert.equal(response.status, 409);
  assert.equal(await prisma.user.count(), 1);
});

test("an invalid registration reports which fields failed", async () => {
  const response = await post("/register", { body: { email: "not-an-email", password: "short" } });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.error.code, "VALIDATION_ERROR");
  assert.deepEqual(body.error.details.map((detail) => detail.field).sort(), ["email", "password"]);
  assert.equal(await prisma.user.count(), 0);
});

test("a registration with no body at all is refused, not crashed on", async () => {
  const response = await post("/register");

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "VALIDATION_ERROR");
});

// --- Login ----------------------------------------------------------------------------------

test("a correct password signs the user in", async () => {
  const user = await createUser({ email: credentials.email });
  const response = await post("/login", { body: credentials });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.user.id, user.id);
  assert.ok(body.accessToken);
});

test("login accepts the email in any capitalisation", async () => {
  await createUser({ email: credentials.email });

  const response = await post("/login", { body: { ...credentials, email: "STUDENT@example.com" } });

  assert.equal(response.status, 200);
});

test("an unknown email and a wrong password are indistinguishable", async () => {
  await createUser({ email: credentials.email });

  const unknownEmail = await post("/login", { body: { ...credentials, email: "nobody@example.com" } });
  const wrongPassword = await post("/login", { body: { ...credentials, password: "wrong-password" } });

  assert.equal(unknownEmail.status, 401);
  assert.equal(wrongPassword.status, 401);

  // Identical bodies, not merely identical status codes: any difference at all would turn this
  // endpoint into a way to find out who has an account.
  assert.deepEqual(await unknownEmail.json(), await wrongPassword.json());
});

test("a failed login neither names the reason nor echoes the attempt", async () => {
  const response = await post("/login", { body: credentials });
  const text = await response.text();

  assert.equal(JSON.parse(text).error.code, "INVALID_CREDENTIALS");
  assert.ok(!text.includes(credentials.email), "the attempted address must not be reflected back");
  assert.ok(!text.includes(credentials.password));
});

// --- The refresh cookie ---------------------------------------------------------------------

test("the refresh cookie is httpOnly, scoped, and SameSite=Strict", async () => {
  const response = await post("/register", { body: credentials });
  const cookie = refreshCookieHeader(response);

  assert.ok(cookie, "registration must set the refresh cookie");
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /Path=\/api\/v1\/auth/);
  assert.match(cookie, /SameSite=Strict/i);
  assert.match(cookie, /Max-Age=\d+/);
});

test("the cookie is not marked Secure outside production, so local HTTP can carry it", async () => {
  const cookie = refreshCookieHeader(await post("/register", { body: credentials }));

  assert.ok(!/Secure/i.test(cookie));
});

test("the refresh token never appears in a response body", async () => {
  const response = await post("/register", { body: credentials });
  const cookie = refreshCookieValue(response).split("=").slice(1).join("=");
  const text = await response.text();

  assert.ok(cookie.length > 0);
  assert.ok(!text.includes(cookie), "the refresh token belongs only in the cookie");
});

// --- Refresh --------------------------------------------------------------------------------

test("the refresh cookie buys a new access token", async () => {
  const { refreshCookie } = await createSignedInUser(baseUrl);
  const response = await post("/refresh", { headers: { cookie: refreshCookie } });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.ok(body.accessToken);
  assert.equal(body.refreshToken, undefined);
});

test("the access token from a refresh is usable", async () => {
  const { user, refreshCookie } = await createSignedInUser(baseUrl);
  const { accessToken } = await (await post("/refresh", { headers: { cookie: refreshCookie } })).json();

  const me = await fetch(`${baseUrl}/api/v1/auth/me`, { headers: authorizationHeader(accessToken) });

  assert.equal(me.status, 200);
  assert.equal((await me.json()).id, user.id);
});

test("refreshing without a cookie is refused", async () => {
  const response = await post("/refresh");

  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, "INVALID_REFRESH_TOKEN");
});

test("a garbage cookie value is refused", async () => {
  const response = await post("/refresh", { headers: { cookie: "refresh_token=not-a-token" } });

  assert.equal(response.status, 401);
});

test("an access token presented as the refresh cookie is refused", async () => {
  const { accessToken } = await createSignedInUser(baseUrl);
  const response = await post("/refresh", { headers: { cookie: `refresh_token=${accessToken}` } });

  assert.equal(response.status, 401);
});

test("a refresh token for a deleted account is refused", async () => {
  const { user, refreshCookie } = await createSignedInUser(baseUrl);

  await prisma.user.delete({ where: { id: user.id } });

  const response = await post("/refresh", { headers: { cookie: refreshCookie } });

  assert.equal(response.status, 401);
});

test("a role changed in the database takes effect at the next refresh", async () => {
  // The refresh token carries no role, which is what makes this possible.
  const { user, refreshCookie } = await createSignedInUser(baseUrl, { role: "STUDENT" });

  await prisma.user.update({ where: { id: user.id }, data: { role: "ADMIN" } });

  const { accessToken } = await (await post("/refresh", { headers: { cookie: refreshCookie } })).json();
  const me = await fetch(`${baseUrl}/api/v1/auth/me`, { headers: authorizationHeader(accessToken) });

  assert.equal((await me.json()).role, "ADMIN");
});

// --- Logout ---------------------------------------------------------------------------------

test("logout clears the refresh cookie", async () => {
  const { refreshCookie } = await createSignedInUser(baseUrl);
  const response = await post("/logout", { headers: { cookie: refreshCookie } });

  assert.equal(response.status, 204);

  const cleared = refreshCookieHeader(response);

  assert.match(cleared, /^refresh_token=;/);
  assert.match(cleared, /Expires=Thu, 01 Jan 1970/);
  assert.match(cleared, /Path=\/api\/v1\/auth/);
});

test("logout is idempotent and needs no cookie", async () => {
  const response = await post("/logout");

  assert.equal(response.status, 204);
});

test("logout does not invalidate the token itself, which is the documented v1 limit", async () => {
  // Recorded as a test rather than a comment so the limitation is visible if it ever changes.
  const { refreshCookie } = await createSignedInUser(baseUrl);

  await post("/logout", { headers: { cookie: refreshCookie } });

  const afterLogout = await post("/refresh", { headers: { cookie: refreshCookie } });

  assert.equal(afterLogout.status, 200);
});

// --- Protected access -----------------------------------------------------------------------

test("a valid access token reaches a protected route", async () => {
  const { user, accessToken } = await createSignedInUser(baseUrl);
  const response = await fetch(`${baseUrl}/api/v1/auth/me`, { headers: authorizationHeader(accessToken) });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.id, user.id);
  assert.deepEqual(Object.keys(body).sort(), ["createdAt", "email", "id", "role"]);
});

test("an ADMIN reaches a protected route and is reported as ADMIN", async () => {
  const { accessToken } = await createSignedInUser(baseUrl, { role: "ADMIN" });
  const response = await fetch(`${baseUrl}/api/v1/auth/me`, { headers: authorizationHeader(accessToken) });

  assert.equal(response.status, 200);
  assert.equal((await response.json()).role, "ADMIN");
});

test("a protected route rejects a missing token", async () => {
  const response = await fetch(`${baseUrl}/api/v1/auth/me`);

  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, "UNAUTHENTICATED");
});

test("a protected route rejects a malformed Authorization header", async () => {
  const { accessToken } = await createSignedInUser(baseUrl);
  const response = await fetch(`${baseUrl}/api/v1/auth/me`, {
    headers: { authorization: accessToken },
  });

  assert.equal(response.status, 401);
});

test("a protected route rejects a forged token", async () => {
  const { accessToken } = await createSignedInUser(baseUrl);
  const [header, payload] = accessToken.split(".");
  const response = await fetch(`${baseUrl}/api/v1/auth/me`, {
    headers: authorizationHeader(`${header}.${payload}.wrong-signature`),
  });

  assert.equal(response.status, 401);
});

test("a refresh token is not accepted as a bearer token", async () => {
  const { refreshCookie } = await createSignedInUser(baseUrl);
  const refreshToken = refreshCookie.split("=").slice(1).join("=");

  const response = await fetch(`${baseUrl}/api/v1/auth/me`, {
    headers: authorizationHeader(refreshToken),
  });

  assert.equal(response.status, 401);
});

// --- What must never be returned --------------------------------------------------------------

test("no authentication response contains a password or its hash", async () => {
  const registration = await post("/register", { body: credentials });
  const registrationText = await registration.text();

  const login = await post("/login", { body: credentials });
  const loginText = await login.text();

  const stored = await prisma.user.findUnique({ where: { email: credentials.email } });

  for (const text of [registrationText, loginText]) {
    assert.ok(!text.includes(stored.passwordHash), "a password hash must never be returned");
    assert.ok(!text.includes(credentials.password), "a password must never be echoed back");
    assert.ok(!/passwordHash/.test(text));
  }
});

test("a signed-in user's record excludes the hash", async () => {
  const { accessToken } = await createSignedInUser(baseUrl);
  const text = await (
    await fetch(`${baseUrl}/api/v1/auth/me`, { headers: authorizationHeader(accessToken) })
  ).text();

  assert.ok(!/passwordHash|\$2[aby]\$/.test(text));
});

test("an unknown authentication route is a 404 in the standard error shape", async () => {
  const response = await post("/nonexistent");
  const body = await response.json();

  assert.equal(response.status, 404);
  assert.equal(body.error.code, "NOT_FOUND");
});

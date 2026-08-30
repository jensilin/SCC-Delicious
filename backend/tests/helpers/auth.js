const crypto = require("node:crypto");

const { prisma } = require("../../src/config/prisma");
const { REFRESH_COOKIE_NAME } = require("../../src/lib/refresh-cookie");
const { hashPassword } = require("../../src/lib/password");

const DEFAULT_PASSWORD = "test-password-123";

// Created through Prisma rather than through the API, because an ADMIN has no endpoint that could
// create it. Using one path for both roles also keeps a test's setup out of the behaviour it is
// checking: a login test should not depend on registration working.
async function createUser({ email, password = DEFAULT_PASSWORD, role = "STUDENT" } = {}) {
  const user = await prisma.user.create({
    data: {
      email: email ?? `user-${crypto.randomUUID()}@example.com`,
      passwordHash: await hashPassword(password),
      role,
    },
  });

  return { ...user, password };
}

// Returns the Set-Cookie entry for the refresh cookie, unparsed, so a test can assert on its
// attributes as the browser would receive them. getSetCookie is used rather than headers.get
// because it keeps multiple cookies separate instead of joining them into one string.
function refreshCookieHeader(response) {
  return response.headers
    .getSetCookie()
    .find((cookie) => cookie.startsWith(`${REFRESH_COOKIE_NAME}=`));
}

// The name=value pair on its own, ready to be sent back in a Cookie request header.
function refreshCookieValue(response) {
  return refreshCookieHeader(response)?.split(";")[0];
}

async function signIn(baseUrl, { email, password = DEFAULT_PASSWORD }) {
  const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  const body = await response.json();

  return {
    response,
    accessToken: body.accessToken,
    refreshCookie: refreshCookieValue(response),
  };
}

// The common arrangement: an existing account of a chosen role, signed in, with both credentials
// ready to use. Anything needing only one of the two still gets it from here.
async function createSignedInUser(baseUrl, { role = "STUDENT", password = DEFAULT_PASSWORD } = {}) {
  const user = await createUser({ password, role });
  const { accessToken, refreshCookie } = await signIn(baseUrl, { email: user.email, password });

  return { user, accessToken, refreshCookie };
}

function authorizationHeader(accessToken) {
  return { authorization: `Bearer ${accessToken}` };
}

module.exports = {
  DEFAULT_PASSWORD,
  authorizationHeader,
  createSignedInUser,
  createUser,
  refreshCookieHeader,
  refreshCookieValue,
  signIn,
};

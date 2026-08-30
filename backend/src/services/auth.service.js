const crypto = require("node:crypto");

const { prisma } = require("../config/prisma");
const { httpError } = require("../lib/http-error");
const { hashPassword, verifyPassword } = require("../lib/password");
const { signAccessToken, signRefreshToken, verifyRefreshToken } = require("../lib/token");

// One message for every sign-in failure. A caller must not be able to tell "no such account" from
// "wrong password", because the difference is a way to discover who has an account here.
function invalidCredentials() {
  return httpError(401, "INVALID_CREDENTIALS", "Invalid email or password");
}

// A password hash is never returned by any endpoint, so the shape that leaves this service simply
// does not contain one. Omitting it here rather than at each call site means a new caller cannot
// forget.
function toPublicUser(user) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt,
  };
}

async function issueSession(user) {
  const [accessToken, refreshToken] = await Promise.all([
    signAccessToken({ userId: user.id, role: user.role }),
    signRefreshToken({ userId: user.id }),
  ]);

  return { user: toPublicUser(user), accessToken, refreshToken };
}

// Hashing a throwaway value so that a sign-in for an unknown email does the same work as one for a
// known email. Without it, the endpoint answers measurably faster for addresses that do not exist,
// which leaks exactly what the shared error message is there to hide. Computed once, on first need,
// rather than at startup, so that no server start pays for it needlessly.
let absentUserHash;

async function getAbsentUserHash() {
  absentUserHash ??= await hashPassword(crypto.randomUUID());

  return absentUserHash;
}

// The role is a literal here and is never taken from the caller's input. Public registration has no
// path to any other value.
//
// Uniqueness is left to the database rather than checked first: a read-then-write pair lets two
// simultaneous registrations for one address both pass the check, while the unique index cannot be
// raced. P2002 is Prisma's unique-constraint violation.
async function registerUser({ email, password }) {
  const passwordHash = await hashPassword(password);

  try {
    const user = await prisma.user.create({
      data: { email, passwordHash, role: "STUDENT" },
    });

    return issueSession(user);
  } catch (error) {
    if (error.code === "P2002") {
      throw httpError(409, "EMAIL_ALREADY_REGISTERED", "That email address is already registered");
    }

    throw error;
  }
}

async function loginUser({ email, password }) {
  const user = await prisma.user.findUnique({ where: { email } });
  const passwordMatches = await verifyPassword(password, user?.passwordHash ?? (await getAbsentUserHash()));

  if (!user || !passwordMatches) {
    throw invalidCredentials();
  }

  return issueSession(user);
}

// The refresh token carries identity only, so the role is read from the database here. That is what
// makes a role change take effect at the next refresh, and it is also how a deleted account stops
// being able to mint new access tokens.
async function refreshAccessToken(refreshToken) {
  if (!refreshToken) {
    throw httpError(401, "INVALID_REFRESH_TOKEN", "A valid refresh token is required");
  }

  let payload;

  try {
    payload = await verifyRefreshToken(refreshToken);
  } catch {
    throw httpError(401, "INVALID_REFRESH_TOKEN", "A valid refresh token is required");
  }

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });

  if (!user) {
    throw httpError(401, "INVALID_REFRESH_TOKEN", "A valid refresh token is required");
  }

  return { accessToken: await signAccessToken({ userId: user.id, role: user.role }) };
}

// Used by the authenticated-profile route. The token already carries the id and role, but reading
// the record confirms the account still exists and is the only way to return anything else about it.
async function getUserById(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId } });

  if (!user) {
    throw httpError(401, "UNAUTHENTICATED", "Authentication required");
  }

  return toPublicUser(user);
}

module.exports = { getUserById, loginUser, refreshAccessToken, registerUser };

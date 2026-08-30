// jose ships as ESM only. Node's require() of an ES module makes it usable from this CommonJS
// codebase without a build step, which is why no bundler or dynamic import appears here.
const { SignJWT, jwtVerify } = require("jose");

const { env } = require("../config/env");

const ALGORITHM = "HS256";

// Encoded once at load rather than per request. Each token type gets its own key so that a refresh
// token cannot be presented where an access token is expected: the signature simply will not
// verify against the other secret.
const accessKey = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
const refreshKey = new TextEncoder().encode(env.JWT_REFRESH_SECRET);

// Exactly the four claims the architecture specifies. No issuer or audience: there is one of each,
// and a claim that never varies proves nothing when it is checked.
async function signAccessToken({ userId, role }) {
  return new SignJWT({ role })
    .setProtectedHeader({ alg: ALGORITHM })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(env.ACCESS_TOKEN_TTL)
    .sign(accessKey);
}

// The refresh token carries identity only. Role is deliberately left out so that refreshing reads
// the current role from the database, which is what lets a role change take effect at all.
async function signRefreshToken({ userId }) {
  return new SignJWT({})
    .setProtectedHeader({ alg: ALGORITHM })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(env.REFRESH_TOKEN_TTL)
    .sign(refreshKey);
}

// Both verifiers throw on a bad signature, a tampered payload, an expired token, or an unexpected
// algorithm. Pinning algorithms is what stops a caller supplying alg: "none" and being believed.
async function verifyAccessToken(token) {
  const { payload } = await jwtVerify(token, accessKey, { algorithms: [ALGORITHM] });

  return payload;
}

async function verifyRefreshToken(token) {
  const { payload } = await jwtVerify(token, refreshKey, { algorithms: [ALGORITHM] });

  return payload;
}

module.exports = { signAccessToken, signRefreshToken, verifyAccessToken, verifyRefreshToken };

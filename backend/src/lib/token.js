const { env } = require("../config/env");

const ALGORITHM = "HS256";

// jose ships as ESM only: its package exports resolve to dist/webapi/*.js and declare no require
// condition, so there is no CommonJS build to reach for. require() of an ES module does work, but
// only on Node 20.19 and 22.12 upwards, and a deployment runtime is not guaranteed to be one of
// those. Where it is not, require("jose") throws ERR_REQUIRE_ESM while this module is still being
// evaluated, which takes down every route rather than only the authenticated ones.
//
// Dynamic import() is the form that works from CommonJS on every version, so it is what loads jose
// here. The specifier is a literal rather than a variable so that static analysis — the file
// tracing a deployment uses to decide what to ship — can still see the dependency.
//
// The promise is created once and reused, and it is deliberately not awaited at load: keeping the
// await inside the functions is what lets this file stay synchronous to require. All four are
// already async, so nothing about their signatures changes. After the first call the module comes
// from the registry already resolved, leaving a microtask.
let josePromise = null;

function loadJose() {
  josePromise ??= import("jose");

  return josePromise;
}

// Encoded once at load rather than per request. Each token type gets its own key so that a refresh
// token cannot be presented where an access token is expected: the signature simply will not
// verify against the other secret.
const accessKey = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
const refreshKey = new TextEncoder().encode(env.JWT_REFRESH_SECRET);

// Exactly the four claims the architecture specifies. No issuer or audience: there is one of each,
// and a claim that never varies proves nothing when it is checked.
async function signAccessToken({ userId, role }) {
  const { SignJWT } = await loadJose();

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
  const { SignJWT } = await loadJose();

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
  const { jwtVerify } = await loadJose();
  const { payload } = await jwtVerify(token, accessKey, { algorithms: [ALGORITHM] });

  return payload;
}

async function verifyRefreshToken(token) {
  const { jwtVerify } = await loadJose();
  const { payload } = await jwtVerify(token, refreshKey, { algorithms: [ALGORITHM] });

  return payload;
}

module.exports = { signAccessToken, signRefreshToken, verifyAccessToken, verifyRefreshToken };

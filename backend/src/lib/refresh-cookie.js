const { env } = require("../config/env");

const REFRESH_COOKIE_NAME = "refresh_token";

// Scoped to the only routes that read it, so the cookie is not attached to ordinary API requests
// and cannot be replayed against them.
const REFRESH_COOKIE_PATH = "/api/v1/auth";

const secondsPerUnit = { s: 1, m: 60, h: 3600, d: 86400 };

// The lifetime is one number in one place: REFRESH_TOKEN_TTL sets both the token's exp claim and
// the cookie's Max-Age, so a browser cannot hold a cookie that outlives the token inside it. The
// format is already validated in config/env.js.
function toSeconds(timeSpan) {
  return Number(timeSpan.slice(0, -1)) * secondsPerUnit[timeSpan.slice(-1)];
}

// Secure is off outside production because the cookie would otherwise never be sent over the plain
// http:// used locally, making the refresh endpoint impossible to exercise in development or tests.
//
// SameSite differs for the same reason the deployment does. In production the browser application
// and the API are served from two Vercel domains, and two Vercel domains are two *sites*:
// `vercel.app` is a public suffix, so `something.vercel.app` is a registrable domain of its own and
// a request from one to another is cross-site. A SameSite=Strict cookie is never attached to a
// cross-site request, so the refresh cookie would be set at login and then never sent back — every
// reload would end the session. `none` is the value that permits it, and a browser accepts that
// value only together with Secure, which production supplies.
//
// Nothing else is loosened, and the token itself is no more exposed than before. HttpOnly still
// keeps it out of JavaScript, so a script on either origin cannot read it. Path still confines it to
// /api/v1/auth, so it rides on four routes rather than on every request. What SameSite=None gives up
// is the guarantee that a request carrying the cookie was initiated by our own site, and what that
// would buy an attacker here is a forged POST to /auth/refresh: it mints an access token into a
// response body that the same-origin policy forbids them from reading, and it changes no state.
const isProduction = env.NODE_ENV === "production";

const cookieOptions = {
  httpOnly: true,
  path: REFRESH_COOKIE_PATH,
  sameSite: isProduction ? "none" : "strict",
  secure: isProduction,
};

function setRefreshCookie(response, refreshToken) {
  response.cookie(REFRESH_COOKIE_NAME, refreshToken, {
    ...cookieOptions,
    maxAge: toSeconds(env.REFRESH_TOKEN_TTL) * 1000,
  });
}

// The attributes must match the ones the cookie was set with, or the browser treats it as a
// different cookie and keeps the original.
function clearRefreshCookie(response) {
  response.clearCookie(REFRESH_COOKIE_NAME, cookieOptions);
}

module.exports = { REFRESH_COOKIE_NAME, clearRefreshCookie, setRefreshCookie };

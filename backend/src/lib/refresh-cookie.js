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
const cookieOptions = {
  httpOnly: true,
  path: REFRESH_COOKIE_PATH,
  sameSite: "strict",
  secure: env.NODE_ENV === "production",
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

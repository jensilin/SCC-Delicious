const { REFRESH_COOKIE_NAME, clearRefreshCookie, setRefreshCookie } = require("../lib/refresh-cookie");
const {
  getUserById,
  loginUser,
  refreshAccessToken,
  registerUser,
} = require("../services/auth.service");

// These handlers do not catch. Express 5 forwards a rejected promise from a handler to the error
// handler on its own, so a thrown httpError reaches the one place that shapes error responses
// without a try/catch around every call. The health controller catches because it answers its own
// failure case with a 503; these do not.
//
// The refresh token is written to the cookie and never into the body. The access token goes in the
// body and never into a cookie: the client holds it in memory, where a cookie could not be kept.

async function register(request, response) {
  const { user, accessToken, refreshToken } = await registerUser(request.validated.body);

  setRefreshCookie(response, refreshToken);
  response.status(201).json({ user, accessToken });
}

async function login(request, response) {
  const { user, accessToken, refreshToken } = await loginUser(request.validated.body);

  setRefreshCookie(response, refreshToken);
  response.status(200).json({ user, accessToken });
}

async function refresh(request, response) {
  const { accessToken } = await refreshAccessToken(request.cookies?.[REFRESH_COOKIE_NAME]);

  response.status(200).json({ accessToken });
}

// Nothing is revoked server-side, because refresh tokens are not stored anywhere to revoke. Logout
// removes the cookie, and the access token expires on its own. This is the documented v1 limit.
//
// It answers 204 unconditionally, including when no cookie was sent: signing out is idempotent, and
// there is no state to be wrong about.
function logout(request, response) {
  clearRefreshCookie(response);
  response.status(204).end();
}

async function me(request, response) {
  const user = await getUserById(request.auth.userId);

  response.status(200).json(user);
}

module.exports = { login, logout, me, refresh, register };

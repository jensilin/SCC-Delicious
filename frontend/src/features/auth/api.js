import { api } from "../../lib/api-client";

// The authentication contract as the backend actually implements it. Register, login and refresh are
// the only endpoints that set or read the refresh cookie, and the access token is only ever returned
// in a response body — never in a cookie, because the client holds it in memory.

/**
 * The public shape of a user. `passwordHash` is omitted at the source in auth.service.js, so no
 * endpoint can return it.
 *
 * @typedef {object} AuthUser
 * @property {string} id UUID.
 * @property {string} email Trimmed and lower-cased by the API before storage.
 * @property {"STUDENT" | "ADMIN"} role Assigned by the server. Registration always produces STUDENT.
 * @property {string} createdAt ISO 8601 timestamp.
 */

/**
 * What register and login return. The refresh token is not here: it arrives as the httpOnly cookie
 * `refresh_token`, scoped to Path=/api/v1/auth, and JavaScript cannot read it.
 *
 * @typedef {object} AuthSession
 * @property {AuthUser} user
 * @property {string} accessToken Short-lived HS256 JWT carrying sub, role, iat and exp.
 */

/**
 * Creates a STUDENT account and signs it in. There is no endpoint that creates an ADMIN — the
 * backend CLI script is the only path — so this form is student-only by construction.
 *
 * A duplicate address is 409 EMAIL_ALREADY_REGISTERED, which is a deliberate exception to the
 * generic-failure rule: registration cannot both create a session and conceal that an email is taken.
 *
 * @param {{ email: string, password: string }} credentials
 * @returns {Promise<AuthSession>} 201.
 */
function register(credentials) {
  return api.post("/auth/register", credentials);
}

/**
 * Every failure is 401 INVALID_CREDENTIALS with one message, deliberately not distinguishing an
 * unknown address from a wrong password.
 *
 * @param {{ email: string, password: string }} credentials
 * @returns {Promise<AuthSession>} 200.
 */
function login(credentials) {
  return api.post("/auth/login", credentials);
}

/**
 * Clears the refresh cookie. Answers 204 unconditionally, including when no cookie was sent, because
 * signing out is idempotent.
 *
 * Nothing is revoked server-side: refresh tokens are not stored, so an already-issued access token
 * stays valid until it expires. Discarding the in-memory token is the client's own responsibility.
 *
 * @returns {Promise<void>}
 */
function logout() {
  return api.post("/auth/logout");
}

/**
 * The signed-in user's own record, returned unwrapped rather than under a `user` key.
 *
 * This is how the application learns the role after a reload: /auth/refresh returns an access token
 * and nothing else, because the refresh token carries identity only and the role is re-read from the
 * database on every refresh.
 *
 * @returns {Promise<AuthUser>} 200.
 */
function fetchCurrentUser() {
  return api.get("/auth/me");
}

export { fetchCurrentUser, login, logout, register };

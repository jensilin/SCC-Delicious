// The access token lives here and nowhere else: not in localStorage, not in sessionStorage, and not
// in React state. The architecture holds it in memory only, so that a cross-site scripting bug
// cannot read a token out of storage. The cost is accepted deliberately — a reload has no token and
// must exchange the refresh cookie for a new one before it knows who the user is.
//
// It is a module rather than context state because the Axios interceptor needs the current token
// synchronously, from outside React's tree. Reading it through a hook would capture whichever value
// existed when the interceptor was installed, which is the usual source of stale-token bugs.

/** @type {string | null} */
let accessToken = null;

/** @returns {string | null} */
function getAccessToken() {
  return accessToken;
}

/** @param {string} token */
function setAccessToken(token) {
  accessToken = token;
}

function clearAccessToken() {
  accessToken = null;
}

export { clearAccessToken, getAccessToken, setAccessToken };

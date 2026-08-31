import axios from "axios";

import { clearAccessToken, getAccessToken, setAccessToken } from "./access-token-store";
import { toApiError } from "./api-error";

// The only module in the application that imports axios. Everything else goes through `api` below,
// so token attachment, the refresh policy, and error normalisation exist exactly once.

const baseURL = import.meta.env.VITE_API_BASE_URL;

// Fail at startup rather than on the first request, matching how the backend validates its own
// configuration: a missing base URL would otherwise surface as a puzzling 404 against the dev server.
if (!baseURL) {
  throw new Error("VITE_API_BASE_URL is not set. Copy frontend/.env.example to frontend/.env.");
}

// withCredentials is required for the refresh cookie: the API is a different origin in development,
// and a cross-origin request does not carry cookies without it. The cookie's own Path=/api/v1/auth
// means the browser sends it only to the auth routes, so ordinary API calls stay bearer-only.
const client = axios.create({
  baseURL,
  withCredentials: true,
});

// A 401 from these three is not an expired session and must never start a refresh. /auth/refresh is
// the refresh itself, and refreshing in response to its own failure is the infinite loop. login and
// register answer 401 INVALID_CREDENTIALS, which means the password was wrong: refreshing would
// replace a usable form error with a redirect to the page the user is already on.
const PATHS_WITHOUT_REFRESH = new Set(["/auth/refresh", "/auth/login", "/auth/register"]);

/** @type {Promise<void> | null} */
let refreshInFlight = null;

/** @type {(() => void) | null} */
let unauthenticatedHandler = null;

/**
 * Registered once by the auth provider. The API layer knows when a session has ended but must not
 * know what the application does about it, so it calls back instead of importing a router.
 *
 * @param {() => void} handler
 */
function setUnauthenticatedHandler(handler) {
  unauthenticatedHandler = handler;
}

/**
 * Exchanges the refresh cookie for a new access token.
 *
 * Concurrent callers share one request. Several components can be in flight when a token expires,
 * and one refresh per rejected request would send a burst of them and let the last response win.
 *
 * @returns {Promise<void>}
 */
function refreshAccessToken() {
  refreshInFlight ??= client
    .post("/auth/refresh")
    .then((response) => {
      setAccessToken(response.data.accessToken);
    })
    .finally(() => {
      refreshInFlight = null;
    });

  return refreshInFlight;
}

// Read from the store at send time rather than captured when the interceptor was installed, which is
// also what makes a replayed request carry the token the refresh just produced. The header is deleted
// when there is no token so that a stale one cannot survive on a reused config.
client.interceptors.request.use((config) => {
  const token = getAccessToken();

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  } else {
    delete config.headers.Authorization;
  }

  return config;
});

client.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config;
    const status = error.response?.status;

    if (status !== 401 || !config || PATHS_WITHOUT_REFRESH.has(config.url ?? "")) {
      throw toApiError(error);
    }

    // The flag travels on the config, which is what bounds this to one attempt. Reaching here with it
    // already set means a token minted moments ago was refused — a revoked or deleted account, say —
    // and nothing further can rescue the session, so it ends here rather than being refreshed again.
    if (config._retriedAfterRefresh === true) {
      clearAccessToken();
      unauthenticatedHandler?.();

      throw toApiError(error);
    }

    try {
      await refreshAccessToken();
    } catch {
      // The cookie is missing, expired, or names a deleted account. The in-memory token goes and the
      // application is told the session has ended. The original 401 is what the caller sees, not the
      // refresh failure, because the caller asked about its own request.
      clearAccessToken();
      unauthenticatedHandler?.();

      throw toApiError(error);
    }

    config._retriedAfterRefresh = true;

    return client(config);
  },
);

/**
 * Unwraps the response body. Every successful response in this API is the resource itself with no
 * envelope, and a 204 carries nothing at all.
 *
 * @template T
 * @param {Promise<{ data: T }>} pending
 * @returns {Promise<T>}
 */
function unwrap(pending) {
  return pending.then((response) => response.data);
}

// Errors are already ApiError instances by the time they arrive here, normalised in the interceptor
// above, so a feature module catches one type regardless of what failed.
const api = {
  /**
   * @template T
   * @param {string} url
   * @param {import("axios").AxiosRequestConfig} [config]
   * @returns {Promise<T>}
   */
  get: (url, config) => unwrap(client.get(url, config)),

  /**
   * @template T
   * @param {string} url
   * @param {unknown} [body]
   * @param {import("axios").AxiosRequestConfig} [config]
   * @returns {Promise<T>}
   */
  post: (url, body, config) => unwrap(client.post(url, body, config)),

  /**
   * @template T
   * @param {string} url
   * @param {unknown} [body]
   * @param {import("axios").AxiosRequestConfig} [config]
   * @returns {Promise<T>}
   */
  patch: (url, body, config) => unwrap(client.patch(url, body, config)),

  /**
   * @template T
   * @param {string} url
   * @param {import("axios").AxiosRequestConfig} [config]
   * @returns {Promise<T>}
   */
  delete: (url, config) => unwrap(client.delete(url, config)),
};

export { api, refreshAccessToken, setUnauthenticatedHandler };

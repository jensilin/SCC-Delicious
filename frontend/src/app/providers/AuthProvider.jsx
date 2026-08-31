import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import {
  fetchCurrentUser,
  login as loginRequest,
  logout as logoutRequest,
  register as registerRequest,
} from "../../features/auth/api";
import { clearAccessToken, setAccessToken } from "../../lib/access-token-store";
import { refreshAccessToken, setUnauthenticatedHandler } from "../../lib/api-client";

/**
 * @typedef {"restoring" | "authenticated" | "anonymous"} AuthStatus
 */

/**
 * @typedef {object} AuthContextValue
 * @property {import("../../features/auth/api").AuthUser | null} user
 * @property {AuthStatus} status
 * @property {(credentials: { email: string, password: string }) => Promise<void>} signIn
 * @property {(credentials: { email: string, password: string }) => Promise<void>} signUp
 * @property {() => Promise<void>} signOut
 */

const AuthContext = createContext(/** @type {AuthContextValue | null} */ (null));

/**
 * Owns the session: the current user, and the token that proves it.
 *
 * The token itself is not held here. It lives in the access-token store, because the Axios
 * interceptor needs it synchronously from outside React's tree.
 *
 * @param {{ children: import("react").ReactNode }} props
 */
function AuthProvider({ children }) {
  const [user, setUser] = useState(
    /** @type {import("../../features/auth/api").AuthUser | null} */ (null),
  );
  const [status, setStatus] = useState(/** @type {AuthStatus} */ ("restoring"));

  // Restoring a session takes two requests and they cannot be collapsed into one. /auth/refresh
  // exchanges the httpOnly cookie for an access token and returns nothing else, because a refresh
  // token carries identity alone and the role is re-read from the database on every refresh. So the
  // user and the role come from /auth/me afterwards.
  //
  // A failure here is the ordinary "not signed in" state — an absent or expired cookie — and is not
  // shown as an error.
  useEffect(() => {
    let cancelled = false;

    async function restoreSession() {
      try {
        await refreshAccessToken();

        const currentUser = await fetchCurrentUser();

        if (!cancelled) {
          setUser(currentUser);
          setStatus("authenticated");
        }
      } catch {
        clearAccessToken();

        if (!cancelled) {
          setUser(null);
          setStatus("anonymous");
        }
      }
    }

    restoreSession();

    return () => {
      cancelled = true;
    };
  }, []);

  // The API layer discovers a dead session before the application does: it is what sees the 401 and
  // what tries the refresh. When that refresh cannot succeed it calls back here, so the two views of
  // the session cannot disagree.
  useEffect(() => {
    setUnauthenticatedHandler(() => {
      setUser(null);
      setStatus("anonymous");
    });
  }, []);

  const signIn = useCallback(async (credentials) => {
    const session = await loginRequest(credentials);

    setAccessToken(session.accessToken);
    setUser(session.user);
    setStatus("authenticated");
  }, []);

  // Registration signs the new account in rather than sending it to a login form, because the API
  // returns a session. The role is always STUDENT; the request cannot ask for anything else.
  const signUp = useCallback(async (credentials) => {
    const session = await registerRequest(credentials);

    setAccessToken(session.accessToken);
    setUser(session.user);
    setStatus("authenticated");
  }, []);

  // The local session is cleared whatever the request does. Logout only removes the cookie — nothing
  // is revoked server-side — so discarding the in-memory token is the part that actually signs the
  // user out of this tab, and a failed request must not leave them looking signed in.
  const signOut = useCallback(async () => {
    try {
      await logoutRequest();
    } finally {
      clearAccessToken();
      setUser(null);
      setStatus("anonymous");
    }
  }, []);

  const value = useMemo(
    () => ({ user, status, signIn, signUp, signOut }),
    [user, status, signIn, signUp, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * @returns {AuthContextValue}
 */
function useAuth() {
  const value = useContext(AuthContext);

  if (!value) {
    throw new Error("useAuth must be used inside AuthProvider");
  }

  return value;
}

export { AuthProvider, useAuth };

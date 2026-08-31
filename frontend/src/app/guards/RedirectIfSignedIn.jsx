import { Navigate, Outlet, useLocation } from "react-router-dom";

import { LoadingState } from "../../components/LoadingState";
import { useAuth } from "../providers/AuthProvider";

/**
 * The other side of RequireAuth: keeps a signed-in user off the login and registration pages, which
 * would otherwise offer to start a second session over the one they already have.
 *
 * It waits for the restore to finish rather than assuming a page load means no session, since a
 * reload always begins with an empty in-memory token.
 *
 * This is also the one place that decides where a successful sign-in lands. RequireAuth attaches the
 * blocked destination to the login location, and reading it here means the login form itself does not
 * navigate — the redirect happens because the session exists, wherever the session came from.
 */
function RedirectIfSignedIn() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === "restoring") {
    return <LoadingState label="Restoring your session" />;
  }

  if (status === "authenticated") {
    const from = location.state?.from;

    return <Navigate to={from ? `${from.pathname}${from.search ?? ""}` : "/"} replace />;
  }

  return <Outlet />;
}

export { RedirectIfSignedIn };

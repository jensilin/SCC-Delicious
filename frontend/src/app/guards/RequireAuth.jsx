import { Navigate, Outlet, useLocation } from "react-router-dom";

import { LoadingState } from "../../components/LoadingState";
import { useAuth } from "../providers/AuthProvider";

/**
 * Keeps signed-out visitors out of the application shell.
 *
 * This is a user-experience feature and not a security boundary: anything the browser enforces the
 * browser can bypass. Every protected action is re-checked on the server, which is what actually
 * refuses it.
 *
 * While the session is being restored it renders a waiting state rather than redirecting. Redirecting
 * would bounce every signed-in user to the login page on each reload, because the access token is
 * held in memory and a reload always starts without one.
 */
function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === "restoring") {
    return <LoadingState label="Restoring your session" />;
  }

  if (status === "anonymous") {
    // Where they were headed travels with the redirect, so signing in returns them there instead of
    // to a generic landing page.
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
}

export { RequireAuth };

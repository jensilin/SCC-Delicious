import { Navigate } from "react-router-dom";

import { useAuth } from "./providers/AuthProvider";

/**
 * Sends each role to the screen its work starts on: a student browses shops, an administrator opens
 * the order queue. Mounted at the index route, so "/" means "wherever I begin".
 */
function HomeRedirect() {
  const { user } = useAuth();

  return <Navigate to={user?.role === "ADMIN" ? "/admin/orders" : "/shops"} replace />;
}

export { HomeRedirect };

import { Outlet } from "react-router-dom";

import { ButtonLink } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import { useAuth } from "../providers/AuthProvider";

// Where each role's own work starts, used as the way back out of an area that is not theirs.
const HOME_BY_ROLE = {
  STUDENT: "/shops",
  ADMIN: "/admin/orders",
};

/**
 * Gates a branch of the route tree on the signed-in account's role, mirroring how the backend attaches
 * a role check to a whole router rather than to each handler.
 *
 * It is a mirror and not the boundary. The server re-checks the role on every request and answers 403
 * FORBIDDEN — a student calling the admin queue is refused there whatever this component renders.
 *
 * A mismatch is explained rather than silently redirected: arriving here means an address was typed or
 * followed by the wrong account, and a redirect that looks like the page simply moved is more
 * confusing than being told why.
 *
 * @param {{ role: "STUDENT" | "ADMIN" }} props
 */
function RequireRole({ role }) {
  const { user } = useAuth();

  if (user?.role !== role) {
    return (
      <EmptyState
        title="Not available for this account"
        message={`This part of SCC Delicious is for ${role} accounts. You are signed in as ${user?.role ?? "an unknown role"}.`}
      >
        <ButtonLink to={HOME_BY_ROLE[user?.role] ?? "/"}>Go to your home page</ButtonLink>
      </EmptyState>
    );
  }

  return <Outlet />;
}

export { RequireRole };

import { useState } from "react";
import { Link, NavLink } from "react-router-dom";

import { useAuth } from "../app/providers/AuthProvider";
import { useCart } from "../features/cart/CartProvider";
import { Logo } from "./Logo";
import styles from "./NavBar.module.css";

/**
 * The application's one navigation bar.
 *
 * Its destinations follow the API's own authorization shape. Catalogue browsing is shown to both roles
 * because the browsing router applies authentication with no role check. The cart and a student's own
 * orders are STUDENT-only routes, and the queue is ADMIN-only, so each role is offered exactly what it
 * can use — which is a convenience, not the boundary: the server refuses the rest regardless.
 *
 * The role badge is informational. It tells the user which account they are signed in as, which matters
 * in an application where the two roles see different things; it grants nothing.
 */
function NavBar() {
  const { user, signOut } = useAuth();
  const { itemCount } = useCart();
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);

    try {
      await signOut();
    } finally {
      setSigningOut(false);
    }
  }

  const linkClassName = ({ isActive }) =>
    isActive ? `${styles.link} ${styles.active}` : styles.link;

  const isAdmin = user?.role === "ADMIN";

  return (
    <nav className={styles.bar}>
      <Link to="/" className={styles.brand}>
        <Logo />
      </Link>

      <div className={styles.links}>
        <NavLink to="/shops" className={linkClassName}>
          Shops
        </NavLink>

        {isAdmin ? (
          <NavLink to="/admin/orders" className={linkClassName}>
            Order queue
          </NavLink>
        ) : (
          <>
            <NavLink to="/cart" className={linkClassName}>
              Cart
              {itemCount > 0 ? <span className={styles.badge}>{itemCount}</span> : null}
            </NavLink>
            <NavLink to="/orders" className={linkClassName}>
              Your orders
            </NavLink>
          </>
        )}
      </div>

      {user ? (
        <div className={styles.session}>
          <span className={styles.email}>{user.email}</span>
          <span className={styles.role}>{user.role}</span>
          <button
            type="button"
            className={styles.signOut}
            onClick={handleSignOut}
            disabled={signingOut}
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      ) : null}
    </nav>
  );
}

export { NavBar };

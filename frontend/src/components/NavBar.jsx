import { useState } from "react";
import { Link, NavLink } from "react-router-dom";

import { useAuth } from "../app/providers/AuthProvider";
import styles from "./NavBar.module.css";

/**
 * The application's one navigation bar.
 *
 * Catalogue browsing is the only destination it offers so far, and it is deliberately shown to both
 * roles: the browsing router applies authentication with no role check, so a student and an
 * administrator read shops and foods through exactly the same endpoints. Role-scoped destinations
 * appear here as their screens are built.
 *
 * The role badge is informational. It tells the user which account they are signed in as, which
 * matters in an application where the two roles see different things; it grants nothing.
 */
function NavBar() {
  const { user, signOut } = useAuth();
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

  return (
    <nav className={styles.bar}>
      <Link to="/" className={styles.brand}>
        SCC Delicious
      </Link>

      <div className={styles.links}>
        <NavLink to="/shops" className={linkClassName}>
          Shops
        </NavLink>
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

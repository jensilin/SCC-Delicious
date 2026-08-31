import { Outlet } from "react-router-dom";

import { NavBar } from "../../components/NavBar";
import { CartProvider } from "../../features/cart/CartProvider";
import { ShopDirectoryProvider } from "../../features/catalogue/shop-directory";
import styles from "./AppLayout.module.css";

/**
 * The shell every signed-in screen renders inside. Mounted beneath RequireAuth, so it never renders
 * for a signed-out visitor and the navigation bar can assume there is a user.
 *
 * Both providers live here rather than at the root of the application, because both fetch and every
 * endpoint they use requires a token: mounted any higher they would fire requests that are certain to
 * fail for a visitor who is not signed in. The cart provider additionally reads nothing for an
 * administrator, who has no cart.
 */
function AppLayout() {
  return (
    <ShopDirectoryProvider>
      <CartProvider>
        <div className={styles.shell}>
          <NavBar />
          <main className={styles.main}>
            <Outlet />
          </main>
        </div>
      </CartProvider>
    </ShopDirectoryProvider>
  );
}

export { AppLayout };

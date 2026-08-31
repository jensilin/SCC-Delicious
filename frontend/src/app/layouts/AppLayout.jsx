import { Outlet } from "react-router-dom";

import { NavBar } from "../../components/NavBar";
import { ShopDirectoryProvider } from "../../features/catalogue/shop-directory";
import styles from "./AppLayout.module.css";

/**
 * The shell every signed-in screen renders inside. Mounted beneath RequireAuth, so it never renders
 * for a signed-out visitor and the navigation bar can assume there is a user.
 *
 * The shop directory is provided here rather than at the root of the application, because it fetches
 * and every catalogue endpoint requires a token: mounted any higher it would fire a request that is
 * certain to fail for a visitor who is not signed in.
 */
function AppLayout() {
  return (
    <ShopDirectoryProvider>
      <div className={styles.shell}>
        <NavBar />
        <main className={styles.main}>
          <Outlet />
        </main>
      </div>
    </ShopDirectoryProvider>
  );
}

export { AppLayout };

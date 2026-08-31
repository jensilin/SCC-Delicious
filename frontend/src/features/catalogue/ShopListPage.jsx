import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { LoadingState } from "../../components/LoadingState";
import { useShopDirectory } from "./shop-directory";
import styles from "./ShopListPage.module.css";

/**
 * The shop list, and the landing screen for both roles: browsing requires a signed-in caller but no
 * particular role, so a student and an administrator see the same list from the same endpoint.
 *
 * It reads the shop directory rather than fetching for itself. The directory has already loaded this
 * exact collection in order to resolve shop names on order screens, and asking twice would put two
 * copies of the same list in memory.
 *
 * Menus, and adding to a cart, arrive with the catalogue browsing screens.
 */
function ShopListPage() {
  const { shops, status, error, reload } = useShopDirectory();

  return (
    <section>
      <header className={styles.header}>
        <h1 className={styles.title}>Shops</h1>
        <p className={styles.subtitle}>Every shop in the food court.</p>
      </header>

      {status === "loading" ? <LoadingState label="Loading shops" /> : null}

      {status === "failed" ? (
        <ErrorState error={error} title="Could not load shops" onRetry={reload} />
      ) : null}

      {/* An empty array is an ordinary state here, not a 404: the API answers with one when no shop
          has been created yet. */}
      {status === "ready" && shops.length === 0 ? (
        <EmptyState
          title="No shops yet"
          message="An administrator has not added any shops to the food court."
        />
      ) : null}

      {status === "ready" && shops.length > 0 ? (
        <ul className={styles.grid}>
          {shops.map((shop) => (
            <li key={shop.id} className={styles.card}>
              <p className={styles.name}>{shop.name}</p>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export { ShopListPage };

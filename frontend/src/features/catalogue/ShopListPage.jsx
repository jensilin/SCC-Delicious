import { Link } from "react-router-dom";

import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { LoadingState } from "../../components/LoadingState";
import { PageHeader } from "../../components/PageHeader";
import { useShopDirectory } from "./shop-directory";
import styles from "./ShopListPage.module.css";

/**
 * The shop list, and the landing screen for a student. Browsing requires a signed-in caller but no
 * particular role, so an administrator sees the same list from the same endpoint.
 *
 * It reads the shop directory rather than fetching for itself. The directory has already loaded this
 * exact collection in order to resolve shop names on order screens, and asking twice would put two
 * copies of the same list in memory.
 */
function ShopListPage() {
  const { shops, status, error, reload } = useShopDirectory();

  return (
    <section>
      <PageHeader title="Shops" subtitle="Pick a shop to see what it is serving today." />

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
            <li key={shop.id}>
              <Link to={`/shops/${shop.id}`} className={styles.card}>
                <span className={styles.name}>{shop.name}</span>
                <span className={styles.action}>View menu →</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export { ShopListPage };

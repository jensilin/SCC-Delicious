import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { ButtonLink } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { LoadingState } from "../../components/LoadingState";
import { PageHeader } from "../../components/PageHeader";
import { StatusBadge } from "../../components/StatusBadge";
import { formatTimestamp } from "../../lib/datetime";
import { formatMinor } from "../../lib/money";
import { useShopDirectory } from "../catalogue/shop-directory";
import { listMyOrders } from "./api";
import styles from "./OrderListPage.module.css";

/**
 * The student's own orders, newest first as the API returns them. No sorting or filtering is applied
 * here — the endpoint takes no parameters and the order it returns is the order shown.
 */
function OrderListPage() {
  const { shopName } = useShopDirectory();

  const [orders, setOrders] = useState(/** @type {import("./api").Order[]} */ ([]));
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState(
    /** @type {import("../../lib/api-error").ApiError | null} */ (null),
  );

  const load = useCallback(async () => {
    setStatus("loading");
    setError(null);

    try {
      setOrders(await listMyOrders());
      setStatus("ready");
    } catch (caught) {
      setError(caught);
      setStatus("failed");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <section>
      <PageHeader title="Your orders" subtitle="Newest first.">
        <ButtonLink to="/shops">Browse shops</ButtonLink>
      </PageHeader>

      {status === "loading" ? <LoadingState label="Loading your orders" /> : null}

      {status === "failed" ? (
        <ErrorState error={error} title="Could not load your orders" onRetry={load} />
      ) : null}

      {status === "ready" && orders.length === 0 ? (
        <EmptyState title="No orders yet" message="Everything you order will appear here.">
          <ButtonLink to="/shops" variant="primary">
            Browse shops
          </ButtonLink>
        </EmptyState>
      ) : null}

      {status === "ready" && orders.length > 0 ? (
        <ul className={styles.list}>
          {orders.map((order) => (
            <li key={order.id}>
              <Link to={`/orders/${order.id}`} className={styles.card}>
                <div className={styles.top}>
                  {/* The order carries a shopId and no shop name, so the name comes from the cached
                      shop directory. A shop referenced by an order cannot be deleted, so the lookup
                      always has something to find. */}
                  <span className={styles.shop}>{shopName(order.shopId) ?? order.shopId}</span>
                  <StatusBadge status={order.status} />
                  <span className={styles.placedAt}>{formatTimestamp(order.placedAt)}</span>
                </div>

                <div className={styles.bottom}>
                  <span className={styles.summary}>
                    {order.items.length} {order.items.length === 1 ? "item" : "items"}
                  </span>
                  <span className={styles.total}>{formatMinor(order.totalMinor)}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export { OrderListPage };

import { useCallback } from "react";
import { Link } from "react-router-dom";

import { ButtonLink } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { LoadingState } from "../../components/LoadingState";
import { PageHeader } from "../../components/PageHeader";
import { StatusBadge } from "../../components/StatusBadge";
import { formatTimestamp } from "../../lib/datetime";
import { formatMinor } from "../../lib/money";
import { STUDENT_ORDER_LIST_POLL_MS, usePolledResource } from "../../lib/use-polled-resource";
import { useShopDirectory } from "../catalogue/shop-directory";
import { listMyOrders } from "./api";
import styles from "./OrderListPage.module.css";

/**
 * The student's own orders, newest first as the API returns them. No sorting or filtering is applied
 * here — the endpoint takes no parameters and the order it returns is the order shown.
 *
 * The list re-reads itself in the background so that a status a shop changed appears here without the
 * page being reloaded.
 */
function OrderListPage() {
  const { shopName } = useShopDirectory();

  const readOrders = useCallback(() => listMyOrders(), []);

  const { data: orders, status, error, reload } = usePolledResource(readOrders, {
    intervalMs: STUDENT_ORDER_LIST_POLL_MS,
    initialData: /** @type {import("./api").Order[]} */ ([]),
  });

  return (
    <section>
      <PageHeader title="Your orders" subtitle="Newest first.">
        <ButtonLink to="/shops">Browse shops</ButtonLink>
      </PageHeader>

      {status === "loading" ? <LoadingState label="Loading your orders" /> : null}

      {status === "failed" ? (
        <ErrorState error={error} title="Could not load your orders" onRetry={reload} />
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

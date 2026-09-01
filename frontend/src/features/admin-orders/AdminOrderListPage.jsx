import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { Button } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { LoadingState } from "../../components/LoadingState";
import { PageHeader } from "../../components/PageHeader";
import { StatusBadge } from "../../components/StatusBadge";
import { formatTimestamp } from "../../lib/datetime";
import { formatMinor } from "../../lib/money";
import { ADMIN_ORDER_LIST_POLL_MS, usePolledResource } from "../../lib/use-polled-resource";
import { useShopDirectory } from "../catalogue/shop-directory";
import { listAllOrders } from "./api";
import styles from "./AdminOrderListPage.module.css";

const ALL = "ALL";
const STATUSES = ["PLACED", "PREPARING", "READY", "COMPLETED", "CANCELLED"];

/**
 * The administrative queue: every order in the system, newest first.
 *
 * Filtering is done in this browser, over the whole list. GET /api/v1/admin/orders accepts no query
 * parameters — v1 has no server-side filtering, sorting or pagination — so narrowing here is the only
 * option available, and inventing a parameter would just be ignored. The screen says so plainly rather
 * than letting it look like the server did the work.
 *
 * The queue re-reads itself in the background, because this is the screen somebody keeps open while
 * orders arrive. Refreshing is silent: the list, the filters and the scroll position stay exactly as
 * they were, and only the orders themselves change.
 */
function AdminOrderListPage() {
  const { shopName } = useShopDirectory();

  const [statusFilter, setStatusFilter] = useState(ALL);
  const [shopFilter, setShopFilter] = useState(ALL);

  const readOrders = useCallback(() => listAllOrders(), []);

  const { data: orders, status, error, refreshing, reload, refresh } = usePolledResource(readOrders, {
    intervalMs: ADMIN_ORDER_LIST_POLL_MS,
    initialData: /** @type {import("./api").AdminOrder[]} */ ([]),
  });

  // Only the shops that actually appear in the queue, so the filter cannot offer a choice that would
  // match nothing. Names come from the cached shop directory, since an order carries only a shopId.
  const shopOptions = useMemo(() => {
    const ids = [...new Set(orders.map((order) => order.shopId))];

    return ids
      .map((id) => ({ id, name: shopName(id) ?? id }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [orders, shopName]);

  const visible = useMemo(
    () =>
      orders.filter(
        (order) =>
          (statusFilter === ALL || order.status === statusFilter) &&
          (shopFilter === ALL || order.shopId === shopFilter),
      ),
    [orders, statusFilter, shopFilter],
  );

  return (
    <section>
      <PageHeader title="Order queue" subtitle="Every order in the food court, newest first.">
        {/* The queue reads itself on a timer, but the button stays: it is how an administrator asks
            for the current state now instead of waiting out the interval. It performs the same silent
            read the timer does, so pressing it never blanks the list. */}
        <Button onClick={refresh} pending={refreshing} pendingLabel="Refreshing…">
          Refresh
        </Button>
      </PageHeader>

      <div className={styles.stack}>
        <p className={styles.clientSideNote}>
          <strong>Filtering is applied in this browser.</strong> The admin orders endpoint returns every
          order and accepts no query parameters, so the full list is loaded and narrowed here. Nothing
          below is a server-side query, and there is no pagination.
        </p>

        <div className={styles.filters}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="statusFilter">
              Status
            </label>
            <select
              id="statusFilter"
              className={styles.select}
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value={ALL}>All statuses</option>
              {STATUSES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="shopFilter">
              Shop
            </label>
            <select
              id="shopFilter"
              className={styles.select}
              value={shopFilter}
              onChange={(event) => setShopFilter(event.target.value)}
            >
              <option value={ALL}>All shops</option>
              {shopOptions.map((shop) => (
                <option key={shop.id} value={shop.id}>
                  {shop.name}
                </option>
              ))}
            </select>
          </div>

          <span className={styles.count}>
            Showing {visible.length} of {orders.length}
          </span>
        </div>

        {status === "loading" && orders.length === 0 ? (
          <LoadingState label="Loading the order queue" />
        ) : null}

        {status === "failed" ? (
          <ErrorState error={error} title="Could not load the order queue" onRetry={reload} />
        ) : null}

        {status === "ready" && orders.length === 0 ? (
          <EmptyState
            title="No orders yet"
            message="Orders placed by students will appear here as soon as they are made."
          />
        ) : null}

        {status === "ready" && orders.length > 0 && visible.length === 0 ? (
          <EmptyState
            title="No orders match these filters"
            message="Every order is still loaded; only what is shown has been narrowed."
          >
            <Button
              onClick={() => {
                setStatusFilter(ALL);
                setShopFilter(ALL);
              }}
            >
              Clear filters
            </Button>
          </EmptyState>
        ) : null}

        {visible.length > 0 ? (
          <ul className={styles.list}>
            {visible.map((order) => (
              <li key={order.id}>
                <Link to={`/admin/orders/${order.id}`} className={styles.card}>
                  <div className={styles.top}>
                    {/* The buyer's address, which is why this response differs from a student's. */}
                    <span className={styles.buyer}>{order.buyerEmail}</span>
                    <StatusBadge status={order.status} />
                    <span className={styles.placedAt}>{formatTimestamp(order.placedAt)}</span>
                  </div>

                  <div className={styles.bottom}>
                    <span className={styles.shop}>
                      {shopName(order.shopId) ?? order.shopId} · {order.items.length}{" "}
                      {order.items.length === 1 ? "item" : "items"}
                    </span>
                    <span className={styles.total}>{formatMinor(order.totalMinor)}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

export { AdminOrderListPage };

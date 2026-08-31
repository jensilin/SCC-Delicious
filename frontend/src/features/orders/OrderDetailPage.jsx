import { useCallback, useEffect, useState } from "react";
import { useLocation, useParams } from "react-router-dom";

import { Button, ButtonLink } from "../../components/Button";
import { ErrorState } from "../../components/ErrorState";
import { LoadingState } from "../../components/LoadingState";
import { Notice } from "../../components/Notice";
import { PageHeader } from "../../components/PageHeader";
import { STATUS_DESCRIPTIONS, StatusBadge } from "../../components/StatusBadge";
import { formatTimestamp } from "../../lib/datetime";
import { useShopDirectory } from "../catalogue/shop-directory";
import { cancelMyOrder, getMyOrder } from "./api";
import { OrderItemsTable } from "./OrderItemsTable";
import styles from "./OrderDetailPage.module.css";

// The only move a student may make, and only from this status. It is the server's rule, mirrored here
// to decide whether to offer the button; the transition is still refused server-side if the order has
// moved on in the meantime.
const CANCELLABLE_FROM = "PLACED";

/**
 * One of the student's own orders.
 *
 * A lookup is scoped to the order id and the caller together, so another student's order is reported
 * as not found rather than forbidden — answering "forbidden" would confirm that it exists. This screen
 * therefore treats a 404 as "not yours or not there" without claiming which.
 */
function OrderDetailPage() {
  const { orderId } = useParams();
  const location = useLocation();
  const { shopName } = useShopDirectory();

  const [order, setOrder] = useState(/** @type {import("./api").Order | null} */ (null));
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState(
    /** @type {import("../../lib/api-error").ApiError | null} */ (null),
  );
  const [cancelling, setCancelling] = useState(false);
  const [failure, setFailure] = useState(
    /** @type {import("../../lib/api-error").ApiError | null} */ (null),
  );
  const [cancelled, setCancelled] = useState(false);

  // Set by checkout when it navigates here, so the order that was just placed is confirmed on the
  // screen that shows it rather than on the one the user has left.
  const justPlaced = location.state?.justPlaced === true;

  const load = useCallback(async () => {
    setStatus("loading");
    setError(null);

    try {
      setOrder(await getMyOrder(orderId));
      setStatus("ready");
    } catch (caught) {
      setError(caught);
      setStatus("failed");
    }
  }, [orderId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCancel() {
    setCancelling(true);
    setFailure(null);

    try {
      // The response is the cancelled order, so there is no follow-up read that could observe a
      // further change.
      setOrder(await cancelMyOrder(orderId));
      setCancelled(true);
    } catch (caught) {
      setFailure(caught);

      // ORDER_STATUS_CONFLICT is the ordinary answer to a stale screen: the shop has started
      // preparing it, or it is already cancelled. Re-reading shows what it actually says now.
      if (caught.code === "ORDER_STATUS_CONFLICT") {
        await load();
      }
    } finally {
      setCancelling(false);
    }
  }

  if (status === "loading") {
    return (
      <section>
        <PageHeader title="Order" backTo="/orders" backLabel="Your orders" />
        <LoadingState label="Loading this order" />
      </section>
    );
  }

  if (status === "failed") {
    return (
      <section>
        <PageHeader title="Order" backTo="/orders" backLabel="Your orders" />
        <ErrorState
          error={error}
          title={error?.status === 404 ? "Order not found" : "Could not load this order"}
          onRetry={load}
        />
        {error?.status === 404 ? (
          <p>
            <ButtonLink to="/orders">Back to your orders</ButtonLink>
          </p>
        ) : null}
      </section>
    );
  }

  const shop = shopName(order.shopId);

  return (
    <section>
      <PageHeader
        title={shop ?? "Order"}
        subtitle={`Placed ${formatTimestamp(order.placedAt)}`}
        backTo="/orders"
        backLabel="Your orders"
      />

      <div className={styles.stack}>
        {justPlaced ? <Notice tone="success" message="Your order has been placed." /> : null}

        {cancelled ? <Notice tone="success" message="Your order has been cancelled." /> : null}

        {failure ? <Notice tone="error" message={failure.message} /> : null}

        <div className={styles.statusCard}>
          <div className={styles.statusText}>
            <StatusBadge status={order.status} />
            <p className={styles.description}>{STATUS_DESCRIPTIONS[order.status] ?? ""}</p>
          </div>

          {/* Cancellation is offered only from PLACED, which is the one status in which the shop has
              not started work. There is no other student action on an order: no edit, no reorder, and
              no line-level change, because an order item is immutable. */}
          {order.status === CANCELLABLE_FROM ? (
            <Button
              variant="danger"
              pending={cancelling}
              pendingLabel="Cancelling…"
              onClick={handleCancel}
            >
              Cancel order
            </Button>
          ) : null}
        </div>

        <OrderItemsTable items={order.items} totalMinor={order.totalMinor} />

        <div className={styles.meta}>
          <div className={styles.metaRow}>
            <span className={styles.metaLabel}>Reference</span>
            <span className={`${styles.metaValue} ${styles.reference}`}>{order.id}</span>
          </div>
          <div className={styles.metaRow}>
            <span className={styles.metaLabel}>Shop</span>
            <span className={styles.metaValue}>{shop ?? order.shopId}</span>
          </div>
        </div>
      </div>
    </section>
  );
}

export { OrderDetailPage };

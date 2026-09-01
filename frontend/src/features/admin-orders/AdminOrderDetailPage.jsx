import { useCallback, useState } from "react";
import { useParams } from "react-router-dom";

import { Button, ButtonLink } from "../../components/Button";
import { ErrorState } from "../../components/ErrorState";
import { LoadingState } from "../../components/LoadingState";
import { Notice } from "../../components/Notice";
import { PageHeader } from "../../components/PageHeader";
import { STATUS_DESCRIPTIONS, StatusBadge } from "../../components/StatusBadge";
import { formatTimestamp } from "../../lib/datetime";
import { ADMIN_ORDER_DETAIL_POLL_MS, usePolledResource } from "../../lib/use-polled-resource";
import { useShopDirectory } from "../catalogue/shop-directory";
import { OrderItemsTable } from "../orders/OrderItemsTable";
import { getOrder, setOrderStatus } from "./api";
import { TRANSITION_LABELS, nextStatuses } from "./transitions";
import styles from "./AdminOrderDetailPage.module.css";

/**
 * One order, as an administrator works it.
 *
 * Advancing and cancelling are the same PATCH with a different target status — cancellation is simply
 * the move that also returns stock — so every button here calls one endpoint. Which moves are offered
 * comes from the client's mirror of the server's transition table; whether a move is allowed is
 * decided by the server when it applies it.
 */
function AdminOrderDetailPage() {
  const { orderId } = useParams();
  const { shopName } = useShopDirectory();

  const [movingTo, setMovingTo] = useState(/** @type {string | null} */ (null));
  const [failure, setFailure] = useState(
    /** @type {import("../../lib/api-error").ApiError | null} */ (null),
  );
  const [moved, setMoved] = useState(/** @type {string | null} */ (null));

  const readOrder = useCallback(() => getOrder(orderId), [orderId]);

  // Polling stops for the duration of a move, and the move's own response is committed, so a read that
  // was already in flight when the button was pressed cannot land afterwards and show the order back
  // in the status it has just left.
  const {
    data: order,
    status,
    error,
    reload,
    refresh,
    commit,
  } = usePolledResource(readOrder, {
    intervalMs: ADMIN_ORDER_DETAIL_POLL_MS,
    paused: movingTo !== null,
  });

  async function move(target) {
    setMovingTo(target);
    setFailure(null);
    setMoved(null);

    try {
      // The response is the order as the change left it, read back inside the same transaction, so
      // there is no follow-up request that could observe a further move.
      commit(await setOrderStatus(orderId, target));
      setMoved(target);
    } catch (caught) {
      setFailure(caught);

      // 409 ORDER_STATUS_CONFLICT means either the move was not legal from where the order stood, or
      // somebody moved it first — the API does not distinguish them, because the answer to both is to
      // read the order and show what it now says. Read in the background, so that the message
      // explaining the refusal is still on screen when the order it refers to updates beneath it.
      if (caught.code === "ORDER_STATUS_CONFLICT") {
        await refresh();
      }
    } finally {
      setMovingTo(null);
    }
  }

  if (status === "loading") {
    return (
      <section>
        <PageHeader title="Order" backTo="/admin/orders" backLabel="Order queue" />
        <LoadingState label="Loading this order" />
      </section>
    );
  }

  if (status === "failed") {
    return (
      <section>
        <PageHeader title="Order" backTo="/admin/orders" backLabel="Order queue" />
        <ErrorState
          error={error}
          title={error?.status === 404 ? "Order not found" : "Could not load this order"}
          onRetry={reload}
        />
        {error?.status === 404 ? (
          <p>
            <ButtonLink to="/admin/orders">Back to the queue</ButtonLink>
          </p>
        ) : null}
      </section>
    );
  }

  const shop = shopName(order.shopId);
  const moves = nextStatuses(order.status);

  return (
    <section>
      <PageHeader
        title={shop ?? "Order"}
        subtitle={`Placed ${formatTimestamp(order.placedAt)}`}
        backTo="/admin/orders"
        backLabel="Order queue"
      />

      <div className={styles.stack}>
        {moved ? (
          <Notice
            tone="success"
            message={
              moved === "CANCELLED"
                ? "Order cancelled. The stock it held has been returned."
                : `Order moved to ${moved}.`
            }
          />
        ) : null}

        {failure ? (
          <Notice tone="error" message={failure.message} details={failure.details} />
        ) : null}

        <div className={styles.buyer}>
          <span className={styles.buyerLabel}>Buyer</span>
          <span className={styles.buyerEmail}>{order.buyerEmail}</span>
        </div>

        <div className={styles.statusCard}>
          <div className={styles.statusRow}>
            <StatusBadge status={order.status} />
            <p className={styles.description}>{STATUS_DESCRIPTIONS[order.status] ?? ""}</p>
          </div>

          {moves.length > 0 ? (
            <div className={styles.moves}>
              {moves.map((target) => (
                <Button
                  key={target}
                  variant={target === "CANCELLED" ? "danger" : "primary"}
                  disabled={movingTo !== null && movingTo !== target}
                  pending={movingTo === target}
                  pendingLabel="Working…"
                  onClick={() => move(target)}
                >
                  {TRANSITION_LABELS[target] ?? target}
                </Button>
              ))}
            </div>
          ) : (
            /* COMPLETED and CANCELLED are terminal: they appear only as targets in the transition
               table and never as predecessors, so nothing can move out of them. */
            <p className={styles.terminal}>
              This order is {order.status}. No further status changes are possible.
            </p>
          )}
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

export { AdminOrderDetailPage };

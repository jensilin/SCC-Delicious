import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Button, ButtonLink } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { LoadingState } from "../../components/LoadingState";
import { Notice } from "../../components/Notice";
import { PageHeader } from "../../components/PageHeader";
import { formatMinor } from "../../lib/money";
import { useCart } from "../cart/CartProvider";
import { useShopDirectory } from "../catalogue/shop-directory";
import { placeOrder } from "./api";
import { newIdempotencyKey } from "./idempotency-key";
import styles from "./CheckoutPage.module.css";

/**
 * Review the cart, then place the order.
 *
 * Nothing on this screen is computed. The lines and the total are the cart as the API reports it, and
 * the order's total is recalculated server-side from the food rows under lock at the moment of
 * checkout — so what is shown here is a quotation, not the authority.
 */
function CheckoutPage() {
  const navigate = useNavigate();
  const { cart, status, error, reload } = useCart();
  const { shopName } = useShopDirectory();

  const [placing, setPlacing] = useState(false);
  const [failure, setFailure] = useState(
    /** @type {{ message: string, tone: "error" | "warning", details?: unknown[], retryable: boolean } | null} */ (
      null
    ),
  );

  // One key per attempt, held across retries. A network failure leaves it unknown whether the order
  // was created, and resending this same key is what turns "try again" into "tell me what happened to
  // the first one" — the server replays the original order instead of writing a second.
  const idempotencyKey = useRef(/** @type {string | null} */ (null));

  async function handlePlaceOrder() {
    idempotencyKey.current ??= newIdempotencyKey();

    setPlacing(true);
    setFailure(null);

    try {
      const order = await placeOrder(idempotencyKey.current);

      // The attempt is over, so the key retires with it: a later checkout is a new attempt and must
      // not be answered with this order.
      idempotencyKey.current = null;

      // The cart was emptied inside the same transaction that wrote the order.
      await reload();

      navigate(`/orders/${order.id}`, { replace: true, state: { justPlaced: true } });
    } catch (caught) {
      setFailure(describe(caught));

      // These three mean the cart on screen no longer matches the server's, so it is re-read before
      // the user decides what to do.
      if (
        caught.code === "CART_MODIFIED" ||
        caught.code === "CART_EMPTY" ||
        caught.status === 404
      ) {
        await reload();
      }

      // Somebody else's order already holds this key. Retrying with it would be refused forever, so
      // the attempt gets a new one.
      if (caught.code === "IDEMPOTENCY_KEY_CONFLICT") {
        idempotencyKey.current = null;
      }
    } finally {
      setPlacing(false);
    }
  }

  if (status === "loading") {
    return (
      <section>
        <PageHeader title="Checkout" backTo="/cart" backLabel="Your cart" />
        <LoadingState label="Loading your cart" />
      </section>
    );
  }

  if (status === "failed") {
    return (
      <section>
        <PageHeader title="Checkout" backTo="/cart" backLabel="Your cart" />
        <ErrorState error={error} title="Could not load your cart" onRetry={reload} />
      </section>
    );
  }

  const items = cart?.items ?? [];

  if (items.length === 0) {
    return (
      <section>
        <PageHeader title="Checkout" backTo="/shops" backLabel="All shops" />
        <EmptyState
          title="There is nothing to check out"
          message="Your cart is empty, so there is no order to place."
        >
          <ButtonLink to="/shops" variant="primary">
            Browse shops
          </ButtonLink>
        </EmptyState>
      </section>
    );
  }

  const shop = cart.shopId ? shopName(cart.shopId) : null;

  return (
    <section>
      <PageHeader
        title="Checkout"
        subtitle="Check the order, then place it."
        backTo="/cart"
        backLabel="Your cart"
      />

      <div className={styles.stack}>
        {failure ? (
          <Notice tone={failure.tone} message={failure.message} details={failure.details}>
            <ButtonLink to="/cart" small>
              Review cart
            </ButtonLink>
          </Notice>
        ) : null}

        <div className={styles.card}>
          <p className={styles.shopLine}>
            Ordering from <span className={styles.shopName}>{shop ?? cart.shopId}</span>
          </p>

          <ul className={styles.lines}>
            {items.map((item) => (
              <li key={item.foodId} className={styles.line}>
                <span>
                  {item.name} <span className={styles.quantity}>× {item.quantity}</span>
                </span>
                <span className={styles.lineTotal}>{formatMinor(item.lineTotalMinor)}</span>
              </li>
            ))}
          </ul>

          <div className={styles.totals}>
            <span className={styles.totalLabel}>Total to pay</span>
            <span className={styles.total}>{formatMinor(cart.totalMinor)}</span>
          </div>
        </div>

        <div className={styles.confirm}>
          <Button
            variant="primary"
            pending={placing}
            pendingLabel="Placing your order…"
            onClick={handlePlaceOrder}
          >
            Place order
          </Button>

          {/* Payment is recorded by the server as part of the same transaction that writes the order.
              There is no payment step to present, and v1 has no representation of a refund, so this
              screen does not promise one. */}
          <p className={styles.note}>
            Placing the order records payment and reserves the stock in one step. You can cancel it
            while it is still Placed.
          </p>
        </div>
      </div>
    </section>
  );
}

/**
 * Turns a checkout refusal into something a person can act on, using the API's own error vocabulary.
 *
 * @param {import("../../lib/api-error").ApiError} error
 */
function describe(error) {
  switch (error.code) {
    case "CART_EMPTY":
      return { tone: "warning", message: error.message, retryable: false };

    case "INSUFFICIENT_STOCK":
      // details names the food that is short. How short is deliberately not published, so the message
      // does not pretend to know.
      return {
        tone: "warning",
        message: `${error.message}. Reduce or remove it in your cart, then try again.`,
        details: error.details,
        retryable: false,
      };

    case "CART_MODIFIED":
      return { tone: "warning", message: error.message, retryable: false };

    case "IDEMPOTENCY_KEY_CONFLICT":
      return {
        tone: "error",
        message: "That checkout could not be identified uniquely. Please place the order again.",
        retryable: true,
      };

    case "NOT_FOUND":
      return {
        tone: "warning",
        message: "Something in your cart is no longer available. Your cart has been refreshed.",
        retryable: false,
      };

    default:
      // Network failures and 5xx land here. Retrying is genuinely safe: the attempt keeps its
      // idempotency key, so if the order did get through, asking again returns that same order.
      return {
        tone: "error",
        message: `${error.message} You can safely try again — the order will not be placed twice.`,
        details: error.details,
        retryable: true,
      };
  }
}

export { CheckoutPage };

import { useState } from "react";

import { Button, ButtonLink } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { LoadingState } from "../../components/LoadingState";
import { Notice } from "../../components/Notice";
import { PageHeader } from "../../components/PageHeader";
import { QuantityStepper } from "../../components/QuantityStepper";
import { formatMinor } from "../../lib/money";
import { useShopDirectory } from "../catalogue/shop-directory";
import { useCart } from "./CartProvider";
import styles from "./CartPage.module.css";

/**
 * The cart, as the server currently computes it.
 *
 * No figure on this screen is calculated here. Line totals and the cart total arrive from the API,
 * which reads the current price off each food row on every request, so a reprice between adding an
 * item and viewing the cart is reflected without the client having to notice.
 *
 * The minimum quantity is one because PATCH requires a positive integer: removing a line is a
 * different operation, and the stepper's floor is the API's rule rather than a choice made here.
 */
function CartPage() {
  const { cart, status, error, reload, setQuantity, removeItem, clear } = useCart();
  const { shopName } = useShopDirectory();

  const [busyFoodId, setBusyFoodId] = useState(/** @type {string | null} */ (null));
  const [clearing, setClearing] = useState(false);
  const [failure, setFailure] = useState(
    /** @type {import("../../lib/api-error").ApiError | null} */ (null),
  );

  /**
   * A 404 here means the cart on screen is stale — the line is already gone — so the cart is re-read
   * rather than the message being left to stand against a view that no longer matches the server.
   */
  async function run(foodId, operation) {
    setBusyFoodId(foodId);
    setFailure(null);

    try {
      await operation();
    } catch (caught) {
      setFailure(caught);

      if (caught.status === 404) {
        await reload();
      }
    } finally {
      setBusyFoodId(null);
    }
  }

  async function handleClear() {
    setClearing(true);
    setFailure(null);

    try {
      await clear();
    } catch (caught) {
      setFailure(caught);
    } finally {
      setClearing(false);
    }
  }

  if (status === "loading") {
    return (
      <section>
        <PageHeader title="Your cart" backTo="/shops" backLabel="All shops" />
        <LoadingState label="Loading your cart" />
      </section>
    );
  }

  if (status === "failed") {
    return (
      <section>
        <PageHeader title="Your cart" backTo="/shops" backLabel="All shops" />
        <ErrorState error={error} title="Could not load your cart" onRetry={reload} />
      </section>
    );
  }

  const items = cart?.items ?? [];

  // A cart that was never created and one that has been emptied are the same thing to a person, and
  // the API describes both the same way: a null id, a null shop, and no items.
  if (items.length === 0) {
    return (
      <section>
        <PageHeader title="Your cart" backTo="/shops" backLabel="All shops" />
        <EmptyState title="Your cart is empty" message="Add something from a shop's menu to get started.">
          <ButtonLink to="/shops" variant="primary">
            Browse shops
          </ButtonLink>
        </EmptyState>
      </section>
    );
  }

  const shop = cart.shopId ? shopName(cart.shopId) : null;
  const anyBusy = busyFoodId !== null || clearing;

  return (
    <section>
      <PageHeader
        title="Your cart"
        subtitle="Quantities and totals are calculated by the server."
        backTo="/shops"
        backLabel="All shops"
      />

      <div className={styles.stack}>
        {failure ? (
          <Notice tone="error" message={failure.message} details={failure.details} />
        ) : null}

        <div className={styles.card}>
          {/* The cart holds one shop at a time, so naming it here explains why adding from elsewhere
              is refused. The name comes from the shop directory, since the cart carries only an id. */}
          <p className={styles.shopLine}>
            Ordering from <span className={styles.shopName}>{shop ?? cart.shopId}</span>
          </p>

          <ul className={styles.lines}>
            {items.map((item) => (
              <li key={item.foodId} className={styles.line}>
                <div className={styles.details}>
                  <p className={styles.name}>{item.name}</p>
                  <p className={styles.unitPrice}>{formatMinor(item.priceMinor)} each</p>
                </div>

                <QuantityStepper
                  value={item.quantity}
                  onChange={(next) => run(item.foodId, () => setQuantity(item.foodId, next))}
                  min={1}
                  disabled={anyBusy}
                  label={`Quantity of ${item.name}`}
                />

                <span className={styles.lineTotal}>{formatMinor(item.lineTotalMinor)}</span>

                <Button
                  variant="quiet"
                  small
                  disabled={anyBusy}
                  pending={busyFoodId === item.foodId}
                  pendingLabel="…"
                  onClick={() => run(item.foodId, () => removeItem(item.foodId))}
                  title={`Remove ${item.name}`}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>

          <div className={styles.footer}>
            <div>
              <div className={styles.totalLabel}>Total</div>
              <div className={styles.total}>{formatMinor(cart.totalMinor)}</div>
            </div>

            <div className={styles.actions}>
              <Button
                variant="danger"
                disabled={busyFoodId !== null}
                pending={clearing}
                pendingLabel="Emptying…"
                onClick={handleClear}
              >
                Empty cart
              </Button>
              <ButtonLink to="/checkout" variant="primary">
                Checkout
              </ButtonLink>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export { CartPage };

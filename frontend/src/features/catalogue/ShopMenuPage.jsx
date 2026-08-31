import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import { useAuth } from "../../app/providers/AuthProvider";
import { Button, ButtonLink } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { LoadingState } from "../../components/LoadingState";
import { Notice } from "../../components/Notice";
import { PageHeader } from "../../components/PageHeader";
import { useCart } from "../cart/CartProvider";
import { listShopFoods } from "./api";
import { MenuItemRow } from "./MenuItemRow";
import { useShopDirectory } from "./shop-directory";
import styles from "./ShopMenuPage.module.css";

/**
 * A shop's menu, and where a student fills their cart.
 *
 * Foods are read through the shop, so a shop that does not exist is a 404 from this endpoint rather
 * than an empty menu — an empty array means the shop is real and has nothing on it yet.
 */
function ShopMenuPage() {
  const { shopId } = useParams();
  const { user } = useAuth();
  const { shopName } = useShopDirectory();
  const { cart, addItem, clear } = useCart();

  const [foods, setFoods] = useState(/** @type {import("./api").Food[]} */ ([]));
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState(
    /** @type {import("../../lib/api-error").ApiError | null} */ (null),
  );

  const [feedback, setFeedback] = useState(
    /** @type {{ tone: "success" | "warning" | "error", message: string, details?: unknown[] } | null} */ (
      null
    ),
  );
  // The addition CART_SHOP_MISMATCH refused, held so it can be offered again if the cart is emptied.
  const [blockedAdd, setBlockedAdd] = useState(
    /** @type {{ food: import("./api").Food, quantity: number } | null} */ (null),
  );
  const [clearing, setClearing] = useState(false);

  const canOrder = user?.role === "STUDENT";

  const load = useCallback(async () => {
    setStatus("loading");
    setError(null);

    try {
      setFoods(await listShopFoods(shopId));
      setStatus("ready");
    } catch (caught) {
      setError(caught);
      setStatus("failed");
    }
  }, [shopId]);

  useEffect(() => {
    load();
  }, [load]);

  const addToCart = useCallback(
    async (food, quantity) => {
      setFeedback(null);
      setBlockedAdd(null);

      try {
        await addItem({ foodId: food.id, quantity });

        setFeedback({
          tone: "success",
          message: `Added ${quantity} × ${food.name} to your cart.`,
        });
      } catch (caught) {
        // The single-shop rule. The API offers no merge, so the only ways forward are emptying the
        // cart or leaving this item behind — both of which are offered rather than guessed at.
        if (caught.code === "CART_SHOP_MISMATCH") {
          setBlockedAdd({ food, quantity });
          setFeedback({ tone: "warning", message: caught.message });

          return;
        }

        // The food was deleted between this menu being drawn and the addition being sent, so the menu
        // on screen is out of date and is re-read.
        if (caught.status === 404) {
          setFeedback({ tone: "error", message: "That item is no longer on this menu." });
          load();

          return;
        }

        setFeedback({ tone: "error", message: caught.message, details: caught.details });
      }
    },
    [addItem, load],
  );

  async function clearCartAndAdd() {
    if (!blockedAdd) {
      return;
    }

    const { food, quantity } = blockedAdd;

    setClearing(true);

    try {
      await clear();
      await addToCart(food, quantity);
    } catch (caught) {
      setFeedback({ tone: "error", message: caught.message });
    } finally {
      setClearing(false);
    }
  }

  const name = shopName(shopId);
  const cartShopId = cart?.shopId ?? null;
  const holdsAnotherShop = cartShopId !== null && cartShopId !== shopId;

  return (
    <section>
      <PageHeader
        title={name ?? "Menu"}
        subtitle={name ? "Everything this shop is serving." : undefined}
        backTo="/shops"
        backLabel="All shops"
      >
        {canOrder ? <ButtonLink to="/cart">Go to cart</ButtonLink> : null}
      </PageHeader>

      <div className={styles.stack}>
        {!canOrder ? (
          <p className={styles.adminNote}>
            You are viewing this menu as an administrator. Carts and ordering are student actions, so
            no add controls are shown.
          </p>
        ) : null}

        {/* Said before an addition is attempted, because the cart already names a shop and the rule is
            worth knowing in advance. The server still decides: this is a heads-up, not the check. */}
        {canOrder && holdsAnotherShop ? (
          <Notice
            tone="info"
            message={`Your cart currently holds items from ${shopName(cartShopId) ?? "another shop"}. A cart can only contain items from one shop at a time.`}
          >
            <ButtonLink to="/cart" small>
              Review cart
            </ButtonLink>
          </Notice>
        ) : null}

        {feedback ? (
          <Notice tone={feedback.tone} message={feedback.message} details={feedback.details}>
            {blockedAdd ? (
              <>
                <Button
                  variant="danger"
                  small
                  pending={clearing}
                  pendingLabel="Emptying…"
                  onClick={clearCartAndAdd}
                >
                  Empty cart and add {blockedAdd.food.name}
                </Button>
                <ButtonLink to="/cart" small>
                  Review cart instead
                </ButtonLink>
              </>
            ) : null}
          </Notice>
        ) : null}

        {status === "loading" ? <LoadingState label="Loading menu" /> : null}

        {status === "failed" ? (
          <ErrorState
            error={error}
            title={error?.status === 404 ? "Shop not found" : "Could not load this menu"}
            onRetry={load}
          />
        ) : null}

        {status === "ready" && foods.length === 0 ? (
          <EmptyState
            title="Nothing on the menu"
            message="This shop has not added any food yet."
          >
            <ButtonLink to="/shops">Back to shops</ButtonLink>
          </EmptyState>
        ) : null}

        {status === "ready" && foods.length > 0 ? (
          <ul className={styles.menu}>
            {foods.map((food) => (
              <MenuItemRow key={food.id} food={food} canOrder={canOrder} onAdd={addToCart} />
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

export { ShopMenuPage };

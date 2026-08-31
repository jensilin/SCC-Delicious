import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { useAuth } from "../../app/providers/AuthProvider";
import {
  addCartItem,
  clearCart,
  getCart,
  removeCartItem,
  setCartItemQuantity,
} from "./api";

/**
 * @typedef {"idle" | "loading" | "ready" | "failed"} CartStatus
 */

/**
 * @typedef {object} CartContextValue
 * @property {import("./api").Cart | null} cart Null until the first read succeeds, and permanently
 *   null for an ADMIN, who has no cart.
 * @property {CartStatus} status "idle" means no read has been attempted, which is the resting state
 *   for an administrator.
 * @property {import("../../lib/api-error").ApiError | null} error
 * @property {number} itemCount Total units across the lines, for the navigation badge.
 * @property {() => Promise<void>} reload
 * @property {(item: { foodId: string, quantity: number }) => Promise<void>} addItem
 * @property {(foodId: string, quantity: number) => Promise<void>} setQuantity
 * @property {(foodId: string) => Promise<void>} removeItem
 * @property {() => Promise<void>} clear
 */

const CartContext = createContext(/** @type {CartContextValue | null} */ (null));

/**
 * Holds the cart for the whole signed-in session, so the menu, the cart screen, the checkout review
 * and the navigation badge all read one copy of it.
 *
 * Every mutation replaces the cart with what the server returned rather than adjusting a local copy:
 * the API recomputes names, prices, line totals and the total on every request, so the response is
 * the only trustworthy version. The two endpoints that answer 204 with no body are followed by a
 * read, because there is nothing in their response to adopt.
 *
 * Nothing is fetched for an ADMIN. Every cart route carries a STUDENT check and would answer 403, so
 * requesting one would be asking for a refusal on every page load.
 *
 * Failures are re-thrown to the caller. The screen that started a mutation is the only place that
 * knows what to say about CART_SHOP_MISMATCH or a 404, so this provider does not swallow them.
 *
 * @param {{ children: import("react").ReactNode }} props
 */
function CartProvider({ children }) {
  const { user } = useAuth();
  const isStudent = user?.role === "STUDENT";

  const [cart, setCart] = useState(/** @type {import("./api").Cart | null} */ (null));
  const [status, setStatus] = useState(/** @type {CartStatus} */ ("idle"));
  const [error, setError] = useState(
    /** @type {import("../../lib/api-error").ApiError | null} */ (null),
  );

  const reload = useCallback(async () => {
    if (!isStudent) {
      return;
    }

    setStatus((current) => (current === "ready" ? current : "loading"));
    setError(null);

    try {
      setCart(await getCart());
      setStatus("ready");
    } catch (caught) {
      setError(caught);
      setStatus("failed");
    }
  }, [isStudent]);

  useEffect(() => {
    reload();
  }, [reload]);

  const addItem = useCallback(async (item) => {
    setCart(await addCartItem(item));
    setStatus("ready");
  }, []);

  const setQuantity = useCallback(async (foodId, quantity) => {
    setCart(await setCartItemQuantity(foodId, quantity));
    setStatus("ready");
  }, []);

  const removeItem = useCallback(
    async (foodId) => {
      await removeCartItem(foodId);
      await reload();
    },
    [reload],
  );

  const clear = useCallback(async () => {
    await clearCart();
    await reload();
  }, [reload]);

  const itemCount = useMemo(
    () => (cart?.items ?? []).reduce((total, item) => total + item.quantity, 0),
    [cart],
  );

  const value = useMemo(
    () => ({ cart, status, error, itemCount, reload, addItem, setQuantity, removeItem, clear }),
    [cart, status, error, itemCount, reload, addItem, setQuantity, removeItem, clear],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

/**
 * @returns {CartContextValue}
 */
function useCart() {
  const value = useContext(CartContext);

  if (!value) {
    throw new Error("useCart must be used inside CartProvider");
  }

  return value;
}

export { CartProvider, useCart };

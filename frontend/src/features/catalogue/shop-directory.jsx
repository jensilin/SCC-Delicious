import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { listShops } from "./api";

/**
 * @typedef {"loading" | "ready" | "failed"} DirectoryStatus
 */

/**
 * @typedef {object} ShopDirectoryValue
 * @property {import("./api").Shop[]} shops Every shop, ordered by name, as the API returned them.
 * @property {DirectoryStatus} status
 * @property {import("../../lib/api-error").ApiError | null} error
 * @property {(shopId: string) => string | null} shopName Null when this directory has not got the
 *   shop, which means it is stale rather than that the shop does not exist.
 * @property {() => void} reload
 */

const ShopDirectoryContext = createContext(/** @type {ShopDirectoryValue | null} */ (null));

/**
 * Resolves a shop id to a shop name, client-side.
 *
 * Why this exists: order responses carry `shopId` and no shop name. The API never joins an order to
 * its shop, deliberately — not joining is what keeps a past order truthful after a rename, and what
 * makes an idempotent checkout replay byte-identical. So an order list would otherwise render a raw
 * UUID where a person expects "Chicken Corner".
 *
 * Why a lookup is safe rather than best-effort: `Order.shop` is declared onDelete: Restrict and
 * deleting a shop that orders reference is refused with 409 SHOP_HAS_ORDERS, so a shop named by any
 * order always exists and is always in this list. Both roles may read GET /shops, so this works for
 * the student's own orders and for the administrative queue alike.
 *
 * Two costs are accepted knowingly. A shop's name is not snapshotted anywhere, so renaming a shop
 * re-labels historical orders — unlike a food's name, which every order line copies at purchase time.
 * And this is a second source of truth for a name, refreshed only when this provider reloads.
 *
 * Whether the API should carry the name instead is an open decision recorded in the architecture. It
 * is not settled by this module: nothing here asks the backend for anything it does not already offer.
 *
 * @param {{ children: import("react").ReactNode }} props
 */
function ShopDirectoryProvider({ children }) {
  const [shops, setShops] = useState(/** @type {import("./api").Shop[]} */ ([]));
  const [status, setStatus] = useState(/** @type {DirectoryStatus} */ ("loading"));
  const [error, setError] = useState(
    /** @type {import("../../lib/api-error").ApiError | null} */ (null),
  );
  const [reloadCount, setReloadCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    setStatus("loading");
    setError(null);

    listShops()
      .then((loaded) => {
        if (!cancelled) {
          setShops(loaded);
          setStatus("ready");
        }
      })
      .catch((caught) => {
        if (!cancelled) {
          setError(caught);
          setStatus("failed");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [reloadCount]);

  const namesById = useMemo(() => {
    const names = new Map();

    for (const shop of shops) {
      names.set(shop.id, shop.name);
    }

    return names;
  }, [shops]);

  const shopName = useCallback((shopId) => namesById.get(shopId) ?? null, [namesById]);

  const reload = useCallback(() => {
    setReloadCount((count) => count + 1);
  }, []);

  const value = useMemo(
    () => ({ shops, status, error, shopName, reload }),
    [shops, status, error, shopName, reload],
  );

  return (
    <ShopDirectoryContext.Provider value={value}>{children}</ShopDirectoryContext.Provider>
  );
}

/**
 * @returns {ShopDirectoryValue}
 */
function useShopDirectory() {
  const value = useContext(ShopDirectoryContext);

  if (!value) {
    throw new Error("useShopDirectory must be used inside ShopDirectoryProvider");
  }

  return value;
}

export { ShopDirectoryProvider, useShopDirectory };

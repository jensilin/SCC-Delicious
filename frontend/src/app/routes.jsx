import { Route, Routes } from "react-router-dom";

import { AdminOrderDetailPage } from "../features/admin-orders/AdminOrderDetailPage";
import { AdminOrderListPage } from "../features/admin-orders/AdminOrderListPage";
import { LoginPage } from "../features/auth/LoginPage";
import { RegisterPage } from "../features/auth/RegisterPage";
import { CartPage } from "../features/cart/CartPage";
import { ShopListPage } from "../features/catalogue/ShopListPage";
import { ShopMenuPage } from "../features/catalogue/ShopMenuPage";
import { CheckoutPage } from "../features/checkout/CheckoutPage";
import { OrderDetailPage } from "../features/orders/OrderDetailPage";
import { OrderListPage } from "../features/orders/OrderListPage";
import { RedirectIfSignedIn } from "./guards/RedirectIfSignedIn";
import { RequireAuth } from "./guards/RequireAuth";
import { RequireRole } from "./guards/RequireRole";
import { HomeRedirect } from "./HomeRedirect";
import { AppLayout } from "./layouts/AppLayout";
import { NotFoundPage } from "./NotFoundPage";

/**
 * Nested layouts, with the guards as pathless parent routes so that protection is declared once for a
 * whole branch rather than repeated per screen — the same reasoning the backend applies by attaching
 * role middleware to a router instead of to each handler.
 *
 * Guards here are a user-experience feature. They hide what a user cannot use; they do not secure it.
 * The server re-checks every protected action and is what actually refuses one.
 *
 * Catalogue browsing sits outside both role branches on purpose: the browsing router applies
 * authentication with no role check, so a student and an administrator read shops and menus through
 * exactly the same endpoints.
 */
function AppRoutes() {
  return (
    <Routes>
      <Route element={<RedirectIfSignedIn />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
      </Route>

      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route index element={<HomeRedirect />} />

          <Route path="shops" element={<ShopListPage />} />
          <Route path="shops/:shopId" element={<ShopMenuPage />} />

          {/* A cart, a checkout and an order all belong to one student, and every route behind them
              carries a STUDENT check on the server. */}
          <Route element={<RequireRole role="STUDENT" />}>
            <Route path="cart" element={<CartPage />} />
            <Route path="checkout" element={<CheckoutPage />} />
            <Route path="orders" element={<OrderListPage />} />
            <Route path="orders/:orderId" element={<OrderDetailPage />} />
          </Route>

          {/* Mounted under /admin because the API keeps the administrative queue on its own base path,
              /api/v1/admin/orders, for the same reason: the role check applies to a whole router. */}
          <Route element={<RequireRole role="ADMIN" />}>
            <Route path="admin/orders" element={<AdminOrderListPage />} />
            <Route path="admin/orders/:orderId" element={<AdminOrderDetailPage />} />
          </Route>

          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}

export { AppRoutes };

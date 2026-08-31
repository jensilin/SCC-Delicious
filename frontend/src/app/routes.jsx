import { Navigate, Route, Routes } from "react-router-dom";

import { LoginPage } from "../features/auth/LoginPage";
import { RegisterPage } from "../features/auth/RegisterPage";
import { ShopListPage } from "../features/catalogue/ShopListPage";
import { RedirectIfSignedIn } from "./guards/RedirectIfSignedIn";
import { RequireAuth } from "./guards/RequireAuth";
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
 * Role-scoped branches, and the guard that gates them, arrive with the first screens that belong to
 * one role: everything reachable so far is either public or open to both roles, and a guard with
 * nothing behind it would be untested and unused.
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
          <Route index element={<Navigate to="/shops" replace />} />
          <Route path="shops" element={<ShopListPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}

export { AppRoutes };

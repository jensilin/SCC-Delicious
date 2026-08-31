import { api } from "../../lib/api-client";

// Browsing is open to both roles — the browsing router applies authentication with no role check —
// so the admin catalogue screens read through exactly these endpoints rather than admin-only ones.
// There is no anonymous browsing: even the shop list requires a token.

/**
 * @typedef {object} Shop
 * @property {string} id UUID.
 * @property {string} name
 * @property {string} createdAt ISO 8601 timestamp.
 * @property {string} updatedAt ISO 8601 timestamp.
 */

/**
 * Money is an integer in minor units, exactly as stored. The API never formats a price, so that no
 * second and lossy representation of money exists.
 *
 * @typedef {object} Food
 * @property {string} id UUID.
 * @property {string} shopId UUID of the owning shop.
 * @property {string} name
 * @property {number} priceMinor Integer minor units.
 * @property {number} stockQuantity Current stock. Adding to a cart does not reserve it; availability
 *   is confirmed only at checkout.
 * @property {string} createdAt ISO 8601 timestamp.
 * @property {string} updatedAt ISO 8601 timestamp.
 */

/**
 * Every shop, ordered by name.
 *
 * @returns {Promise<Shop[]>} 200. An empty array when there are no shops, never a 404.
 */
function listShops() {
  return api.get("/shops");
}

/**
 * A shop's foods, ordered by name. Read through the shop, so a missing shop is a 404 rather than an
 * empty list — an empty array means the shop exists and has no menu yet.
 *
 * @param {string} shopId
 * @returns {Promise<Food[]>} 200, or 404 NOT_FOUND.
 */
function listShopFoods(shopId) {
  return api.get(`/shops/${shopId}/foods`);
}

// The API also offers GET /shops/:shopId and GET /shops/:shopId/foods/:foodId. Neither is wrapped
// here, because no screen has anything to ask them: a shop's name comes from the directory the list
// above already fills, and a food's list entry carries every field the API publishes about it, so a
// per-food read would return what is already on screen.

export { listShopFoods, listShops };

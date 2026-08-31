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
 * @param {string} shopId
 * @returns {Promise<Shop>} 200, or 404 NOT_FOUND.
 */
function getShop(shopId) {
  return api.get(`/shops/${shopId}`);
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

/**
 * A food is only ever addressed through its shop, and the pair is what the lookup is scoped by, so a
 * real food id under the wrong shop is 404 rather than a leak.
 *
 * @param {string} shopId
 * @param {string} foodId
 * @returns {Promise<Food>} 200, or 404 NOT_FOUND.
 */
function getShopFood(shopId, foodId) {
  return api.get(`/shops/${shopId}/foods/${foodId}`);
}

export { getShop, getShopFood, listShopFoods, listShops };

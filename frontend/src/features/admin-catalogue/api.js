import { api } from "../../lib/api-client";

// ADMIN only: the write half of the catalogue.
//
// These share the /api/v1/shops base path with browsing, because the API keeps one URL per resource
// and splits it by router instead — reads on a router open to both roles, writes on a second router
// behind an ADMIN check. The client mirrors that split rather than restating it: reading is not
// redeclared here, since the list a management screen shows is the same list a student browses,
// wrapped once in features/catalogue/api.js and held by the shop directory.
//
// A STUDENT calling any of these is refused by the server with 403 FORBIDDEN. The role guard in the
// route tree decides only what is offered.

/**
 * Creates a shop. `name` is the only field, because it is the only column the model has besides its
 * identifier and its timestamps.
 *
 * Shop names are deliberately not unique — two stalls may reasonably share a name — so a duplicate
 * is created rather than refused.
 *
 * @param {{ name: string }} shop
 * @returns {Promise<import("../catalogue/api").Shop>} 201 with the created shop.
 */
function createShop(shop) {
  return api.post("/shops", shop);
}

/**
 * Renames a shop. The name is the only field the endpoint accepts, and a patch that changes nothing
 * is 400 VALIDATION_ERROR — "must change at least one field" — rather than a no-op success.
 *
 * A rename re-labels the orders placed with the shop: unlike a food's name, a shop's name is not
 * snapshotted anywhere, and an order response carries only its shopId.
 *
 * @param {string} shopId
 * @param {{ name: string }} changes
 * @returns {Promise<import("../catalogue/api").Shop>} 200 with the updated shop, or 404 NOT_FOUND.
 */
function updateShop(shopId, changes) {
  return api.patch(`/shops/${shopId}`, changes);
}

/**
 * Deletes a shop, and its whole menu with it, because Food.shop cascades.
 *
 * Refused with 409 SHOP_HAS_ORDERS for as long as any order references the shop, since Order.shop is
 * declared onDelete: Restrict — which is what keeps a past order's attribution truthful. There is no
 * soft delete and no visibility flag in v1, so this is the only way a shop leaves the list.
 *
 * @param {string} shopId
 * @returns {Promise<void>} 204, or 404 NOT_FOUND, or 409 SHOP_HAS_ORDERS.
 */
function deleteShop(shopId) {
  return api.delete(`/shops/${shopId}`);
}

/**
 * Creates a food within a shop. All three fields are required, and this is the one place a stock
 * quantity is set absolutely — every later change to it is a delta.
 *
 * Foods are addressed beneath their shop for writes exactly as they are for reads, so a shop that
 * does not exist is reported rather than a food created loose.
 *
 * @param {string} shopId
 * @param {{ name: string, priceMinor: number, stockQuantity: number }} food
 * @returns {Promise<import("../catalogue/api").Food>} 201, or 404 NOT_FOUND for an unknown shop.
 */
function createFood(shopId, food) {
  return api.post(`/shops/${shopId}/foods`, food);
}

/**
 * Changes a food's name, its price, or both. At least one is required: a patch describing no change
 * is 400 VALIDATION_ERROR rather than a success that moved updated_at.
 *
 * `stockQuantity` is not accepted here. The schema strips it before any code reads it, the same way
 * a client-supplied `role` is stripped from registration, so stock can only move through the delta
 * endpoint below.
 *
 * Neither field rewrites a past order: an order item copied the name and the unit price at purchase
 * time, which is what makes a rename or a reprice safe.
 *
 * @param {string} shopId
 * @param {string} foodId
 * @param {{ name?: string, priceMinor?: number }} changes
 * @returns {Promise<import("../catalogue/api").Food>} 200, or 404 NOT_FOUND.
 */
function updateFood(shopId, foodId, changes) {
  return api.patch(`/shops/${shopId}/foods/${foodId}`, changes);
}

/**
 * Deletes a food. Always permitted, and what it leaves behind is worth knowing: a past order keeps
 * the line, because its name and price are snapshots and its food reference is nulled, while a cart
 * holding the food loses that line to a cascade — a cart being transient working state.
 *
 * @param {string} shopId
 * @param {string} foodId
 * @returns {Promise<void>} 204, or 404 NOT_FOUND.
 */
function deleteFood(shopId, foodId) {
  return api.delete(`/shops/${shopId}/foods/${foodId}`);
}

/**
 * Moves a food's stock by a signed delta, which is the only way a quantity changes after creation.
 *
 * The delta is applied by the database as one conditional update, so the current quantity is never
 * read into the client and no two callers can both spend the last unit. A delta of zero is a
 * validation error, and one that would leave the quantity negative is 409 INSUFFICIENT_STOCK — which
 * carries no `details` from this endpoint, unlike checkout's.
 *
 * @param {string} shopId
 * @param {string} foodId
 * @param {number} delta Non-zero. Negative consumes stock, positive restores it.
 * @returns {Promise<import("../catalogue/api").Food>} 200 with the food as the change left it.
 */
function adjustFoodStock(shopId, foodId, delta) {
  return api.patch(`/shops/${shopId}/foods/${foodId}/stock`, { delta });
}

export {
  adjustFoodStock,
  createFood,
  createShop,
  deleteFood,
  deleteShop,
  updateFood,
  updateShop,
};

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

export { createShop, deleteShop, updateShop };

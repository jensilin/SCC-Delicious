import { api } from "../../lib/api-client";

// STUDENT only. Every route here carries a router-level STUDENT check, so an ADMIN receives 403 on
// all of them — an administrator has no cart at all.
//
// The cart is a per-user singleton with no id in the path: the token names it, so there is nothing a
// client could substitute. A line is addressed by its food, which appears at most once per cart.

/**
 * A cart line. It stores quantity and nothing else — the name, the price and both totals are read
 * from the food row on every request, so a reprice is reflected immediately and no stale figure can
 * be quoted back.
 *
 * `priceMinor` is the same key an order item uses for the same figure, so one component renders both.
 *
 * @typedef {object} CartItem
 * @property {string} foodId UUID, and the identifier used to address this line.
 * @property {string} name Current food name.
 * @property {number} priceMinor Current unit price, integer minor units.
 * @property {number} quantity
 * @property {number} lineTotalMinor Computed by the server.
 */

/**
 * The cart.
 *
 * There are two shapes of empty and a screen must treat them alike. A user who has never added
 * anything has no cart row at all, which the API describes directly rather than answering 404 or
 * writing a row on a GET: `id` is null. A cart that once held items and was emptied keeps its row, so
 * `id` is a uuid while `items` is still empty. Emptiness is therefore `items.length === 0`, never a
 * null id.
 *
 * `shopId` is the single-shop rule made visible — it is null whenever the cart is empty, however it
 * got that way, and names the one shop the cart holds items from otherwise.
 *
 * @typedef {object} Cart
 * @property {string | null} id
 * @property {string | null} shopId
 * @property {CartItem[]} items Ordered by food name.
 * @property {number} totalMinor Sum of the line totals, computed by the server.
 */

/**
 * @returns {Promise<Cart>} 200.
 */
function getCart() {
  return api.get("/cart");
}

/**
 * Adds to the cart. `quantity` is a **delta**: adding two of something already in the cart asks for
 * two more of it, and the API increments the existing line rather than creating a second one.
 *
 * A food from a different shop than the cart already holds is 409 CART_SHOP_MISMATCH. The rule is
 * one shop per cart and the API offers no merge, so the only ways forward are clearing the cart or
 * abandoning the addition.
 *
 * @param {{ foodId: string, quantity: number }} item Quantity must be a positive integer.
 * @returns {Promise<Cart>} 201 with the whole cart, because every write moves the totals.
 */
function addCartItem(item) {
  return api.post("/cart/items", item);
}

/**
 * Sets a line's quantity. `quantity` here is the **resulting total**, not a change to it, because
 * this endpoint exists for a field the user typed a number into.
 *
 * @param {string} foodId
 * @param {number} quantity Positive integer.
 * @returns {Promise<Cart>} 200 with the whole cart.
 */
function setCartItemQuantity(foodId, quantity) {
  return api.patch(`/cart/items/${foodId}`, { quantity });
}

/**
 * Removes a line. Answers 204 with no body, so the caller must refetch the cart rather than reading
 * a returned one.
 *
 * @param {string} foodId
 * @returns {Promise<void>} 204.
 */
function removeCartItem(foodId) {
  return api.delete(`/cart/items/${foodId}`);
}

/**
 * Empties the cart and releases its shop. Emptying a cart that was never created is not an error.
 * Answers 204 with no body, so the caller must refetch.
 *
 * @returns {Promise<void>} 204.
 */
function clearCart() {
  return api.delete("/cart");
}

export { addCartItem, clearCart, getCart, removeCartItem, setCartItemQuantity };

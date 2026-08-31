// The one place money becomes text. Every screen that shows a price — menu, cart, checkout, order
// list, order detail — formats through here, so a total cannot be rendered one way on one screen and
// another way on the next.

/**
 * Formats an integer amount of minor units as a plain decimal with exactly two places.
 *
 * No currency symbol, deliberately. The API stores money as integer minor units and names no
 * currency anywhere in the schema, the validators or the responses, so choosing a symbol here would
 * be the client inventing product information the server never stated.
 *
 * The arithmetic is integer, not `minor / 100`, so no floating-point value is ever rounded to
 * produce a figure a person is asked to pay.
 *
 * @param {number} minor Integer minor units, as every priceMinor, lineTotalMinor and totalMinor is.
 * @returns {string} For example "40.00", "1.05", "0.00".
 */
function formatMinor(minor) {
  const sign = minor < 0 ? "-" : "";
  const absolute = Math.abs(minor);
  const major = Math.trunc(absolute / 100);
  const remainder = absolute % 100;

  return `${sign}${major}.${String(remainder).padStart(2, "0")}`;
}

export { formatMinor };

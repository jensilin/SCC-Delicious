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

/**
 * Reads a decimal amount somebody typed as the integer minor units every price field in the API is.
 *
 * Strict rather than forgiving: text this does not recognise returns null and the form says so.
 * The alternative is guessing what "12.3.4" or "1,20" was meant to be and storing the guess as a
 * price, and a price is the one figure in the application a person is asked to pay.
 *
 * The arithmetic is integer, for the same reason formatMinor's is: `Number("25.50") * 100` is
 * 2549.9999999999995 before rounding.
 *
 * @param {string} text A whole or two-place decimal, such as "25" or "25.50".
 * @returns {number | null} Integer minor units, or null when the text is not an amount.
 */
function parseMinor(text) {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text.trim());

  if (!match) {
    return null;
  }

  const [, major, fraction = ""] = match;
  const minor = Number(major) * 100 + Number(fraction.padEnd(2, "0"));

  // The column is a PostgreSQL integer and the validator bounds it; this only refuses what cannot
  // survive the conversion above.
  return Number.isSafeInteger(minor) ? minor : null;
}

export { formatMinor, parseMinor };

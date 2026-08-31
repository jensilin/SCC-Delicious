// Timestamps arrive as ISO 8601 strings in UTC. They are rendered in the reader's own locale and time
// zone, which is what the browser knows and the server does not.

const formatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

/**
 * @param {string} iso An ISO 8601 timestamp, such as an order's placedAt.
 * @returns {string}
 */
function formatTimestamp(iso) {
  return formatter.format(new Date(iso));
}

export { formatTimestamp };

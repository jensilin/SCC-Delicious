// A mirror of the server's transition table, turned around.
//
// The server states it as "the status a role may ask for, and the statuses an order must already be in
// for that move to be legal", because that direction is what goes into the WHERE clause of a
// conditional update. A screen needs the opposite: given where this order stands, what may be offered.
//
// It is only ever used to decide which buttons to draw. The server re-applies its own table on every
// request and refuses anything else with 409 ORDER_STATUS_CONFLICT, so a stale screen here produces a
// refusal rather than an illegal move. COMPLETED and CANCELLED list nothing, which is the whole of
// what makes them terminal, and each advancement has exactly one predecessor, so no status can be
// skipped.

/** @type {Record<string, import("../orders/api").OrderStatus[]>} */
const NEXT_STATUSES = {
  PLACED: ["PREPARING", "CANCELLED"],
  PREPARING: ["READY", "CANCELLED"],
  READY: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

/** What each move is called on a button, rather than showing the raw enum. */
const TRANSITION_LABELS = {
  PREPARING: "Start preparing",
  READY: "Mark ready",
  COMPLETED: "Mark completed",
  CANCELLED: "Cancel order",
};

/**
 * @param {string} status
 * @returns {import("../orders/api").OrderStatus[]}
 */
function nextStatuses(status) {
  return NEXT_STATUSES[status] ?? [];
}

export { TRANSITION_LABELS, nextStatuses };

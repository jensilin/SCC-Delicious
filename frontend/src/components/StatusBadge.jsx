import styles from "./StatusBadge.module.css";

// The five statuses the API defines, and nothing else. A status the client does not recognise is
// rendered as it arrived rather than hidden or relabelled, so an unexpected value is visible instead
// of silently becoming something else.
const CLASS_NAMES = {
  PLACED: styles.placed,
  PREPARING: styles.preparing,
  READY: styles.ready,
  COMPLETED: styles.completed,
  CANCELLED: styles.cancelled,
};

/**
 * What an order's status is called on screen, for the places a sentence reads better than the raw
 * enum. The badge itself keeps the enum's own casing, because that is what the API and the
 * administrative queue speak.
 */
const STATUS_DESCRIPTIONS = {
  PLACED: "Waiting for the shop to start preparing it",
  PREPARING: "The shop is preparing it now",
  READY: "Ready for collection",
  COMPLETED: "Collected and finished",
  CANCELLED: "Cancelled; any stock it held has been returned",
};

/**
 * @param {{ status: string }} props
 */
function StatusBadge({ status }) {
  return <span className={`${styles.badge} ${CLASS_NAMES[status] ?? ""}`}>{status}</span>;
}

export { STATUS_DESCRIPTIONS, StatusBadge };

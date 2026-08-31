import styles from "./feedback.module.css";

/**
 * The one waiting state, so that every screen reads the same way while a request is in flight.
 *
 * @param {{ label?: string }} props
 */
function LoadingState({ label = "Loading" }) {
  return (
    <div className={styles.panel} role="status" aria-live="polite">
      <div className={styles.spinner} />
      <p className={styles.message}>{label}</p>
    </div>
  );
}

export { LoadingState };

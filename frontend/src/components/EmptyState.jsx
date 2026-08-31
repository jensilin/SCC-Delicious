import styles from "./feedback.module.css";

/**
 * For the states the API returns as genuinely empty rather than as failures: no shops, a shop with no
 * foods, a cart that was never created, an order list with nothing in it. None of those are errors,
 * and none of them are 404s.
 *
 * @param {{ title: string, message?: string, children?: import("react").ReactNode }} props
 */
function EmptyState({ title, message, children }) {
  return (
    <div className={styles.panel}>
      <p className={styles.title}>{title}</p>
      {message ? <p className={styles.message}>{message}</p> : null}
      {children}
    </div>
  );
}

export { EmptyState };

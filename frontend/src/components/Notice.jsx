import styles from "./Notice.module.css";

/**
 * Inline feedback about something the user just did, as opposed to the full-panel LoadingState,
 * EmptyState and ErrorState which describe a screen that could not load.
 *
 * Mutations report through this: an item added, a status advanced, or a refusal the user can act on.
 *
 * @param {object} props
 * @param {"info" | "success" | "warning" | "error"} props.tone
 * @param {string} props.message
 * @param {Array<{ field?: string, foodId?: string, name?: string, message: string }>} [props.details] The `details`
 *   array of an ApiError, when it has one: per-field for a validation failure, or the named food for
 *   checkout's INSUFFICIENT_STOCK.
 * @param {import("react").ReactNode} [props.children] Actions offered alongside the message.
 */
function Notice({ tone, message, details, children }) {
  const listed = Array.isArray(details) ? details : [];

  return (
    <div
      className={`${styles.notice} ${styles[tone]}`}
      role={tone === "error" ? "alert" : "status"}
    >
      <div className={styles.body}>
        <p className={styles.message}>{message}</p>

        {listed.length > 0 ? (
          <ul className={styles.details}>
            {listed.map((detail, index) => (
              <li key={detail.foodId ?? detail.field ?? index}>
                {detail.name ? `${detail.name}: ${detail.message}` : detail.message}
              </li>
            ))}
          </ul>
        ) : null}

        {children ? <div className={styles.actions}>{children}</div> : null}
      </div>
    </div>
  );
}

export { Notice };

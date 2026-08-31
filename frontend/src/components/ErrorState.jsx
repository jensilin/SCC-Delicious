import styles from "./feedback.module.css";

/**
 * A failed read, rendered from the normalised ApiError the API layer produces.
 *
 * The message shown is the backend's own: deliberate client errors carry messages written to be read
 * by a client, and a 5xx has already had its message replaced with a generic one server-side.
 *
 * Retry is offered only where retrying the identical request could succeed — a network failure or a
 * 5xx. A 409 describes a state, not a transient fault, so offering to retry it would be misleading.
 *
 * @param {object} props
 * @param {import("../lib/api-error").ApiError} props.error
 * @param {string} [props.title]
 * @param {() => void} [props.onRetry]
 */
function ErrorState({ error, title = "Something went wrong", onRetry }) {
  const canRetry = Boolean(onRetry) && error?.isRetryable === true;
  const details = Array.isArray(error?.details) ? error.details : [];

  return (
    <div className={`${styles.panel} ${styles.error}`} role="alert">
      <p className={`${styles.title} ${styles.errorTitle}`}>{title}</p>
      <p className={styles.message}>{error?.message ?? "The request could not be completed."}</p>

      {details.length > 0 ? (
        <ul className={styles.details}>
          {details.map((detail, index) => (
            <li key={`${detail.field ?? detail.foodId ?? index}`}>
              {detail.name ? `${detail.name}: ${detail.message}` : detail.message}
            </li>
          ))}
        </ul>
      ) : null}

      {canRetry ? (
        <button type="button" className={styles.button} onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}

export { ErrorState };

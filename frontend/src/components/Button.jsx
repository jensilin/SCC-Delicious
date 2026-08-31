import { Link } from "react-router-dom";

import styles from "./Button.module.css";

/**
 * @param {object} parameters
 * @param {"primary" | "secondary" | "danger" | "quiet"} [parameters.variant]
 * @param {boolean} [parameters.small]
 * @param {boolean} [parameters.fullWidth]
 */
function classNames({ variant = "secondary", small = false, fullWidth = false }) {
  return [
    styles.button,
    styles[variant],
    small ? styles.small : "",
    fullWidth ? styles.fullWidth : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * The one button. Every action across the application uses it, so the styling lives in a single
 * module instead of being restated by each screen's stylesheet.
 *
 * `pending` both disables the button and swaps its label, which is how every mutation on every screen
 * reports that it is in flight and stops a second submission.
 *
 * @param {object} props
 * @param {import("react").ReactNode} props.children
 * @param {"button" | "submit"} [props.type]
 * @param {"primary" | "secondary" | "danger" | "quiet"} [props.variant]
 * @param {boolean} [props.small]
 * @param {boolean} [props.fullWidth]
 * @param {boolean} [props.disabled]
 * @param {boolean} [props.pending]
 * @param {string} [props.pendingLabel]
 * @param {string} [props.title]
 * @param {() => void} [props.onClick]
 */
function Button({
  children,
  type = "button",
  variant,
  small,
  fullWidth,
  disabled = false,
  pending = false,
  pendingLabel,
  title,
  onClick,
}) {
  return (
    <button
      type={type}
      className={classNames({ variant, small, fullWidth })}
      disabled={disabled || pending}
      title={title}
      onClick={onClick}
    >
      {pending ? (pendingLabel ?? "Working…") : children}
    </button>
  );
}

/**
 * A navigation that looks like a button, for the places where the action is "go to the next step" —
 * proceeding to checkout, going back to a list. It is a link rather than a button with a navigate
 * call so that it behaves like one: middle-click, open in a new tab, and the browser's own focus
 * handling all work.
 *
 * @param {object} props
 * @param {import("react").ReactNode} props.children
 * @param {string} props.to
 * @param {"primary" | "secondary" | "danger" | "quiet"} [props.variant]
 * @param {boolean} [props.small]
 * @param {boolean} [props.fullWidth]
 */
function ButtonLink({ children, to, variant, small, fullWidth }) {
  return (
    <Link to={to} className={classNames({ variant, small, fullWidth })}>
      {children}
    </Link>
  );
}

export { Button, ButtonLink };

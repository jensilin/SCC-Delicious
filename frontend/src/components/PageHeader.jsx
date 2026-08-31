import { Link } from "react-router-dom";

import styles from "./PageHeader.module.css";

/**
 * The top of every screen: what this page is, and the way back to the one that leads here.
 *
 * The back link is a real route rather than history.back(), so it points somewhere sensible even when
 * the screen was opened directly from a pasted address.
 *
 * @param {object} props
 * @param {string} props.title
 * @param {string} [props.subtitle]
 * @param {string} [props.backTo]
 * @param {string} [props.backLabel]
 * @param {import("react").ReactNode} [props.children] Actions shown opposite the title.
 */
function PageHeader({ title, subtitle, backTo, backLabel = "Back", children }) {
  return (
    <header className={styles.header}>
      {backTo ? (
        <Link to={backTo} className={styles.back}>
          ← {backLabel}
        </Link>
      ) : null}

      <div className={styles.row}>
        <div>
          <h1 className={styles.title}>{title}</h1>
          {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
        </div>

        {children ? <div className={styles.actions}>{children}</div> : null}
      </div>
    </header>
  );
}

export { PageHeader };

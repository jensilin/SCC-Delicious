import styles from "./Logo.module.css";

/**
 * The SCC Delicious brand lockup: the serving-dome mark beside the wordmark.
 *
 * The mark is inline SVG rather than an <img> so that it scales with the layout and needs no second
 * network request, and the wordmark is real text rather than paths baked into an image. That is what
 * keeps it crisp at every zoom level, lets it inherit the application's own font stack, and leaves
 * "SCC Delicious" readable to a screen reader and to search — an image would have to restate the
 * name in alt text and could then drift from it. The SVG is therefore aria-hidden: it is decoration
 * beside the name, not a second announcement of it.
 *
 * The dome geometry is duplicated in public/favicon.svg on purpose. A browser tab is served a static
 * file before any script runs, so the mark cannot come from this component; the two must be kept in
 * step by hand if the shape ever changes.
 */
function Logo() {
  return (
    <span className={styles.lockup}>
      <svg className={styles.mark} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id="sccDeliciousLogoWarm" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ea580c" />
            <stop offset="1" stopColor="#c2410c" />
          </linearGradient>
        </defs>
        <rect width="32" height="32" rx="8" fill="url(#sccDeliciousLogoWarm)" />
        <circle cx="16" cy="9.9" r="1.8" fill="#ffffff" />
        <path d="M7.2 19.1a8.8 8 0 0 1 17.6 0Z" fill="#ffffff" />
        <rect x="5.2" y="20.6" width="21.6" height="3" rx="1.5" fill="#ffffff" />
      </svg>

      <span className={styles.wordmark}>
        <span className={styles.scc}>SCC</span>
        {" "}
        <span className={styles.delicious}>Delicious</span>
      </span>
    </span>
  );
}

export { Logo };

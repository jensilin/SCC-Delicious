import { formatMinor } from "../../lib/money";
import styles from "./OrderItemsTable.module.css";

/**
 * What an order contains, and what it came to. Shared by the student's order detail and the
 * administrative one, because an order item is the same record to both and the admin response is the
 * student response plus the buyer's email.
 *
 * Every figure shown is a snapshot the order recorded when it was placed, not a current catalogue
 * price, which is why a rename or a reprice afterwards cannot change what a past order says.
 *
 * @param {object} props
 * @param {import("./api").OrderItem[]} props.items
 * @param {number} props.totalMinor
 */
function OrderItemsTable({ items, totalMinor }) {
  return (
    <div className={styles.card}>
      <ul className={styles.lines}>
        {items.map((item, index) => (
          // The name snapshot is not unique and foodId is null once a food has been deleted, so
          // neither is a dependable key on its own.
          <li key={item.foodId ?? `${item.name}-${index}`} className={styles.line}>
            <div className={styles.details}>
              <p className={styles.name}>{item.name}</p>
              <p className={styles.breakdown}>
                {formatMinor(item.priceMinor)} × {item.quantity}
                {/* foodId is null when the food has been deleted since. The line keeps its name and
                    price, so the order stays readable; there is simply nothing left to link to. */}
                {item.foodId === null ? (
                  <span className={styles.removed}> · no longer in the catalogue</span>
                ) : null}
              </p>
            </div>

            <span className={styles.lineTotal}>{formatMinor(item.lineTotalMinor)}</span>
          </li>
        ))}
      </ul>

      <div className={styles.totals}>
        <span className={styles.totalLabel}>Order total</span>
        <span className={styles.total}>{formatMinor(totalMinor)}</span>
      </div>
    </div>
  );
}

export { OrderItemsTable };

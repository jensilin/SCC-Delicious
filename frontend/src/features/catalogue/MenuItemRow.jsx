import { useState } from "react";

import { Button } from "../../components/Button";
import { QuantityStepper } from "../../components/QuantityStepper";
import { formatMinor } from "../../lib/money";
import styles from "./MenuItemRow.module.css";

/**
 * One food on a shop's menu, with the controls to put it in a cart.
 *
 * The quantity chosen here is a delta, which is what POST /cart/items takes: choosing two of
 * something already in the cart asks for two more of it, and the server increments the existing line
 * rather than creating a second one.
 *
 * The stock figure is displayed because the API publishes it, and the add control is withheld when it
 * is zero. That is a courtesy rather than a rule — the cart deliberately does not consult stock, so
 * the API would accept the addition — but an item known to be unavailable would only fail at
 * checkout, which is where availability is actually decided. Nothing here reserves anything.
 *
 * @param {object} props
 * @param {import("./api").Food} props.food
 * @param {boolean} props.canOrder False for an administrator, who has no cart.
 * @param {(food: import("./api").Food, quantity: number) => Promise<void>} props.onAdd
 */
function MenuItemRow({ food, canOrder, onAdd }) {
  const [quantity, setQuantity] = useState(1);
  const [adding, setAdding] = useState(false);

  const outOfStock = food.stockQuantity === 0;

  async function handleAdd() {
    setAdding(true);

    try {
      await onAdd(food, quantity);
      setQuantity(1);
    } finally {
      setAdding(false);
    }
  }

  return (
    <li className={styles.row}>
      <div className={styles.details}>
        <p className={styles.name}>{food.name}</p>
        <p className={`${styles.stock} ${outOfStock ? styles.outOfStock : ""}`}>
          {outOfStock ? "Out of stock" : `${food.stockQuantity} in stock`}
        </p>
      </div>

      <span className={styles.price}>{formatMinor(food.priceMinor)}</span>

      {canOrder && !outOfStock ? (
        <div className={styles.controls}>
          <QuantityStepper
            value={quantity}
            onChange={setQuantity}
            max={food.stockQuantity}
            disabled={adding}
            label={`Quantity of ${food.name}`}
          />
          <Button variant="primary" small pending={adding} pendingLabel="Adding…" onClick={handleAdd}>
            Add to cart
          </Button>
        </div>
      ) : null}
    </li>
  );
}

export { MenuItemRow };

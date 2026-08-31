import styles from "./QuantityStepper.module.css";

/**
 * A quantity control, used both for choosing how many of a food to add and for changing a cart line.
 *
 * There is no free-text entry on purpose: the API accepts a positive integer, and a stepper cannot
 * produce a blank, a decimal or a negative, so the two ways a quantity is chosen in this application
 * cannot disagree about what a valid one is.
 *
 * `max` is a courtesy where a bound is known, not a rule. Stock is not reserved by a cart and is only
 * confirmed at checkout, so the server remains the authority on whether a quantity can be supplied.
 *
 * @param {object} props
 * @param {number} props.value
 * @param {(next: number) => void} props.onChange
 * @param {number} [props.min]
 * @param {number} [props.max]
 * @param {boolean} [props.disabled]
 * @param {string} props.label Accessible description, such as "Quantity of Pani Puri".
 */
function QuantityStepper({ value, onChange, min = 1, max, disabled = false, label }) {
  const canDecrease = !disabled && value > min;
  const canIncrease = !disabled && (max === undefined || value < max);

  return (
    <span className={styles.stepper} role="group" aria-label={label}>
      <button
        type="button"
        className={styles.step}
        onClick={() => onChange(value - 1)}
        disabled={!canDecrease}
        aria-label="Decrease"
      >
        −
      </button>

      <span className={styles.value} aria-live="polite">
        {value}
      </span>

      <button
        type="button"
        className={styles.step}
        onClick={() => onChange(value + 1)}
        disabled={!canIncrease}
        aria-label="Increase"
      >
        +
      </button>
    </span>
  );
}

export { QuantityStepper };

import styles from "./FieldErrors.module.css";

/**
 * One field's validation message, from the `details` array a 400 VALIDATION_ERROR carries. The field
 * name is Zod's own path joined with dots, so it matches the request key: "email", "quantity",
 * "delta", or "idempotency-key" for the checkout header.
 *
 * @param {{ errors: Record<string, string>, field: string }} props
 */
function FieldError({ errors, field }) {
  const message = errors[field];

  if (!message) {
    return null;
  }

  return <p className={styles.fieldError}>{message}</p>;
}

/**
 * A message that belongs to the request as a whole rather than to one field.
 *
 * Two sources reach here. Validation details carry an empty `field` when the rule is about the object
 * rather than a member of it — "must change at least one field" on a catalogue PATCH is reported that
 * way — and dropping those would leave a form that refuses to submit without saying why. Everything
 * that is not a validation failure at all, such as 401 INVALID_CREDENTIALS or 409
 * EMAIL_ALREADY_REGISTERED, is shown here too.
 *
 * @param {{ message: string | null | undefined }} props
 */
function FormError({ message }) {
  if (!message) {
    return null;
  }

  return (
    <p className={styles.formError} role="alert">
      {message}
    </p>
  );
}

export { FieldError, FormError };

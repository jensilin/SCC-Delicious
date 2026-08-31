import { useState } from "react";
import { Link } from "react-router-dom";

import { FieldError, FormError } from "../../components/FieldErrors";
import { useAuth } from "../../app/providers/AuthProvider";
import styles from "./AuthForm.module.css";

/**
 * Creates a student account. Registration always produces a STUDENT — the server assigns the role and
 * strips any the request tries to send — and there is no endpoint anywhere that creates an
 * administrator, so this form is student-only by construction rather than by choice.
 *
 * A successful registration returns a session, so the new account is signed in rather than sent back
 * to the login form.
 */
function RegisterPage() {
  const { signUp } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(/** @type {import("../../lib/api-error").ApiError | null} */ (null));
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      await signUp({ email, password });
    } catch (caught) {
      setError(caught);
      setSubmitting(false);
    }
  }

  // 409 EMAIL_ALREADY_REGISTERED is shown as written. Registration cannot both create a session and
  // conceal that an address is taken, so the API says so plainly here where sign-in does not.
  const fieldErrors = error?.fieldErrors() ?? {};
  const formMessage = error && error.status !== 400 ? error.message : null;

  return (
    <div className={styles.screen}>
      <div className={styles.card}>
        <h1 className={styles.brand}>Create an account</h1>
        <p className={styles.subtitle}>Student accounts can browse, order, and cancel.</p>

        <form className={styles.form} onSubmit={handleSubmit} noValidate>
          <FormError message={formMessage} />

          <div className={styles.field}>
            <label className={styles.label} htmlFor="email">
              Email
            </label>
            <input
              id="email"
              className={styles.input}
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
            <FieldError errors={fieldErrors} field="email" />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="password">
              Password
            </label>
            <input
              id="password"
              className={styles.input}
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
            {/* The API's only password rule is length: at least 8 characters, with no composition
                requirements. Stating it avoids a round trip to discover it. */}
            <p className={styles.hint}>At least 8 characters.</p>
            <FieldError errors={fieldErrors} field="password" />
          </div>

          <button type="submit" className={styles.submit} disabled={submitting}>
            {submitting ? "Creating account…" : "Create account"}
          </button>
        </form>

        <p className={styles.footer}>
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}

export { RegisterPage };

import { useState } from "react";
import { Link } from "react-router-dom";

import { FieldError, FormError } from "../../components/FieldErrors";
import { useAuth } from "../../app/providers/AuthProvider";
import styles from "./AuthForm.module.css";

/**
 * Sign-in for both roles. There is one login endpoint and one form: an administrator signs in here
 * exactly as a student does, and the role comes back with the session rather than being chosen.
 *
 * On success this component does not navigate. The session appearing is what moves the user on, and
 * RedirectIfSignedIn owns where to — including honouring the page they were originally headed for.
 */
function LoginPage() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(/** @type {import("../../lib/api-error").ApiError | null} */ (null));
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      await signIn({ email, password });
    } catch (caught) {
      setError(caught);
      setSubmitting(false);
    }
  }

  // A 400 names the offending fields; a 401 INVALID_CREDENTIALS does not, deliberately, because the
  // API refuses to say whether the address or the password was wrong. Its single message is shown as
  // a form-level error, which is the only honest place for it.
  const fieldErrors = error?.fieldErrors() ?? {};
  const formMessage = error && error.status !== 400 ? error.message : null;

  return (
    <div className={styles.screen}>
      <div className={styles.card}>
        <h1 className={styles.brand}>SCC Delicious</h1>
        <p className={styles.subtitle}>Sign in to order from the food court.</p>

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
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
            <FieldError errors={fieldErrors} field="password" />
          </div>

          <button type="submit" className={styles.submit} disabled={submitting}>
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className={styles.footer}>
          No account? <Link to="/register">Create one</Link>
        </p>
      </div>
    </div>
  );
}

export { LoginPage };

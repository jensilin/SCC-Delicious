import { useState } from "react";

import { Button } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { FieldError, FormError } from "../../components/FieldErrors";
import { LoadingState } from "../../components/LoadingState";
import { Notice } from "../../components/Notice";
import { PageHeader } from "../../components/PageHeader";
import { useShopDirectory } from "../catalogue/shop-directory";
import { createShop, deleteShop, updateShop } from "./api";
import styles from "./AdminShopListPage.module.css";

/**
 * Where an administrator adds, renames and removes the shops a student browses.
 *
 * It reads the shop directory rather than fetching a list of its own, exactly as the student's shop
 * list does: the directory has already loaded this collection in order to resolve shop names on the
 * order screens, and a second copy would be a second thing to keep current. Reloading it after a
 * write is also what stops those screens showing a name this page has just changed.
 *
 * A name is the whole of what can be edited, because it is the whole of what the model holds. There
 * is no visibility or lifecycle state in the schema, so nothing here can close a stall for the day:
 * deleting it is the only way to take it off a student's list, and the server refuses that for as
 * long as any order still references it.
 */
function AdminShopListPage() {
  const { shops, status, error, reload } = useShopDirectory();

  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(
    /** @type {import("../../lib/api-error").ApiError | null} */ (null),
  );

  const [editingId, setEditingId] = useState(/** @type {string | null} */ (null));
  const [draftName, setDraftName] = useState("");
  const [editError, setEditError] = useState(
    /** @type {import("../../lib/api-error").ApiError | null} */ (null),
  );

  const [confirmingId, setConfirmingId] = useState(/** @type {string | null} */ (null));

  // One shop is acted on at a time, so a single identifier is enough to report which row is working
  // and to leave the others alone.
  const [busyId, setBusyId] = useState(/** @type {string | null} */ (null));

  const [feedback, setFeedback] = useState(
    /** @type {{ tone: "info" | "success" | "warning" | "error", message: string, details?: unknown[] } | null} */ (
      null
    ),
  );

  async function handleCreate(event) {
    event.preventDefault();

    const name = newName.trim();

    // The server trims the name and refuses an empty one. Asking it about a name that is only
    // spaces is a round trip whose answer is already known here.
    if (!name || creating) {
      return;
    }

    setCreating(true);
    setCreateError(null);
    setFeedback(null);

    try {
      const created = await createShop({ name });

      setNewName("");
      setFeedback({ tone: "success", message: `${created.name} has been added.` });
      reload();
    } catch (caught) {
      setCreateError(caught);
    } finally {
      setCreating(false);
    }
  }

  function startEditing(shop) {
    setEditingId(shop.id);
    setDraftName(shop.name);
    setEditError(null);
    setConfirmingId(null);
    setFeedback(null);
  }

  async function handleRename(event, shop) {
    event.preventDefault();

    const name = draftName.trim();

    if (!name || busyId) {
      return;
    }

    // A patch that changes nothing is a validation error, which is a confusing answer to pressing
    // Save without having typed anything. Closing the form is what was actually asked for.
    if (name === shop.name) {
      setEditingId(null);

      return;
    }

    setBusyId(shop.id);
    setEditError(null);
    setFeedback(null);

    try {
      const updated = await updateShop(shop.id, { name });

      setEditingId(null);
      setFeedback({ tone: "success", message: `Renamed to ${updated.name}.` });
      reload();
    } catch (caught) {
      setEditError(caught);
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(shop) {
    setBusyId(shop.id);
    setFeedback(null);

    try {
      await deleteShop(shop.id);

      setConfirmingId(null);
      setFeedback({ tone: "success", message: `${shop.name} has been deleted.` });
      reload();
    } catch (caught) {
      setConfirmingId(null);

      // The refusal this screen exists to explain. Order.shop is onDelete: Restrict, so a shop named
      // by any order stays for as long as that order does. There is nothing an administrator can do
      // about it from here, so it is stated plainly rather than offered as something to retry.
      if (caught.code === "SHOP_HAS_ORDERS") {
        setFeedback({
          tone: "warning",
          message: `${shop.name} cannot be deleted because it has existing orders. An order keeps the shop it was placed with, so this one stays on the list for as long as those orders do.`,
        });
      } else if (caught.status === 404) {
        // Removed by somebody else while this page was open, so the list on screen is out of date.
        setFeedback({ tone: "info", message: `${shop.name} had already been removed.` });
        reload();
      } else {
        setFeedback({ tone: "error", message: caught.message, details: caught.details });
      }
    } finally {
      setBusyId(null);
    }
  }

  // A 400 names the field it is about; anything else belongs to the request as a whole. The same
  // split the sign-in form makes.
  const createFieldErrors = createError?.fieldErrors() ?? {};
  const createFormMessage = createError && createError.status !== 400 ? createError.message : null;
  const editFieldErrors = editError?.fieldErrors() ?? {};
  const editFormMessage = editError && editError.status !== 400 ? editError.message : null;

  return (
    <section>
      <PageHeader
        title="Manage shops"
        subtitle="Add, rename and remove the shops students order from."
      />

      <div className={styles.stack}>
        {feedback ? (
          <Notice tone={feedback.tone} message={feedback.message} details={feedback.details} />
        ) : null}

        <form className={styles.create} onSubmit={handleCreate} noValidate>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="newShopName">
              New shop name
            </label>
            <input
              id="newShopName"
              className={styles.input}
              value={newName}
              autoComplete="off"
              onChange={(event) => setNewName(event.target.value)}
            />
            <FieldError errors={createFieldErrors} field="name" />
          </div>

          <Button
            type="submit"
            variant="primary"
            disabled={newName.trim().length === 0}
            pending={creating}
            pendingLabel="Adding…"
          >
            Add shop
          </Button>

          {createFormMessage ? (
            <div className={styles.formError}>
              <FormError message={createFormMessage} />
            </div>
          ) : null}
        </form>

        {/* The list stays on screen while the directory reloads after a write, so only a first load
            with nothing to show puts a panel here. */}
        {status === "loading" && shops.length === 0 ? <LoadingState label="Loading shops" /> : null}

        {status === "failed" ? (
          <ErrorState error={error} title="Could not load shops" onRetry={reload} />
        ) : null}

        {status === "ready" && shops.length === 0 ? (
          <EmptyState
            title="No shops yet"
            message="Add the first one above, and students will see it straight away."
          />
        ) : null}

        {shops.length > 0 ? (
          <ul className={styles.list}>
            {shops.map((shop) => (
              <li key={shop.id} className={styles.row}>
                {editingId === shop.id ? (
                  <form
                    className={styles.editForm}
                    onSubmit={(event) => handleRename(event, shop)}
                    noValidate
                  >
                    <div className={styles.field}>
                      <label className={styles.label} htmlFor={`shopName-${shop.id}`}>
                        Shop name
                      </label>
                      <input
                        id={`shopName-${shop.id}`}
                        className={styles.input}
                        value={draftName}
                        autoComplete="off"
                        onChange={(event) => setDraftName(event.target.value)}
                      />
                      <FieldError errors={editFieldErrors} field="name" />
                    </div>

                    <div className={styles.actions}>
                      <Button
                        type="submit"
                        variant="primary"
                        small
                        disabled={draftName.trim().length === 0}
                        pending={busyId === shop.id}
                        pendingLabel="Saving…"
                      >
                        Save
                      </Button>
                      <Button
                        variant="quiet"
                        small
                        disabled={busyId === shop.id}
                        onClick={() => setEditingId(null)}
                      >
                        Cancel
                      </Button>
                    </div>

                    {editFormMessage ? (
                      <div className={styles.formError}>
                        <FormError message={editFormMessage} />
                      </div>
                    ) : null}
                  </form>
                ) : confirmingId === shop.id ? (
                  <>
                    {/* Deleting takes the shop's whole menu with it and cannot be undone, which is
                        worth one question before it happens. */}
                    <span className={styles.confirm}>
                      Delete {shop.name} and everything on its menu?
                    </span>

                    <div className={styles.actions}>
                      <Button
                        variant="danger"
                        small
                        pending={busyId === shop.id}
                        pendingLabel="Deleting…"
                        onClick={() => handleDelete(shop)}
                      >
                        Delete
                      </Button>
                      <Button
                        variant="quiet"
                        small
                        disabled={busyId === shop.id}
                        onClick={() => setConfirmingId(null)}
                      >
                        Keep
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <span className={styles.name}>{shop.name}</span>

                    <div className={styles.actions}>
                      <Button small disabled={busyId !== null} onClick={() => startEditing(shop)}>
                        Rename
                      </Button>
                      <Button
                        variant="danger"
                        small
                        disabled={busyId !== null}
                        onClick={() => {
                          setConfirmingId(shop.id);
                          setFeedback(null);
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

export { AdminShopListPage };

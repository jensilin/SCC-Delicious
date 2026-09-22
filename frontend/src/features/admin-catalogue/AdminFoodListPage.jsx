import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import { Button } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { FieldError, FormError } from "../../components/FieldErrors";
import { LoadingState } from "../../components/LoadingState";
import { Notice } from "../../components/Notice";
import { PageHeader } from "../../components/PageHeader";
import { formatMinor, parseMinor } from "../../lib/money";
import { listShopFoods } from "../catalogue/api";
import { useShopDirectory } from "../catalogue/shop-directory";
import { adjustFoodStock, createFood, deleteFood, updateFood } from "./api";
import styles from "./AdminFoodListPage.module.css";

/**
 * A whole, non-negative count, which is what both an initial stock quantity and a stock adjustment
 * are. Null for anything else, so a form can refuse what the server would only refuse later.
 *
 * @param {string} text
 * @returns {number | null}
 */
function parseCount(text) {
  return /^\d+$/.test(text.trim()) ? Number(text.trim()) : null;
}

/**
 * One shop's menu, as an administrator maintains it.
 *
 * Foods are read and written beneath their shop, exactly as the API addresses them, which is why
 * this screen exists per shop rather than as one list of every food. It reads them for itself rather
 * than through a provider: unlike the shop directory, nothing else in the application holds a menu,
 * so there is no shared copy to keep current and none for a student to read stale — a student's menu
 * is fetched when they open it.
 *
 * Name and price are the only fields that can be edited, because they are the only ones the model
 * holds besides stock, and stock is deliberately not editable here: it moves by signed delta through
 * its own endpoint, so that the database can decide whether a decrease is possible.
 */
function AdminFoodListPage() {
  const { shopId } = useParams();
  const { shopName } = useShopDirectory();

  const [foods, setFoods] = useState(/** @type {import("../catalogue/api").Food[]} */ ([]));
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState(
    /** @type {import("../../lib/api-error").ApiError | null} */ (null),
  );

  const [newName, setNewName] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [newStock, setNewStock] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(
    /** @type {import("../../lib/api-error").ApiError | null} */ (null),
  );

  const [editingId, setEditingId] = useState(/** @type {string | null} */ (null));
  const [draftName, setDraftName] = useState("");
  const [draftPrice, setDraftPrice] = useState("");
  const [editError, setEditError] = useState(
    /** @type {import("../../lib/api-error").ApiError | null} */ (null),
  );

  const [confirmingId, setConfirmingId] = useState(/** @type {string | null} */ (null));

  // How much the next adjustment moves, per food, because two items are restocked by different
  // amounts and a single shared box would carry one row's number into another's.
  const [amounts, setAmounts] = useState(/** @type {Record<string, string>} */ ({}));

  // Which row is working, and at what. The action is part of it so that only the button that was
  // pressed reports that it is in flight.
  const [busy, setBusy] = useState(
    /** @type {{ id: string, action: "save" | "add" | "remove" | "delete" } | null} */ (null),
  );

  const [feedback, setFeedback] = useState(
    /** @type {{ tone: "info" | "success" | "warning" | "error", message: string, details?: unknown[] } | null} */ (
      null
    ),
  );

  /**
   * A background read keeps what is on screen if it fails and never shows the loading panel, which
   * is what lets every write end with one: the list is re-read rather than patched, so it stays in
   * the order the server returns it in after a rename.
   */
  const load = useCallback(
    async (background = false) => {
      if (!background) {
        setStatus("loading");
        setError(null);
      }

      try {
        setFoods(await listShopFoods(shopId));
        setStatus("ready");
      } catch (caught) {
        if (!background) {
          setError(caught);
          setStatus("failed");
        }
      }
    },
    [shopId],
  );

  useEffect(() => {
    load();
  }, [load]);

  const amountFor = (foodId) => amounts[foodId] ?? "1";
  const busyOn = (foodId, action) => busy?.id === foodId && busy.action === action;
  const anyBusy = busy !== null;

  async function handleCreate(event) {
    event.preventDefault();

    const name = newName.trim();
    const priceMinor = parseMinor(newPrice);
    const stockQuantity = parseCount(newStock);

    if (!name || priceMinor === null || stockQuantity === null || creating) {
      return;
    }

    setCreating(true);
    setCreateError(null);
    setFeedback(null);

    try {
      const created = await createFood(shopId, { name, priceMinor, stockQuantity });

      setNewName("");
      setNewPrice("");
      setNewStock("");
      setFeedback({
        tone: "success",
        message: `${created.name} has been added at ${formatMinor(created.priceMinor)}.`,
      });
      await load(true);
    } catch (caught) {
      setCreateError(caught);
    } finally {
      setCreating(false);
    }
  }

  function startEditing(food) {
    setEditingId(food.id);
    setDraftName(food.name);
    setDraftPrice(formatMinor(food.priceMinor));
    setEditError(null);
    setConfirmingId(null);
    setFeedback(null);
  }

  async function handleEdit(event, food) {
    event.preventDefault();

    const name = draftName.trim();
    const priceMinor = parseMinor(draftPrice);

    if (!name || priceMinor === null || anyBusy) {
      return;
    }

    // Only what changed is sent. The endpoint requires at least one field and refuses a patch that
    // describes no change, so an untouched form closes instead of asking for one.
    const changes = {
      ...(name === food.name ? {} : { name }),
      ...(priceMinor === food.priceMinor ? {} : { priceMinor }),
    };

    if (Object.keys(changes).length === 0) {
      setEditingId(null);

      return;
    }

    setBusy({ id: food.id, action: "save" });
    setEditError(null);
    setFeedback(null);

    try {
      const updated = await updateFood(shopId, food.id, changes);

      setEditingId(null);
      setFeedback({
        tone: "success",
        message: `${updated.name} is now ${formatMinor(updated.priceMinor)}.`,
      });
      await load(true);
    } catch (caught) {
      setEditError(caught);

      if (caught.status === 404) {
        await load(true);
      }
    } finally {
      setBusy(null);
    }
  }

  /**
   * @param {import("../catalogue/api").Food} food
   * @param {1 | -1} direction
   */
  async function adjustStock(food, direction) {
    const amount = parseCount(amountFor(food.id));

    // Zero is a validation error server-side, and an amount the box cannot be read as is not a
    // request worth sending at all.
    if (amount === null || amount === 0 || anyBusy) {
      return;
    }

    setBusy({ id: food.id, action: direction === 1 ? "add" : "remove" });
    setFeedback(null);

    try {
      const updated = await adjustFoodStock(shopId, food.id, direction * amount);

      setFeedback({
        tone: "success",
        message: `${updated.name} now has ${updated.stockQuantity} in stock.`,
      });
      await load(true);
    } catch (caught) {
      // The database refused the arithmetic rather than the request: the decrease would have taken
      // the quantity below zero. It carries no details, and deliberately does not say how short it
      // was, so the figure quoted here is re-read rather than calculated.
      if (caught.code === "INSUFFICIENT_STOCK") {
        setFeedback({
          tone: "warning",
          message: `Removing ${amount} would leave ${food.name} below zero, so nothing was changed.`,
        });
        await load(true);
      } else if (caught.status === 404) {
        setFeedback({ tone: "info", message: `${food.name} is no longer on this menu.` });
        await load(true);
      } else {
        setFeedback({ tone: "error", message: caught.message, details: caught.details });
      }
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete(food) {
    setBusy({ id: food.id, action: "delete" });
    setFeedback(null);

    try {
      await deleteFood(shopId, food.id);

      setConfirmingId(null);
      setFeedback({ tone: "success", message: `${food.name} has been removed from the menu.` });
      await load(true);
    } catch (caught) {
      setConfirmingId(null);

      if (caught.status === 404) {
        setFeedback({ tone: "info", message: `${food.name} had already been removed.` });
        await load(true);
      } else {
        setFeedback({ tone: "error", message: caught.message, details: caught.details });
      }
    } finally {
      setBusy(null);
    }
  }

  // A 400 names the field it is about; anything else belongs to the request as a whole.
  const createFieldErrors = createError?.fieldErrors() ?? {};
  const createFormMessage = createError && createError.status !== 400 ? createError.message : null;
  const editFieldErrors = editError?.fieldErrors() ?? {};
  const editFormMessage = editError && editError.status !== 400 ? editError.message : null;

  const name = shopName(shopId);
  const canCreate =
    newName.trim().length > 0 && parseMinor(newPrice) !== null && parseCount(newStock) !== null;

  if (status === "loading") {
    return (
      <section>
        <PageHeader title={name ?? "Menu"} backTo="/admin/shops" backLabel="Manage shops" />
        <LoadingState label="Loading this menu" />
      </section>
    );
  }

  if (status === "failed") {
    return (
      <section>
        <PageHeader title={name ?? "Menu"} backTo="/admin/shops" backLabel="Manage shops" />
        <ErrorState
          error={error}
          title={error?.status === 404 ? "Shop not found" : "Could not load this menu"}
          onRetry={load}
        />
      </section>
    );
  }

  return (
    <section>
      <PageHeader
        title={name ?? "Menu"}
        subtitle="Add food, change a price, move stock, or take something off the menu."
        backTo="/admin/shops"
        backLabel="Manage shops"
      />

      <div className={styles.stack}>
        {feedback ? (
          <Notice tone={feedback.tone} message={feedback.message} details={feedback.details} />
        ) : null}

        <form className={styles.create} onSubmit={handleCreate} noValidate>
          <div className={styles.wide}>
            <label className={styles.label} htmlFor="newFoodName">
              New item
            </label>
            <input
              id="newFoodName"
              className={styles.input}
              value={newName}
              autoComplete="off"
              onChange={(event) => setNewName(event.target.value)}
            />
            <FieldError errors={createFieldErrors} field="name" />
          </div>

          <div className={styles.narrow}>
            <label className={styles.label} htmlFor="newFoodPrice">
              Price
            </label>
            <input
              id="newFoodPrice"
              className={styles.input}
              value={newPrice}
              inputMode="decimal"
              autoComplete="off"
              placeholder="25.00"
              onChange={(event) => setNewPrice(event.target.value)}
            />
            <FieldError errors={createFieldErrors} field="priceMinor" />
          </div>

          <div className={styles.narrow}>
            <label className={styles.label} htmlFor="newFoodStock">
              Stock
            </label>
            <input
              id="newFoodStock"
              className={styles.input}
              value={newStock}
              inputMode="numeric"
              autoComplete="off"
              placeholder="0"
              onChange={(event) => setNewStock(event.target.value)}
            />
            <FieldError errors={createFieldErrors} field="stockQuantity" />
          </div>

          <Button
            type="submit"
            variant="primary"
            disabled={!canCreate}
            pending={creating}
            pendingLabel="Adding…"
          >
            Add food
          </Button>

          {/* No currency is named, here or anywhere else in the application, because the API names
              none either. Two places is the whole of the rule. */}
          <p className={styles.hint}>
            A price takes at most two decimal places — 25 or 25.50. Stock is set here and then moves
            by the adjustments below.
          </p>

          {createFormMessage ? (
            <div className={styles.formError}>
              <FormError message={createFormMessage} />
            </div>
          ) : null}
        </form>

        {foods.length === 0 ? (
          <EmptyState
            title="Nothing on the menu"
            message="Add the first item above. Students will see it the next time they open this shop."
          />
        ) : (
          <ul className={styles.list}>
            {foods.map((food) => (
              <li key={food.id} className={styles.row}>
                {editingId === food.id ? (
                  <form
                    className={styles.editForm}
                    onSubmit={(event) => handleEdit(event, food)}
                    noValidate
                  >
                    <div className={styles.wide}>
                      <label className={styles.label} htmlFor={`foodName-${food.id}`}>
                        Name
                      </label>
                      <input
                        id={`foodName-${food.id}`}
                        className={styles.input}
                        value={draftName}
                        autoComplete="off"
                        onChange={(event) => setDraftName(event.target.value)}
                      />
                      <FieldError errors={editFieldErrors} field="name" />
                    </div>

                    <div className={styles.narrow}>
                      <label className={styles.label} htmlFor={`foodPrice-${food.id}`}>
                        Price
                      </label>
                      <input
                        id={`foodPrice-${food.id}`}
                        className={styles.input}
                        value={draftPrice}
                        inputMode="decimal"
                        autoComplete="off"
                        onChange={(event) => setDraftPrice(event.target.value)}
                      />
                      <FieldError errors={editFieldErrors} field="priceMinor" />
                    </div>

                    <div className={styles.actions}>
                      <Button
                        type="submit"
                        variant="primary"
                        small
                        disabled={draftName.trim().length === 0 || parseMinor(draftPrice) === null}
                        pending={busyOn(food.id, "save")}
                        pendingLabel="Saving…"
                      >
                        Save
                      </Button>
                      <Button
                        variant="quiet"
                        small
                        disabled={anyBusy}
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
                ) : confirmingId === food.id ? (
                  <>
                    {/* What deletion leaves behind is worth saying: past orders keep their own copy
                        of the name and the price, so only carts and this menu lose the item. */}
                    <span className={styles.confirm}>
                      Remove {food.name} from the menu? Past orders keep their record of it.
                    </span>

                    <div className={styles.actions}>
                      <Button
                        variant="danger"
                        small
                        pending={busyOn(food.id, "delete")}
                        pendingLabel="Removing…"
                        onClick={() => handleDelete(food)}
                      >
                        Remove
                      </Button>
                      <Button
                        variant="quiet"
                        small
                        disabled={anyBusy}
                        onClick={() => setConfirmingId(null)}
                      >
                        Keep
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <span className={styles.name}>{food.name}</span>
                    <span className={styles.price}>{formatMinor(food.priceMinor)}</span>

                    <div className={styles.actions}>
                      <Button small disabled={anyBusy} onClick={() => startEditing(food)}>
                        Edit
                      </Button>
                      <Button
                        variant="danger"
                        small
                        disabled={anyBusy}
                        onClick={() => {
                          setConfirmingId(food.id);
                          setFeedback(null);
                        }}
                      >
                        Delete
                      </Button>
                    </div>

                    <div className={styles.stockBar}>
                      {/* The same words the student's menu uses for the same figure. */}
                      <span
                        className={food.stockQuantity === 0 ? styles.noStock : styles.stock}
                      >
                        {food.stockQuantity === 0
                          ? "Out of stock"
                          : `${food.stockQuantity} in stock`}
                      </span>

                      <div className={styles.stockControls}>
                        <label className={styles.stockLabel} htmlFor={`amount-${food.id}`}>
                          Adjust by
                        </label>
                        <input
                          id={`amount-${food.id}`}
                          className={styles.amount}
                          value={amountFor(food.id)}
                          inputMode="numeric"
                          autoComplete="off"
                          onChange={(event) =>
                            setAmounts((current) => ({
                              ...current,
                              [food.id]: event.target.value,
                            }))
                          }
                        />
                        <Button
                          small
                          disabled={anyBusy || !parseCount(amountFor(food.id))}
                          pending={busyOn(food.id, "add")}
                          pendingLabel="Adding…"
                          onClick={() => adjustStock(food, 1)}
                        >
                          Add
                        </Button>
                        <Button
                          small
                          disabled={anyBusy || !parseCount(amountFor(food.id))}
                          pending={busyOn(food.id, "remove")}
                          pendingLabel="Removing…"
                          onClick={() => adjustStock(food, -1)}
                        >
                          Remove
                        </Button>
                      </div>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export { AdminFoodListPage };

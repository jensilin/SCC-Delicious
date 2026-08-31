const { prisma } = require("../config/prisma");
const { httpError } = require("../lib/http-error");
const { findCartForUser } = require("./cart.service");
const { recordPayment } = require("./payment.service");
const { applyStockDelta } = require("./shop.service");

const UNIQUE_VIOLATION = "P2002";
const CART_EMPTY = "CART_EMPTY";

// Generous rather than default. Ten simultaneous checkouts for one food queue on that food's row,
// each holding its connection while it waits, and the defaults — two seconds to be admitted and five
// to finish — turn ordinary contention into a failure that reads like a checkout bug.
//
// A cancellation queues on the same rows, for the same reason, so it runs under the same allowance.
const TRANSACTION_OPTIONS = { maxWait: 20_000, timeout: 20_000 };

// Selected explicitly, and only from columns that never change once the order is written. That is
// what lets a replayed request return a body identical to the original without the original response
// having been stored anywhere.
//
// The food is deliberately not joined. The snapshots are what a past order says was bought, so a
// rename or a reprice afterwards must not reach this response, and a deleted food leaves foodId null
// with its name and price intact.
const orderSelect = {
  id: true,
  shopId: true,
  status: true,
  totalMinor: true,
  placedAt: true,
  items: {
    select: {
      foodId: true,
      foodNameSnapshot: true,
      unitPriceMinorSnapshot: true,
      quantity: true,
      lineTotalMinor: true,
    },
    // Ordered by the name the order recorded, matching how the cart orders its lines, so the list
    // the buyer confirmed and the list the order reports read the same way.
    orderBy: { foodNameSnapshot: "asc" },
  },
};

// What an administrator sees: the same order, plus who bought it. Handing an order over requires
// knowing whose it is, and a queue of opaque user ids cannot be worked from.
//
// The email is the only thing joined from the user. This is the one place in v1 where one user's
// address is exposed to another, so it is a named column rather than the whole row.
const adminOrderSelect = {
  ...orderSelect,
  user: { select: { email: true } },
};

// Newest first, so the list opens on what a shop or a buyer is most likely to be looking for.
// Explicit because without an order PostgreSQL may return rows in any sequence, which would make
// both the interface and its tests unpredictable.
const newestFirst = { placedAt: "desc" };

function cartEmpty() {
  return httpError(409, CART_EMPTY, "There is nothing in your cart to order");
}

function cartModified() {
  return httpError(
    409,
    "CART_MODIFIED",
    "Your cart changed while the order was being placed; check it and try again",
  );
}

function idempotencyKeyConflict() {
  return httpError(409, "IDEMPOTENCY_KEY_CONFLICT", "That idempotency key is already in use");
}

function foodNotFound() {
  return httpError(404, "NOT_FOUND", "Food not found");
}

function orderNotFound() {
  return httpError(404, "NOT_FOUND", "Order not found");
}

// One code for both refusals, because a client's next move is the same either way: read the order
// and show what it actually says. An illegal move and a move another actor made first are not
// reliably distinguishable anyway — between the attempt and any explanatory read the order can move
// again — so the message names the order's status as the reason without claiming which case it was.
function orderStatusConflict() {
  return httpError(
    409,
    "ORDER_STATUS_CONFLICT",
    "This order is not in a status that permits that change",
  );
}

// The detail names the food rather than a request field, because what the client has to act on is a
// line of the cart and not something it sent. It carries no quantity: how short the shop is of a food
// is the shop's business, and the caller only needs to know which line cannot be supplied.
function insufficientStock({ foodId, name }) {
  return httpError(409, "INSUFFICIENT_STOCK", "There is not enough stock to place this order", [
    { foodId, name, message: "Insufficient stock" },
  ]);
}

// The order item columns are named for what they are in the database — snapshots — while the response
// names them for what they mean to a client. `priceMinor` is the same key a cart line uses for the
// same figure, so one component can render either.
function toOrderView(order) {
  return {
    id: order.id,
    shopId: order.shopId,
    status: order.status,
    totalMinor: order.totalMinor,
    placedAt: order.placedAt,
    items: order.items.map((item) => ({
      foodId: item.foodId,
      name: item.foodNameSnapshot,
      priceMinor: item.unitPriceMinorSnapshot,
      quantity: item.quantity,
      lineTotalMinor: item.lineTotalMinor,
    })),
  };
}

// The buyer's address, and nothing else about them: no user id, because an administrator has no use
// for one and checkout deliberately publishes no ownership fields.
function toAdminOrderView(order) {
  return { ...toOrderView(order), buyerEmail: order.user.email };
}

// The lock ordering every stock movement in this module follows, whether a checkout is consuming
// stock or a cancellation is returning it. Two transactions holding the same foods then acquire
// those row locks in one sequence; in opposite sequences each can end up holding what the other
// needs next, which PostgreSQL resolves by killing one of them.
//
// One comparator rather than one per call site, so the two sequences cannot drift apart.
function byAscendingFoodId(left, right) {
  return left.foodId.localeCompare(right.foodId);
}

// Scoped to the caller, always. orders.idempotency_key is unique across the whole table rather than
// per user, so a lookup on the key alone would load a row that may belong to someone else — and once
// that row is in hand, any later change to the code around it can return it. Ownership is a property
// of this query instead, so another user's order is never read at all.
function findOwnOrderByKey(client, userId, idempotencyKey) {
  return client.order.findFirst({ where: { idempotencyKey, userId }, select: orderSelect });
}

// True only for the order's own idempotency key. No other unique index checkout writes to can
// collide — a payment's order id is an order created moments earlier — but matching the constraint
// rather than the error code alone means an unexpected violation is reported as the fault it is
// instead of being mistaken for a duplicate submission.
//
// Prisma 7 passes the database's error through the driver adapter, which names the violated index
// rather than listing the columns as meta.target did before it. That name is the schema's own
// `orders_idempotency_key_key`, so the test covering a cross-user conflict is what would catch this
// shape changing under an upgrade.
function isIdempotencyKeyViolation(error) {
  if (error?.code !== UNIQUE_VIOLATION) {
    return false;
  }

  const constraint = error.meta?.driverAdapterError?.cause?.constraint?.index;

  return typeof constraint === "string" && constraint.includes("idempotency");
}

// Both of these mean "another request may have got there first", and both are answered the same way:
// the transaction is already gone, so ask — scoped to the caller — whether this key now identifies an
// order.
//
// The duplicate key is the obvious one. An empty cart is the other, and it is not obvious: a second
// request for the same key waits on the cart row lock, and by the time it is granted the first request
// has committed and taken the cart's lines with it. Reading that as "nothing to order" would answer a
// duplicate submission with a failure.
function mayHaveBeenSettledElsewhere(error) {
  return isIdempotencyKeyViolation(error) || error?.code === CART_EMPTY;
}

// Takes the cart row's write lock before a single line is read from it. Adding an item, removing one,
// and clearing the cart all write this row, so each of them waits here until checkout commits or
// rolls back, and the lines read below cannot change underneath the order being built from them.
//
// The update carries no meaningful change — taking the lock is the whole point — and a checkout that
// fails rolls it back along with everything else, so a request that does not go on to place an order
// leaves nothing behind. A caller who has never added anything has no cart row at all, which is
// reported as null and answered the same way as an empty one.
async function lockCart(tx, userId) {
  const locked = await tx.cart.updateMany({ where: { userId }, data: { updatedAt: new Date() } });

  return locked.count === 0 ? null : findCartForUser(tx, userId);
}

// Every write is on `tx`, so the whole of checkout is one transaction: an order, its items, its
// payment, the stock movements, and the emptied cart either all commit or none of them exist. A
// partial checkout — stock consumed with no order, or an order with no stock movement — is the worst
// outcome available here and is hard to detect afterwards.
async function runCheckout(tx, userId, idempotencyKey) {
  // First, and before anything is written: a key this caller has already used identifies the order it
  // created, and the answer is that order rather than a second one.
  const replayed = await findOwnOrderByKey(tx, userId, idempotencyKey);

  if (replayed) {
    return { order: replayed, created: false };
  }

  const cart = await lockCart(tx, userId);

  // Nothing to order — or nothing left to order, because waiting for that lock can mean waiting for
  // this caller's own earlier request with this key, which committed and took the lines with it. The
  // two are separated after the rollback, in placeOrder, so that a duplicate submission is not
  // answered as a failure.
  if (!cart || cart.items.length === 0) {
    throw cartEmpty();
  }

  // Prices come from the food rows read under the lock, never from the request, and the line totals
  // and order total are computed here rather than taken from anything a client sent. What the order
  // records is what the food cost at this moment, which is what makes the row a snapshot.
  const items = cart.items.map((item) => ({
    foodId: item.foodId,
    foodNameSnapshot: item.food.name,
    unitPriceMinorSnapshot: item.food.priceMinor,
    quantity: item.quantity,
    lineTotalMinor: item.food.priceMinor * item.quantity,
  }));

  const totalMinor = items.reduce((total, item) => total + item.lineTotalMinor, 0);

  // The order is written before any stock moves. Nothing is visible outside the transaction until it
  // commits, so the ordering costs nothing — and it means a duplicate idempotency key is refused by
  // the unique index before a single food row has been locked.
  //
  // The items are created with the order rather than afterwards, so there is no moment, even inside
  // the transaction, at which the order exists without them.
  const order = await tx.order.create({
    data: {
      userId,
      shopId: cart.shopId,
      status: "PLACED",
      totalMinor,
      idempotencyKey,
      items: { create: items },
    },
    select: orderSelect,
  });

  // Ascending food id, so two checkouts holding two of the same foods acquire those row locks in the
  // same sequence — and so does a cancellation returning stock for the same foods.
  const consumption = [...items].sort(byAscendingFoodId);

  for (const item of consumption) {
    // The one implementation of a stock movement, called with a negative delta. The quantity is never
    // read into JavaScript and compared here: the database matches the row only when the result would
    // not be negative, which is what stops two checkouts both selling the same last unit.
    const changed = await applyStockDelta(tx, { id: item.foodId }, -item.quantity);

    if (changed.count === 0) {
      // Nothing moved for one of two reasons and only a second look says which, exactly as the stock
      // endpoint distinguishes them: the food is still there and short, or it has been deleted since
      // the cart was read.
      const food = await tx.food.findUnique({ where: { id: item.foodId }, select: { id: true } });

      throw food
        ? insufficientStock({ foodId: item.foodId, name: item.foodNameSnapshot })
        : foodNotFound();
    }
  }

  await recordPayment(tx, { orderId: order.id, amountMinor: totalMinor });

  // Conditional on the quantities read under the lock, so a line is removed only if it still holds
  // exactly what was written into an order item. Changing a line's quantity is the one cart operation
  // that does not write the cart row and is therefore not waiting on the lock above; this is what
  // catches it, and it is what guarantees no cart line can disappear without having been ordered.
  const removed = await tx.cartItem.deleteMany({
    where: {
      cartId: cart.id,
      OR: items.map((item) => ({ foodId: item.foodId, quantity: item.quantity })),
    },
  });

  if (removed.count !== items.length) {
    throw cartModified();
  }

  // The lock has been held since before the lines were read, so nothing can have been added in the
  // meantime: the cart is empty now, and its shop reference is released so the next addition may come
  // from anywhere. This is the last write before the commit — the cart empties only once everything
  // else has succeeded.
  await tx.cart.update({ where: { id: cart.id }, data: { shopId: null } });

  return { order, created: true };
}

async function placeOrder(userId, idempotencyKey) {
  try {
    const { order, created } = await prisma.$transaction(
      (tx) => runCheckout(tx, userId, idempotencyKey),
      TRANSACTION_OPTIONS,
    );

    return { order: toOrderView(order), created };
  } catch (error) {
    if (!mayHaveBeenSettledElsewhere(error)) {
      throw error;
    }

    // Two requests raced for one key and this is the one that lost. Its transaction is gone and
    // everything it had written with it, including its stock deductions, so nothing has to be undone
    // here. The question has to be asked outside that transaction rather than inside it: a failed
    // statement aborts a PostgreSQL transaction and no statement after it can run.
    //
    // Scoped, as every idempotency lookup is. This caller's own order means the duplicate was theirs
    // and they get the order it created.
    const existing = await findOwnOrderByKey(prisma, userId, idempotencyKey);

    if (existing) {
      return { order: toOrderView(existing), created: false };
    }

    // No order of the caller's carries this key, so the two possibilities separate. A duplicate key
    // that is not theirs belongs to someone else, and saying so is all the response reveals about it.
    // An empty cart was simply an empty cart.
    if (isIdempotencyKeyViolation(error)) {
      throw idempotencyKeyConflict();
    }

    throw error;
  }
}

// --- Reading an order ----------------------------------------------------------------------------
//
// A student's reads are scoped to the caller and an administrator's are not, which is the only
// difference between the two pairs below. The scope is part of every query rather than a comparison
// made afterwards, so an order belonging to someone else is never loaded at all — and because it is
// never found, it is reported missing rather than forbidden. Answering "forbidden" would confirm
// that the order exists.

async function listOwnOrders(userId) {
  const orders = await prisma.order.findMany({
    where: { userId },
    select: orderSelect,
    orderBy: newestFirst,
  });

  return orders.map(toOrderView);
}

// findFirst rather than findUnique, because the id alone is not the whole key here: the caller's id
// is the rest of it, and a query that can only be satisfied by both cannot be made to leak by a
// later edit that forgets a comparison.
async function getOwnOrder(userId, orderId) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, userId },
    select: orderSelect,
  });

  if (!order) {
    throw orderNotFound();
  }

  return toOrderView(order);
}

async function listAllOrders() {
  const orders = await prisma.order.findMany({ select: adminOrderSelect, orderBy: newestFirst });

  return orders.map(toAdminOrderView);
}

async function getAnyOrder(orderId) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: adminOrderSelect,
  });

  if (!order) {
    throw orderNotFound();
  }

  return toAdminOrderView(order);
}

// --- Moving an order -----------------------------------------------------------------------------

// The settled transition table, read as "the status a role may ask for, and the statuses an order
// must already be in for that move to be legal".
//
// That direction is what makes the conditional update possible: the permitted predecessors go into
// the WHERE clause, so the database decides whether the move is legal at the moment it applies it,
// rather than this service deciding from a status it read a moment earlier.
//
// Three properties are the table's shape rather than rules written beside it. COMPLETED and
// CANCELLED appear only as targets and never as predecessors, which is the whole of what makes them
// terminal. Each advancement lists exactly one predecessor, so no status can be skipped. And a
// STUDENT has one row, so a student may cancel and may do nothing else.
const TRANSITIONS = {
  STUDENT: {
    CANCELLED: ["PLACED"],
  },
  ADMIN: {
    PREPARING: ["PLACED"],
    READY: ["PREPARING"],
    COMPLETED: ["READY"],
    CANCELLED: ["PLACED", "PREPARING", "READY"],
  },
};

const CANCELLED = "CANCELLED";

// Returns to the shelf exactly what the order took.
//
// The status has already been changed by the conditional update this is called from, and that update
// holds the order row's write lock for the rest of the transaction. A second cancellation is
// therefore waiting on that lock, and when it is granted the order is already CANCELLED and no
// predecessor matches — so stock is returned once per order however many callers ask for it.
async function restoreStock(tx, orderId) {
  const items = await tx.orderItem.findMany({
    where: { orderId },
    select: { foodId: true, quantity: true },
  });

  // A null reference means the food was deleted after the order was placed. There is no inventory
  // left to correct, so the line is skipped and the cancellation goes on: refusing would trap the
  // order in a status it could never leave, and would let deleting a food break a cancellation
  // months later. The line itself keeps its snapshots either way.
  const restorable = items.filter((item) => item.foodId !== null).sort(byAscendingFoodId);

  for (const item of restorable) {
    // The one implementation of a stock movement, called with a positive delta. Its affected-row
    // count is not inspected here, and that is deliberate: the condition it carries is
    // `quantity >= -delta`, which a positive delta makes true of every non-negative quantity, so a
    // restore is never refused. Zero rows would mean the food has been deleted since the lines above
    // were read — the null case arriving a moment later, skipped for the same reason.
    await applyStockDelta(tx, { id: item.foodId }, item.quantity);
  }
}

// One conditional update, whichever move was asked for.
//
// `scope` carries the order id and, for a student, the caller's id, so a student's transition is
// bounded by ownership in the same statement that bounds it by status. Nothing is read and compared
// first: a status read into JavaScript and written back is the same race as a stock quantity read
// and written back, and a cancellation applied twice would return the stock twice.
async function runStatusChange(tx, { scope, status, predecessors, select }) {
  const changed = await tx.order.updateMany({
    where: { ...scope, status: { in: predecessors } },
    data: { status },
  });

  if (changed.count === 0) {
    // Nothing moved for one of two reasons and only a second look says which, exactly as a refused
    // stock movement is separated from a missing food: the order is out of this caller's reach, or it
    // is in reach and is not in a status this move may start from.
    const reachable = await tx.order.findFirst({ where: scope, select: { id: true } });

    throw reachable ? orderStatusConflict() : orderNotFound();
  }

  if (status === CANCELLED) {
    await restoreStock(tx, scope.id);
  }

  // Read back inside the transaction, so the body describes the order as this change left it. The
  // row's write lock is held until the commit, so no other transition can land between the two.
  return tx.order.findFirst({ where: scope, select });
}

// A target this role never has — a student asking for anything but a cancellation, or anyone asking
// for PLACED — has no permitted predecessors. It needs no special case: an empty set matches no row,
// so the same conditional update refuses it and the same second look decides whether the answer is
// a conflict or a missing order.
function applyStatusChange({ scope, role, status, select }) {
  const predecessors = TRANSITIONS[role]?.[status] ?? [];

  return prisma.$transaction(
    (tx) => runStatusChange(tx, { scope, status, predecessors, select }),
    TRANSACTION_OPTIONS,
  );
}

async function cancelOwnOrder(userId, orderId) {
  const order = await applyStatusChange({
    scope: { id: orderId, userId },
    role: "STUDENT",
    status: CANCELLED,
    select: orderSelect,
  });

  return toOrderView(order);
}

// An administrative cancellation is a transition like any other: the table decides whether the move
// is legal, and a cancellation is the one target that also returns stock.
async function setOrderStatus(orderId, status) {
  const order = await applyStatusChange({
    scope: { id: orderId },
    role: "ADMIN",
    status,
    select: adminOrderSelect,
  });

  return toAdminOrderView(order);
}

module.exports = {
  cancelOwnOrder,
  getAnyOrder,
  getOwnOrder,
  listAllOrders,
  listOwnOrders,
  placeOrder,
  setOrderStatus,
};

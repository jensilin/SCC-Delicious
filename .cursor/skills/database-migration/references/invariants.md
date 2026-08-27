# SCC Delicious data invariants

Where each invariant is enforced, and what counts as verifying it. A schema change must leave
every row of this table true.

## Money is integer minor units

**Enforced by:** integer column types in the schema. There is no float or decimal money column.

**Why:** binary floating point cannot represent common decimal fractions exactly, so repeated
arithmetic drifts and totals stop reconciling with their line items.

**Verify:** the migration produces integer columns, and a total computed by the service equals
the sum of its line items exactly.

**Watch for:** a new money field added as `Float` or `Decimal`; a calculation that divides and
reintroduces a fraction.

## Inventory can never be negative

**Enforced by:** a database `CHECK (stock_quantity >= 0)` constraint. Prisma schema cannot
express this, so it is raw SQL in the migration, added with `migrate dev --create-only`.

**Why:** it is the last line of defence that holds regardless of what application code does now
or later.

**Verify:** attempt a write that would drive stock below zero and confirm the database rejects
it. A constraint present in a migration file but never exercised is unverified.

## Inventory updates are concurrency-safe

**Enforced by:** application code — a single conditional update statement that decrements only
when sufficient stock exists, with zero affected rows treated as out of stock. Correct at
PostgreSQL's default read-committed isolation, so no retry loop is needed.

**Never:** read the quantity, compare it in JavaScript, then write it back. Two concurrent
checkouts for the last unit both pass that check and both succeed.

**Verify:** a test that issues concurrent checkouts against the last remaining unit and asserts
exactly one succeeds. This test is mandatory and must not be skipped.

**Watch for:** a refactor that "simplifies" the conditional update into a read and a write.

## Multi-write checkout is transactional

**Enforced by:** application code — one transaction covering revalidation, the inventory
decrement, order and order item creation, the payment record, and clearing the cart.

**Why:** a partial checkout leaves stock consumed with no order, or an order with no stock
movement, and both are hard to detect afterwards.

**Verify:** a forced failure mid-checkout leaves no order, no payment row, and stock unchanged.

## Orders preserve historical item information

**Enforced by:** snapshot columns on order items holding food name, unit price, quantity, and
line total; a nullable food reference; a direct shop reference on the order; and no cascade path
that can delete order or order item rows.

**Why:** renaming or repricing a food, or deleting it, must not rewrite what a past order says
was bought, from where, and at what price.

**Verify:** delete a food that appears in a past order, then read that order back and confirm
the item name, unit price, and shop attribution are intact.

**Watch for:** a new relation declared with `onDelete: Cascade` that reaches orders; a migration
that makes the shop reference nullable.

## Primary keys are UUIDs

**Enforced by:** column types in the schema.

**Why:** identifiers appear in URLs, and UUIDs are not enumerable.

## Prisma is the only data access layer

**Enforced by:** convention and review. No `pg` client or raw connection in application code.

**Verify:** no direct driver import outside Prisma's own usage.

## Credentials never leak

**Enforced by:** `.gitignore` covering `.env` from the first commit; server-only environment
variables; nothing sensitive in any `VITE_`-prefixed variable, because Vite inlines those into
the browser bundle.

**Verify:** `.env` is untracked, and the client bundle contains no connection string or secret.

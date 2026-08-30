# SCC Delicious

A full-stack food-ordering application for a campus food court. Students browse shops, build a
cart, and place orders; administrators manage shops, menus, and stock.

**The backend is under active development and the frontend has not been started.** Students can now
browse, build a cart, and place an order; what remains on the backend is order management. This README
describes the repository as it exists today — what is built and verified, and what is still
design only. The intended design in full lives in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Current Status

### Implemented and tested

| Area | State |
| --- | --- |
| Backend foundation | Express application factory, fixed middleware chain, graceful shutdown |
| Database integration | PostgreSQL on Supabase, reached only through Prisma |
| Prisma 7 | Driver adapter (`@prisma/adapter-pg`), client generated |
| Database migration | Initial migration written and applied; schema up to date |
| Health endpoint | `GET /health`, verifies a real database round trip |
| Authentication | Register, login, refresh, logout, and current-user endpoints |
| Token handling | Short-lived access JWT plus refresh JWT in an HTTP-only cookie |
| Password hashing | bcrypt with a configurable cost and an enforced minimum |
| Authentication middleware | Bearer access-token verification on protected routes |
| Role mechanism | `STUDENT` and `ADMIN`, with router-level role middleware |
| Admin bootstrap | Server-side CLI; no endpoint can create an `ADMIN` |
| Catalogue browsing | Read-only shop and food endpoints, foods scoped to their shop |
| Cart | Server-side cart, one shop at a time, prices recomputed on every read |
| Catalogue administration | `ADMIN` write endpoints for shops, foods, and stock |
| Checkout | `POST /api/v1/orders`: one transaction placing an order, deducting stock, recording payment, clearing the cart |
| Idempotency | Required `Idempotency-Key` header; a retried key returns the original order and writes nothing |
| Payment simulation | A `SUCCEEDED` payment row written inside the checkout transaction |
| Test database | Local PostgreSQL in Docker, isolated from Supabase |
| Automated tests | **305 tests, 305 passing** |

### Not implemented yet

- Order management: reading an order, listing a student's orders, cancelling, and advancing status
- Frontend (the `frontend/` directory currently holds only environment templates)

---

## Technology Stack

| Layer | Technology |
| --- | --- |
| Runtime | Node.js (CommonJS modules) |
| Web framework | Express 5 |
| ORM and migrations | Prisma 7 with the `@prisma/adapter-pg` driver adapter |
| Database | PostgreSQL, hosted on Supabase |
| Validation | Zod |
| Password hashing | bcrypt (native) |
| Tokens | jose (HS256 JWTs) |
| Cookies | cookie-parser |
| Cross-origin | cors |
| Configuration | dotenv |
| Tests | Node.js built-in test runner (`node:test`) and built-in `fetch` |

There is no test framework, HTTP test client, logging service, caching layer, or payment SDK.
Supabase is used strictly as managed PostgreSQL — no Supabase client library and no project API
key exist anywhere in this repository.

**Node.js 22.12 or newer is required.** `jose` ships as ESM only, and this backend is CommonJS, so
it depends on Node's ability to `require()` an ES module. Verified on Node 24.18.

---

## Repository Structure

```
SCC Delicious/
├── backend/
│   ├── src/
│   │   ├── config/           environment validation and the Prisma client
│   │   ├── routes/           path definitions and middleware composition
│   │   ├── controllers/      HTTP concerns only
│   │   ├── services/         business logic and all database access
│   │   ├── middleware/       authentication, roles, validation, errors, not-found
│   │   ├── validators/       Zod request schemas
│   │   ├── lib/              shared utilities: passwords, tokens, cookies, errors
│   │   ├── app.js            application factory, no listening
│   │   └── server.js         binds the port and handles shutdown
│   ├── tests/
│   │   ├── unit/             pure logic, no database
│   │   ├── integration/      real HTTP against a real PostgreSQL
│   │   ├── helpers/          server lifecycle, database reset, user factories
│   │   └── setup.js          refuses to run against a non-local database
│   ├── prisma/
│   │   ├── schema.prisma     the schema source of truth
│   │   └── migrations/       committed, immutable once applied
│   ├── scripts/
│   │   └── create-admin.js   the only way to create an ADMIN account
│   ├── package.json
│   ├── package-lock.json
│   ├── .env.example          required variable names, placeholder values
│   └── prisma.config.mjs     Prisma CLI configuration (migration connection)
├── frontend/                 environment templates only; no application yet
├── docs/
│   └── ARCHITECTURE.md       the authoritative design document
└── .cursor/
    ├── rules/                project, backend, and database development rules
    └── skills/               guided workflows for schema and migration work
```

`docs/ARCHITECTURE.md` records every design decision and the reasoning behind it, including
decisions that are still open. `.cursor/rules/` holds constraints that apply to code in specific
directories. `.cursor/skills/` holds step-by-step procedures for risky operations, principally
creating and applying database migrations.

---

## Backend Architecture

Requests travel in one direction, and each layer talks only to the one beneath it:

```
Routes → Controllers → Services → Prisma → PostgreSQL
```

| Layer | Responsibility |
| --- | --- |
| **Routes** | Declare paths and compose middleware. No logic. |
| **Controllers** | HTTP only: read validated input, call one service, set the status and body. They never touch Prisma. |
| **Services** | All business logic, transactions, and authorization. They know nothing about `req` or `res`, which is what makes them directly testable. |
| **Prisma** | The only database access path. |

There is **one process-wide `PrismaClient`**, created in `src/config/prisma.js`, so the process
holds a single connection pool. It is constructed with the `@prisma/adapter-pg` driver adapter and
takes its connection from `DATABASE_URL` — the pooled Supabase connection. `DIRECT_URL` is used by
the Prisma CLI for migrations only and is never read by application code.

Middleware order is fixed and treated as part of the architecture: CORS, cookie parsing, JSON body
parsing with a size limit, routes, a not-found handler, and a single centralised error handler
last. That error handler is the only place an error response is shaped, so every failure reaches
the client in one predictable form.

---

## Database

PostgreSQL, hosted on Supabase, is the development database. Prisma owns the schema, and **all
schema changes are made through committed migrations** — never by hand in the Supabase dashboard,
and never by editing a migration that has already been applied.

The current schema holds **8 application tables** and 3 enums:

| Tables | Enums |
| --- | --- |
| `users`, `shops`, `foods`, `carts`, `cart_items`, `orders`, `order_items`, `payments` | `role`, `order_status`, `payment_status` |

Notable properties already enforced by the database rather than by application code:

- **Row-level security is enabled on all 8 tables with no policies.** This blocks Supabase's Data
  API from reaching them while leaving Prisma unaffected, because the role Prisma connects as owns
  the tables. Authorization therefore lives in one place: the service layer.
- Money is stored as integer minor units, never as a floating-point value.
- `CHECK (stock_quantity >= 0)` on `foods` and `CHECK (quantity > 0)` on `cart_items`.
- Primary keys are UUIDs; timestamps are `TIMESTAMPTZ` in UTC.

All 8 tables are now written by application code. `orders`, `order_items`, and `payments` are
written by checkout and, after it commits, are never modified: order management will move an order's
status and nothing else.

**The initial migration has already been applied**, and `prisma migrate status` currently reports
that the database schema is up to date.

---

## Environment Configuration

Configuration lives in `backend/.env`, which is **never committed**.
[`backend/.env.example`](backend/.env.example) is committed and documents every required variable
name with a placeholder value. The server validates its configuration with Zod at startup and
refuses to start if anything is missing or malformed.

```bash
# Application runtime — pooled Supabase connection
DATABASE_URL=<your-database-url>

# Prisma CLI migrations only — direct/session connection
DIRECT_URL=<your-direct-database-url>

# Local throwaway PostgreSQL used by the test suite only
TEST_DATABASE_URL=<local-test-database-url>

# Two different long random values. The server rejects identical or short secrets.
JWT_ACCESS_SECRET=<generate-a-long-random-value>
JWT_REFRESH_SECRET=<generate-a-different-long-random-value>
ACCESS_TOKEN_TTL=15m
REFRESH_TOKEN_TTL=7d

# Minimum enforced value is 12
BCRYPT_COST=12

PORT=3000
NODE_ENV=development
CORS_ORIGIN=http://localhost:5173
```

No Supabase project API key is required, because the application never uses one.

---

## Running the Backend

```bash
cd backend
npm install
```

Then copy `.env.example` to `.env` and fill in real values. **The server will not start until the
environment is configured** — in particular, both JWT secrets must be set, must differ from each
other, and must be at least 32 characters.

```bash
npm start      # node src/server.js
npm run dev    # node --watch src/server.js, restarts on change
```

The server listens on `PORT` (default `3000`). Confirm it is up and can reach the database with
`GET /health`.

### Creating an administrator

No endpoint can create an `ADMIN`. Use the server-side script, which reads the password from
standard input so it never appears in shell history:

```bash
npm run create-admin -- admin@example.com
```

It writes to whatever database `DATABASE_URL` points at and prints the database name it used.

---

## Database Migration Commands

Run these from `backend/`. The `--no-install` flag makes npx fail rather than silently fetching a
different Prisma version.

| Command | What it does | Touches the database? |
| --- | --- | --- |
| `npx --no-install prisma validate` | Checks `schema.prisma` is well formed | No |
| `npx --no-install prisma migrate status` | Reports which migrations have been applied | Reads only |
| `npx --no-install prisma migrate deploy` | Applies pending migrations | **Yes, writes** |
| `npx --no-install prisma generate` | Regenerates the client after a schema change | No |

**Handle migration commands against a real database with care.** `migrate deploy` is the only
command above that changes a live schema, and it uses `DIRECT_URL`. Never run `prisma migrate dev`,
`prisma db push`, or `prisma migrate reset` against Supabase — the first two can alter the schema
outside a committed migration, and the last one destroys data. Migration work is governed by the
procedure in `.cursor/skills/database-migration/`.

---

## Testing

```bash
cd backend
npm test
```

which runs:

```
node --test --test-concurrency=1 "tests/**/*.test.js"
```

Current verified result:

| Metric | Value |
| --- | --- |
| Tests | 305 |
| Passed | 305 |
| Failed | 0 |

Coverage today spans application bootstrap, the health endpoint including its database-failure
path, password hashing, JWT signing and verification, the validation schemas, the role middleware,
and the authentication, catalogue browsing, cart, catalogue administration, and checkout endpoints
end to end over HTTP. The database-level guarantees are exercised directly as well as through the
API: the uniqueness of a cart line, `CHECK (quantity > 0)`, `CHECK (stock_quantity >= 0)`, the
global uniqueness of an idempotency key, one payment per order, the refusal to delete a shop that
orders reference, and the survival of an order item whose food has been deleted.

Concurrency is tested rather than reasoned about, and checkout is where most of that lives:
simultaneous cart writes; simultaneous stock changes against the last units; two simultaneous
checkouts carrying one idempotency key, which must produce exactly one order; ten buyers placing
orders at once against five units of stock, which must produce five orders and five refusals with
no overselling; eight buyers checking out four shared foods at once, which must not deadlock; and a
checkout racing each kind of cart write. A forced failure part-way through a checkout is asserted to
leave no order, no payment, no stock movement, and the cart exactly as it was.

Two things are worth understanding before running the suite:

- **Tests use a separate local PostgreSQL database and must never run against Supabase.** The suite
  resets data destructively between tests. `tests/setup.js` reads `TEST_DATABASE_URL`, refuses any
  host that is not loopback, and rebinds `DATABASE_URL` before application code loads. The reset
  helper repeats that check immediately before truncating.
- **`--test-concurrency=1` is deliberate.** Test files share one database, so running them in
  parallel would let one file truncate another's rows mid-test.

---

## Test Database

The suite expects a disposable PostgreSQL instance on the local machine, most easily run in Docker:

```bash
docker run -d --name scc-delicious-test-db \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=scc_delicious_test \
  -p 127.0.0.1:5433:5432 \
  postgres:16
```

Then point `TEST_DATABASE_URL` at it and apply the committed migration to it, so the test database
enforces the same constraints as every other environment. The Prisma CLI takes its connection from
`DIRECT_URL` (see `prisma.config.mjs`), so that is the variable to override — and because dotenv
does not overwrite a variable that is already set, exporting it first wins over `.env`:

```bash
cd backend
DIRECT_URL="postgresql://postgres:<password>@127.0.0.1:5433/scc_delicious_test" \
  npx --no-install prisma migrate deploy
```

About this container:

- It **binds to loopback only** (`127.0.0.1:5433`), so it is not reachable from the network.
- It is **disposable**. Delete and recreate it freely; it holds nothing worth keeping.
- It is **entirely separate from Supabase**, and the test harness refuses to run if the configured
  test database is not on a loopback host.
- The **committed migration is applied to it**, so tests exercise real constraints rather than an
  approximation.
- **Tests reset database state between tests** by truncating every application table.

This container is not configured to start automatically. If Docker or the machine has been
restarted, start it again with `docker start scc-delicious-test-db` before running the suite.

---

## API

Everything below is implemented and covered by tests. The order-management endpoints — reading an
order, listing a student's orders, cancelling, and advancing status — do not exist yet and are not
documented here.

### Operational

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Reports process and database health. `200` when a database round trip succeeds, `503` when it does not. Deliberately outside `/api/v1`. |

### Authentication

| Method | Path | Auth | Success | Purpose |
| --- | --- | --- | --- | --- |
| `POST` | `/api/v1/auth/register` | none | `201` | Create a `STUDENT` account and sign it in |
| `POST` | `/api/v1/auth/login` | none | `200` | Exchange email and password for a session |
| `POST` | `/api/v1/auth/refresh` | refresh cookie | `200` | Exchange the refresh cookie for a new access token |
| `POST` | `/api/v1/auth/logout` | none | `204` | Clear the refresh cookie |
| `GET` | `/api/v1/auth/me` | access token | `200` | Return the signed-in user's own record |

### Catalogue browsing

Any signed-in caller, either role. Read-only.

| Method | Path | Success | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/v1/shops` | `200` | Every shop, ordered by name |
| `GET` | `/api/v1/shops/:shopId` | `200` | One shop |
| `GET` | `/api/v1/shops/:shopId/foods` | `200` | That shop's foods, ordered by name |
| `GET` | `/api/v1/shops/:shopId/foods/:foodId` | `200` | One food, within that shop |

Foods are addressed only beneath their shop. A food whose id is real but which belongs to a
different shop is a `404`, not a leak.

### Cart

`STUDENT` only. The cart is a singleton belonging to the caller and is never addressed by an id, so
there is no identifier a client could change to reach someone else's.

| Method | Path | Success | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/v1/cart` | `200` | The caller's cart, with current prices and totals |
| `POST` | `/api/v1/cart/items` | `201` | Add `quantity` of `foodId`; returns the cart |
| `PATCH` | `/api/v1/cart/items/:foodId` | `200` | Set that line's quantity; returns the cart |
| `DELETE` | `/api/v1/cart/items/:foodId` | `204` | Remove that line |
| `DELETE` | `/api/v1/cart` | `204` | Empty the cart and release its shop |

A cart holds one shop at a time; a food from another shop is refused with `409
CART_SHOP_MISMATCH`. Cart lines store quantity only — every price and total is recomputed from the
food at the moment of the request. Adding to a cart does not reserve stock.

### Catalogue administration

`ADMIN` only. These share the `/api/v1/shops` base path with browsing but live in a second router,
so the role check attaches once rather than per handler.

| Method | Path | Success | Purpose |
| --- | --- | --- | --- |
| `POST` | `/api/v1/shops` | `201` | Create a shop |
| `PATCH` | `/api/v1/shops/:shopId` | `200` | Update a shop |
| `DELETE` | `/api/v1/shops/:shopId` | `204` | Delete a shop |
| `POST` | `/api/v1/shops/:shopId/foods` | `201` | Create a food, with its initial stock |
| `PATCH` | `/api/v1/shops/:shopId/foods/:foodId` | `200` | Update that food's name or price |
| `DELETE` | `/api/v1/shops/:shopId/foods/:foodId` | `204` | Delete that food |
| `PATCH` | `/api/v1/shops/:shopId/foods/:foodId/stock` | `200` | Move that food's stock by a signed delta |

Stock is set absolutely only at creation. Afterwards it moves by delta, applied as one conditional
database update that cannot leave it negative — never a read, a comparison, and a write. Deleting a
shop that past orders reference is refused with `409 SHOP_HAS_ORDERS`; deleting a food succeeds and
leaves any order line intact, because those columns are snapshots.

### Checkout

`STUDENT` only; an `ADMIN` receives `403`. The request carries **no body and no cart id** — the
caller's own cart, its shop, the quantities, and the prices are all server state — and one required
header.

| Method | Path | Success | Purpose |
| --- | --- | --- | --- |
| `POST` | `/api/v1/orders` | `201` | Place an order from the caller's cart |
| `POST` | `/api/v1/orders` | `200` | Return the order an earlier request with the same key created |

```http
POST /api/v1/orders
Authorization: Bearer <access token>
Idempotency-Key: 7f3c9a1e-0b2d-4c85-9d61-2f8ab4c07e5a
```

The `Idempotency-Key` header is required, must match `^[A-Za-z0-9_-]+$`, must be 16 to 128
characters, and is case-sensitive. The server treats it as opaque: it is never trimmed, normalised,
or parsed, only compared. A client generates one key per checkout attempt from a cryptographically
random source and reuses that same key for every retry of that attempt.

- A **new key** places the order and answers `201`.
- The **same key again** answers `200` with the identical order and writes nothing at all: no second
  order, no stock movement, no change to a cart that has since been refilled.
- **Two requests with one key at the same time** produce exactly one order — one `201` and one `200`,
  with the same body.
- A key that **already belongs to another user's order** is `409 IDEMPOTENCY_KEY_CONFLICT`, and the
  response discloses nothing about that order.
- A **failed checkout leaves the key free**, because its transaction rolled back and the row never
  existed. Retrying after `409 INSUFFICIENT_STOCK` is an ordinary fresh attempt.

Checkout is one database transaction. The order, its items, the payment, every stock deduction, and
the emptied cart all commit together or none of them exist — a mid-checkout failure leaves no order,
no payment, no stock movement, and the cart untouched. Stock is deducted through the same conditional
update the admin stock endpoint uses, so simultaneous checkouts cannot oversell; deductions are
applied in a fixed food order so that concurrent checkouts sharing foods cannot deadlock. The cart
is cleared last, and only if everything before it succeeded.

Prices and totals are read from the food rows at the moment of checkout and computed on the server;
nothing about money is taken from the request. Each order item stores the food's name and unit price
as immutable snapshots, so renaming, repricing, or deleting a food afterwards never rewrites a past
order. The payment amount is assigned from the order total rather than recalculated, so the line
totals, the order total, and the payment amount cannot disagree. Every order is created `PLACED`,
and payment in v1 is simulated: the row is always `SUCCEEDED`, written inside the transaction, with
no external gateway.

The response is the order and its lines, with no `userId`, no idempotency key, no payment, and no
timestamps beyond `placedAt`:

```json
{
  "id": "…",
  "shopId": "…",
  "status": "PLACED",
  "totalMinor": 1450,
  "placedAt": "2026-08-30T12:00:00.000Z",
  "items": [
    { "foodId": "…", "name": "Chicken Roll", "priceMinor": 450, "quantity": 2, "lineTotalMinor": 900 }
  ]
}
```

An empty or absent cart is `409 CART_EMPTY`. A food that cannot supply the ordered quantity is `409
INSUFFICIENT_STOCK`, whose `details` name the failing line as `{ foodId, name, message }` and carry
no stock figure. A cart changed while the order was being built is `409 CART_MODIFIED`, which
guarantees no cart line can disappear without having been ordered.

Successful responses return the resource directly, with no envelope. Errors share one structure —
`{ "error": { "code", "message" } }` — produced only by the central error handler, with a `details`
array added where a client can act on more than the code. Validation failures name the offending
field as `{ field, message }`; `INSUFFICIENT_STOCK` names the food instead, as
`{ foodId, name, message }`, because what has to be highlighted is a line of the cart rather than
something the client sent.

| Code | Status |
| --- | --- |
| `VALIDATION_ERROR` | `400` |
| `UNAUTHENTICATED` | `401` |
| `INVALID_CREDENTIALS` | `401` |
| `INVALID_REFRESH_TOKEN` | `401` |
| `FORBIDDEN` | `403` |
| `NOT_FOUND` | `404` |
| `EMAIL_ALREADY_REGISTERED` | `409` |
| `CART_SHOP_MISMATCH` | `409` |
| `CART_EMPTY` | `409` |
| `CART_MODIFIED` | `409` |
| `IDEMPOTENCY_KEY_CONFLICT` | `409` |
| `SHOP_HAS_ORDERS` | `409` |
| `INSUFFICIENT_STOCK` | `409` |
| `INTERNAL_ERROR` | `500` |

---

## Authentication

Authentication is implemented entirely in Express. Supabase Auth is not used.

- **Access token** — a short-lived JWT signed with HS256, returned in the response body, and sent
  back in the `Authorization: Bearer` header. It carries exactly four claims: `sub` (the user's
  UUID), `role`, `iat`, and `exp`. Clients are expected to hold it in memory, never in
  `localStorage` or `sessionStorage`.
- **Refresh token** — a separate JWT signed with a *different* secret and delivered only as an
  HTTP-only cookie. It never appears in a response body. It carries identity alone and no role, so
  refreshing re-reads the current role from the database, which is what allows a role change to
  take effect and stops a deleted account minting new tokens.
- **Passwords** are hashed with bcrypt at a configurable cost with an enforced floor. A hash is
  never logged and never returned by any endpoint.
- **Roles** are `STUDENT` and `ADMIN`. Registration always creates a `STUDENT`; a role supplied in
  a request body is discarded before any code reads it. `ADMIN` accounts come only from the
  server-side CLI.
- **Duplicate registration is rejected** with `409 EMAIL_ALREADY_REGISTERED`. Uniqueness is
  enforced by the database's unique index rather than a prior lookup, so two simultaneous
  registrations for one address cannot both succeed.
- **Login failures do not reveal whether an account exists.** An unknown email and a wrong password
  return byte-identical responses, and the unknown-email path performs equivalent hashing work so
  the two cannot be distinguished by response time either.
- **Password length is capped at bcrypt's 72-byte input limit**, measured in bytes. Beyond that
  bcrypt silently ignores the remainder, which would make two long passwords sharing a prefix
  interchangeable at sign-in. The minimum is 8 characters, with no composition rules.

---

## Security

Measures that exist in the code today:

- **Refresh cookie** is `HttpOnly`, so JavaScript cannot read it, and scoped with
  `Path=/api/v1/auth` so it is not attached to any other request.
- **`SameSite=Strict`** on that cookie, which the same-site deployment of client and API permits.
- **`Secure` is set in production** and omitted otherwise, because a `Secure` cookie is not sent
  over the plain HTTP used in local development.
- **CORS** is an explicit origin allowlist with credentials enabled, never a wildcard.
- **Zod validation at the API edge** for request bodies, with route params and query strings
  covered by the same middleware as those endpoints arrive.
- **Centralised error handling.** `5xx` messages are replaced with a generic string, so a
  connection string, file path, or SQL fragment cannot escape in an error body.
- **No password or hash is ever returned**, and tests assert this on every authentication response.
- **Uniqueness enforced in the database**, not by a read-then-write check that a race can defeat.
- **Parent-scoped queries** are the documented pattern for ownership checks, applied as protected
  resources arrive; today the equivalent is that `/auth/me` reads only the caller's own record.
- **`X-Powered-By` is disabled**, so the framework does not advertise itself.

Deliberately **not** part of v1: rate limiting, additional security headers, audit logging, and
server-side refresh-token storage. These are recorded as scope boundaries in the architecture, not
oversights.

---

## Current Limitations

- **Refresh tokens are stateless.** Logout clears the cookie but cannot invalidate a token already
  copied from it, and there is no "sign out everywhere". This is an accepted v1 limitation.
- **An order cannot be looked at once it is placed.** Checkout returns the order it created, but
  there is no endpoint yet to read it again, list a student's orders, cancel one, or advance its
  status. That is the next phase.
- **Payment is simulated.** The payment row is always `SUCCEEDED` and no provider is contacted.
  Introducing a real gateway would mean revisiting checkout's single-transaction shape, because a
  network call cannot live inside a database transaction.
- **The test database does not exercise the Supabase connection pooler.** Tests run against a plain
  local PostgreSQL, so pooler-specific behaviour is not covered by the suite.
- **No frontend exists.**
- **No production deployment configuration exists** — no Dockerfile, no CI pipeline, no host
  configuration.

---

## Development Roadmap

The order below is the one recorded in `docs/ARCHITECTURE.md`; phases build on each other.

| # | Phase | State |
| --- | --- | --- |
| 1 | Configuration and database schema | **Complete** |
| 2 | Authentication | **Complete** |
| 3 | Authorization mechanism | **Complete** |
| 4 | Read-only shop and food browsing | **Complete** |
| 5 | Cart | **Complete** |
| 6 | Catalogue administration | **Complete** |
| 7 | Checkout with inventory, payment simulation, and idempotency | **Complete** |
| 8 | Order management | **Next** |
| 9 | Frontend | Planned |

The cart was built before catalogue administration and administration followed it, so both are
done and the ordering is back on track. Payment simulation was not a phase of its own: it is one
module inside the checkout transaction.

The next phase is order management: reading one of the caller's own orders, listing them, `ADMIN`
listing and status transitions, and cancellation. Its shape is already constrained by what exists —
an order is immutable apart from its status, a status change is a conditional update matching the
expected current status, and a student's order is read by a query scoped to both the order id and
the caller, which is the pattern checkout's idempotency lookup established. Whether cancelling
restores stock, and which transitions each role may make, are recorded as open decisions in the
architecture and are settled before that code is written.

Each phase follows the same sequence: planned, implemented, tested, reviewed, then committed on its
own. A phase's behaviour is not described as working until its tests pass.

---

## Development Rules

Read these before contributing:

| Location | What it contains |
| --- | --- |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | The authoritative design: decisions, the reasoning behind them, normative constraints, scope boundaries, and the decisions still open |
| [`.cursor/rules/`](.cursor/rules) | Development constraints scoped to directories — project-wide, backend, and database |
| [`.cursor/skills/`](.cursor/skills) | Step-by-step procedures for risky work, principally schema changes and migrations |

The architecture document is normative, not advisory. Where it settles a question, the code follows
it; where it marks a question open, that decision is made explicitly before the code that depends
on it is written.

---

## Git and Secrets

- **Never commit `backend/.env`.** It is ignored from the first commit, along with every other
  `.env` file except the templates.
- **Use `backend/.env.example` as the template.** It carries variable names and placeholder values
  only, and it is the file to update when a new variable is introduced.
- **Never commit passwords, JWT secrets, database credentials, connection strings, or tokens** —
  not in code, not in tests, not in documentation, and not in commit messages.
- Secrets belong in environment variables, and only the server ever sees them. Nothing sensitive
  may reach the frontend bundle.

---

## Verification

The current state of the repository can be confirmed with three commands, run from `backend/`:

```bash
npm test
npx --no-install prisma validate
npx --no-install prisma migrate status
```

| Command | Expected result |
| --- | --- |
| `npm test` | 305 tests, 305 passing, 0 failing |
| `prisma validate` | The schema is valid |
| `prisma migrate status` | Database schema is up to date |

`npm test` requires the local test database to be running. The other two read `schema.prisma` and,
for `migrate status`, the configured database; neither modifies anything.

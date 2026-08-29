# Overview

This document records the approved technical architecture for SCC Delicious, a full-stack
web application. It is an architecture decision document. It describes what we intend to
build and why. It does not describe anything that has been built.

**Status: no application code exists yet.** At the time of writing, the repository contains
only this document and the Cursor rules directory. Nothing in this document has been
implemented, and nothing has been tested. Every design statement here should be read as
"the intended design", not as a description of working software.

The document covers v1 only. It deliberately stops short of settling questions that have not
been decided, and it deliberately excludes work that v1 does not need. Open questions are
collected under [Future Decisions](#future-decisions); things consciously left out are listed
under [Scope boundaries for v1](#scope-boundaries-for-v1). Product behaviour that is not part
of the SCC Delicious requirements is not invented here.

# Goals

The architecture is shaped by the following goals, in priority order.

1. **A single, server-side authority.** All data access, validation, and authorization
   happen in one place, so there is one gate to reason about and audit.
2. **Correctness under concurrency.** Inventory must not be oversold when two users act at
   the same time, and a retried checkout must not produce two orders. Both are treated as
   first-class design requirements, not edge cases.
3. **Trustworthy money and order records.** Prices and totals must be exact, and a
   historical order must remain an accurate record of what was bought, and from which shop,
   even after the menu changes.
4. **Secrets stay on the server.** Database credentials and token secrets must never be
   reachable from the browser and must never be committed to the repository.
5. **Clear separation of responsibilities.** Routing, HTTP handling, business logic, and
   data access occupy distinct layers, so a change has one obvious home.
6. **Only what v1 needs.** Abstractions are introduced when a second case exists, not in
   anticipation of one.
7. **Incremental delivery.** The design can be built in small, independently reviewable
   phases (see [Implementation Principle](#implementation-principle)).

# System Architecture

Three tiers with a single hard boundary at the HTTP API:

```
React (browser)
  |
  v  HTTPS / JSON
Axios
  |
  v
Express                 <-- the only public boundary
  |
  v
Routes                  routing + middleware composition
  |
  v
Controllers             HTTP concerns only
  |
  v
Services                business logic, transactions, authorization
  |
  v
Prisma                  database access layer
  |
  v
PostgreSQL (Supabase)
```

Requests only ever travel down this chain, and each layer only talks to the layer directly
beneath it. A controller never uses Prisma. A service never touches `req` or `res`.

**The browser must never connect directly to Supabase.** No Supabase client library, no
project API keys, and no database connection exist in the frontend. Supabase provides
managed PostgreSQL, reached only by the Express server through Prisma.

*Why:* authentication is implemented in Express with JWT and bcrypt. If the browser also held
a direct database session, there would be two independent authorization systems that must
agree forever, and eventually they would not. One boundary is simpler to secure, and it is
the only arrangement in which database credentials can be kept off the client.

A consequence to accept deliberately: because the database is not the enforcement layer,
**every authorization rule is application code in the service layer**, and therefore
something that must be tested rather than assumed.

# Technology Stack

**Frontend:** React, Vite, React Router, Axios.

**Backend:** Node.js, Express, Prisma, JWT, bcrypt, Zod, CORS, dotenv.

**Database:** Supabase PostgreSQL.

Brief rationale for the less obvious choices:

- **Prisma** gives typed database access and, more importantly, owns the schema through
  migrations, so schema changes are versioned artifacts in the repository rather than manual
  actions.
- **Zod** validates untrusted input at the API edge and also validates environment
  configuration at startup, so one library covers both trust boundaries.
- **bcrypt** hashes passwords so they are never stored recoverably.
- **dotenv** loads configuration from the environment in development; production
  configuration is injected by the host.
- **CORS** is configured as an explicit origin allowlist rather than a wildcard, because the
  refresh-token cookie requires credentialed cross-origin requests.

Nothing else is part of the v1 stack. No payment gateway, no logging service, no caching
layer, no server-state library. Additions require a decision, not an assumption.

# Frontend Architecture

The frontend is a Vite-built React single-page application, organised by feature, so a change
to one area of the product stays in one directory.

**HTTP access is centralised.** A single configured Axios instance is the only module that
knows the API base URL, attaches the access token to outgoing requests, and reacts to a `401`
by attempting one token refresh before redirecting to sign-in. No component calls `axios`
directly.

*Why:* token attachment and refresh logic duplicated across call sites is a reliable source of
subtle authentication bugs, and centralising it means the retry policy exists once.

**Routing** uses React Router with nested layouts. Route protection is expressed as small
reusable guard wrappers that check the authenticated user and role from application state.

*Why it matters what guards are for:* route guards are a user-experience feature. They hide
what the user cannot use. They are **not** a security boundary, because anything the browser
enforces the browser can bypass. Every protected action is re-checked on the server.

**Token handling.** The access token is short-lived and held in memory only, never in
`localStorage` or `sessionStorage`. The refresh token is delivered and returned as a secure
`httpOnly` cookie, so JavaScript cannot read it at all.

*Why:* a cross-site scripting bug cannot exfiltrate a token it cannot read. The cost is
accepted deliberately: requests must be credentialed, CORS must name exact origins, and the
application shows a brief "restoring session" state on load while it exchanges the cookie for
a fresh access token.

**Server-state caching library: not used in v1.** Data is fetched in components through the
shared Axios instance and held in local or context state.

*Why not:* a caching library solves refetching, deduplication, and staleness problems that
this application does not yet have, and it adds a dependency and a mental model to every data
fetch. It can be adopted later without changing the API.

# Backend Architecture

The Express application is layered, with each layer having a single responsibility.

- **Routes** declare paths and compose middleware. They contain no logic.
- **Controllers** handle HTTP only: read validated input, call one service, and translate the
  result into a status code and response body. Controllers contain no business rules and
  never use Prisma.
- **Services** hold all business logic, own database transactions, and enforce authorization
  and ownership. Services are plain functions that know nothing about HTTP.
- **Prisma** is the only database access path. No raw connection handling elsewhere.

*Why this particular seam:* checkout is the most intricate logic in the system and the part
most in need of direct testing. That is only possible if it does not depend on an HTTP request
object.

**Middleware order** is fixed early and treated as part of the architecture: CORS, cookie
parsing, body parsing with a size limit, route handling, a not-found handler, and finally a
single centralised error handler.

*Why one error handler:* it is the only place that formats an error response, so every client
sees one predictable shape regardless of where the failure occurred.

**Input validation** happens at the edge of every route with Zod, covering body, route params,
and query string. The parsed, typed value is what flows inward.

*Why:* services can then assume well-formed input instead of defending against it, and
validation stays declarative rather than scattered through conditionals.

**Configuration** is parsed and validated once at startup. If a required variable is missing
or malformed, the process fails to start.

*Why fail fast:* a missing token secret must be a startup crash, not a silent runtime weakness
discovered later.

# Authentication

Authentication is implemented in the Express API. Supabase authentication is not used.

- **Passwords** are hashed with bcrypt before storage. A password hash is never logged and
  never appears in an API response.
- **Access tokens** are short-lived JWTs, sent in the `Authorization` header and verified on
  every protected request.
- **Refresh tokens** are delivered as secure, `httpOnly`, `SameSite` cookies and exchanged at
  a dedicated refresh endpoint for a new access token.
- **A client cannot assign its own role.** The role is decided by the server and is never read
  from a request body, query parameter, or any other client-supplied field.

**Registration creates a `STUDENT` account.** The role is set by the server, not by the
request.

**`ADMIN` accounts are not created by public self-registration.** They are created through a
controlled mechanism that is not reachable from the public registration endpoint. The specific
mechanism is a remaining decision (see Future Decisions); what is settled is that no publicly
reachable endpoint can produce an `ADMIN`.

**Where the role is read from.** The role is carried as a signed claim in the access token and
trusted from there, rather than re-read from the database on every request.

*Why this is safe, and its cost:* a signed JWT claim is server-issued and tamper-evident, so
it is not "client-supplied" in the sense the rule above guards against, and trusting it avoids
a database round trip on every authorized request. The cost is bounded staleness: a role
changed mid-session remains stale until the short-lived access token expires. Ownership checks
are never taken from the token — they always hit the database.

*Why short access tokens plus a cookie-borne refresh token:* a JWT cannot be un-issued, so a
short lifetime bounds the damage of a leaked one, while the refresh cookie keeps sessions
usable without exposing a long-lived credential to JavaScript.

Authentication failures return a single generic message. *Why:* distinguishing "unknown email"
from "wrong password" turns the sign-in endpoint into a way to discover which accounts exist.

Email addresses are normalised to lower case before storage and comparison, so that a single
person cannot hold two accounts differing only in capitalisation.

Refresh tokens are not persisted server-side in v1, which means signing out clears the cookie
but cannot invalidate a token already stolen from it. This is an accepted v1 limitation, listed
under scope boundaries rather than left unnoticed.

# Authorization

There are exactly **two application roles: `STUDENT` and `ADMIN`.** No other role exists. There
is no separate customer or shop-owner role; a shop is administered by `ADMIN` users.

- **`STUDENT`** may browse shops and foods, manage their own cart, place orders, and read
  their own orders.
- **`ADMIN`** may manage shops and foods, including stock, and may read and advance orders.

Authorization has two layers, and both are required.

1. **Coarse role checks** in middleware, attached at the router level, reject callers whose
   role cannot perform a class of action at all.
2. **Ownership and relationship verification in the service layer**, which answers the
   question a role check cannot: not "is this caller a student?" but "may this caller act on
   *this* record?"

**Server-side authorization must verify resource ownership.** This takes two forms:

- For resources belonging to a user — cart, cart items, orders — the query is scoped by the
  caller's user id, so a record belonging to someone else is simply not found.
- For nested resources — a food within a shop, an item within an order — the query is scoped
  by the parent, so a mismatched pair cannot be acted on even by an `ADMIN`.

*Why query scoping rather than a separate check:* a fetch-then-compare pattern is bypassed by
any future code path that forgets the comparison, while a scoped query cannot return data the
caller is not entitled to in the first place. It fails safe by construction.

Because `ADMIN` is a platform-wide role in v1, administrators are not partitioned by shop.
Whether shops should later be assigned to specific administrators is a remaining decision; the
relationship-scoping rule above applies either way.

# Database Architecture

Prisma owns the schema. **All schema changes are made through Prisma migrations**, which are
committed to the repository and, once applied, never edited. Schema changes are never made by
hand in the Supabase dashboard.

*Why:* manual changes drift from the schema definition, and the next migration will attempt to
reconcile that drift, sometimes destructively. Committed migrations also mean any environment
can be rebuilt to a known state.

**Two connection strings** are used, which is specific to Supabase and worth getting right
from the start: the pooled connection for the running application, and the direct connection
for running migrations. *Why:* pooled connections in transaction mode do not support the
session-level operations that migrations require, while direct connections are too limited in
number to serve application traffic.

**Primary keys are UUIDs.** *Why:* identifiers appear in URLs, and UUIDs are not enumerable,
so a caller cannot walk the identifier space to discover records that exist. They are also
safe to generate before insert. The cost — larger indexes than sequential integers — is
irrelevant at this scale.

**Timestamps are stored in UTC.** *Why:* mixed offsets are extremely difficult to correct once
data exists.

## Core entities

The core entities are `User`, `Shop`, `Food`, `Cart`, `CartItem`, `Order`, `OrderItem`, and
`Payment`. Field lists below are indicative of intent, not a final schema; only fields that
follow from a decision are listed.

```
User        id (uuid), email (unique, lower-cased), password_hash, role,
            created_at, updated_at

Shop        id (uuid), name, created_at, updated_at

Food        id (uuid), shop_id -> Shop, name, price_minor,
            stock_quantity (check >= 0), created_at, updated_at

Cart        id (uuid), user_id -> User, shop_id -> Shop (nullable),
            created_at, updated_at

CartItem    id (uuid), cart_id -> Cart, food_id -> Food, quantity (check > 0),
            unique (cart_id, food_id)

Order       id (uuid), user_id -> User, shop_id -> Shop, status,
            total_minor, idempotency_key (unique), placed_at,
            created_at, updated_at

OrderItem   id (uuid), order_id -> Order, food_id -> Food (nullable),
            food_name_snapshot, unit_price_minor_snapshot,
            quantity, line_total_minor

Payment     id (uuid), order_id -> Order (unique), status, amount_minor,
            created_at, updated_at
```

## Relationships

- **Shop to Food:** one shop has many foods; each food belongs to exactly one shop. A food is
  never shared between shops.
- **User to Cart:** one user has one active cart, owned by that user alone.
- **Cart to Shop:** a cart holds items from at most one shop at a time and carries a shop
  reference directly. The reference is null while the cart is empty.
- **Cart to CartItem:** one cart has many cart items. A given food appears at most once per
  cart, with a quantity, enforced by a uniqueness constraint on the cart-and-food pair.
- **CartItem to Food:** each cart item references one food and stores quantity only, never
  price.
- **User to Order:** one user has many orders; each order belongs to exactly one user.
- **Order to Shop:** **each order references exactly one shop, directly.** This is required so
  that a historical order remains associated with its shop even if a food item is later
  removed. It also means a single order covers items from exactly one shop.
- **Order to OrderItem:** one order has many order items. Order items are immutable once
  written.
- **OrderItem to Food:** each order item references the food it was created from, but the
  reference is nullable and the descriptive and price fields are copies taken at purchase
  time. If the food is later removed, the order item survives with its snapshot intact, and
  the order still knows its shop.
- **Order to Payment:** one order has exactly one payment record.

Deletion behaviour follows the same reasoning. Removing a shop removes its foods, and removing
a food removes any cart items referencing it, because a cart is transient working state with no
historical value. **Orders and order items are never cascade-deleted**, and the direct shop
reference on the order means deleting a food or a shop cannot orphan an order's attribution.

## Cross-cutting data decisions

**Money is stored as integer minor units** — a whole number of the smallest currency unit —
never as a floating-point value. *Why:* binary floating-point cannot represent common decimal
fractions exactly, so repeated arithmetic on currency accumulates error and produces totals
that do not reconcile with their line items. Integers make the arithmetic exact.

**Order items snapshot the food name, unit price, quantity, and line total.** *Why:* an
administrator renaming or repricing an item must not retroactively rewrite what a past order
says was bought and at what price.

**A stated money invariant:** the sum of an order's `line_total_minor` values equals the
order's `total_minor`, which equals its payment's `amount_minor`. The redundancy is deliberate
— a payment records what was actually charged — but the agreement between the three is a
property to be tested, not assumed.

**Stock quantity is constrained at the database level so it can never go negative**,
independently of application logic. See [Inventory and Concurrency](#inventory-and-concurrency).

**Indexes** accompany the tables in the same migration, covering the foreign keys and the
predictable access paths: a shop's foods, a user's orders, and a shop's orders.

# Inventory and Concurrency

Inventory correctness is the highest-risk area of the design, because the intuitive
implementation is wrong. Reading stock, comparing it in JavaScript, then writing the new value
is a race: two concurrent checkouts for the last unit both read `1`, both pass the check, and
both write `0`. One unit has been sold twice.

Two mechanisms prevent this.

1. **A database check constraint enforcing `stock_quantity >= 0`.** This is the invariant that
   holds no matter what any application code does, now or in future.
2. **An atomic conditional decrement.** Stock is reduced by a single statement that decrements
   only when sufficient stock is present. Zero rows affected means insufficient stock, which
   aborts the enclosing transaction. *Why this works:* the comparison and the write are one
   operation evaluated under a row lock, so there is no window between checking and writing.

**Isolation level.** The conditional decrement is correct at PostgreSQL's default read
committed isolation. No stricter isolation level is required, and consequently no
serialization-failure retry loop is needed.

*Why state this explicitly:* the retry machinery that stricter isolation demands is a
meaningful amount of code, and it would be written for a failure mode this approach does not
produce.

**Deterministic row ordering.** When an order touches several foods, rows are always processed
in a consistent order, by food id. *Why:* two concurrent orders covering overlapping items
would otherwise be able to lock the same rows in opposite sequences and deadlock.

The same conditional-update pattern is reused for the two other places where concurrent
writers could otherwise conflict: restoring stock on cancellation, and advancing order status
(see [Order Management](#order-management)).

This behaviour must be verified by a test that issues concurrent checkouts against the last
remaining unit and asserts that exactly one succeeds. Reasoning about this code is not
sufficient evidence that it is correct. No such test exists yet.

# Cart

The cart is **stored in PostgreSQL** as server-side state owned by one user, not in browser
storage.

*Why server-side:* the cart survives switching device or clearing browser state, and the server
can re-derive prices and check availability from authoritative data instead of trusting values
the client kept.

**Cart items store quantity only. They never store prices.** Displayed totals are always
computed from the current food price.

*Why:* a price supplied or cached by the client is an opportunity to pay less than the asking
price, and a stale cached price silently misquotes the user.

**The cart does not reserve inventory.** Adding an item to the cart does not hold stock for
that user; availability is confirmed at checkout instead.

*Why:* reservations require expiry handling to release abandoned holds, and they permit an
inventory-denial problem in which filling carts makes stock unavailable to everyone else. The
accepted cost is stated plainly: an item in a cart can sell out before checkout, so the
interface must present that rejection clearly rather than as an unexpected error.

Because an order references exactly one shop, a checkout covers items from exactly one shop.
**The cart is therefore restricted to a single shop at a time**, and carries a shop reference
that is null while it is empty. Adding a food from a different shop is refused rather than
silently accepted; the interface offers to clear the cart and switch shops.

*Why this rather than partitioning at checkout:* a cart spanning several shops makes one
checkout produce several orders, and since a payment record is one-to-one with an order and an
order's idempotency key is unique, one client-supplied key would then no longer identify one
row. Restricting the cart keeps checkout a one-to-one mapping from cart to order, at the cost
of an explicit shop-switching step in the interface.

The accompanying rule — that every cart item's food belongs to the cart's shop — spans two
tables and cannot be expressed as a check constraint. It is a service-layer obligation and a
test, not a database guarantee.

# Checkout and Payment

**Checkout revalidates price and inventory on the server.** Nothing about the money or the
stock position is taken from the request. The server recomputes every line total and the order
total from current food prices and confirms availability at that moment.

**Checkout is idempotent.** The client sends an idempotency key with the checkout request. The
key is stored on the order under a unique constraint, so a retried or double-submitted request
either creates the order exactly once or returns the order already created for that key.

*Why this is mandatory rather than a refinement:* without it, a double-clicked submit produces
two orders and two stock decrements, and because each is individually valid, no constraint
catches the duplicate. It is a correctness requirement, not a convenience.

Checkout runs as a **single database transaction**: revalidate the cart, decrement inventory
using the conditional decrement above, create the order with its snapshotted items and its
shop reference, record the payment, and clear the cart. It either completes fully or leaves no
trace.

*Why one transaction:* the failure mode of a partial checkout is the worst available outcome —
stock consumed with no order, or an order with no stock movement — and it is difficult to
detect after the fact.

**Payment in v1 is simulated, and the simulation lives in one module called by the checkout
service.** There is no payment provider abstraction.

*Why no abstraction:* an interface with exactly one implementation adds indirection to justify
an integration that may never happen. A single well-isolated module is enough, and an interface
can be extracted at the moment a second implementation actually exists.

Because checkout is one transaction, a failed payment rolls the whole transaction back: no
order, no payment row, and stock untouched. Payment rows in v1 therefore record the outcome of
a completed checkout, and the one-to-one relationship with `Order` holds without ambiguity.

**The payment status column holds exactly one permitted value in v1: `SUCCEEDED`.** A failed or
pending payment row is unreachable by construction, so permitting those values would describe
rows this design cannot create. Introducing a real gateway would revisit this alongside the
single-transaction shape.

One structural caveat to be aware of before any real provider is ever introduced: a real
gateway is a network call that cannot live inside a database transaction and may settle after
the HTTP response. Adopting one would require revisiting this single-transaction shape. That is
an accepted consequence of keeping v1 simple, not an oversight.

# Order Management

An order is an immutable record of a completed transaction. Its line items never change after
creation. The only thing that moves is its status.

Status transitions are validated on the server against an explicit set of permitted moves, and
a status value supplied by a client is never applied without that check.

*Why:* without explicit transition rules, an order can be moved into a state that contradicts
its history — for example cancelled after it was fulfilled, which would restore stock that was
genuinely consumed.

**Status changes are applied as a conditional update matching the expected current status.**
Zero rows affected means another actor already moved the order, and the request fails rather
than applying a second transition.

*Why:* comparing the current status in application code and then writing is the same race as
the inventory read-compare-write, and a cancellation applied twice would restock twice.

Cancellation before fulfilment returns stock through the same conditional-decrement path used
to consume it, so inventory movements have one implementation rather than two.

**The authoritative list of order statuses is `PLACED`, `PREPARING`, `READY`, `COMPLETED`, and
`CANCELLED`.** These are the `status` column's permitted values, held as a PostgreSQL enum so
that a value outside the set is rejected by the database rather than by application code alone.

There is deliberately no pre-payment status. Payment is simulated inside the checkout
transaction and a failure rolls that transaction back, so an order exists only once its payment
has succeeded; the list begins after payment rather than before it.

The permitted transitions between these values, who may perform each, and the statuses from
which a cancellation may still restore stock are a remaining decision, and they block this part
of the work.

Inventory movements and status changes are not recorded in audit tables in v1.

# API Architecture

The API is REST over JSON, served under the prefix **`/api/v1`**. Resources are addressed by
plural nouns and acted on with HTTP verbs.

**Successful responses return the resource or collection directly.** There is no success
envelope wrapping every payload.

*Why not:* an envelope adds an unwrapping step at every call site and provides no information
the HTTP status code does not already carry.

**Error responses use one consistent structure.** Every error carries a stable
machine-readable code, a human-readable message, and, for validation failures, per-field
detail. The centralised error handler is the only place that produces it.

*Why a stable code:* the frontend must distinguish "out of stock" from a validation failure in
order to react usefully, and matching on prose is fragile.

**Endpoint families** are grouped so that role middleware attaches once per router rather than
once per handler: authentication, shop and food browsing, cart, orders, and administration.
*Why group by required privilege:* it removes the possibility of forgetting to protect an
individual route.

Collection endpoints are expected to support pagination with a default and a maximum page size.
This is recommended rather than normative for v1.

# Security

The security posture rests on the boundaries described above rather than on any single control.

- **`.env` is never committed.** Credentials and token secrets live only in environment
  variables. `.env` is ignored by version control from the first commit, and `.env.example` is
  committed, documenting required variable names with placeholder values only.
- **The frontend never receives database credentials or JWT secrets.** Nothing in the browser
  bundle can reach the database directly.
- **Passwords** are hashed with bcrypt, never logged, and never returned by any endpoint. A
  minimum password length is enforced by the registration schema.
- **The client cannot assign its own role**, and client-supplied prices, totals, and stock
  figures are never trusted. All are re-derived server-side.
- **Refresh tokens** are `httpOnly` and therefore unreadable by JavaScript; access tokens are
  short-lived and kept in memory.
- **CORS** is an explicit origin allowlist with credentials enabled, not a wildcard, because a
  credentialed cross-origin request requires a named origin.
- **All input is validated** at the API edge before reaching business logic, and request bodies
  are size-limited.
- **Authorization is enforced in the service layer**, closest to the data, and never delegated
  to the client.

**Cross-site request forgery.** Choosing a cookie-borne refresh token introduces CSRF exposure
that a header-carried bearer token does not have. The posture is therefore deliberately narrow:
the refresh endpoint is the **only** cookie-authenticated endpoint, and every other protected
endpoint authenticates from the `Authorization` header, which a cross-site form post cannot
set. The refresh cookie's `SameSite` value is the mitigation for the remaining surface, and it
cannot be chosen until the deployment topology is settled — a same-origin deployment permits
the strictest value, while a cross-origin one does not. This is a remaining decision.

**The bcrypt cost factor** is configured from the environment with a validated minimum, so a
misconfigured low value fails at startup rather than silently weakening every password hash.

Rate limiting, additional security headers, and audit logging are not part of v1. See scope
boundaries.

# Environment Configuration

All configuration comes from the environment. The server validates it at startup with Zod and
refuses to start if anything required is missing or malformed.

Server-side variables include: the pooled database connection string, the direct database
connection string used for migrations, separate secrets for the access and refresh tokens,
token lifetimes, the bcrypt cost factor, the allowed CORS origin, the port, and the environment
name.

*Why separate secrets for the two token types:* with one shared secret, a token issued for one
purpose can be presented for the other, collapsing the distinction between a short-lived and a
long-lived credential.

The frontend receives exactly one variable: the API base URL. A warning that belongs in this
document because it has caused real incidents in other projects: **Vite inlines build-time
environment variables into the browser bundle**, so a secret placed in frontend configuration
is published rather than configured. Only non-sensitive values belong there.

`.env` holds real values and is never committed. `.env.example` lists every required variable
name with a placeholder value and is committed, so that setting up the project does not require
guessing.

Separate database environments are used so that tests can reset data destructively without
affecting development work. The test database is a local PostgreSQL container reached through
`TEST_DATABASE_URL`, which is required by the test suite only and never by the running server. How
many deployed environments exist beyond that remains open.

# Testing Strategy

This section states what testing consists of. Only application bootstrap and the health endpoint
are covered so far; every scenario listed below describes intent rather than existing coverage.

- **Unit tests** for pure logic: total and line-item calculation, order status transition
  rules, and validation schemas. *Why here:* these are fast, deterministic, and cover the
  arithmetic and rule checks where quiet mistakes hide.
- **Integration tests** exercising API routes through the full middleware stack against a real
  PostgreSQL database, with data reset between runs. *Why a real database rather than a mocked
  data layer:* the mechanisms most likely to fail are constraints, transactions, and cascade
  behaviour, and a mock verifies none of them. This is the layer that matters most here.
- **Frontend component tests** are optional in v1, valuable mainly for cart interaction and
  route guards.

Scenarios treated as mandatory rather than optional:

1. Registration always produces `STUDENT` and cannot assign `ADMIN`.
2. A caller cannot read or modify another user's cart or orders.
3. Administrative endpoints reject a `STUDENT` caller, and reject mismatched parent-child
   resource pairs.
4. Checkout ignores a client-supplied price and uses the server-side price.
5. Concurrent checkouts for the last unit of stock result in exactly one success.
6. A repeated checkout with the same idempotency key produces one order, not two.
7. A failed payment leaves no order and no stock movement.
8. An order's line totals sum to its order total and to its payment amount.

**Tooling.** Tests run on Node's built-in runner, `node:test`, and integration tests drive HTTP
with the built-in `fetch` against an application bound to an ephemeral port. Neither requires a
dependency, which is why they were preferred to Vitest and Supertest.

**The test database is a local PostgreSQL container**, separate from development and from
production, so the suite may reset data destructively. `backend/tests/setup.js` reads
`TEST_DATABASE_URL`, refuses any host that is not loopback, and rebinds `DATABASE_URL` before the
application is loaded — so a misconfigured variable cannot quietly point the suite at Supabase.
The container runs the same committed migration as every other environment, which means the test
database exercises the real constraints rather than an approximation of them.

Project documentation must continue to distinguish what is implemented from what is actually
covered by passing tests, and must not imply coverage that does not exist.

# Project Structure

A single repository holding both applications, so that an API change and its frontend consumer
can be reviewed and committed together.

```
scc-delicious/
  frontend/               React + Vite application
    src/
      app/                application shell, providers, router setup
      features/           feature-scoped routes, components, API calls
      components/         shared presentational components
      lib/                Axios instance, helpers
    .env.example          documented variable names, placeholder values
  backend/                Express API
    src/
      config/             environment parsing and validation
      routes/             path + middleware composition
      controllers/        HTTP handling
      services/           business logic, transactions, authorization
      middleware/         auth, validation, error handling
      lib/                shared server utilities
    prisma/               schema and committed migrations
    tests/                unit and integration tests
    .env.example          documented variable names, placeholder values
  docs/                   this document and future design notes
  .cursor/rules/          Cursor rules
  .cursor/skills/         Cursor skills
  .gitignore              ignores every .env from the first commit
  README.md
```

The `backend/` and `frontend/` names are binding rather than cosmetic: the rule globs in
`.cursor/rules/` attach to those paths, so renaming either directory silently detaches its
guardrails from the code inside it. Each application holds its own environment files, because
the two are configured independently and only the backend ever sees a credential.

Migrations are source of truth and are committed. Work proceeds in small, focused commits on
short-lived branches.

# Architectural Constraints

These are normative. They are the rules that future changes are checked against, and they apply
to all code in the repository.

1. There are exactly two application roles: `STUDENT` and `ADMIN`. No customer or shop-owner
   role exists.
2. The database is Supabase PostgreSQL, accessed through Prisma.
3. The backend is Node.js with Express, Prisma, JWT, bcrypt, Zod, CORS, and dotenv.
4. The frontend is React with Vite, React Router, and Axios.
5. The request path is React to Axios to Express to routes to controllers to services to
   Prisma to PostgreSQL.
6. The browser must never connect directly to Supabase.
7. Primary keys are UUIDs.
8. Money is stored as integer minor units.
9. The cart is stored in PostgreSQL.
10. The cart does not reserve inventory.
11. Checkout revalidates price and inventory on the server.
12. Every order contains a direct shop reference, so historical orders stay associated with
    their shop even if a food item is later removed.
13. Order items snapshot food name, unit price, quantity, and line total.
14. Food inventory changes use an atomic conditional decrement.
15. The database enforces `stock_quantity >= 0`.
16. Checkout is idempotent, so retries and double clicks cannot produce duplicate orders.
17. Authentication uses bcrypt password hashing, short-lived JWT access tokens, and a refresh
    token in a secure `httpOnly` cookie; the client cannot assign its own role.
18. Registration creates `STUDENT`. `ADMIN` accounts are created only through a controlled
    mechanism, never public self-registration.
19. Server-side authorization verifies resource ownership.
20. The API is served under `/api/v1`.
21. Controllers contain HTTP concerns only; business logic belongs in services.
22. Database schema changes happen through Prisma migrations.
23. `.env` is never committed; `.env.example` is committed.
24. Features that are not part of the SCC Delicious requirements are not added.

## Scope boundaries for v1

Deliberately excluded, to keep v1 to what it needs. Each can be added later without
restructuring what is described above.

- **A payment provider abstraction.** Payment is simulated in one module. An interface will be
  extracted if and when a second implementation exists.
- **A frontend server-state caching library.** Not needed at this data volume.
- **Request-ID middleware.** Its value is correlating log lines, and no logging service is part
  of v1.
- **Success response envelopes.** Successful responses return the resource directly. The
  consistent *error* structure is kept.
- **Stricter transaction isolation and serialization retry loops.** Unnecessary given the
  conditional-decrement approach.
- **Audit tables** for inventory movements and order status changes.
- **Server-side refresh token persistence**, and therefore true "sign out everywhere". Signing
  out clears the cookie only.
- **Rate limiting, additional security headers, and audit logging.**
- **Per-administrator shop assignment.** `ADMIN` is platform-wide in v1.

# Future Decisions

The following are genuinely undecided. They are recorded so that they are settled explicitly
rather than by accident during implementation. Items that block a specific phase are marked.

**Blocks authentication**

- The controlled mechanism by which `ADMIN` accounts are created.
- Whether the client and API share an origin in production, which fixes the refresh cookie's
  `SameSite` value.

**Blocks order management**

- The permitted status transitions, and who may perform each.
- Whether an order can be cancelled partially or only in full.

**Not blocking**

- The currency. A single currency is assumed and no currency column is included; adding one is
  a small migration.
- Which profile fields beyond sign-in identity a user record holds.
- Whether foods need an availability flag separate from stock quantity.
- Whether shops have a lifecycle or visibility state.
- How food images are stored and served, if at all.
- Where each application is deployed, and the number of database environments.
- Continuous integration setup.

## Resolved since first writing

Recorded here so that a settled decision is traceable rather than only visible in the body of
the document. Each was resolved by the project owner, not assumed during implementation.

- **The cart is restricted to a single shop at a time**, so `Cart` carries a nullable shop
  reference. Previously listed as blocking the database schema. See [Cart](#cart).
- **The order status list is `PLACED`, `PREPARING`, `READY`, `COMPLETED`, `CANCELLED`**, held as
  a PostgreSQL enum. Previously listed as blocking the database schema. See
  [Order Management](#order-management).
- **The payment status list is `SUCCEEDED` alone.** This was never recorded as an open question:
  the column existed with no defined values, which was found during a schema audit. See
  [Checkout and Payment](#checkout-and-payment).
- **Tests run on `node:test`.** Previously listed as blocking the tests. See
  [Testing Strategy](#testing-strategy).
- **The test database is a local PostgreSQL container**, reached through `TEST_DATABASE_URL` and
  migrated with the committed migration. Previously listed as blocking the tests.
- **Integration tests drive HTTP with the built-in `fetch`** against an ephemeral port rather than
  Supertest. This was never recorded as an open question: the architecture required
  full-middleware-stack integration tests without saying what issued the requests, which was found
  during a testing audit.

The permitted transitions between order statuses remain open and are listed above, under order
management.

## Implementation Principle

Implementation will proceed in **small, sequential phases**. A phase is a slice of
functionality small enough to hold in one review.

Each phase is carried out in the same order, and each step is finished before the next begins:

1. **Planned.** The phase's scope, the files it will touch, and the decisions it depends on are
   agreed before any code is written. If a phase depends on an unresolved item from Future
   Decisions, that decision is made first.
2. **Implemented.** Only what the plan describes is built. Unrelated files are not modified,
   and speculative abstractions are not introduced.
3. **Tested.** Tests are written and run for the behaviour the phase adds, including its
   authorization rules and failure paths. A phase's behaviour is not described as working until
   tests for it pass.
4. **Reviewed.** The change is read against this document's constraints and the project rules
   before being accepted.
5. **Committed.** The phase lands as its own focused commit, so history stays readable and any
   individual change can be understood or reverted on its own.

Phases build on each other, so the ordering runs from foundations outward: configuration and
database schema, then authentication, then authorization, then read-only browsing, then cart,
then checkout with inventory and idempotency, then order management. Later phases depend on
earlier ones being complete and verified rather than assumed.

Two commitments follow from this and apply to all future work on the project. Documentation and
status reports must distinguish functionality that has been implemented from functionality that
has actually been tested. And no part of this document may be described as working software
until the phase that builds it has been completed and verified.

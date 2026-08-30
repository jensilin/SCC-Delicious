# SCC Delicious

A full-stack food-ordering application for a campus food court. Students browse shops, build a
cart, and place orders; administrators manage shops, menus, and stock.

**The backend is under active development and the frontend has not been started.** This README
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
| Test database | Local PostgreSQL in Docker, isolated from Supabase |
| Automated tests | **81 tests, 81 passing** |

### Not implemented yet

- Shop and food browsing API
- Cart
- Checkout, inventory decrement, and idempotency
- Orders and order management
- Administration APIs for shops, foods, and stock
- Payment simulation
- Frontend (the `frontend/` directory currently holds only environment templates)

The role middleware is written and unit-tested but is not yet attached to any router, because no
protected resource exists for it to guard. That happens in a later phase.

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

Only the `users` table is exercised by application code so far. The rest exist for phases that have
not been built.

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
| Tests | 81 |
| Passed | 81 |
| Failed | 0 |

Coverage today spans application bootstrap, the health endpoint including its database-failure
path, password hashing, JWT signing and verification, the validation schemas, the role middleware,
and the authentication endpoints end to end over HTTP.

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

Everything below is implemented and covered by tests. Endpoints for the catalogue, cart, orders,
and administration do not exist yet and are not documented here.

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

Successful responses return the resource directly, with no envelope. Errors share one structure —
`{ "error": { "code", "message" } }` — produced only by the central error handler, with a
`details` array of `{ field, message }` added for validation failures:

| Code | Status |
| --- | --- |
| `VALIDATION_ERROR` | `400` |
| `UNAUTHENTICATED` | `401` |
| `INVALID_CREDENTIALS` | `401` |
| `INVALID_REFRESH_TOKEN` | `401` |
| `FORBIDDEN` | `403` |
| `NOT_FOUND` | `404` |
| `EMAIL_ALREADY_REGISTERED` | `409` |
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
- **No administrative resource endpoints exist**, so shops and foods cannot yet be created through
  the API at all.
- **Catalogue browsing is not implemented**, so the API currently exposes no product data.
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
| 3 | Authorization mechanism | **Complete**, awaiting a protected resource to guard |
| 4 | Read-only shop and food browsing | **Next** |
| 5 | Cart | Planned |
| 6 | Checkout with inventory and idempotency | Planned |
| 7 | Order management | Planned |
| 8 | Administration | Planned |
| 9 | Payment simulation | Planned |
| 10 | Frontend | Planned |

The next phase is read-only catalogue browsing. **Its API contract is still being settled** — most
notably whether browsing requires authentication — so no catalogue endpoints are documented above.

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
| `npm test` | 81 tests, 81 passing, 0 failing |
| `prisma validate` | The schema is valid |
| `prisma migrate status` | Database schema is up to date |

`npm test` requires the local test database to be running. The other two read `schema.prisma` and,
for `migrate status`, the configured database; neither modifies anything.

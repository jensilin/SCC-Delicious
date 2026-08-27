# Supabase connections for Prisma migrations

Read this when a migration hangs, times out, fails to acquire a lock, or reports an error that
looks like a connection problem rather than a schema problem.

## Two connection strings, two jobs

SCC Delicious uses Supabase PostgreSQL through two different connection paths:

| Purpose | Variable | Path |
|---|---|---|
| Running application queries | `DATABASE_URL` | Supabase connection pooler, transaction mode |
| Running Prisma migrations | `DIRECT_URL` | Direct database connection |

**Why two.** A pooler in transaction mode multiplexes many clients onto few server connections,
which is what the application wants but breaks migrations: migrations need session-level
operations, advisory locks, and a stable connection for the duration of the change. Direct
connections support that but are limited in number, so they are unsuitable for serving traffic.

The Prisma `datasource` block reads the pooled URL as its `url` and the direct URL as
`directUrl`, so `prisma migrate` and `prisma db push` use the direct connection automatically
while the runtime client uses the pooler. If `directUrl` is missing, migrations run through the
pooler and fail in confusing ways.

## Symptoms and likely causes

**Hangs, then times out; or "could not acquire advisory lock"**
Migration is going through the pooler. Confirm `directUrl` is configured and that `DIRECT_URL`
points at the direct connection, not the pooler port.

**"prepared statement already exists" or similar protocol errors**
Pooled connection used where a session connection is required. Same fix. For the runtime
client, the pooled URL needs the pgBouncer-compatibility parameter.

**"Too many connections" / connection refused under load**
The application is using the direct connection instead of the pooler, or is creating more than
one Prisma client instance. One client instance per process.

**Shadow database errors during `migrate dev`**
`migrate dev` creates and drops a temporary shadow database to detect drift. If the database
user cannot create databases, either grant that ability in a development project or configure
a dedicated shadow database URL. Do not work around it by switching to `db push`, which skips
migration history entirely.

**Everything fails, including psql**
A paused free-tier Supabase project. Resume it and retry before debugging anything else.

## Rules that always apply

- Never print, echo, or paste a connection string anywhere. It contains the database password.
- Never commit `.env`. Keep `.env.example` populated with variable names and placeholders.
- Never point a development or test command at the production database. Destructive commands
  (`migrate reset`, `db push --force-reset`) must only ever touch a database whose loss is
  acceptable.
- Tests need a database that can be reset destructively, which means a separate database from
  the one used for development.

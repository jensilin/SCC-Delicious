---
name: database-migration
description: Guides a safe Prisma schema change for SCC Delicious against Supabase PostgreSQL, covering planning, inspecting the current schema and applied migrations, creating the migration, regenerating the client, updating services, validation and tests, and verifying with real evidence. Use when changing schema.prisma, adding or altering a table, column, relation, enum, index or constraint, when a migration fails or drift is reported, or when the user mentions Prisma migrate, database schema changes, or Supabase schema. Assumes an existing Prisma schema and migration history; see Preconditions.
disable-model-invocation: true
---

# Database Migration (SCC Delicious)

A schema change is six distinct pieces of work: planning, schema modification, migration
creation, application changes, test changes, and verification. Do them in order. Do not
collapse them.

## When to use this skill

- Adding, altering, renaming, or removing a model, field, relation, enum, index, or constraint.
- Changing anything touching money, inventory quantity, or order history.
- A migration failed, was partially applied, or drift was reported.

Not needed for: reading data, writing queries against the existing schema, or seed-content-only
changes that add no schema. Not applicable to initial Prisma setup or authoring the first
schema — see Preconditions.

## Project constraints this workflow must respect

The data invariants and standing prohibitions for this project live in
`.cursor/rules/database.mdc`, which is the authoritative source. Read it before Phase 2 and do
not restate or reinterpret it here. For how each invariant is enforced and what counts as
verifying it, see [references/invariants.md](references/invariants.md).

One clarification specific to this workflow: "never modify a migration" means never modify an
**already-applied** one. Editing a migration Prisma has just generated but not yet applied is
correct and is sometimes required — see Phase 3.

And one rule this workflow adds: **never treat generated files as proof of success.** See
Phase 7.

## Running commands

Use the project's own Prisma dependency, not whatever version happens to be installed
globally. Either a script defined in `backend/package.json`, or:

```bash
npx --no-install prisma <command>
```

`--no-install` uses the local install and fails loudly instead of silently fetching a different
version. Commands below are written as `prisma ...`; run them through the project's tooling from
the `backend/` directory.

## Command safety

Read this before running anything in Phase 3 or Phase 7.

- **`prisma migrate dev` is intended for a local development database only.** It may create and
  drop a shadow database, and when it detects drift or a failed migration it may propose
  resetting the database, which destroys all data in it. Never point it at a shared, staging, or
  production database.
- **If Prisma reports drift, or proposes resetting the database: STOP.** Do not accept the
  reset. Report exactly what Prisma said and diagnose the cause first. Drift means the database
  and the migration history disagree; a reset hides that instead of explaining it, and the same
  cause will usually recur on the next migration.
- **`prisma migrate reset` drops and recreates the database.** Never run it against a shared,
  staging, or production database — only against a local database whose data is disposable.
- **`prisma migrate deploy` is the only apply command for non-development environments.** It
  applies pending migrations and never resets.
- **`prisma migrate resolve` rewrites Prisma's record of which migrations were applied; it does
  not change the database.** Used with the wrong flag it makes the migration history lie about
  the real state of the database, which is harder to recover from than the failure it was meant
  to fix. Do not use it casually. Inspect the database and establish what was actually applied
  first, and never use it against a shared or production database without a known recovery
  position.

## Preconditions

Check both before starting Phase 1. Create nothing that is missing.

1. `backend/prisma/schema.prisma` exists.
2. `backend/prisma/migrations/` exists.

If either is missing, stop and state exactly this:

> This is initial Prisma schema/setup work, not a database migration. Stop this Skill and use
> the appropriate initial-schema/setup workflow instead.

Do not create the schema file, create the migrations directory, initialize Prisma, or run any
Prisma command in order to satisfy a precondition. A missing baseline is not an obstacle to work
around — it means there is nothing to migrate from, so this workflow does not apply and its
verification steps cannot produce meaningful evidence.

If both exist, continue to Phase 1.

## Phase 1 — Planning (change no files)

Start only after both preconditions pass.

1. State the change in one sentence, including why.
2. Read `backend/prisma/schema.prisma` in full. Do not work from memory of it.
3. List the applied migrations in `backend/prisma/migrations/` to see what has already shipped.
4. Map affected relationships: every model with a relation to the one being changed, and the
   delete behaviour on each side.
5. Identify affected application code: services, validation schemas, seeds, and tests.
6. Assess existing data and backward compatibility:
   - Is the change additive, or does it drop or narrow something?
   - Will it fail against rows that already exist (a new non-null column, a new unique index,
     a tightened type)?
   - Does any deployed code read or write what is changing?
7. For anything non-additive, plan it as expand then contract: add the new nullable column or
   table, backfill, switch the code over, then tighten or remove in a later migration.
8. **Renames are dangerous.** Prisma may interpret a rename as a drop plus an add, which
   destroys the column's data. Inspect the generated SQL before applying, and prefer
   `--create-only` for renames.
9. **Establish the recovery position before any destructive or tightening change** — dropping a
   column or table, adding `NOT NULL` or a unique constraint, changing a type, or backfilling.
   Confirm that a current backup or point-in-time recovery exists for the target database and
   that restoring it is understood. If the target is a local database rebuildable from
   migrations and seeds, state that instead. Do not start a destructive migration with an
   unknown recovery position.
10. Write the plan down and agree it before editing files. If the change depends on an
    unresolved decision in `docs/ARCHITECTURE.md`, resolve that first.

## Phase 2 — Schema modification

Edit only `backend/prisma/schema.prisma`, and make one logical change per migration.

- Declare relations explicitly, with the intended `onDelete` behaviour.
- Add the indexes the new access path needs in the same change, not later.
- Prisma schema cannot express a `CHECK` constraint. If the change needs one, plan to add it as
  raw SQL in Phase 3.
- Check the edit against `.cursor/rules/database.mdc` before moving on.

## Phase 3 — Migration creation

Re-read **Command safety** above first. Run from the `backend/` directory.

Migrations must use the direct database connection, not the pooled one. If a migration hangs,
fails to acquire a lock, or reports a prepared-statement error, the pooled URL is the first
thing to check. See [references/supabase-connections.md](references/supabase-connections.md).

Standard case, against a local development database:

```bash
prisma migrate dev --name descriptive_snake_case_name
```

If this proposes a reset or reports drift, stop and diagnose rather than accepting it.

When hand-written SQL is required — a check constraint, a safe rename, a backfill, a concurrent
index:

```bash
prisma migrate dev --create-only --name descriptive_snake_case_name
# edit the generated SQL in backend/prisma/migrations/<timestamp>_<name>/migration.sql
prisma migrate dev
```

Read the generated SQL before applying it, every time. This is the only moment where editing
migration SQL is correct, because the migration has not been applied yet.

For non-development environments, apply with `prisma migrate deploy`.

Convention: the schema change and its migration directory belong in the same commit, so that no
commit contains one without the other.

## Phase 4 — Regenerate the Prisma client

```bash
prisma generate
```

`migrate dev` usually does this, but run it explicitly after `--create-only` edits, after
pulling someone else's migration, or whenever type errors look inconsistent with the schema. A
stale client produces errors that appear to come from the schema change but do not.

## Phase 5 — Application changes

- Business logic changes go in services. Controllers stay HTTP-only. Routes change only if the
  API surface changed.
- Update Zod validation at the API boundary if the accepted input changed. Validation belongs
  at the boundary, not inside services.
- Reuse existing services and utilities. Do not create a second module that does what an
  existing one does.
- Update seed or factory data so the development database still builds.

Only if the change touches inventory, orders, or money: re-read the affected service against
`.cursor/rules/database.mdc` before finishing, since a schema change is a common opportunity to
weaken the transaction boundary or the conditional decrement by accident.

## Phase 6 — Test changes

- Update or add integration tests that run against a real PostgreSQL database.
- Cover the failure paths the change introduces, including any newly rejected input.
- If the change touches money, inventory, or orders, the relevant invariant tests must be
  updated or confirmed still passing — not merely a test that the new column exists.

## Phase 7 — Verification (mandatory)

**Prisma generating files is not evidence that anything works.** The change is not done until
each applicable check below has actually been run and its output read:

```
- [ ] prisma migrate status        -> no pending, no failed migration
- [ ] drift check (see below)      -> no differences
- [ ] prisma generate              -> succeeds
- [ ] typecheck / lint             -> clean
- [ ] test suite                   -> runs, and the schema-relevant tests pass
- [ ] constraint behaviour         -> a violating write is rejected (if one was added)
- [ ] affected endpoints exercised -> observed working, not assumed
```

Mark a check "not applicable" only with a reason. Never tick one that was not run.

### Drift check

```bash
prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma \
  --exit-code
```

Both sides point at the same file deliberately: `--from-schema-datasource` reads its
`datasource` block to inspect the live database, and `--to-schema-datamodel` reads its models.
The command compares the database against the schema.

Distinguish the two failure kinds, because they need opposite responses:

- **Exit code 2 — differences found.** The database and the schema disagree. This is a real
  drift finding. Diagnose the cause before continuing, and do not paper over it with a new
  migration.
- **Exit code 1 — the command itself failed.** Nothing was compared, so this is *not* evidence
  of drift and also not evidence of its absence. Usual causes are connection or configuration
  problems; see [references/supabase-connections.md](references/supabase-connections.md). Fix
  the command, then run the check again and record the real result.
- **Exit code 0** — no differences.

Treating a failed command as a clean result is the most likely way to report a migration as
verified when it is not.

### Constraint verification

If the change added a constraint, verify it by attempting a write that should be rejected and
confirming the database rejects it. A constraint that exists in the migration file but was never
exercised has not been verified.

### Reporting

Name the commands run and what they returned. State plainly which checks were not run. Do not
describe the change as tested or working on the strength of generated files, and do not describe
functionality as implemented if it is not.

## If a migration fails

- Do not edit the failed migration. Diagnose first with `prisma migrate status`.
- A partially applied migration must be resolved deliberately: either rolled forward with a
  corrective migration, or reconciled with `prisma migrate resolve` after establishing what the
  database actually contains. Re-read the `migrate resolve` warning in **Command safety** before
  using it. Never leave the migration history and the database disagreeing.
- Connection-level failures are usually configuration, not schema. See
  [references/supabase-connections.md](references/supabase-connections.md).

## Progress checklist

Copy and track:

```
- [ ] Phase 1  Plan agreed; schema and migrations read; data impact and recovery position known
- [ ] Phase 2  schema.prisma edited; one logical change
- [ ] Phase 3  Migration generated; SQL reviewed; applied without accepting a reset
- [ ] Phase 4  Prisma client regenerated
- [ ] Phase 5  Services and validation updated
- [ ] Phase 6  Tests updated
- [ ] Phase 7  Verification run, with observed output
```

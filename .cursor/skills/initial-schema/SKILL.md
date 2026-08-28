---
name: initial-schema
description: Establishes the first Prisma schema and initial migration for SCC Delicious against Supabase PostgreSQL, covering requirements decisions, entity and relationship design, nullability, uniqueness, defaults and delete behaviour, database-level invariants, the initial migration, and verification with observable evidence. Use when no migration history exists yet — creating schema.prisma for the first time, running the first migration, or bootstrapping the database — and also to diagnose a pre-baseline repository holding only one of the two artifacts. For any change after the baseline exists, use the database-migration skill instead.
disable-model-invocation: true
---

# Initial Schema (SCC Delicious)

Establishes the baseline: the first `schema.prisma` and the first migration. Executes in full
**once** in the life of the repository; otherwise it only diagnoses and reports.

## Boundary with database-migration

| | initial-schema | database-migration |
|---|---|---|
| Precondition | no migration history — whether or not a schema file exists | schema **and** migration history both exist |
| Produces | the baseline, or a diagnosis of a broken pre-baseline state | a change to the baseline |
| Runs | once | every subsequent change |

Once a baseline exists, drift, failed or partially applied migrations, `migrate resolve`, reset
recovery, and every later schema change belong to `database-migration`. This skill's only
responsibility before a baseline exists is to produce one, or to report why it cannot. Once the
baseline exists and is verified, this skill is finished and must not be used again.

## Preconditions

Establish the repository state first, then run the remaining checks. Create nothing, and run no
command that writes.

### Repository state

Determine which of these four states the repository is in. They are mutually exclusive and
exhaustive — exactly one applies. Each branch ends in either proceeding or reporting, never in
forwarding the work to a skill whose own preconditions would send it back.

**A — `backend/prisma/schema.prisma` absent and `backend/prisma/migrations/` absent.**
This is the clean initial-schema state, and the only one this skill executes in. Continue to the
remaining checks below, then to Phase 1.

**B — both exist.** Stop and state exactly this:

> A baseline already exists: both the Prisma schema and the migration history are present.
> Initial schema work is finished for this repository. Every subsequent schema change belongs to
> the database-migration skill.

**C — `schema.prisma` exists, `migrations/` absent.** This skill owns this state. Do not hand it
to `database-migration`: with no migration history there is nothing to migrate from, so its
workflow cannot apply and its verification cannot produce meaningful evidence. Stop and report an
**unfinished initial-schema baseline** — a schema was authored but never migrated, most often an
interrupted first attempt. Do not create the migrations directory. Do not generate a migration
until it is confirmed who authored the schema, whether it was ever applied to any database, and
whether its contents are trustworthy as the baseline.

**D — `schema.prisma` absent, `migrations/` exists.** This skill owns the diagnosis. Do not hand
it to `database-migration`. Stop and report an **inconsistent repository state** — migration
history without the schema it was generated from, typically a deleted file, an incomplete
checkout, or a partial revert. Do not create `schema.prisma` to fill the gap: a reconstructed
schema would silently disagree with the migrations already applied. Do not generate or modify any
migration. Recovering the real schema file is a prerequisite to any further work, not a step in
this skill.

### Remaining checks — state A only

Run them in this order. It is not arbitrary: the first two are purely local, and the third
cannot be performed until the first has confirmed that a connection is configured.

1. **The backend Node and Prisma tooling is initialized.** Confirm all four:
   - `backend/package.json` exists
   - `prisma` is installed as a local dependency or dev dependency of that project
   - the Prisma Client dependency is present
   - the pooled and direct database connection variables are configured in the environment —
     confirm they are set, without printing their values

   If any is missing, **stop** and state that initializing the Node and Prisma project is
   prerequisite setup work, not part of establishing the schema. Report exactly what is missing.
   Do not run `npm init`. Do not run `npm install`. Do not create `schema.prisma`. Do not create
   the migrations directory. Do not run any Prisma command.

   This check gates Phase 4, and that ordering is the point: a `schema.prisma` written into a
   project with no Prisma dependency cannot be migrated, and leaving it behind puts the
   repository into state C above — an unfinished baseline this skill will then refuse to continue
   from. Stopping here costs a sentence; stopping after Phase 4 costs a cleanup.
2. **The backend directory name matches the globs in `.cursor/rules/`.** The schema must live
   where `database.mdc` expects it, or the database rules will never attach to it and every
   later change loses its guardrails. If the repository's layout and the rule globs disagree,
   stop and resolve that first — it is a one-line fix before the schema exists and an
   invasive one afterwards.
3. **The target database contains no application tables.** This check comes last because it
   needs the connection configuration confirmed in check 1; attempting it first turns an
   uninitialized project into a misleading connection failure. If application tables are found,
   this is adopting an existing database rather than creating a baseline — a different task with
   different risks. Stop and report what was found rather than migrating over it. Note the
   converse is not implied: an empty database is not necessarily a disposable one, which is why
   Phase 5 confirms the connection target separately.

## Separation of concerns

Keep these six distinct. Confusing them is how invariants end up stated but unenforced.

| Concern | Answers | Lives in | In this skill? |
|---|---|---|---|
| Requirements decisions | what the product needs | requirements and `docs/ARCHITECTURE.md` | consumed, never invented |
| Schema design | tables, columns, relations, types | `schema.prisma` | yes — Phase 4 |
| Database enforcement | what cannot be violated | constraints in the migration | yes — Phases 4 and 5 |
| Application enforcement | what code must uphold | services, later phases | identified, not implemented |
| Testing | proof behaviour holds | test suite | baseline tests only |
| Verification | evidence it actually works | observed command output | yes — Phase 8 |

A rule that can be a constraint should be a constraint. A rule that cannot must be recorded as
an application obligation and a test, not left implicit.

## Phase 1 — Read the authoritative sources

Read, do not recall:

- `docs/ARCHITECTURE.md` — the database architecture section, the core entity list, the
  relationships, the cross-cutting data decisions, and **Future Decisions**.
- `.cursor/rules/database.mdc` — the data invariants and prohibitions. Authoritative.
- `.cursor/rules/backend.mdc` and `.cursor/rules/project.mdc` — layering and general
  constraints.

Where this skill and those documents disagree, they win. Do not restate their contents here.

## Phase 2 — Requirements decisions

The baseline encodes product decisions. It must not invent them.

1. Take the entity list from `docs/ARCHITECTURE.md`. It is authoritative. An entity not present
   there and not present in the requirements does not go in the schema.
2. Take the relationships and the stated delete behaviour from the same document.
3. Check every item under the **"Blocks the database schema"** heading in Future Decisions.
   Each one must be resolved before Phase 4, because each determines a column or a table.
   These are product decisions, and they are resolved by the user or the requirements owner —
   never by the Agent. Selecting an answer in order to keep moving is not resolution, however
   plausible or obvious the answer looks. An unresolved blocking decision is a hard stop.
4. If a needed detail is absent, ambiguous, or contradicted, **stop** — see Stopping rules.

Record which decisions were resolved and by whom before continuing.

## Phase 3 — Field and relation decisions

Decide these explicitly for every column and relation, and write the reason down. Silence here
becomes an accidental default in the database.

**Nullability.** Default to nullable unless the value is genuinely required at insert time. A
non-null column with no natural value invites a fabricated placeholder, which is worse than an
honest null.

**Uniqueness.** Add a unique constraint only where the domain requires it. Note that PostgreSQL
permits multiple nulls under a unique index, so unique-and-nullable is coherent. Every unique
constraint is also a future migration hazard once data exists.

**Defaults.** A default must be a true statement about a row that omits the value. Never use a
default to make a non-null column tolerable.

**Delete behaviour.** Declare it on every relation. Cascades are appropriate for transient
working state and unacceptable for historical records — a relation that can reach a historical
row must not cascade. Where a referenced row may disappear while the referring row must
survive, the reference is nullable and the surviving row carries its own copies of what it
needs.

**Indexes.** Add the indexes the documented access paths require, in this same migration.

## Phase 4 — Design schema.prisma

Write `backend/prisma/schema.prisma`. One file, one coherent baseline.

- Configure the datasource with both the pooled connection for the application and the direct
  connection for migrations.
- Use consistent naming, and map field names to column names consistently with the documented
  schema sketch.
- Types must satisfy the invariants in `database.mdc` — check the edit against it before
  continuing.
- **Prisma schema cannot express a `CHECK` constraint.** List every check the invariants require
  now; they are added as raw SQL in Phase 5. A check constraint that is only described in a
  document is not enforcement.

## Phase 5 — Create the initial migration

Use the project's own Prisma dependency, via a `backend/package.json` script or
`npx --no-install prisma <command>`, run from `backend/`. Migrations use the direct connection,
not the pooled one.

### Confirm the target database first

Do this before the first Prisma command that connects to a database — including
`prisma migrate dev --create-only`, which despite its name still connects, and may create and
drop a shadow database. There is no file-only step to hide behind. Confirm and state:

- which database the direct Prisma connection actually resolves to — host, port, database name
- which environment that database represents
- that this is the database expected for this initial-schema operation
- whether it holds any unexpected data or objects unrelated to this project

Read the resolved target rather than assuming the intended one, and never print credentials while
doing so. A stale or inherited environment variable is exactly how a first migration lands
somewhere it should not. If the target is unexpected, or if any of these four points cannot be
answered with certainty, **stop**.

Because the baseline needs raw SQL for its check constraints, generate before applying:

```bash
prisma migrate dev --create-only --name init
# add the CHECK constraints and any other unsupported SQL to
# backend/prisma/migrations/<timestamp>_init/migration.sql
prisma migrate dev
```

Safety, even on a first migration:

- Target a **local development database** only. `prisma migrate dev` may create and drop a
  shadow database and may propose resetting.
- If Prisma proposes a reset or reports drift on what should be an empty database, **stop** —
  on a baseline that means the database is not in the state the preconditions assumed.
- Apply to non-development environments with `prisma migrate deploy`, never `migrate dev`.
- **`prisma migrate reset` must never be run against a shared, staging, or production
  database.** It drops and recreates everything, and there is no undo.
- **`prisma migrate reset` must never be used as automatic recovery for a failed first
  migration.** A failed baseline is a diagnosis task: read the error, establish what was actually
  applied, and report. Resetting destroys the evidence needed to explain the failure, and the
  same fault will recur on the next attempt.
- Before considering any destructive recovery action, confirm the connection target and
  environment again, as above. The absence of application tables is **not** sufficient evidence
  that a database is disposable — an empty shared or staging database is still shared.

Convention: when a commit is made, `schema.prisma` and the generated migration directory belong
in the same one. Creating that commit is not part of this skill — do not commit unless asked.

## Phase 6 — Review the generated SQL

Read the migration SQL before treating it as done. Confirm, item by item:

- every intended table exists, and no unintended one does
- every foreign key carries the delete behaviour decided in Phase 3
- every unique constraint and index from Phase 3 is present
- every check constraint from Phase 4 is present
- nothing drops anything

This is the last cheap moment to catch a wrong delete rule. After data exists, correcting one
is a migration with a data-loss risk.

## Phase 7 — Generate the Prisma client

```bash
prisma generate
```

Confirm the generated types match the schema. A stale client produces errors that look like
schema faults but are not.

## Phase 8 — Verify the resulting database

**Generated files are not evidence.** The baseline is not established until each check has been
run and its output read:

```
- [ ] prisma migrate status     -> one applied migration, none pending, none failed
- [ ] tables present            -> every entity exists in the database, not just the schema
- [ ] check constraints         -> a violating write is actually rejected
- [ ] delete behaviour          -> deleting a parent behaves as designed, including that
                                   historical rows survive with their copied values
- [ ] unique constraints        -> a duplicate is actually rejected
- [ ] prisma generate           -> succeeds; where a typecheck is configured, the project
                                   typechecks
```

Mark a check "not applicable" only with a reason. Never tick one that was not run.

If test tooling has not yet been selected — check Future Decisions — verify by direct database
interaction instead, and record that the checks were manual and no automated test yet covers
them. Do not skip verification because the test suite does not exist, and do not describe
manual checks as tests.

## Phase 9 — Record evidence

Write down, in the change summary — or in the commit message body if a commit is made:

- the commands run and what each returned
- which invariants are enforced by a database constraint, naming it
- which invariants remain application obligations with no database enforcement
- which checks were manual, and which are covered by an automated test
- each decision that was resolved: what it was, who resolved it, and what it was resolved to

Do not add claims to documentation that this evidence does not support. Implemented and tested
are different states and must be reported differently.

## Stopping rules

Stop and report rather than proceeding when:

- the repository is not in state A, or any remaining precondition check fails
- the database the direct connection resolves to is unexpected, or cannot be confirmed
- an item under "Blocks the database schema" in Future Decisions is unresolved, or was resolved
  by the Agent rather than by the user
- an entity, field, or relationship is needed that no repository artifact describes
- two artifacts contradict each other on a schema-affecting point
- an invariant cannot be enforced in the database and no application owner for it is identified
- Prisma proposes a reset, or the database is not empty

Inventing a requirement to keep moving is the most expensive failure available here: the guess
becomes a table, the table gets data, and correcting it becomes a migration instead of a
conversation.

## Handoff

The baseline is complete when Phase 8 passes and Phase 9 is recorded. From that point every
schema change uses `database-migration`, whose preconditions this work has now satisfied.

## Progress checklist

```
- [ ] Preconditions  State A confirmed and all remaining checks passed; nothing created
- [ ] Phase 1  Architecture and rules read
- [ ] Phase 2  Entities and relationships taken from artifacts; blocking decisions user-resolved
- [ ] Phase 3  Nullability, uniqueness, defaults, delete behaviour decided with reasons
- [ ] Phase 4  schema.prisma written; required CHECK constraints listed
- [ ] Phase 5  Connection target confirmed; migration generated with raw SQL added, then applied
- [ ] Phase 6  Generated SQL reviewed item by item
- [ ] Phase 7  Prisma client generated
- [ ] Phase 8  Database verified with observed output
- [ ] Phase 9  Evidence recorded, including what is not enforced or not tested
```

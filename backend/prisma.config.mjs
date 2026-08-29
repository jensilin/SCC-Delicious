import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { defineConfig, env } from "prisma/config";

// Prisma 7 does not load .env by itself, so this file does it. The path is resolved from this
// file's own location rather than the working directory, so a Prisma command run from the
// repository root reads the same backend/.env as one run from backend/. dotenv also strips the
// carriage returns that backend/.env carries from Windows, which shell-sourcing the file does
// not — a trailing \r inside a connection URL fails in ways that look like a credential problem.
loadEnv({
  path: path.join(path.dirname(fileURLToPath(import.meta.url)), ".env"),
  quiet: true,
});

// Prisma 7 reads the CLI's database connection from here rather than from schema.prisma.
//
// The URL below must be the session-mode connection (DIRECT_URL), not the transaction pooler
// the application runs on: migrations need session-level operations and an advisory lock, which
// transaction pooling on port 6543 cannot provide.
//
// No shadowDatabaseUrl is set. The initial migration is generated with
// `migrate diff --from-empty` and applied with `migrate deploy`, and neither command uses a
// shadow database.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DIRECT_URL"),
  },
});

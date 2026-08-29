const path = require("node:path");

const { config: loadEnv } = require("dotenv");
const { z } = require("zod");

// The path is resolved from this file rather than the working directory, so a server started from
// the repository root reads the same backend/.env as one started from backend/. dotenv also strips
// the carriage returns backend/.env carries from Windows, which shell-sourcing does not.
loadEnv({
  path: path.join(__dirname, "..", "..", ".env"),
  quiet: true,
});

// DIRECT_URL is deliberately not part of this schema. It is the session connection Prisma's CLI
// uses for migrations, and application queries belong on the pooled DATABASE_URL; validating it
// here would invite runtime code to reach for it.
//
// The token, token-lifetime, and bcrypt variables are also absent for now. They are still
// placeholders in .env, and requiring them before authentication exists would stop the server
// from starting for a feature that has not been built. The authentication phase adds them here.
const environmentSchema = z.object({
  DATABASE_URL: z
    .string()
    .min(1)
    .regex(/^postgres(ql)?:\/\//, "must be a postgres:// connection string"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  CORS_ORIGIN: z.string().min(1),
});

const result = environmentSchema.safeParse(process.env);

if (!result.success) {
  // Only variable names and the expectation they failed are reported. A message carrying the
  // offending value would write a connection string into the logs of every misconfigured start.
  const problems = result.error.issues
    .map((issue) => `${issue.path.join(".")} (${issue.message})`)
    .join(", ");

  throw new Error(`Invalid or missing environment variables: ${problems}`);
}

module.exports = { env: result.data };

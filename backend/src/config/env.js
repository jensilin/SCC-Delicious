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

// The lifetimes jose accepts and the cookie's Max-Age is derived from: a whole number of seconds,
// minutes, hours, or days.
const timeSpan = /^\d+[smhd]$/;

const environmentSchema = z
  .object({
    DATABASE_URL: z
      .string()
      .min(1)
      .regex(/^postgres(ql)?:\/\//, "must be a postgres:// connection string"),
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(3000),
    CORS_ORIGIN: z.string().min(1),

    // A shorter secret than the 256-bit key HS256 derives would weaken every token silently, so
    // the length is a startup condition rather than a convention.
    JWT_ACCESS_SECRET: z.string().min(32, "must be at least 32 characters"),
    JWT_REFRESH_SECRET: z.string().min(32, "must be at least 32 characters"),

    ACCESS_TOKEN_TTL: z.string().regex(timeSpan, 'must be a time span such as "15m"'),
    REFRESH_TOKEN_TTL: z.string().regex(timeSpan, 'must be a time span such as "7d"'),

    // The floor is architectural, not arbitrary: a cost low enough to be fast is low enough to
    // brute-force, and 31 is bcrypt's own ceiling.
    BCRYPT_COST: z.coerce.number().int().min(12, "must be at least 12").max(31),
  })
  .refine((value) => value.JWT_ACCESS_SECRET !== value.JWT_REFRESH_SECRET, {
    message: "must differ from JWT_ACCESS_SECRET, or a refresh token could be presented as an access token",
    path: ["JWT_REFRESH_SECRET"],
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

const { z } = require("zod");

const { MAX_PASSWORD_BYTES } = require("../lib/password");

// Lower-cased here, at the edge, so that every consumer downstream — storage, lookup, uniqueness —
// sees the same form and one person cannot end up with two accounts differing only in case.
// Trimming first means a copied address with a trailing space is accepted rather than rejected as
// malformed.
const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, "must be at most 254 characters")
  .pipe(z.email("must be a valid email address"));

// Length is the only rule. Composition requirements are deliberately absent; the upper bound is
// bcrypt's 72-byte input limit rather than a policy choice, and is measured in bytes because a
// multi-byte character costs more than one.
const passwordSchema = z
  .string()
  .min(8, "must be at least 8 characters")
  .refine(
    (value) => Buffer.byteLength(value, "utf8") <= MAX_PASSWORD_BYTES,
    `must be at most ${MAX_PASSWORD_BYTES} bytes`,
  );

// role is absent on purpose, and Zod strips unknown keys, so a request carrying one is accepted and
// the field is discarded before any code can read it. The server assigns the role unconditionally.
const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

// Sign-in checks only that a password was supplied. Applying the registration rules here would
// reject an existing password after the policy tightened, and would let a caller infer the policy
// from which inputs are refused before authentication.
const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "is required"),
});

module.exports = { loginSchema, registerSchema };

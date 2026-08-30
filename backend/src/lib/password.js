const bcrypt = require("bcrypt");

const { env } = require("../config/env");

// bcrypt ignores everything past the 72nd byte of a password. Left unchecked, two different long
// passwords sharing a 72-byte prefix would be interchangeable at sign-in, so the registration
// schema rejects anything longer instead of hashing a silently truncated value.
const MAX_PASSWORD_BYTES = 72;

async function hashPassword(plainPassword) {
  return bcrypt.hash(plainPassword, env.BCRYPT_COST);
}

// Returns false for a wrong password and throws only if the stored hash is unreadable. bcrypt's
// own comparison is used rather than hashing and comparing strings, because it reads the cost and
// salt out of the stored hash and compares in constant time.
async function verifyPassword(plainPassword, passwordHash) {
  return bcrypt.compare(plainPassword, passwordHash);
}

module.exports = { MAX_PASSWORD_BYTES, hashPassword, verifyPassword };

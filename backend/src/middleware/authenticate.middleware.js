const { httpError } = require("../lib/http-error");
const { verifyAccessToken } = require("../lib/token");

// A missing token, a malformed one, a forged one, and an expired one all answer the same way. The
// client's only useful reaction is to refresh once and then sign in, and naming the specific fault
// tells an attacker which part of a guess was right.
function unauthenticated() {
  return httpError(401, "UNAUTHENTICATED", "Authentication required");
}

// The scheme name is matched case-insensitively because RFC 7235 defines it that way.
const bearerScheme = /^Bearer +/i;

async function authenticate(request, response, next) {
  const header = request.get("authorization");

  if (!header || !bearerScheme.test(header)) {
    next(unauthenticated());
    return;
  }

  try {
    const payload = await verifyAccessToken(header.replace(bearerScheme, ""));

    // A token that verifies but carries neither claim cannot identify or authorise anyone. It
    // should be unreachable, and is rejected rather than allowed to become undefined downstream.
    if (!payload.sub || !payload.role) {
      next(unauthenticated());
      return;
    }

    // Identity for the request, taken from the signature-verified token and never from input.
    // Services still scope their queries by userId; this is the value they scope on.
    request.auth = { userId: payload.sub, role: payload.role };

    next();
  } catch {
    next(unauthenticated());
  }
}

module.exports = { authenticate };

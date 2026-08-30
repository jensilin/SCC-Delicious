const { httpError } = require("../lib/http-error");

// The coarse half of authorization: whether this role may perform this class of action at all.
// It is mounted once per router rather than per handler, so a new route inside a protected router
// cannot be left unguarded by omission.
//
// It never answers "may this caller act on this record?" — that question needs the record, and is
// answered in the service layer by scoping the query to the caller.
function requireRole(...allowedRoles) {
  return function requireAllowedRole(request, response, next) {
    // Reachable only if this middleware is mounted without authenticate before it, which is a
    // wiring mistake rather than a client error. Refusing is the safe reading of an unknown caller.
    if (!request.auth) {
      next(httpError(401, "UNAUTHENTICATED", "Authentication required"));
      return;
    }

    if (!allowedRoles.includes(request.auth.role)) {
      next(httpError(403, "FORBIDDEN", "You do not have permission to perform this action"));
      return;
    }

    next();
  };
}

module.exports = { requireRole };

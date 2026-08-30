const { httpError } = require("../lib/http-error");

// Turns Zod's issue list into the per-field detail the error contract promises. The message is
// Zod's own, so the rule that failed is named rather than described generically.
function toDetails(error) {
  return error.issues.map((issue) => ({
    field: issue.path.join("."),
    message: issue.message,
  }));
}

// Accepts any request property carrying input — body, params, query, headers — and validates the ones
// given. Header names arrive lowercased from Node, so a header schema declares them in that form.
//
// Express 5 exposes request.query through a getter with no setter, so parsed values are collected
// on request.validated instead of overwriting the originals. Handlers read request.validated.body
// rather than request.body, which also makes it visible at a glance whether a handler is reading
// checked input or raw input.
function validate(schemas) {
  return function validateRequest(request, response, next) {
    const validated = {};

    for (const [source, schema] of Object.entries(schemas)) {
      const result = schema.safeParse(request[source]);

      if (!result.success) {
        next(httpError(400, "VALIDATION_ERROR", "Request validation failed", toDetails(result.error)));
        return;
      }

      validated[source] = result.data;
    }

    request.validated = validated;

    next();
  };
}

module.exports = { validate };

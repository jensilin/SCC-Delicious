// The only place an error response is shaped, so every client sees one structure regardless of
// where the failure happened. Express recognises an error handler by its four parameters.
function errorHandler(error, request, response, next) {
  // Once a response has started there is nothing left to shape, and writing again would corrupt
  // it. Express's default handler closes the connection instead.
  if (response.headersSent) {
    next(error);
    return;
  }

  const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 500;
  const isClientError = statusCode >= 400 && statusCode < 500;

  if (!isClientError) {
    console.error("Unhandled error", error);
  }

  const body = {
    error: {
      code: error.code ?? (isClientError ? "BAD_REQUEST" : "INTERNAL_ERROR"),
      // A 5xx message is replaced rather than forwarded: it can carry a connection string, a file
      // path, or SQL. Deliberate client errors carry a message written to be read by the client.
      message: isClientError
        ? error.clientMessage ?? error.message
        : "Internal server error",
    },
  };

  // Per-field detail exists for validation failures, where "which field" is the whole point. It is
  // attached only to client errors, so a 5xx cannot smuggle internals out through a second field.
  if (isClientError && Array.isArray(error.details)) {
    body.error.details = error.details;
  }

  response.status(statusCode).json(body);
}

module.exports = { errorHandler };

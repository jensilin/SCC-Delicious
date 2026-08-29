// Hands the unmatched route to the error handler rather than answering here, so that one module
// stays responsible for the shape of every error response. The path is logged, not returned.
function notFound(request, response, next) {
  const error = new Error(`No route matches ${request.method} ${request.originalUrl}`);

  error.statusCode = 404;
  error.code = "NOT_FOUND";
  error.clientMessage = "Route not found";

  next(error);
}

module.exports = { notFound };

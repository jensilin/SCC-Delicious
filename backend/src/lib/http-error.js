// The central error handler reads statusCode, code, and clientMessage off an error. Assembling
// those by hand at every throw site is how one of them eventually goes missing, and a client error
// missing its statusCode is reported to the caller as a 500.
//
// details carries per-field validation failures and is omitted for everything else.
function httpError(statusCode, code, clientMessage, details) {
  const error = new Error(clientMessage);

  error.statusCode = statusCode;
  error.code = code;
  error.clientMessage = clientMessage;

  if (details !== undefined) {
    error.details = details;
  }

  return error;
}

module.exports = { httpError };

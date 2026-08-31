// One error type for every failure that leaves the API layer, so no component ever reaches into
// error.response.data.error.code by hand.
//
// The backend shapes every error as { error: { code, message, details? } } from a single handler, and
// that is what this reads. Two shapes of `details` exist and both are optional: VALIDATION_ERROR
// carries { field, message } per offending field, and checkout's INSUFFICIENT_STOCK carries
// { foodId, name, message } naming the food. The admin stock endpoint raises INSUFFICIENT_STOCK with
// no details at all, so details is never assumed to be present.

/**
 * @typedef {object} ValidationDetail
 * @property {string} field Empty for a rule about the object rather than one field, such as
 *   "must change at least one field" on a catalogue PATCH.
 * @property {string} message
 */

/**
 * @typedef {object} StockDetail
 * @property {string} foodId
 * @property {string} name
 * @property {string} message
 */

/** Raised when the request never reached the API: offline, DNS, connection refused, CORS. */
const NETWORK_ERROR = "NETWORK_ERROR";

/** Raised when the API answered but the body was not the documented error envelope. */
const UNEXPECTED_ERROR = "UNEXPECTED_ERROR";

class ApiError extends Error {
  /**
   * @param {object} parameters
   * @param {number} parameters.status HTTP status, or 0 when the request never got a response.
   * @param {string} parameters.code Backend error code, or NETWORK_ERROR / UNEXPECTED_ERROR.
   * @param {string} parameters.message
   * @param {Array<ValidationDetail | StockDetail>} [parameters.details]
   */
  constructor({ status, code, message, details }) {
    super(message);

    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }

  get isNetworkError() {
    return this.code === NETWORK_ERROR;
  }

  /** True for the statuses where retrying the identical request can succeed. */
  get isRetryable() {
    return this.isNetworkError || this.status >= 500;
  }

  /**
   * Per-field messages for a form, keyed by field name. A detail with an empty field belongs to the
   * form as a whole and is collected under the empty key rather than dropped.
   *
   * @returns {Record<string, string>}
   */
  fieldErrors() {
    if (!Array.isArray(this.details)) {
      return {};
    }

    const errors = {};

    for (const detail of this.details) {
      if (typeof detail?.field === "string") {
        errors[detail.field] = detail.message;
      }
    }

    return errors;
  }
}

/**
 * Turns whatever Axios rejected with into an ApiError.
 *
 * A 5xx is forced to INTERNAL_ERROR rather than trusting the body. The backend has a known defect
 * recorded under Known Defects in docs/ARCHITECTURE.md: its error handler forwards whatever `code`
 * an error carries, so an unhandled Prisma fault surfaces Prisma's own code — P2020, for instance —
 * instead of INTERNAL_ERROR. The message is already replaced with a generic one server-side, so
 * nothing sensitive leaks, but the code is outside the published vocabulary. Deciding the code from
 * the status class for every 5xx contains that here, and keeps working unchanged once it is fixed.
 *
 * @param {unknown} error
 * @returns {ApiError}
 */
function toApiError(error) {
  if (error instanceof ApiError) {
    return error;
  }

  const response = /** @type {{ response?: { status: number, data?: unknown } }} */ (error)?.response;

  if (!response) {
    return new ApiError({
      status: 0,
      code: NETWORK_ERROR,
      message: "The server could not be reached. Check your connection and try again.",
    });
  }

  const { status } = response;

  if (status >= 500) {
    return new ApiError({
      status,
      code: "INTERNAL_ERROR",
      message: "Something went wrong on the server. Please try again.",
    });
  }

  const body = /** @type {{ error?: { code?: unknown, message?: unknown, details?: unknown } }} */ (
    response.data
  );
  const code = body?.error?.code;
  const message = body?.error?.message;

  return new ApiError({
    status,
    code: typeof code === "string" ? code : UNEXPECTED_ERROR,
    message: typeof message === "string" ? message : "The request could not be completed.",
    details: Array.isArray(body?.error?.details) ? body.error.details : undefined,
  });
}

export { ApiError, NETWORK_ERROR, UNEXPECTED_ERROR, toApiError };

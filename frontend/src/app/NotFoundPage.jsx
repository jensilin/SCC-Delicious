import { Link } from "react-router-dom";

import { EmptyState } from "../components/EmptyState";

/**
 * An address the client does not have a screen for. This is a routing miss in the browser and has
 * nothing to do with the API's own 404 NOT_FOUND, which means a record was not found.
 */
function NotFoundPage() {
  return (
    <EmptyState title="Page not found" message="That address does not exist in this application.">
      <Link to="/shops">Back to shops</Link>
    </EmptyState>
  );
}

export { NotFoundPage };

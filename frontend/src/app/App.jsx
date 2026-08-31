import { BrowserRouter } from "react-router-dom";

import { AuthProvider } from "./providers/AuthProvider";
import { AppRoutes } from "./routes";

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}

export { App };

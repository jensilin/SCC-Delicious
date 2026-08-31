import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// strictPort rather than Vite's default of moving to the next free port. The backend's CORS_ORIGIN
// names one exact origin — a wildcard is not permitted alongside credentials, and the refresh cookie
// requires credentials — so a dev server that quietly started on 5174 would fail every request with
// a CORS error instead of saying the port was taken.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
  },
});

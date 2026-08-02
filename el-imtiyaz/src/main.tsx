import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./app/app";
import { initUserPreferences } from "./app/providers/user-preferences-provider";
import "./index.css";
import "./i18n/i18n";

// Iteration 15: synchronously apply stored theme + locale on app startup so
// the dir="rtl" attribute and the data-theme attribute are both set BEFORE
// the first paint. This prevents:
//   - An LTR flash for users who previously selected Arabic.
//   - A flash of the wrong color palette (dark/light) at startup.
// Safe to call multiple times — the UserPreferencesProvider will re-apply
// the same values on mount (idempotent).
initUserPreferences();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root container #root not found in document.");
}

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <App />
      </HashRouter>
    </QueryClientProvider>
  </StrictMode>,
);

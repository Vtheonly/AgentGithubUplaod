import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./app/app";
import { initLocale } from "./shared/components/language-switcher";
import "./index.css";
import "./i18n/i18n";

// Iteration 7 (P3-O): apply stored locale on app startup so the dir attribute
// (rtl/ltr) is set before the first render — prevents a flash of LTR layout
// for users who previously selected Arabic.
initLocale();

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

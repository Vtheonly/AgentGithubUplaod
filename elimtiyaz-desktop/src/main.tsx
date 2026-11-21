import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { App } from "./app/app";
import { initUserPreferences } from "./app/providers/user-preferences-provider";
// T-388 (I18N-501): the webfonts are BUNDLED LOCALLY via @fontsource — the
// Google Fonts CDN <link> is gone. The Electron app renders identical type
// fully offline (the CDN 404/fallback was the owner's font complaint).
// Arabic UI = IBM Plex Sans Arabic (clean, professional, excellent Arabic +
// Latin harmony); Latin UI = Inter; code/tabular = JetBrains Mono.
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/ibm-plex-sans-arabic/400.css";
import "@fontsource/ibm-plex-sans-arabic/500.css";
import "@fontsource/ibm-plex-sans-arabic/600.css";
import "@fontsource/ibm-plex-sans-arabic/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/600.css";
import "./index.css";
import "./i18n/i18n";
import { startFinancialRealtime } from "./infrastructure/supabase/financial-realtime";

// Iteration 15: synchronously apply stored theme + locale on app startup so
// the dir="rtl" attribute and the data-theme attribute are both set BEFORE
// the first paint. This prevents:
//   - An LTR flash for users who previously selected Arabic.
//   - A flash of the wrong color palette (dark/light) at startup.
// Safe to call multiple times — the UserPreferencesProvider will re-apply
// the same values on mount (idempotent).
initUserPreferences();

// T-592 (E7A-3) — THE ONE-COHERENT-CACHING-ARCHITECTURE DECISION
// (ARCH-020 / F-U4 / L-13): the `QueryClientProvider` phantom mount is
// PRUNED together with its `@tanstack/react-query` dependency. The app's
// data layer is the repository-Observable stack (useObservable + the
// SubjectBehavior caches + the CacheFreshness TTL policy + the T-592 delta
// cache layer) — react-query was mounted but NEVER consumed (zero
// useQuery/useMutation/useQueryClient sites; the provider below its own
// comment admitted "Finance uses repository Observables rather than
// TanStack Query"). ONE documented architecture; the E4.8 ADR lands in
// its own lane.
// Finance uses repository Observables — its cache freshness and the
// Supabase Realtime bridge stay in the data layer itself.
void startFinancialRealtime();

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root container #root not found in document.");
}

createRoot(container).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
);

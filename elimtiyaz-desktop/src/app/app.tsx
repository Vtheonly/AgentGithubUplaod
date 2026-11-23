/**
 * App — top-level routing + global providers.
 *
 * Order of providers (outermost → innermost):
 *   1. RepositoryProvider       — data layer (mock today, Supabase later)
 *   2. AuthProvider              — current session
 *   3. SyncProvider              — offline-first sync queue (Iter 14)
 *   4. ToastProvider             — popups / dialogs
 *   5. TooltipProvider           — radix tooltip context
 *   6. UserPreferencesProvider   — theme/locale/timezone/currency (Iter 15)
 *   (E6.6/ARCH-018: the former "5. ModalProvider — modal manager" line is
 *   REMOVED — the dead stack never had a real consumer; modals render
 *   through UnifiedModal/ModalShell.)
 *
 * The Router lives inside so that components can useNavigate.
 *
 * Iteration 14: SyncProvider sits inside AuthProvider so it can read
 * the session's tenantId + actorId, and inside RepositoryProvider so
 * the push handler can access the Supabase client.
 *
 * Iteration 15: UserPreferencesProvider sits at the OUTERMOST position
 * (above RepositoryProvider) because theme + locale need to apply on the
 * login screen too — before any auth state exists. It is pure client-side
 * state and has no dependency on the repository layer.
 *
 * T-261 (39th session): AICopilotProvider sits INSIDE ToastProvider (it
 * consumes useToast) and above the routed shell — the copilot drawer is
 * reachable from every authenticated page. The blueprint's placement
 * (outside ToastProvider) would throw "useToast must be used within
 * <ToastProvider>" at mount.
 */
import { lazy, Suspense } from "react";
import { useEffect } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { TooltipProvider } from "../shared/ui/tooltip";
import { RepositoryProvider } from "./providers/repository-provider";
import { AuthProvider, useAuth } from "./providers/auth-provider";
import { SyncProvider } from "./providers/sync-provider";
import { ToastProvider } from "./providers/toast-provider";
import { AICopilotProvider } from "./providers/ai-copilot-provider";
import { UserPreferencesProvider } from "./providers/user-preferences-provider";
import { ToastViewport } from "../shared/layout/toast-viewport";
/*
 * T-583 (E1.8 completion — ARCH-010/ADD-5): the Ctrl+O test-data autofill
 * is a DEVTOOLS surface. The static mount pulled the whole autofill engine
 * (generators + classifier + Radix dance) into the EAGER production
 * bundle; the lazy import + `import.meta.env.DEV` gate keeps it a dev-build
 * affordance — production builds never reference the chunk (the component
 * never mounts, so the dynamic import never fires). The t-399 suite keeps
 * importing the module directly and stays the behavioral contract.
 */
const TestDataAutofill = lazy(
  () => import("../shared/devtools/test-data/use-test-data-autofill").then((m) => ({ default: m.TestDataAutofill })),
);
// T-502 (UI-332): the application-wide keyboard zoom (Ctrl+= / Ctrl++ /
// Ctrl+- / Ctrl+0) — mounted at the App root so every view has it.
import { useKeyboardZoom } from "../shared/hooks/use-keyboard-zoom";
import { SplashGate } from "./splash-gate";
/*
 * T-583: the authenticated shell is a lazy route-level chunk — it carries
 * the sidebar/topbar + the eleven feature pages. Keeping it static kept
 * EVERY feature module in the eager entry bundle; the lazy import moves
 * them behind the login + first-navigation boundary.
 */
const AppShell = lazy(() => import("./app-shell").then((m) => ({ default: m.AppShell })));
import { LoginScreen } from "../features/auth/login-screen";
import { buildWhatsAppUrl } from "../shared/utils/whatsapp";
import { LoadingState } from "../shared/layout/state-views";

/**
 * Electron's renderer `window.open()` can otherwise create a new BrowserWindow
 * instead of handing the URL to Chrome/the user's default browser. The desktop
 * already owns a validated `shell.openExternal` IPC surface, so all wa.me
 * opens are intercepted here and delegated to that external-browser path.
 *
 * This keeps existing UI call sites compatible (they may still call
 * `window.open(...)`) while guaranteeing WhatsApp never replaces the app
 * renderer with a black/blank embedded page.
 */
function useExternalWhatsAppHandoff(): void {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const originalOpen = window.open;

    window.open = ((url?: string | URL, target?: string, features?: string) => {
      const href = url instanceof URL ? url.toString() : url ?? "";

      try {
        const parsed = new URL(href);
        if (
          parsed.protocol === "https:" &&
          parsed.hostname.toLowerCase() === "wa.me"
        ) {
          const phone = parsed.pathname.replace(/^\/+/, "");
          const message = parsed.searchParams.get("text") ?? undefined;
          const normalizedUrl = buildWhatsAppUrl(phone, message);

          if (!normalizedUrl) {
            console.error("[WhatsApp] Refusing invalid phone number:", phone);
            return null;
          }

          const desktopApi = window.elImtiyaz;

          if (desktopApi?.shell?.openExternal) {
            void desktopApi.shell.openExternal(normalizedUrl).then((result) => {
              if (!result.ok) {
                console.error("[WhatsApp] External browser open failed:", result.error);
              }
            });
            return null;
          }

          // Browser/Vite fallback: still open the normalized URL rather than
          // the malformed original URL (for example `wa.me/+213...`).
          return originalOpen.call(window, normalizedUrl, target, features);
        }
      } catch {
        // Preserve the browser's original semantics for non-URL values or
        // unsupported URLs. The external handoff only owns wa.me URLs.
      }

      return originalOpen.call(window, url, target, features);
    }) as typeof window.open;

    return () => {
      window.open = originalOpen;
    };
  }, []);
}

export function App() {
  useExternalWhatsAppHandoff();
  // T-502 (UI-332): Ctrl+= / Ctrl++ zoom in, Ctrl+- zoom out, Ctrl+0
  // reset — the window's own zoom level (the Affichage menu's mechanism),
  // active on every view including the login screen (before any session).
  useKeyboardZoom();

  return (
    <UserPreferencesProvider>
      <RepositoryProvider>
        <AuthProvider>
          <SyncProvider>
            <ToastProvider>
              <AICopilotProvider>
                {/* E6.6 (ARCH-018): the dead useModal/ModalHost/ModalProvider
                    stack REMOVED — zero real consumers ever called
                    useModal().open(); every modal renders through
                    UnifiedModal/ModalShell now. The provider + host nodes
                    (and their z-[90] wrapper) are gone. */}
                <TooltipProvider delayDuration={300}>
                  <SplashGate>
                    <AppRoutes />
                  </SplashGate>
                  <ToastViewport />
                  {/* T-399 (OPS-321) / T-583 (E1.8): Ctrl+O test-data autofill
                      — DEV BUILDS ONLY, lazily mounted (never in the eager
                      production bundle). */}
                  {import.meta.env.DEV ? (
                    <Suspense fallback={null}>
                      <TestDataAutofill />
                    </Suspense>
                  ) : null}
                </TooltipProvider>
              </AICopilotProvider>
            </ToastProvider>
          </SyncProvider>
        </AuthProvider>
      </RepositoryProvider>
    </UserPreferencesProvider>
  );
}

function AppRoutes() {
  const { session } = useAuth();
  const location = useLocation();

  if (!session) {
    return (
      <Routes>
        <Route path="/login" element={<LoginScreen />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  if (location.pathname === "/login") {
    return <Navigate to="/" replace />;
  }

  // T-583: the authenticated shell + its pages load as async chunks; the
  // fallback is the shared loading state (never a blank screen).
  return (
    <Suspense fallback={<LoadingState />}>
      <AppShell />
    </Suspense>
  );
}

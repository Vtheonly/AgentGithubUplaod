/**
 * App — top-level routing + global providers.
 *
 * Order of providers (outermost → innermost):
 *   1. RepositoryProvider       — data layer (mock today, Supabase later)
 *   2. AuthProvider              — current session
 *   3. SyncProvider              — offline-first sync queue (Iter 14)
 *   4. ToastProvider             — popups / dialogs
 *   5. ModalProvider             — modal manager
 *   6. TooltipProvider           — radix tooltip context
 *   7. UserPreferencesProvider   — theme/locale/timezone/currency (Iter 15)
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
import { useEffect } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { TooltipProvider } from "../shared/ui/tooltip";
import { RepositoryProvider } from "./providers/repository-provider";
import { AuthProvider, useAuth } from "./providers/auth-provider";
import { SyncProvider } from "./providers/sync-provider";
import { ToastProvider } from "./providers/toast-provider";
import { AICopilotProvider } from "./providers/ai-copilot-provider";
import { ModalProvider } from "./providers/modal-provider";
import { UserPreferencesProvider } from "./providers/user-preferences-provider";
import { ToastViewport } from "../shared/layout/toast-viewport";
import { ModalHost } from "../shared/layout/modal-host";
import { SplashGate } from "./splash-gate";
import { AppShell } from "./app-shell";
import { LoginScreen } from "../features/auth/login-screen";
import { buildWhatsAppUrl } from "../shared/utils/whatsapp";

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
          parsed.hostname.toLowerCase() === "wa.me" &&
          window.elImtiyaz?.shell?.openExternal
        ) {
          const phone = parsed.pathname.replace(/^\/+/, "");
          const message = parsed.searchParams.get("text") ?? undefined;
          const normalizedUrl = buildWhatsAppUrl(phone, message);

          if (!normalizedUrl) {
            console.error("[WhatsApp] Refusing invalid phone number:", phone);
            return null;
          }

          void window.elImtiyaz.shell.openExternal(normalizedUrl).then((result) => {
            if (!result.ok) {
              console.error("[WhatsApp] External browser open failed:", result.error);
            }
          });
          return null;
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

  return (
    <UserPreferencesProvider>
      <RepositoryProvider>
        <AuthProvider>
          <SyncProvider>
            <ToastProvider>
              <AICopilotProvider>
                <ModalProvider>
                  <TooltipProvider delayDuration={300}>
                    <SplashGate>
                      <AppRoutes />
                    </SplashGate>
                    <ToastViewport />
                    <ModalHost />
                  </TooltipProvider>
                </ModalProvider>
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

  return <AppShell />;
}

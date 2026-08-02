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
 */
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { TooltipProvider } from "../shared/ui/tooltip";
import { RepositoryProvider } from "./providers/repository-provider";
import { AuthProvider, useAuth } from "./providers/auth-provider";
import { SyncProvider } from "./providers/sync-provider";
import { ToastProvider } from "./providers/toast-provider";
import { ModalProvider } from "./providers/modal-provider";
import { UserPreferencesProvider } from "./providers/user-preferences-provider";
import { ToastViewport } from "../shared/layout/toast-viewport";
import { ModalHost } from "../shared/layout/modal-host";
import { SplashGate } from "./splash-gate";
import { AppShell } from "./app-shell";
import { LoginScreen } from "../features/auth/login-screen";

export function App() {
  return (
    <UserPreferencesProvider>
      <RepositoryProvider>
        <AuthProvider>
          <SyncProvider>
            <ToastProvider>
              <ModalProvider>
                <TooltipProvider delayDuration={300}>
                  <SplashGate>
                    <AppRoutes />
                  </SplashGate>
                  <ToastViewport />
                  <ModalHost />
                </TooltipProvider>
              </ModalProvider>
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

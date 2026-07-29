/**
 * App — top-level routing + global providers.
 *
 * Order of providers (outermost → innermost):
 *   1. RepositoryProvider  — data layer (mock today, Supabase later)
 *   2. AuthProvider         — current session
 *   3. ToastProvider        — popups / dialogs
 *   4. ModalProvider        — modal manager
 *   5. TooltipProvider      — radix tooltip context
 *
 * The Router lives inside so that components can useNavigate.
 */
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { TooltipProvider } from "../shared/ui/tooltip";
import { RepositoryProvider } from "../infrastructure/repository-provider";
import { AuthProvider, useAuth } from "../state/auth-context";
import { ToastProvider } from "../state/toast-context";
import { ModalProvider } from "../state/modal-context";
import { ToastViewport } from "../shared/components/toast-viewport";
import { ModalHost } from "../shared/components/modal-host";
import { SplashGate } from "./splash-gate";
import { AppShell } from "./app-shell";
import { LoginScreen } from "../features/auth/login-screen";

export function App() {
  return (
    <RepositoryProvider>
      <AuthProvider>
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
      </AuthProvider>
    </RepositoryProvider>
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

/**
 * SplashGate — shows the branded particle splash on first load, then
 * renders the children (the actual app) once. The splash plays once
 * per session (tracked via sessionStorage) so reloads during a session
 * don't replay it.
 */
import { useState, type ReactNode } from "react";
import { SplashScreen } from "../features/auth/splash-screen";

const SESSION_KEY = "el-imtiyaz.splash-played";

export function SplashGate({ children }: { children: ReactNode }) {
  const [showSplash, setShowSplash] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem(SESSION_KEY) !== "1";
    } catch {
      return true;
    }
  });

  if (showSplash) {
    return (
      <SplashScreen
        onDone={() => {
          try {
            sessionStorage.setItem(SESSION_KEY, "1");
          } catch {
            /* ignore */
          }
          setShowSplash(false);
        }}
      />
    );
  }

  return <>{children}</>;
}

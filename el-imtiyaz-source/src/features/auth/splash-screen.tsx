/**
 * SplashScreen — branded particle intro animation.
 *
 * Preserves the legacy desktop app's brand identity (particle EI monogram).
 * Calls onDone after the splash duration so the host can transition to the
 * next screen (login or app shell).
 */
import { useEffect, useState } from "react";
import { ParticleLogo } from "../../shared/components/particle-logo";

export function SplashScreen({ onDone, durationMs = 2200 }: { onDone: () => void; durationMs?: number }) {
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setExiting(true), durationMs - 400);
    const t2 = setTimeout(onDone, durationMs);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [onDone, durationMs]);

  return (
    <div
      className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-[#242526] transition-opacity duration-400"
      style={{ opacity: exiting ? 0 : 1 }}
    >
      <div className="h-[60vh] w-full max-w-3xl">
        <ParticleLogo mode="logo" text="EI" color="#349BD4" />
      </div>
      <div className="absolute bottom-16 flex flex-col items-center gap-2">
        <p className="text-lg font-semibold text-[#EFF2F3] tracking-wide">El-Imtiyaz</p>
        <p className="text-sm text-[#6EC1E4]">Plateforme de gestion scolaire</p>
      </div>
    </div>
  );
}

/**
 * SplashScreen — branded particle intro animation.
 *
 * Preserves the legacy desktop app's brand identity (particle EI monogram).
 * Calls onDone after the splash duration so the host can transition to the
 * next screen (login or app shell).
 *
 * Iteration 6 polish: layered visual effect with TWO ParticleLogo layers:
 *   - Background: `mode="circular"` — concentric rings of orbiting particles
 *     tinted with the brand-cyan accent, low opacity, slowly rotating. This
 *     restores the "animated circular particle effects" from the legacy app.
 *   - Foreground: `mode="logo"` — the canonical EI monogram formed by
 *     particles in primary brand blue, mouse-reactive.
 *
 * A subtle radial gradient overlay (brand-blue → dark surface) sits between
 * the two layers to give the splash screen depth without flattening the
 * particle visibility. This mirrors the "dynamic background that displayed
 * the selected hero image within the animated particle environment" from the
 * legacy app — but uses pure CSS gradients instead of a bitmap hero image
 * so the splash stays dependency-free and themable.
 *
 * The whole splash fades out over the last 400ms before `onDone` fires.
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
      {/*
        Layer 1: Background — circular particle rings.
        Low opacity (40%), slowly orbiting. This restores the legacy
        "animated circular particle effects" from the old desktop app.
      */}
      <div
        className="absolute inset-0 opacity-40 pointer-events-none"
        aria-hidden
      >
        <ParticleLogo
          mode="circular"
          color="#6EC1E4"
          className="mix-blend-screen"
        />
      </div>

      {/*
        Layer 2: Radial gradient overlay — gives the splash depth without
        flattening the particles. Mirrors the legacy "dynamic background that
        displayed the selected hero image within the animated particle
        environment", but using pure CSS so the splash stays dependency-free.
      */}
      <div
        className="absolute inset-0 pointer-events-none"
        aria-hidden
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(52,155,212,0.12) 0%, rgba(36,37,38,0.55) 55%, rgba(36,37,38,0.85) 100%)",
        }}
      />

      {/*
        Layer 3: Foreground — the canonical EI monogram formed by particles.
        Mouse-reactive (spring physics repel cursor). This is the brand mark.
      */}
      <div className="relative h-[60vh] w-full max-w-3xl">
        <ParticleLogo mode="logo" text="EI" color="#349BD4" />
      </div>

      {/*
        Layer 4: Brand text — bottom-aligned title + subtitle.
        Fades in slightly after the particles settle (CSS animation).
      */}
      <div className="absolute bottom-16 flex flex-col items-center gap-2 animate-fade-in">
        <p className="text-lg font-semibold text-[#EFF2F3] tracking-wide">El-Imtiyaz</p>
        <p className="text-sm text-[#6EC1E4]">Plateforme de gestion scolaire</p>
      </div>
    </div>
  );
}

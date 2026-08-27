/**
 * SplashScreen — branded particle intro animation.
 *
 * Replaces the legacy `particle-engine.ts` + `particle-logo.tsx` pair with
 * the new renderer-side `ParticleEngine` (ported from the standalone
 * `import-engine-particle` package). The new engine brings:
 *
 *   - Image-pipeline-driven particle seeding (the "EI" monogram is rendered
 *     to an offscreen canvas, dark pixels are sampled, and each becomes a
 *     particle target — yielding a denser, more accurate brand mark than
 *     the legacy 60-particle ring approximation).
 *   - Color excitation: particles pulse toward a near-white target colour
 *     when the cursor enters their repulsion radius, then relax back to
 *     their brand palette base.
 *   - Three morphing modes (logo / circular / linear) driven by the
 *     morphing system ported from the standalone engine.
 *
 * The splash plays once per session (tracked via `sessionStorage` by the
 * host `SplashGate`) and fades out over the last 400 ms before `onDone`.
 *
 * Defensive rendering: if the host environment cannot provide a 2D canvas
 * context (jsdom during tests, very old browsers), the splash silently
 * falls back to a static brand panel and still fires `onDone` after the
 * configured duration — the particle animation is purely decorative.
 */
import { useEffect, useRef, useState } from "react";
import { ParticleEngine, DEFAULT_PALETTE } from "../../shared/particle-engine";
import type { LogoMode } from "../../shared/particle-engine";

export function SplashScreen({
  onDone,
  durationMs = 2200,
}: {
  onDone: () => void;
  durationMs?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [exiting, setExiting] = useState(false);
  const [particlesReady, setParticlesReady] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    // Measure the container to size the engine's coordinate system.
    const rect = container.getBoundingClientRect();
    const width = Math.max(rect.width, 320);
    const height = Math.max(rect.height, 240);

    const ctx = canvas.getContext("2d", { willReadFrequently: false });
    if (!ctx) {
      // No canvas support (e.g. jsdom) — skip particle setup, the splash
      // still completes on schedule via the duration timer below.
      return;
    }

    // Size the canvas for devicePixelRatio to keep particles crisp on HiDPI.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const engine = new ParticleEngine();

    let rafId = 0;
    let disposed = false;

    engine
      .initialize({
        pipeline: {
          source: { fallback: true },
          canvasWidth: width,
          canvasHeight: height,
          // Lower density for the splash — keeps the particle count tractable
          // for low-end GPUs while preserving the recognisable monogram shape.
          density: 3,
          luminanceThreshold: 128,
          fillRatio: 0.75,
          palette: DEFAULT_PALETTE,
        },
        physics: {
          damping: 0.86,
          stiffnessRange: [0.06, 0.10],
          sizeRange: [1.4, 2.6],
          colorProbabilities: [0.7, 0.18, 0.12],
          excitationColor: [239, 242, 243],
          excitationSpeed: 0.4,
          relaxationSpeed: 0.08,
          sizeExcitationMultiplier: 1.6,
          sizeRelaxationSpeed: 0.1,
        },
        interaction: {
          radius: 90,
          force: 5,
          pointerX: null,
          pointerY: null,
          active: false,
        },
        initialMode: "logo" as LogoMode,
        background: "rgba(36, 37, 38, 0.22)",
      })
      .then(() => {
        if (disposed) return;
        setParticlesReady(true);

        // After the logo settles, briefly morph through the other modes to
        // showcase the engine — adds visual interest without distracting.
        const modeTimer1 = setTimeout(() => engine.setMode("circular"), durationMs * 0.45);
        const modeTimer2 = setTimeout(() => engine.setMode("logo"), durationMs * 0.75);
        modeTimers.push(modeTimer1, modeTimer2);

        const loop = () => {
          if (disposed) return;
          const frame = engine.step();
          if (frame) {
            // Motion-blur clear — paint a translucent background rect instead
            // of `clearRect` to leave faint trails behind moving particles.
            ctx.fillStyle = "rgba(36, 37, 38, 0.22)";
            ctx.fillRect(0, 0, width, height);

            for (const p of frame.particles) {
              const [r, g, b] = p.color;
              ctx.beginPath();
              ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
              ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.92)`;
              ctx.fill();
            }
          }
          rafId = requestAnimationFrame(loop);
        };
        rafId = requestAnimationFrame(loop);
      })
      .catch(() => {
        // Engine init can fail in environments without `getImageData` (jsdom).
        // The splash already renders the brand text overlay, so we just no-op.
      });

    const modeTimers: ReturnType<typeof setTimeout>[] = [];

    // Mouse interaction — particles repel from the cursor with colour excitation.
    const onMouseMove = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      engine.setInteraction({
        pointerX: e.clientX - r.left,
        pointerY: e.clientY - r.top,
        active: true,
      });
    };
    const onMouseLeave = () => {
      engine.setInteraction({ pointerX: null, pointerY: null, active: false });
    };
    canvas.addEventListener("mousemove", onMouseMove);
    canvas.addEventListener("mouseleave", onMouseLeave);

    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      for (const t of modeTimers) clearTimeout(t);
      canvas.removeEventListener("mousemove", onMouseMove);
      canvas.removeEventListener("mouseleave", onMouseLeave);
      engine.destroy();
    };
  }, [durationMs]);

  // Schedule the exit transition + onDone.
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
      ref={containerRef}
      className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-surface-background transition-opacity duration-400"
      style={{ opacity: exiting ? 0 : 1 }}
      aria-label="El-Imtiyaz"
      role="img"
    >
      {/*
        Particle canvas — fills the whole splash. The engine renders the
        EI monogram from the fallback pattern; particles repel the cursor
        with a near-white excitation pulse.
      */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full"
        style={{ opacity: particlesReady ? 1 : 0, transition: "opacity 600ms ease-out" }}
        aria-hidden
      />

      {/*
        Radial gradient overlay — gives the splash depth without flattening
        particle visibility. Mirrors the legacy "hero image" backdrop but
        uses pure CSS so the splash stays dependency-free.
      */}
      <div
        className="absolute inset-0 pointer-events-none"
        aria-hidden
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(52,155,212,0.10) 0%, rgba(36,37,38,0.55) 55%, rgba(36,37,38,0.85) 100%)",
        }}
      />

      {/*
        Brand text — bottom-aligned. Fades in slightly after the particles
        settle (CSS animation).
      */}
      <div className="absolute bottom-16 flex flex-col items-center gap-2 animate-fade-in pointer-events-none">
        <p className="text-lg font-semibold text-foreground tracking-wide">El-Imtiyaz</p>
        <p className="text-sm text-brand-blue-light">Plateforme de gestion scolaire</p>
      </div>
    </div>
  );
}

/**
 * ParticleCanvas — React wrapper around the new `ParticleEngine`.
 *
 * Mounts a `<canvas>`, runs a `requestAnimationFrame` loop, drives the
 * engine, and forwards pointer events for mouse-reactive physics. This
 * is the reusable surface for embedding particle animations anywhere in
 * the app (login side panel, future loading states, etc.). The splash
 * screen uses `ParticleEngine` directly for finer control over its
 * mode-sequence + fade-out orchestration.
 *
 * The component degrades gracefully: if the host environment cannot
 * provide a 2D canvas context (jsdom during tests), it renders an empty
 * canvas and skips the engine setup — no errors thrown.
 */
import { useEffect, useRef, useState } from "react";
import { ParticleEngine, DEFAULT_PALETTE } from "../particle-engine";
import type { ImageSource, LogoMode, Palette, PhysicsConfig } from "../particle-engine";
import { cn } from "../ui/cn";

/**
 * Option 2 static asset — `elimtiyaz-desktop/public/intro-logo.png`.
 * Files in `public/` are copied as-is to the build output (`dist/`), so a
 * relative `./` URL resolves in the Vite dev server AND in the packaged
 * Electron app (`file://…/dist/index.html`).
 */
export const INTRO_LOGO_SRC = "./intro-logo.png";

export interface ParticleCanvasProps {
  /**
   * Optional URL or Vite-imported asset string. Defaults to the Option 2
   * static asset (`./intro-logo.png`). Pass `""` (or an explicit `source`)
   * to skip the static file — an empty string resolves to `source` when
   * provided, else the built-in EI monogram fallback.
   */
  imageSrc?: string;
  /** Full image source object ({ url, buffer, fallback }) — used when `imageSrc` is absent. */
  source?: ImageSource;
  /** Initial animation mode (default `logo`). */
  mode?: LogoMode;
  /** Palette override (defaults to the brand palette). */
  palette?: Palette;
  /** Physics overrides. */
  physics?: PhysicsConfig;
  /** Sample density (lower = more particles, default 3). */
  density?: number;
  /** Canvas fill ratio (0–1, default 0.7). */
  fillRatio?: number;
  /** Luminance threshold (0-255, default 128). Pixels darker than this become particles. */
  luminanceThreshold?: number;
  /** Enable mouse-reactive repulsion (default true). */
  interactive?: boolean;
  /** Optional className for the canvas element. */
  className?: string;
  /** Called once when particles are seeded and the first frame is rendered. */
  onReady?: () => void;
}

export function ParticleCanvas({
  imageSrc = INTRO_LOGO_SRC,
  source,
  mode = "logo",
  palette = DEFAULT_PALETTE,
  physics,
  density = 3,
  fillRatio = 0.7,
  luminanceThreshold = 128,
  interactive = true,
  className,
  onReady,
}: ParticleCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const rect = container.getBoundingClientRect();
    const width = Math.max(rect.width, 240);
    const height = Math.max(rect.height, 240);

    const ctx = canvas.getContext("2d", { willReadFrequently: false });
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const engine = new ParticleEngine();
    let rafId = 0;
    let disposed = false;
    let readyFired = false;

    // Resolve image source: `imageSrc` string → custom source → fallback pattern.
    // Default is the Option 2 static asset (`./intro-logo.png` in `public/`,
    // copied as-is to `dist/`). Until you drop that file in, the load fails
    // and we retry with the built-in EI monogram so the canvas never blanks.
    // An empty string skips the static file and resolves to `source` when
    // provided, else the monogram.
    const trimmedSrc = imageSrc?.trim() ?? "";
    const primarySource: ImageSource =
      trimmedSrc.length > 0 ? { url: trimmedSrc } : (source ?? { fallback: true });
    const canFallBack = !primarySource.fallback;

    const startLoop = () => {
      if (disposed) return;
      setReady(true);
      if (!readyFired) {
        readyFired = true;
        onReady?.();
      }

      const loop = () => {
        if (disposed) return;
        const frame = engine.step();
        if (frame) {
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
    };

    const initWithFallback = async () => {
      try {
        await engine.initialize({
          pipeline: {
            source: primarySource,
            canvasWidth: width,
            canvasHeight: height,
            density,
            luminanceThreshold,
            fillRatio,
            palette,
          },
          physics: physics ?? {
            damping: 0.86,
            stiffnessRange: [0.06, 0.10],
            sizeRange: [1.4, 2.6],
            colorProbabilities: [0.7, 0.18, 0.12],
          },
          interaction: {
            radius: 90,
            force: 5,
            pointerX: null,
            pointerY: null,
            active: false,
          },
          initialMode: mode,
          background: "rgba(36, 37, 38, 0.22)",
        });
      } catch (err) {
        if (!canFallBack || disposed) {
          // No canvas support (jsdom) or already unmounted — degrade to an
          // empty canvas; the host screen renders its own brand overlay.
          console.error("ParticleEngine init failed:", err);
          return;
        }
        // Static asset missing/unloadable (e.g. `intro-logo.png` not dropped
        // into `public/` yet) — retry with the built-in monogram.
        console.warn(
          `ParticleCanvas: image "${trimmedSrc}" failed to load, falling back to EI monogram.`,
          err,
        );
        try {
          await engine.initialize({
            pipeline: {
              source: { fallback: true },
              canvasWidth: width,
              canvasHeight: height,
              density,
              luminanceThreshold,
              fillRatio,
              palette,
            },
            physics: physics ?? {
              damping: 0.86,
              stiffnessRange: [0.06, 0.10],
              sizeRange: [1.4, 2.6],
              colorProbabilities: [0.7, 0.18, 0.12],
            },
            interaction: {
              radius: 90,
              force: 5,
              pointerX: null,
              pointerY: null,
              active: false,
            },
            initialMode: mode,
            background: "rgba(36, 37, 38, 0.22)",
          });
        } catch (fallbackErr) {
          // Fallback needs canvas 2D too (jsdom) — degrade to empty canvas.
          console.error("ParticleEngine fallback init failed:", fallbackErr);
          return;
        }
      }
      startLoop();
    };

    void initWithFallback();

    if (interactive) {
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
        canvas.removeEventListener("mousemove", onMouseMove);
        canvas.removeEventListener("mouseleave", onMouseLeave);
        engine.destroy();
      };
    }

    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      engine.destroy();
    };
  }, [imageSrc, source, mode, palette, physics, density, fillRatio, luminanceThreshold, interactive, onReady]);

  return (
    <div ref={containerRef} className="relative h-full w-full">
      <canvas
        ref={canvasRef}
        className={cn("block h-full w-full", ready && "transition-opacity duration-700", className)}
        aria-hidden
      />
    </div>
  );
}

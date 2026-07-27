/**
 * ParticleLogo — React wrapper around ParticleEngine.
 *
 * Mounts a <canvas>, runs a rAF loop, hooks up resize + mouse listeners.
 * Use as the splash / loading screen so the brand identity (particle EI
 * monogram) is preserved from the legacy desktop app.
 */
import { useEffect, useRef, useState } from "react";
import { ParticleEngine, type ParticleMode } from "./particle-engine";
import { cn } from "../ui/cn";

export function ParticleLogo({
  mode = "logo",
  text = "EI",
  color = "#349BD4",
  className,
  onReady,
}: {
  mode?: ParticleMode;
  text?: string;
  color?: string;
  className?: string;
  onReady?: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<ParticleEngine | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = new ParticleEngine(canvas, { mode, text, particleColor: color });
    engineRef.current = engine;

    let rafId = 0;
    const tick = () => {
      engine.step();
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    const ro = new ResizeObserver(() => engine.resize());
    ro.observe(canvas);

    const onMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      engine.setMouse(e.clientX - rect.left, e.clientY - rect.top, true);
    };
    const onMouseLeave = () => engine.setMouse(0, 0, false);
    canvas.addEventListener("mousemove", onMouseMove);
    canvas.addEventListener("mouseleave", onMouseLeave);

    // Mark "ready" after the first frame settles (~600ms)
    const readyTimer = setTimeout(() => {
      setReady(true);
      onReady?.();
    }, 600);

    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(readyTimer);
      ro.disconnect();
      canvas.removeEventListener("mousemove", onMouseMove);
      canvas.removeEventListener("mouseleave", onMouseLeave);
      engine.dispose();
      engineRef.current = null;
    };
  }, [mode, text, color, onReady]);

  return (
    <canvas
      ref={canvasRef}
      className={cn("block h-full w-full", ready && "transition-opacity duration-700", className)}
    />
  );
}

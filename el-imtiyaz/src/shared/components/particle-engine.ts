/**
 * ParticleEngine — pure TypeScript particle system with spring physics.
 *
 * Ported from the legacy desktop codebase (`src/ui/components/logo/particle-engine.ts`)
 * and adapted to a framework-agnostic TypeScript class so it can render into
 * any <canvas>. Three modes:
 *
 *   - logo      — particles arrange themselves to form the "EI" El-Imtiyaz monogram
 *   - circular  — particles orbit a center point in concentric rings
 *   - linear    — particles drift along a linear path with subtle wave motion
 *
 * Particles react to mouse proximity: within `repelRadius`, they push away
 * from the cursor with a falloff; on release, spring physics pull them
 * back to their target position.
 *
 * The engine owns NO state beyond its own particles. The host component
 * (ParticleLogo) supplies the canvas, the rAF loop, and the resize listener.
 */

export type ParticleMode = "logo" | "circular" | "linear";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** target position (where the particle wants to be) */
  tx: number;
  ty: number;
  /** particle's own spring constant & damping — gives organic variety */
  spring: number;
  damping: number;
  radius: number;
  hue: number;
  alpha: number;
}

export interface ParticleEngineOptions {
  mode?: ParticleMode;
  particleColor?: string;
  accentColor?: string;
  density?: number; // particles per 1000 px² of canvas area
  repelRadius?: number;
  repelStrength?: number;
  text?: string; // for "logo" mode
  font?: string; // for "logo" mode
}

const DEFAULTS: Required<Omit<ParticleEngineOptions, "text" | "font">> = {
  mode: "logo",
  particleColor: "#349BD4",
  accentColor: "#6EC1E4",
  density: 1.4,
  repelRadius: 80,
  repelStrength: 0.6,
};

export class ParticleEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private particles: Particle[] = [];
  private options: Required<ParticleEngineOptions>;
  private dpr = 1;
  private width = 0;
  private height = 0;
  private mouse: { x: number; y: number; active: boolean } = { x: 0, y: 0, active: false };

  constructor(canvas: HTMLCanvasElement, options: ParticleEngineOptions = {}) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context not available");
    this.ctx = ctx;
    this.options = {
      ...DEFAULTS,
      ...options,
      text: options.text ?? "EI",
      font: options.font ?? "bold 220px Inter, sans-serif",
    };
    this.resize();
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = Math.max(1, Math.floor(this.width * this.dpr));
    this.canvas.height = Math.max(1, Math.floor(this.height * this.dpr));
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.seed();
  }

  setMode(mode: ParticleMode): void {
    this.options.mode = mode;
    this.seed();
  }

  setMouse(x: number, y: number, active: boolean): void {
    this.mouse.x = x;
    this.mouse.y = y;
    this.mouse.active = active;
  }

  /** Step the simulation by one frame. Returns false if there's nothing to render. */
  step(): boolean {
    if (this.particles.length === 0) return false;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);

    const { repelRadius, repelStrength } = this.options;
    const repelSq = repelRadius * repelRadius;

    for (const p of this.particles) {
      // Repel from mouse
      if (this.mouse.active) {
        const dx = p.x - this.mouse.x;
        const dy = p.y - this.mouse.y;
        const distSq = dx * dx + dy * dy;
        if (distSq < repelSq && distSq > 0.01) {
          const dist = Math.sqrt(distSq);
          const force = (1 - dist / repelRadius) * repelStrength;
          p.vx += (dx / dist) * force;
          p.vy += (dy / dist) * force;
        }
      }

      // Spring back to target
      const sx = (p.tx - p.x) * p.spring;
      const sy = (p.ty - p.y) * p.spring;
      p.vx += sx;
      p.vy += sy;
      p.vx *= p.damping;
      p.vy *= p.damping;
      p.x += p.vx;
      p.y += p.vy;

      // Render
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fillStyle = withAlpha(this.options.particleColor, p.alpha);
      ctx.fill();
    }
    return true;
  }

  dispose(): void {
    this.particles = [];
  }

  // ============================================================
  // Seeding strategies
  // ============================================================
  private seed(): void {
    const count = Math.max(60, Math.floor((this.width * this.height) / 1000 * this.options.density));
    this.particles = [];
    const targets = this.computeTargets(count);

    for (let i = 0; i < count; i++) {
      const target = targets[i];
      this.particles.push({
        x: Math.random() * this.width,
        y: Math.random() * this.height,
        vx: 0,
        vy: 0,
        tx: target.x,
        ty: target.y,
        spring: 0.02 + Math.random() * 0.03,
        damping: 0.85 + Math.random() * 0.08,
        radius: 1.2 + Math.random() * 1.6,
        hue: 200 + Math.random() * 20,
        alpha: 0.6 + Math.random() * 0.4,
      });
    }
  }

  private computeTargets(count: number): Array<{ x: number; y: number }> {
    if (this.options.mode === "logo") return this.logoTargets(count);
    if (this.options.mode === "circular") return this.circularTargets(count);
    return this.linearTargets(count);
  }

  /** Logo mode: sample pixels from a rendered text glyph, use the dark pixels as targets. */
  private logoTargets(count: number): Array<{ x: number; y: number }> {
    const off = document.createElement("canvas");
    off.width = this.width;
    off.height = this.height;
    const octx = off.getContext("2d");
    if (!octx) return this.circularTargets(count);

    // Scale font to ~50% of canvas height
    const fontSize = Math.min(this.height * 0.55, 320);
    octx.fillStyle = "#fff";
    octx.font = `bold ${fontSize}px Inter, sans-serif`;
    octx.textAlign = "center";
    octx.textBaseline = "middle";
    octx.fillText(this.options.text ?? "EI", this.width / 2, this.height / 2);

    const data = octx.getImageData(0, 0, this.width, this.height).data;
    const candidates: Array<{ x: number; y: number }> = [];
    const step = 4; // sample every 4 pixels for performance
    for (let y = 0; y < this.height; y += step) {
      for (let x = 0; x < this.width; x += step) {
        const i = (y * this.width + x) * 4 + 3; // alpha channel
        if (data[i] > 128) {
          candidates.push({ x: x + (Math.random() - 0.5) * 2, y: y + (Math.random() - 0.5) * 2 });
        }
      }
    }

    if (candidates.length === 0) return this.circularTargets(count);
    // Resample / repeat candidates to reach `count`.
    const targets: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < count; i++) {
      targets.push(candidates[Math.floor(Math.random() * candidates.length)]);
    }
    return targets;
  }

  /** Circular mode: concentric rings. */
  private circularTargets(count: number): Array<{ x: number; y: number }> {
    const cx = this.width / 2;
    const cy = this.height / 2;
    const maxR = Math.min(this.width, this.height) * 0.4;
    const rings = 5;
    const perRing = Math.ceil(count / rings);
    const targets: Array<{ x: number; y: number }> = [];
    for (let r = 1; r <= rings; r++) {
      const radius = (r / rings) * maxR;
      for (let i = 0; i < perRing; i++) {
        const theta = (i / perRing) * Math.PI * 2;
        targets.push({ x: cx + Math.cos(theta) * radius, y: cy + Math.sin(theta) * radius });
      }
    }
    return targets.slice(0, count);
  }

  /** Linear mode: drift along a sine wave. */
  private linearTargets(count: number): Array<{ x: number; y: number }> {
    const targets: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < count; i++) {
      const t = i / count;
      const x = t * this.width;
      const y = this.height / 2 + Math.sin(t * Math.PI * 4) * (this.height * 0.15);
      targets.push({ x, y });
    }
    return targets;
  }
}

function withAlpha(color: string, alpha: number): string {
  // Handle #RRGGBB → rgba()
  if (color.startsWith("#") && color.length === 7) {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return color;
}

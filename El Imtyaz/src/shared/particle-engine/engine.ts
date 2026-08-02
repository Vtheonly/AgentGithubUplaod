/**
 * ParticleEngine — renderer-side particle system orchestrator.
 *
 * Ported from `import-engine-particle/src/engine.ts` and adapted to the
 * El-Imtiyaz renderer:
 *   - No `EventEmitter` from Node `events` — uses a tiny typed listener bag.
 *   - No `JobQueue` or `IPCHandler` (single-shot pipeline is enough for splash).
 *   - No `setInterval` simulation loop by default — exposes a public
 *     `step()` so React hosts can drive it via `requestAnimationFrame`.
 *   - Optional `startSimulation()` / `pauseSimulation()` for callers that
 *     want the engine to manage its own rAF loop.
 */
import type {
  ParticleEngineConfig,
  ParticleState,
  LogoMode,
  InteractionConfig,
  SimulationFrame,
  PipelineConfig,
  Palette,
  PhysicsConfig,
  CircularModeConfig,
  LinearModeConfig,
} from "./types";
import { DEFAULT_PALETTE } from "./types";
import { ParticleEngineError, ConfigError } from "./errors";
import { executePipeline, type PipelineResult } from "./pipeline/pipeline";
import { createParticle, updateParticle, toFrameData } from "./physics/particle";
import { updateTargets } from "./physics/morphing";

/** Default interaction state (no mouse). */
const DEFAULT_INTERACTION: InteractionConfig = {
  radius: 100,
  force: 6,
  pointerX: null,
  pointerY: null,
  active: false,
};

/** Event types emitted by the engine. */
type EngineEventMap = {
  ready: { particleCount: number };
  frame: SimulationFrame;
  error: { error: string };
  progress: { progress: number; message: string };
};

type EngineEventName = keyof EngineEventMap;
type Listener<T> = (payload: T) => void;

/** Internal: a per-event set of listeners. We store `Set<Function>` and cast at emit/on sites. */
type AnyListenerSet = Set<(payload: unknown) => void>;

export class ParticleEngine {
  private particles: ParticleState[] = [];
  private mode: LogoMode = "logo";
  private interaction: InteractionConfig = { ...DEFAULT_INTERACTION };
  private destroyed = false;

  private config: ParticleEngineConfig | null = null;
  private canvasWidth = 0;
  private canvasHeight = 0;
  private palette: Palette = DEFAULT_PALETTE;
  private physicsConfig: PhysicsConfig = {};
  private circularConfig: CircularModeConfig = {};
  private linearConfig: LinearModeConfig = {};
  private progressValue = { value: 0 };
  private pipelineResult: PipelineResult | null = null;

  private rafId: number | null = null;
  private lastTickMs = 0;

  private listeners: Record<EngineEventName, AnyListenerSet> = {
    ready: new Set(),
    frame: new Set(),
    error: new Set(),
    progress: new Set(),
  };

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Import an image and generate particles.
   *
   * Validates the config, runs the load → sample → project pipeline, and
   * initialises particles at the projected positions.
   */
  async initialize(config: ParticleEngineConfig): Promise<void> {
    if (this.destroyed) {
      throw new ParticleEngineError("Engine has been destroyed", "ENGINE_DESTROYED");
    }
    this.validateConfig(config);
    this.config = config;

    this.canvasWidth = config.pipeline.canvasWidth;
    this.canvasHeight = config.pipeline.canvasHeight;
    this.palette = config.pipeline.palette ?? DEFAULT_PALETTE;
    this.physicsConfig = config.physics ?? {};
    this.circularConfig = config.circular ?? {};
    this.linearConfig = config.linear ?? {};
    this.mode = config.initialMode ?? "logo";
    this.interaction = { ...DEFAULT_INTERACTION, ...config.interaction };

    try {
      this.emit("progress", { progress: 0.1, message: "Starting pipeline…" });

      this.pipelineResult = await executePipeline(config.pipeline, (p, msg) =>
        this.emit("progress", { progress: p, message: msg }),
      );

      // Create particles from projected points.
      const { projection } = this.pipelineResult;
      this.particles = projection.points.map((pt, i) =>
        createParticle(i, pt.x, pt.y, this.palette, this.physicsConfig),
      );

      // Set initial targets for the chosen mode.
      updateTargets(
        this.particles,
        this.mode,
        this.canvasWidth,
        this.canvasHeight,
        Date.now(),
        this.circularConfig,
        this.linearConfig,
        this.progressValue,
      );

      this.emit("ready", { particleCount: this.particles.length });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.emit("error", { error: msg });
      throw err;
    }
  }

  /** Set the animation mode. Resets `progressValue` for linear mode. */
  setMode(mode: LogoMode): void {
    if (this.destroyed) return;
    this.mode = mode;
    this.progressValue.value = 0;
    updateTargets(
      this.particles,
      mode,
      this.canvasWidth,
      this.canvasHeight,
      Date.now(),
      this.circularConfig,
      this.linearConfig,
      this.progressValue,
    );
  }

  /** Update interaction parameters (mouse/touch state). */
  setInteraction(interaction: Partial<InteractionConfig>): void {
    if (this.destroyed) return;
    Object.assign(this.interaction, interaction);
  }

  /**
   * Run one simulation tick. Returns the produced frame, or `null` if
   * the engine is empty / destroyed.
   *
   * React hosts should call this from a `requestAnimationFrame` loop.
   */
  step(): SimulationFrame | null {
    if (this.destroyed || this.particles.length === 0) return null;

    const time = Date.now();

    // Update targets for time-dependent modes.
    if (this.mode === "circular" || this.mode === "linear") {
      updateTargets(
        this.particles,
        this.mode,
        this.canvasWidth,
        this.canvasHeight,
        time,
        this.circularConfig,
        this.linearConfig,
        this.progressValue,
      );
    }

    // Apply physics to each particle.
    for (const p of this.particles) {
      updateParticle(p, this.interaction, this.physicsConfig);
    }

    const frame: SimulationFrame = {
      t: time,
      mode: this.mode,
      particles: this.particles.map(toFrameData),
    };
    this.emit("frame", frame);
    return frame;
  }

  /**
   * Start an internal rAF-driven simulation loop. Useful for non-React
   * hosts. React hosts should prefer calling `step()` from their own
   * rAF loop for finer control over rendering lifecycle.
   */
  startSimulation(): void {
    if (this.destroyed) return;
    if (this.rafId !== null) return;
    if (this.particles.length === 0) {
      throw new ParticleEngineError(
        "No particles — call initialize first",
        "ENGINE_NOT_READY",
      );
    }

    const loop = () => {
      this.step();
      this.rafId = requestAnimationFrame(loop);
    };
    this.lastTickMs = performance.now();
    this.rafId = requestAnimationFrame(loop);
  }

  /** Pause the internal rAF loop. */
  pauseSimulation(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  /** Get the current number of particles. */
  getParticleCount(): number {
    return this.particles.length;
  }

  /** Get all particle states (full snapshot, including velocities). */
  getParticles(): ParticleState[] {
    return this.particles;
  }

  /** Subscribe to an engine event. Returns an unsubscribe function. */
  on<K extends EngineEventName>(event: K, listener: Listener<EngineEventMap[K]>): () => void {
    const set = this.listeners[event];
    const wrapped = listener as (payload: unknown) => void;
    set.add(wrapped);
    return () => set.delete(wrapped);
  }

  /** Destroy the engine — stop simulation, drop particles, remove listeners. */
  destroy(): void {
    this.pauseSimulation();
    this.particles = [];
    this.pipelineResult = null;
    this.config = null;
    this.destroyed = true;
    for (const key of Object.keys(this.listeners) as EngineEventName[]) {
      this.listeners[key].clear();
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────

  private emit<K extends EngineEventName>(event: K, payload: EngineEventMap[K]): void {
    const set = this.listeners[event];
    for (const listener of set) {
      try {
        listener(payload as unknown);
      } catch {
        // Listeners must not crash the simulation loop.
      }
    }
  }

  private validateConfig(config: ParticleEngineConfig): void {
    const { pipeline } = config;
    if (!pipeline.canvasWidth || pipeline.canvasWidth <= 0) {
      throw new ConfigError("canvasWidth must be a positive number");
    }
    if (!pipeline.canvasHeight || pipeline.canvasHeight <= 0) {
      throw new ConfigError("canvasHeight must be a positive number");
    }
    const source: PipelineConfig["source"] = pipeline.source;
    if (!source.url && !source.buffer && !source.fallback) {
      throw new ConfigError(
        "At least one image source must be provided (url, buffer, or fallback)",
      );
    }
  }
}

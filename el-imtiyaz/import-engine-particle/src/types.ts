/**
 * particle-import-engine — Core Type Definitions
 *
 * Shared types for the entire import engine: particle state vectors,
 * image pipeline config, physics parameters, mode enums, and IPC
 * message contracts.
 */

// ─── Mode & Display ─────────────────────────────────────────────────────────

/** Animation morphing mode for the particle system. */
export type LogoMode = 'logo' | 'circular' | 'linear';

/** Overall lifecycle state of an import job. */
export type JobState = 'pending' | 'loading' | 'sampling' | 'projecting' | 'ready' | 'running' | 'paused' | 'error' | 'destroyed';

// ─── Particle State Vector ──────────────────────────────────────────────────

/** RGB colour triplet in [0, 255]. */
export type RGB = [number, number, number];

/** Full serialisable particle state — enough to reconstruct rendering on the client. */
export interface ParticleState {
  /** Unique particle index within the system. */
  id: number;
  /** Current x position on the canvas. */
  x: number;
  /** Current y position on the canvas. */
  y: number;
  /** Current x velocity. */
  vx: number;
  /** Current y velocity. */
  vy: number;
  /** Current spring target x. */
  targetX: number;
  /** Current spring target y. */
  targetY: number;
  /** Original logo position x — used for resetting to 'logo' mode. */
  logoX: number;
  /** Original logo position y. */
  logoY: number;
  /** Particle-specific stiffness coefficient (Hooke's Law). */
  stiffness: number;
  /** Velocity damping factor (0–1). */
  damping: number;
  /** Base rendering size (radius). */
  baseSize: number;
  /** Current rendering size. */
  size: number;
  /** Base brand colour. */
  baseColor: RGB;
  /** Current interpolated colour. */
  color: RGB;
}

// ─── Image Pipeline Config ──────────────────────────────────────────────────

/** Palette configuration for particle colour assignment. */
export interface Palette {
  primary: RGB;
  deep: RGB;
  accent: RGB;
}

export const DEFAULT_PALETTE: Palette = {
  primary: [52, 155, 212],
  deep:   [43, 127, 176],
  accent: [200, 169, 140],
};

/** Source specification for the image import pipeline. */
export interface ImageSource {
  /** File-system path to a local image. */
  filePath?: string;
  /** HTTP(S) URL to fetch. */
  url?: string;
  /** Raw image buffer (PNG, JPEG, etc.). */
  buffer?: Buffer;
  /** Use the built-in programmatic fallback pattern. */
  fallback?: boolean;
}

/** Configuration for the import / sampling pipeline. */
export interface PipelineConfig {
  /** Image source to process. */
  source: ImageSource;
  /** Maximum dimension for the offscreen sampling canvas (default 180). */
  maxDim?: number;
  /** Pixel step interval for sampling (lower = denser, default 2). */
  density?: number;
  /** Luminance threshold for dark-pixel detection (default 128). */
  luminanceThreshold?: number;
  /** Palette for particle colour assignment. */
  palette?: Palette;
  /** Canvas width for coordinate projection. */
  canvasWidth: number;
  /** Canvas height for coordinate projection. */
  canvasHeight: number;
  /** Fraction of canvas to fill (0–1, default 0.7). */
  fillRatio?: number;
}

// ─── Physics Config ─────────────────────────────────────────────────────────

/** Mouse / pointer interaction parameters. */
export interface InteractionConfig {
  /** Radius of the repulsion field in canvas pixels (default 100). */
  radius: number;
  /** Magnitude of the repulsion force (default 6.0). */
  force: number;
  /** Current pointer x position (null if inactive). */
  pointerX: number | null;
  /** Current pointer y position (null if inactive). */
  pointerY: number | null;
  /** Whether the pointer is currently active. */
  active: boolean;
}

/** Full physics simulation configuration. */
export interface PhysicsConfig {
  /** Velocity damping factor (default 0.88). */
  damping?: number;
  /** Stiffness range [min, max] for random sampling (default [0.06, 0.10]). */
  stiffnessRange?: [number, number];
  /** Base size range [min, max] for random sampling (default [1.6, 3.0]). */
  sizeRange?: [number, number];
  /** Colour probability distribution: [primary, deep, accent] (default [0.65, 0.20, 0.15]). */
  colorProbabilities?: [number, number, number];
  /** Excitation colour target (default [239, 242, 243]). */
  excitationColor?: RGB;
  /** Excitation colour lerp speed (default 0.4). */
  excitationSpeed?: number;
  /** Relaxation colour lerp speed (default 0.08). */
  relaxationSpeed?: number;
  /** Size excitation multiplier (default 1.5). */
  sizeExcitationMultiplier?: number;
  /** Size relaxation lerp speed (default 0.1). */
  sizeRelaxationSpeed?: number;
}

// ─── Circular Mode Config ───────────────────────────────────────────────────

export interface CircularModeConfig {
  /** Number of concentric rings (default 3). */
  ringCount?: number;
  /** Base radius for the innermost ring (default 90). */
  baseRadius?: number;
  /** Radius increment per ring (default 10). */
  ringSpacing?: number;
  /** Radial harmonic amplitude (default 3). */
  harmonicAmplitude?: number;
  /** Angular velocity in rad/ms (default 0.002). */
  angularVelocity?: number;
  /** Counter-rotation multiplier for odd rings (default 0.8). */
  counterRotationFactor?: number;
}

// ─── Linear Mode Config ─────────────────────────────────────────────────────

export interface LinearModeConfig {
  /** Fraction of canvas width for the bar (default 0.75). */
  barWidthFraction?: number;
  /** Maximum bar width in pixels (default 500). */
  maxBarWidth?: number;
  /** Bar height in pixels (default 24). */
  barHeight?: number;
  /** Wave influence radius in pixels (default 45). */
  waveRadius?: number;
  /** Wave amplitude in pixels (default 12). */
  waveAmplitude?: number;
  /** Progress increment per frame (default 0.5). */
  progressSpeed?: number;
  /** Wave colour target (default [110, 193, 228]). */
  waveColor?: RGB;
  /** Wave colour lerp speed (default 0.3). */
  waveColorSpeed?: number;
  /** Base colour relaxation speed (default 0.05). */
  baseColorRelaxationSpeed?: number;
}

// ─── Engine Config (top-level) ──────────────────────────────────────────────

/** Complete configuration for the ImportEngine. */
export interface ImportEngineConfig {
  /** Pipeline configuration. */
  pipeline: PipelineConfig;
  /** Physics configuration. */
  physics?: PhysicsConfig;
  /** Interaction configuration. */
  interaction?: Partial<InteractionConfig>;
  /** Circular mode configuration. */
  circular?: CircularModeConfig;
  /** Linear mode configuration. */
  linear?: LinearModeConfig;
  /** Initial mode (default 'logo'). */
  initialMode?: LogoMode;
  /** Background colour for motion blur (default 'rgba(36, 37, 38, 0.25)'). */
  background?: string;
  /** Simulation tick interval in ms (default 16 ≈ 60 FPS). */
  tickInterval?: number;
  /** Maximum number of retry attempts for failed jobs (default 3). */
  maxRetries?: number;
}

// ─── Job & Progress ─────────────────────────────────────────────────────────

/** An import job tracked by the engine. */
export interface ImportJob {
  /** Unique job identifier. */
  id: string;
  /** Current job state. */
  state: JobState;
  /** Pipeline config used to create this job. */
  config: PipelineConfig;
  /** Number of retry attempts made so far. */
  retries: number;
  /** Maximum retries allowed. */
  maxRetries: number;
  /** Creation timestamp (epoch ms). */
  createdAt: number;
  /** Last update timestamp (epoch ms). */
  updatedAt: number;
  /** Error message if state is 'error'. */
  error?: string;
  /** Progress fraction 0–1. */
  progress: number;
  /** Number of particles generated. */
  particleCount: number;
}

/** Progress event payload emitted during import. */
export interface ProgressEvent {
  /** Job ID. */
  jobId: string;
  /** Current state. */
  state: JobState;
  /** Progress fraction 0–1. */
  progress: number;
  /** Human-readable status message. */
  message: string;
}

// ─── Simulation Frame ───────────────────────────────────────────────────────

/** A single simulation frame snapshot sent to the client. */
export interface SimulationFrame {
  /** Timestamp (epoch ms). */
  t: number;
  /** Current mode. */
  mode: LogoMode;
  /** Compact particle state array — only the fields that change per frame. */
  particles: Array<{
    id: number;
    x: number;
    y: number;
    size: number;
    color: RGB;
  }>;
}

// ─── IPC Messages ───────────────────────────────────────────────────────────

/** IPC message types the engine can receive from the Electron renderer. */
export type InboundMessage =
  | { type: 'import'; config: ImportEngineConfig }
  | { type: 'setMode'; mode: LogoMode }
  | { type: 'setInteraction'; interaction: Partial<InteractionConfig> }
  | { type: 'startSimulation' }
  | { type: 'pauseSimulation' }
  | { type: 'resumeSimulation' }
  | { type: 'destroy' }
  | { type: 'getJobStatus'; jobId: string }
  | { type: 'listJobs' };

/** IPC message types the engine sends back to the renderer. */
export type OutboundMessage =
  | { type: 'progress'; data: ProgressEvent }
  | { type: 'frame'; data: SimulationFrame }
  | { type: 'ready'; data: { jobId: string; particleCount: number } }
  | { type: 'error'; data: { jobId: string; error: string } }
  | { type: 'jobStatus'; data: ImportJob }
  | { type: 'jobList'; data: ImportJob[] };

/** IPC transport interface — implemented by Electron's ipcMain or a WebSocket. */
export interface IPCTransport {
  send(message: OutboundMessage): void;
  onMessage(handler: (message: InboundMessage) => void): void;
  close(): void;
}

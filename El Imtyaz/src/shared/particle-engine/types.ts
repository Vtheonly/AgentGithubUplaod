/**
 * Particle engine — core type definitions.
 *
 * Ported from the standalone `import-engine-particle` package and adapted
 * to the El-Imtiyaz renderer environment:
 *   - `Buffer` (Node) → `Uint8Array` (DOM-friendly, works with `getImageData`).
 *   - Removed Node-only IPC / JobQueue types — the renderer engine runs
 *     inside the React component tree, so there is no IPC bridge to wire.
 *   - The palette defaults match the brand tokens defined in `src/index.css`
 *     (`--brand-blue`, `--brand-blue-deep`, `--brand-gold`).
 */
export type LogoMode = "logo" | "circular" | "linear";

/** RGB triplet in [0, 255]. */
export type RGB = [number, number, number];

/** Full mutable particle state used by the physics step. */
export interface ParticleState {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  targetX: number;
  targetY: number;
  /** Original logo position — used when morphing back to `logo` mode. */
  logoX: number;
  logoY: number;
  stiffness: number;
  damping: number;
  baseSize: number;
  size: number;
  baseColor: RGB;
  color: RGB;
}

/** Brand palette for particle colour assignment. */
export interface Palette {
  primary: RGB;
  deep: RGB;
  accent: RGB;
}

/**
 * Default brand palette — mirrors the CSS variables in `src/index.css`:
 *   --brand-blue      #349BD4 → [52, 155, 212]
 *   --brand-blue-deep #2B7FB0 → [43, 127, 176]
 *   --brand-gold      #C8A98C → [200, 169, 140]
 */
export const DEFAULT_PALETTE: Palette = {
  primary: [52, 155, 212],
  deep: [43, 127, 176],
  accent: [200, 169, 140],
};

/** Image source for the pipeline. The renderer version supports URLs, blobs, and a programmatic fallback. */
export interface ImageSource {
  /** HTTP(S) URL or `data:` URI to load via HTMLImageElement. */
  url?: string;
  /** Raw encoded image bytes (PNG, JPEG, SVG, …). Wrapped in a Blob at runtime. */
  buffer?: Uint8Array;
  /** Optional MIME type hint when `buffer` is provided (default: `image/png`). */
  mimeType?: string;
  /** Use the built-in programmatic fallback pattern (El-Imtiyaz monogram). */
  fallback?: boolean;
}

/** Configuration for the import / sampling pipeline. */
export interface PipelineConfig {
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
  damping?: number;
  stiffnessRange?: [number, number];
  sizeRange?: [number, number];
  /** Colour probability distribution: [primary, deep, accent] (default [0.65, 0.20, 0.15]). */
  colorProbabilities?: [number, number, number];
  /** Excitation colour target (default near-white). */
  excitationColor?: RGB;
  excitationSpeed?: number;
  relaxationSpeed?: number;
  sizeExcitationMultiplier?: number;
  sizeRelaxationSpeed?: number;
}

export interface CircularModeConfig {
  ringCount?: number;
  baseRadius?: number;
  ringSpacing?: number;
  harmonicAmplitude?: number;
  /** Angular velocity in rad/ms (default 0.002). */
  angularVelocity?: number;
  counterRotationFactor?: number;
}

export interface LinearModeConfig {
  barWidthFraction?: number;
  maxBarWidth?: number;
  barHeight?: number;
  waveRadius?: number;
  waveAmplitude?: number;
  progressSpeed?: number;
  waveColor?: RGB;
  waveColorSpeed?: number;
  baseColorRelaxationSpeed?: number;
}

/** Complete configuration for the particle engine. */
export interface ParticleEngineConfig {
  pipeline: PipelineConfig;
  physics?: PhysicsConfig;
  interaction?: Partial<InteractionConfig>;
  circular?: CircularModeConfig;
  linear?: LinearModeConfig;
  initialMode?: LogoMode;
  /** Background colour used for the motion-blur clear step (default `rgba(36, 37, 38, 0.25)`). */
  background?: string;
}

/** A single simulation frame snapshot — consumed by the React canvas renderer. */
export interface SimulationFrame {
  /** Timestamp (epoch ms). */
  t: number;
  mode: LogoMode;
  /** Compact particle state — only the fields needed for rendering. */
  particles: Array<{
    id: number;
    x: number;
    y: number;
    size: number;
    color: RGB;
  }>;
}

/** Loaded image ready for sampling. */
export interface LoadedImage {
  /** RGBA pixel data (length = width × height × 4). */
  data: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
  channels: 4;
  sourceLabel: string;
}

/**
 * particle-import-engine — Entry Point
 *
 * Public API for the import engine module. Exports the main class,
 * all types, errors, and sub-system modules for direct access.
 *
 * Usage:
 * ```typescript
 * import { ImportEngine, LogoMode } from 'particle-import-engine';
 *
 * const engine = new ImportEngine();
 *
 * // Import with fallback pattern.
 * const jobId = await engine.importImage({
 *   pipeline: {
 *     source: { fallback: true },
 *     canvasWidth: 600,
 *     canvasHeight: 600,
 *   },
 * });
 *
 * // Listen for frames.
 * engine.on('frame', (frame) => {
 *   // Send frame data to renderer via IPC.
 * });
 *
 * engine.startSimulation();
 * ```
 */

// ── Main Engine ─────────────────────────────────────────────────────────────
export { ImportEngine } from './engine';

// ── Types ───────────────────────────────────────────────────────────────────
export type {
  LogoMode,
  JobState,
  RGB,
  Palette,
  ParticleState,
  ImageSource,
  PipelineConfig,
  PhysicsConfig,
  InteractionConfig,
  CircularModeConfig,
  LinearModeConfig,
  ImportEngineConfig,
  ImportJob,
  ProgressEvent,
  SimulationFrame,
  InboundMessage,
  OutboundMessage,
  IPCTransport,
} from './types';

export { DEFAULT_PALETTE } from './types';

// ── Errors ──────────────────────────────────────────────────────────────────
export {
  ImportEngineError,
  ImageLoadError,
  SamplingError,
  ProjectionError,
  JobError,
  ConfigError,
} from './errors';

export type { ErrorCode } from './errors';

// ── Pipeline Sub-Modules ────────────────────────────────────────────────────
export { loadImage, LoadedImage } from './pipeline/image-loader';
export { samplePixels, SamplingResult, SamplePoint } from './pipeline/sampler';
export { projectPoints, ProjectionResult, ProjectedPoint } from './pipeline/projector';
export { generateFallbackPattern } from './pipeline/fallback';
export { executePipeline, PipelineResult } from './pipeline/pipeline';

// ── Physics Sub-Modules ─────────────────────────────────────────────────────
export { createParticle, updateParticle, toFrameData } from './physics/particle';
export { updateTargets } from './physics/morphing';

// ── Colour Sub-Modules ──────────────────────────────────────────────────────
export {
  exciteColor,
  relaxColor,
  waveColorShift,
  roundColor,
  luminance,
} from './color/interpolator';

// ── Job Queue ───────────────────────────────────────────────────────────────
export { JobQueue } from './queue/job-queue';

// ── IPC Handler ─────────────────────────────────────────────────────────────
export { IPCHandler } from './ipc/ipc-handler';

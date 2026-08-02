/**
 * Pipeline orchestrator — load → sample → project.
 *
 * Ported from `import-engine-particle/src/pipeline/pipeline.ts`. Replaces
 * Node's `EventEmitter` with a lightweight typed callback so the engine
 * can run in the renderer without pulling in Node polyfills.
 */
import type { PipelineConfig } from "../types";
import { ImageLoadError } from "../errors";
import { loadImage } from "./image-loader";
import { samplePixels, type SamplingResult } from "./sampler";
import { projectPoints, type ProjectionResult } from "./projector";
import { generateFallbackPattern } from "./fallback";

export interface PipelineResult {
  /** Projected particle positions in canvas space. */
  projection: ProjectionResult;
  /** Sampling statistics. */
  sampling: SamplingResult;
  /** Image metadata. */
  image: {
    width: number;
    height: number;
    sourceLabel: string;
  };
}

/** Progress callback signature — receives a fraction in [0, 1] and a status message. */
export type ProgressCallback = (progress: number, message: string) => void;

/**
 * Execute the full image import pipeline.
 *
 * @param config   - Pipeline configuration.
 * @param onProgress - Optional progress callback (called 5 times during a successful run).
 */
export async function executePipeline(
  config: PipelineConfig,
  onProgress?: ProgressCallback,
): Promise<PipelineResult> {
  // ── Stage 1: Image Loading ──────────────────────────────────────────────
  onProgress?.(0.1, "Loading image source…");

  const maxDim = config.maxDim ?? 180;
  const loaded = config.source.fallback
    ? await generateFallbackPattern()
    : await loadImage(config.source, maxDim);

  onProgress?.(
    0.35,
    `Image loaded: ${loaded.width}x${loaded.height} from ${loaded.sourceLabel}`,
  );

  // ── Stage 2: Pixel Sampling ─────────────────────────────────────────────
  onProgress?.(0.5, "Sampling dark pixels…");

  const samplingResult = samplePixels(
    loaded.data,
    loaded.width,
    loaded.height,
    {
      density: config.density,
      luminanceThreshold: config.luminanceThreshold,
    },
  );

  if (samplingResult.darkPixelCount === 0) {
    throw new ImageLoadError(
      "No dark pixels found in the image. The image may be entirely white or too bright.",
    );
  }

  onProgress?.(
    0.7,
    `Sampled ${samplingResult.darkPixelCount} dark pixels from ${samplingResult.totalScanned} scanned`,
  );

  // ── Stage 3: Coordinate Projection ──────────────────────────────────────
  onProgress?.(0.85, "Projecting coordinates onto canvas…");

  const projectionResult = projectPoints(
    samplingResult.points,
    loaded.width,
    loaded.height,
    {
      canvasWidth: config.canvasWidth,
      canvasHeight: config.canvasHeight,
      fillRatio: config.fillRatio,
    },
  );

  onProgress?.(
    1.0,
    `Projection complete: ${projectionResult.points.length} particles at scale ${projectionResult.scale.toFixed(3)}`,
  );

  return {
    projection: projectionResult,
    sampling: samplingResult,
    image: {
      width: loaded.width,
      height: loaded.height,
      sourceLabel: loaded.sourceLabel,
    },
  };
}

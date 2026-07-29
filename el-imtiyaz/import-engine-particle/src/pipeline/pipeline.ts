/**
 * particle-import-engine — Pipeline Orchestrator
 *
 * Coordinates the full image import pipeline: load → sample → project.
 * Emits progress events at each stage and returns the final projected
 * particle positions ready for physics initialisation.
 */

import { EventEmitter } from 'events';
import { PipelineConfig, DEFAULT_PALETTE, RGB, ProgressEvent } from '../types';
import { ImageLoadError } from '../errors';
import { loadImage, LoadedImage } from './image-loader';
import { samplePixels, SamplingResult } from './sampler';
import { projectPoints, ProjectionResult } from './projector';
import { generateFallbackPattern } from './fallback';

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

/**
 * Execute the full image import pipeline.
 *
 * @param config   - Pipeline configuration.
 * @param jobId    - Job ID for progress events.
 * @param emitter  - EventEmitter to emit progress on.
 */
export async function executePipeline(
  config: PipelineConfig,
  jobId: string,
  emitter: EventEmitter,
): Promise<PipelineResult> {
  // ── Stage 1: Image Loading ──────────────────────────────────────────────
  emitter.emit('progress', {
    jobId,
    state: 'loading',
    progress: 0.1,
    message: 'Loading image source…',
  } as ProgressEvent);

  let loaded: LoadedImage;
  const maxDim = config.maxDim ?? 180;

  if (config.source.fallback) {
    loaded = await generateFallbackPattern();
  } else {
    loaded = await loadImage(config.source, maxDim);
  }

  emitter.emit('progress', {
    jobId,
    state: 'loading',
    progress: 0.35,
    message: `Image loaded: ${loaded.width}x${loaded.height} from ${loaded.sourceLabel}`,
  } as ProgressEvent);

  // ── Stage 2: Pixel Sampling ─────────────────────────────────────────────
  emitter.emit('progress', {
    jobId,
    state: 'sampling',
    progress: 0.5,
    message: 'Sampling dark pixels…',
  } as ProgressEvent);

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
      'No dark pixels found in the image. The image may be entirely white or too bright.',
    );
  }

  emitter.emit('progress', {
    jobId,
    state: 'sampling',
    progress: 0.7,
    message: `Sampled ${samplingResult.darkPixelCount} dark pixels from ${samplingResult.totalScanned} scanned`,
  } as ProgressEvent);

  // ── Stage 3: Coordinate Projection ──────────────────────────────────────
  emitter.emit('progress', {
    jobId,
    state: 'projecting',
    progress: 0.85,
    message: 'Projecting coordinates onto canvas…',
  } as ProgressEvent);

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

  emitter.emit('progress', {
    jobId,
    state: 'projecting',
    progress: 1.0,
    message: `Projection complete: ${projectionResult.points.length} particles at scale ${projectionResult.scale.toFixed(3)}`,
  } as ProgressEvent);

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

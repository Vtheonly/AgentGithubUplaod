/**
 * particle-import-engine — Canvas Coordinate Projector
 *
 * Projects offscreen sample coordinates onto the main rendering canvas
 * with aspect-ratio-preserving scaling and centering. This converts
 * raw image-space (x, y) pairs into canvas-space target positions
 * that the particle system will use.
 */

import { ProjectionError } from '../errors';
import { SamplePoint } from './sampler';

/** A projected coordinate in canvas space. */
export interface ProjectedPoint {
  /** Canvas-space x coordinate. */
  x: number;
  /** Canvas-space y coordinate. */
  y: number;
  /** Original offscreen x coordinate. */
  sourceX: number;
  /** Original offscreen y coordinate. */
  sourceY: number;
}

/** Projection result. */
export interface ProjectionResult {
  /** Projected points in canvas space. */
  points: ProjectedPoint[];
  /** Uniform scale factor applied. */
  scale: number;
  /** X offset for centering. */
  offsetX: number;
  /** Y offset for centering. */
  offsetY: number;
  /** Offscreen image width used. */
  sourceWidth: number;
  /** Offscreen image height used. */
  sourceHeight: number;
}

/** Configuration for the projection pass. */
export interface ProjectionConfig {
  /** Canvas width in pixels. */
  canvasWidth: number;
  /** Canvas height in pixels. */
  canvasHeight: number;
  /** Fraction of canvas to fill (0–1, default 0.7). */
  fillRatio?: number;
}

/**
 * Project offscreen sample points onto the main canvas.
 *
 * The projection applies a uniform scale so that the sampled image
 * fills `fillRatio` of the canvas (70% by default), then centres
 * the result within the canvas bounds.
 *
 * @param samplePoints - Points extracted by the sampler.
 * @param sourceWidth  - Width of the offscreen image.
 * @param sourceHeight - Height of the offscreen image.
 * @param config       - Projection configuration.
 */
export function projectPoints(
  samplePoints: SamplePoint[],
  sourceWidth: number,
  sourceHeight: number,
  config: ProjectionConfig,
): ProjectionResult {
  try {
    const {
      canvasWidth,
      canvasHeight,
      fillRatio = 0.7,
    } = config;

    if (canvasWidth <= 0 || canvasHeight <= 0) {
      throw new ProjectionError(`Invalid canvas dimensions: ${canvasWidth}x${canvasHeight}`);
    }

    if (sourceWidth <= 0 || sourceHeight <= 0) {
      throw new ProjectionError(`Invalid source dimensions: ${sourceWidth}x${sourceHeight}`);
    }

    // Compute uniform scale factor: fit within fillRatio of canvas.
    const scale = Math.min(
      (canvasWidth * fillRatio) / sourceWidth,
      (canvasHeight * fillRatio) / sourceHeight,
    );

    // Centre the projected image within the canvas.
    const offsetX = (canvasWidth - sourceWidth * scale) / 2;
    const offsetY = (canvasHeight - sourceHeight * scale) / 2;

    const points: ProjectedPoint[] = samplePoints.map((sp) => ({
      x: sp.x * scale + offsetX,
      y: sp.y * scale + offsetY,
      sourceX: sp.x,
      sourceY: sp.y,
    }));

    return {
      points,
      scale,
      offsetX,
      offsetY,
      sourceWidth,
      sourceHeight,
    };
  } catch (err) {
    if (err instanceof ProjectionError) throw err;
    throw new ProjectionError(
      `Projection failed: ${(err as Error).message}`,
      err as Error,
    );
  }
}

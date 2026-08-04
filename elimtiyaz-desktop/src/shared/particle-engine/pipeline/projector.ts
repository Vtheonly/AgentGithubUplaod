/**
 * Canvas coordinate projector — pure TypeScript.
 *
 * Ported from `import-engine-particle/src/pipeline/projector.ts`. Projects
 * offscreen sample coordinates onto the main rendering canvas with
 * aspect-ratio-preserving scaling and centering.
 */
import { ProjectionError } from "../errors";
import type { SamplePoint } from "./sampler";

export interface ProjectedPoint {
  x: number;
  y: number;
  sourceX: number;
  sourceY: number;
}

export interface ProjectionResult {
  points: ProjectedPoint[];
  scale: number;
  offsetX: number;
  offsetY: number;
  sourceWidth: number;
  sourceHeight: number;
}

export interface ProjectionConfig {
  canvasWidth: number;
  canvasHeight: number;
  /** Fraction of canvas to fill (0–1, default 0.7). */
  fillRatio?: number;
}

/**
 * Project offscreen sample points onto the main canvas.
 *
 * Applies a uniform scale so the sampled image fills `fillRatio` of the
 * canvas (70% by default), then centres the result.
 */
export function projectPoints(
  samplePoints: SamplePoint[],
  sourceWidth: number,
  sourceHeight: number,
  config: ProjectionConfig,
): ProjectionResult {
  try {
    const { canvasWidth, canvasHeight, fillRatio = 0.7 } = config;

    if (canvasWidth <= 0 || canvasHeight <= 0) {
      throw new ProjectionError(`Invalid canvas dimensions: ${canvasWidth}x${canvasHeight}`);
    }
    if (sourceWidth <= 0 || sourceHeight <= 0) {
      throw new ProjectionError(`Invalid source dimensions: ${sourceWidth}x${sourceHeight}`);
    }

    const scale = Math.min(
      (canvasWidth * fillRatio) / sourceWidth,
      (canvasHeight * fillRatio) / sourceHeight,
    );

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

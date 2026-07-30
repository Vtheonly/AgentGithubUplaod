/**
 * Pixel luminance sampler — pure TypeScript.
 *
 * Ported from `import-engine-particle/src/pipeline/sampler.ts`. Accepts
 * any indexed byte buffer (`Uint8Array` or `Uint8ClampedArray`); both are
 * produced by `<canvas>.getImageData().data` in the renderer.
 */
import { SamplingError } from "../errors";

export interface SamplePoint {
  x: number;
  y: number;
  /** Raw luminance value (0–255). */
  luminance: number;
}

export interface SamplingResult {
  points: SamplePoint[];
  width: number;
  height: number;
  darkPixelCount: number;
  totalScanned: number;
}

export interface SamplerConfig {
  /** Pixel step interval (lower = denser, default 2). */
  density?: number;
  /** Luminance threshold for dark-pixel detection (default 128). */
  luminanceThreshold?: number;
}

/**
 * Sample dark pixels from a raw RGBA buffer.
 *
 * For each pixel at step intervals of `density`, the luminance is
 * computed as the arithmetic mean of R, G, and B channels. If the
 * luminance falls below the threshold, the pixel coordinate is
 * included in the output.
 */
export function samplePixels(
  data: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  config: SamplerConfig = {},
): SamplingResult {
  const density = config.density ?? 2;
  const threshold = config.luminanceThreshold ?? 128;

  if (width <= 0 || height <= 0) {
    throw new SamplingError(`Invalid image dimensions: ${width}x${height}`);
  }

  try {
    const points: SamplePoint[] = [];
    let totalScanned = 0;

    for (let y = 0; y < height; y += density) {
      for (let x = 0; x < width; x += density) {
        const idx = (y * width + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        // Alpha channel (data[idx + 3]) is ignored for luminance.
        const lum = (r + g + b) / 3;
        totalScanned++;

        if (lum < threshold) {
          points.push({ x, y, luminance: lum });
        }
      }
    }

    return {
      points,
      width,
      height,
      darkPixelCount: points.length,
      totalScanned,
    };
  } catch (err) {
    throw new SamplingError(
      `Pixel sampling failed: ${(err as Error).message}`,
      err as Error,
    );
  }
}

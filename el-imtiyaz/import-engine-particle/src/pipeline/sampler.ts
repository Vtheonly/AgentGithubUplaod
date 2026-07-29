/**
 * particle-import-engine — Pixel Luminance Sampler
 *
 * Scans an RGBA pixel buffer and extracts dark-region coordinates
 * based on a luminance threshold. This is the core of the import
 * pipeline — it converts image data into a list of (x, y) sample
 * points that become particle positions.
 */

import { SamplingError } from '../errors';

/** A single sample point extracted from the image. */
export interface SamplePoint {
  /** X coordinate in the offscreen image. */
  x: number;
  /** Y coordinate in the offscreen image. */
  y: number;
  /** Raw luminance value (0–255). */
  luminance: number;
}

/** Result of the sampling pass. */
export interface SamplingResult {
  /** Extracted sample points. */
  points: SamplePoint[];
  /** Width of the sampled image. */
  width: number;
  /** Height of the sampled image. */
  height: number;
  /** Total number of dark pixels found. */
  darkPixelCount: number;
  /** Total number of pixels scanned. */
  totalScanned: number;
}

/** Configuration for the sampling pass. */
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
 *
 * @param data   - Raw RGBA pixel buffer (4 bytes per pixel).
 * @param width  - Image width in pixels.
 * @param height - Image height in pixels.
 * @param config - Sampling configuration.
 */
export function samplePixels(
  data: Buffer,
  width: number,
  height: number,
  config: SamplerConfig = {},
): SamplingResult {
  const density = config.density ?? 2;
  const threshold = config.luminanceThreshold ?? 128;

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
        const luminance = (r + g + b) / 3;
        totalScanned++;

        if (luminance < threshold) {
          points.push({ x, y, luminance });
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

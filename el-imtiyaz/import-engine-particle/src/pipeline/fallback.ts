/**
 * particle-import-engine — Programmatic Fallback Pattern Generator
 *
 * Generates the El-Imtiyaz student silhouette & graduation cape
 * pattern programmatically using SVG rendered by `sharp`.
 * This produces a raw RGBA pixel buffer identical to what the image
 * loader would return, so the downstream pipeline is unchanged.
 *
 * This is used when no image file or URL is supplied — the engine
 * falls back to a built-in vector graphic.
 *
 * No native canvas dependency required — uses pure SVG + sharp.
 */

import sharp from 'sharp';
import { SamplingError } from '../errors';
import { LoadedImage } from './image-loader';

/** Canvas size for the fallback pattern. */
const FALLBACK_SIZE = 300;

/**
 * Build the SVG string for the El-Imtiyaz pattern.
 *
 * The pattern consists of:
 *   1. Two student head silhouettes (circles).
 *   2. Graduation cape sweeps (quadratic Bezier curves).
 *   3. Centre arches (quadratic Bezier curves).
 *   4. "E" brand monogram overlay.
 *
 * SVG quadratic Bezier: Q cx cy, ex ey
 * (equivalent to canvas quadraticCurveTo(cx, cy, ex, ey))
 */
function buildFallbackSVG(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${FALLBACK_SIZE}" height="${FALLBACK_SIZE}" viewBox="0 0 ${FALLBACK_SIZE} ${FALLBACK_SIZE}">
  <rect width="100%" height="100%" fill="#ffffff"/>

  <!-- 1. Two heads (the "students" silhouette) -->
  <circle cx="120" cy="90" r="24" fill="#000000"/>
  <circle cx="180" cy="110" r="20" fill="#000000"/>

  <!-- 2. Sweeping wing shapes (graduation-cape silhouette) -->
  <path d="M150,150 Q80,120 20,220 Q80,170 150,150" fill="#000000"/>
  <path d="M150,150 Q220,130 280,240 Q210,180 150,150" fill="#000000"/>

  <!-- 3. Centre arches -->
  <path d="M150,150 Q110,160 70,240 Q110,190 150,150" fill="#000000"/>
  <path d="M150,150 Q190,160 230,260 Q190,200 150,150" fill="#000000"/>

  <!-- 4. "E" brand monogram overlay -->
  <text x="150" y="75" text-anchor="middle" font-family="Arial, sans-serif" font-size="60" font-weight="bold" fill="#000000">E</text>
</svg>`;
}

/**
 * Generate the programmatic fallback pattern and return it as
 * a LoadedImage (raw RGBA buffer + dimensions).
 *
 * Uses sharp to render the SVG to raw RGBA pixels — no native
 * canvas library required.
 */
export async function generateFallbackPattern(): Promise<LoadedImage> {
  try {
    const svg = buildFallbackSVG();

    const { data, info } = await sharp(Buffer.from(svg))
      .resize(FALLBACK_SIZE, FALLBACK_SIZE)
      .raw()
      .ensureAlpha()
      .toBuffer({ resolveWithObject: true });

    return {
      data: data as Buffer,
      width: info.width,
      height: info.height,
      channels: 4,
      sourceLabel: '<fallback-pattern>',
    };
  } catch (err) {
    throw new SamplingError(
      `Fallback pattern generation failed: ${(err as Error).message}`,
      err as Error,
    );
  }
}

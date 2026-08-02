/**
 * Renderer-side programmatic fallback pattern.
 *
 * Replaces the standalone engine's `sharp`-based SVG rasteriser with a
 * direct Canvas 2D drawing routine. Produces the same `LoadedImage`
 * shape as `image-loader.ts`, so the downstream pipeline is unchanged.
 *
 * The pattern is the El-Imtiyaz "EI" brand monogram — a bold sans-serif
 * "EI" rendered at the canvas centre. This is the canonical brand mark
 * used by the splash screen when no external image is supplied.
 */
import { SamplingError } from "../errors";
import type { LoadedImage } from "../types";

/** Canvas size for the fallback pattern. */
export const FALLBACK_SIZE = 300;

/**
 * Generate the programmatic fallback pattern.
 *
 * Draws a bold "EI" monogram on a white background using Canvas 2D
 * primitives. The dark pixels of the glyph become particle target
 * positions in the downstream pipeline.
 */
export async function generateFallbackPattern(): Promise<LoadedImage> {
  try {
    const size = FALLBACK_SIZE;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new SamplingError("Canvas 2D context unavailable");

    // White background (so the glyph produces dark-pixel targets).
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, size, size);

    // Bold "EI" monogram centred on the canvas.
    // The font size is tuned so the glyph fills ~70% of the canvas height,
    // matching the `fillRatio` default used by the projector.
    const fontSize = Math.floor(size * 0.55);
    ctx.fillStyle = "#000000";
    ctx.font = `bold ${fontSize}px Inter, "Helvetica Neue", Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("EI", size / 2, size / 2);

    const imageData = ctx.getImageData(0, 0, size, size);
    return {
      data: imageData.data,
      width: size,
      height: size,
      channels: 4,
      sourceLabel: "<fallback-ei-monogram>",
    };
  } catch (err) {
    if (err instanceof SamplingError) throw err;
    throw new SamplingError(
      `Fallback pattern generation failed: ${(err as Error).message}`,
      err as Error,
    );
  }
}

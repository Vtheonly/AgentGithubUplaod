/**
 * Renderer-side image loader.
 *
 * Replaces the standalone engine's `sharp`-based loader with an
 * `HTMLImageElement` + `<canvas>` pipeline that runs entirely inside
 * the Electron renderer process. No native modules required.
 *
 * Supported sources:
 *   - `url`     → HTTP(S) or `data:` URI loaded via `<img>`.
 *   - `buffer`  → raw encoded image bytes wrapped in a `Blob` and loaded
 *                 via `URL.createObjectURL`.
 *   - `fallback`→ delegate to `generateFallbackPattern()` in `fallback.ts`.
 */
import { ImageLoadError } from "../errors";
import type { ImageSource, LoadedImage } from "../types";

/** Default maximum dimension for the offscreen sampling canvas. */
const DEFAULT_MAX_DIM = 180;

/**
 * Load an image and downscale it to ≤ `maxDim` per side, preserving aspect
 * ratio. Returns raw RGBA pixel data via `<canvas>.getImageData()`.
 */
export async function loadImage(
  source: ImageSource,
  maxDim: number = DEFAULT_MAX_DIM,
): Promise<LoadedImage> {
  if (source.fallback) {
    // Delegated to fallback.ts to avoid a circular import.
    const { generateFallbackPattern } = await import("./fallback");
    return generateFallbackPattern();
  }

  let objectUrl: string | null = null;
  let img: HTMLImageElement;

  try {
    if (source.url) {
      img = await loadFromUrl(source.url);
    } else if (source.buffer) {
      const mime = source.mimeType ?? "image/png";
      const blob = new Blob([source.buffer as BlobPart], { type: mime });
      objectUrl = URL.createObjectURL(blob);
      img = await loadFromUrl(objectUrl);
    } else {
      throw new ImageLoadError("No image source provided (need url, buffer, or fallback)");
    }

    const { data, width, height, sourceLabel } = rasterize(img, source, maxDim);
    return { data, width, height, channels: 4, sourceLabel };
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

function loadFromUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new ImageLoadError(`Failed to load image from URL: ${url}`));
    img.src = url;
  });
}

function rasterize(
  img: HTMLImageElement,
  source: ImageSource,
  maxDim: number,
): { data: Uint8ClampedArray; width: number; height: number; sourceLabel: string } {
  const naturalW = img.naturalWidth || img.width;
  const naturalH = img.naturalHeight || img.height;
  if (naturalW <= 0 || naturalH <= 0) {
    throw new ImageLoadError(`Invalid image dimensions: ${naturalW}x${naturalH}`);
  }

  // Aspect-preserving downscale.
  const scale = Math.min(1, maxDim / Math.max(naturalW, naturalH));
  const w = Math.max(1, Math.round(naturalW * scale));
  const h = Math.max(1, Math.round(naturalH * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new ImageLoadError("Canvas 2D context unavailable");
  ctx.drawImage(img, 0, 0, w, h);

  const imageData = ctx.getImageData(0, 0, w, h);
  return {
    data: imageData.data,
    width: w,
    height: h,
    sourceLabel: source.url ?? `<buffer:${w}x${h}>`,
  };
}

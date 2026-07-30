/**
 * Tests for the particle engine pipeline modules — sampler + projector.
 *
 * These are the pure functions that convert a raw RGBA pixel buffer into
 * canvas-space particle target positions.
 */
import { describe, it, expect } from "vitest";
import { samplePixels } from "../../../shared/particle-engine/pipeline/sampler";
import { projectPoints } from "../../../shared/particle-engine/pipeline/projector";
import { ProjectionError } from "../../../shared/particle-engine/errors";

/** Build a synthetic RGBA buffer where dark pixels form a known shape. */
function makeRgba(width: number, height: number, isDark: (x: number, y: number) => boolean): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      if (isDark(x, y)) {
        data[idx] = 0;
        data[idx + 1] = 0;
        data[idx + 2] = 0;
      } else {
        data[idx] = 255;
        data[idx + 1] = 255;
        data[idx + 2] = 255;
      }
      data[idx + 3] = 255;
    }
  }
  return data;
}

describe("particle-engine / pipeline/sampler.ts", () => {
  it("extracts dark pixel coordinates", () => {
    // 4x4 image: top-left 2x2 block is dark.
    const data = makeRgba(4, 4, (x, y) => x < 2 && y < 2);
    const result = samplePixels(data, 4, 4, { density: 1 });
    expect(result.darkPixelCount).toBe(4);
    expect(result.totalScanned).toBe(16);
    expect(result.width).toBe(4);
    expect(result.height).toBe(4);
    // Dark pixels are at (0,0), (1,0), (0,1), (1,1).
    const coords = result.points.map((p) => `${p.x},${p.y}`).sort();
    expect(coords).toEqual(["0,0", "0,1", "1,0", "1,1"]);
  });

  it("respects the density parameter", () => {
    // 8x8 image all dark.
    const data = makeRgba(8, 8, () => true);
    const result = samplePixels(data, 8, 8, { density: 2 });
    // At density 2, we sample 4x4 = 16 pixels (all dark).
    expect(result.totalScanned).toBe(16);
    expect(result.darkPixelCount).toBe(16);
  });

  it("respects the luminance threshold", () => {
    // Build a 2x2 image where every pixel is mid-grey (128,128,128).
    const data = new Uint8ClampedArray(2 * 2 * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 128;
      data[i + 1] = 128;
      data[i + 2] = 128;
      data[i + 3] = 255;
    }
    // Threshold 128 → pixels with luminance < 128 are dark. Mid-grey is NOT < 128.
    const result = samplePixels(data, 2, 2, { density: 1, luminanceThreshold: 128 });
    expect(result.darkPixelCount).toBe(0);
    // Threshold 129 → mid-grey IS < 129.
    const result2 = samplePixels(data, 2, 2, { density: 1, luminanceThreshold: 129 });
    expect(result2.darkPixelCount).toBe(4);
  });

  it("returns empty points when no dark pixels are found", () => {
    const data = makeRgba(4, 4, () => false);
    const result = samplePixels(data, 4, 4, { density: 1 });
    expect(result.darkPixelCount).toBe(0);
    expect(result.points).toEqual([]);
    expect(result.totalScanned).toBe(16);
  });

  it("uses default density=2 and threshold=128 when not specified", () => {
    // 4x4 image, all dark.
    const data = makeRgba(4, 4, () => true);
    const result = samplePixels(data, 4, 4);
    // At density 2, sample 2x2 = 4 pixels.
    expect(result.totalScanned).toBe(4);
    expect(result.darkPixelCount).toBe(4);
  });

  it("accepts both Uint8Array and Uint8ClampedArray", () => {
    const clamped = makeRgba(2, 2, () => true);
    const plain = new Uint8Array(clamped);
    const r1 = samplePixels(clamped, 2, 2, { density: 1 });
    const r2 = samplePixels(plain, 2, 2, { density: 1 });
    expect(r1.darkPixelCount).toBe(r2.darkPixelCount);
  });

  it("throws on invalid dimensions", () => {
    const data = new Uint8ClampedArray(0);
    expect(() => samplePixels(data, 0, 0)).toThrow();
  });
});

describe("particle-engine / pipeline/projector.ts", () => {
  it("projects sample points onto the canvas with uniform scale", () => {
    const samplePoints = [
      { x: 0, y: 0, luminance: 0 },
      { x: 100, y: 100, luminance: 0 },
    ];
    const result = projectPoints(samplePoints, 100, 100, {
      canvasWidth: 400,
      canvasHeight: 400,
      fillRatio: 1.0,
    });
    // Scale = min(400/100, 400/100) = 4. Offset = (400 - 100*4)/2 = 0.
    expect(result.scale).toBe(4);
    expect(result.offsetX).toBe(0);
    expect(result.offsetY).toBe(0);
    expect(result.points).toHaveLength(2);
    expect(result.points[0].x).toBe(0);
    expect(result.points[0].y).toBe(0);
    expect(result.points[1].x).toBe(400);
    expect(result.points[1].y).toBe(400);
  });

  it("centres the projected image when aspect ratios differ", () => {
    const samplePoints = [{ x: 50, y: 50, luminance: 0 }];
    // Canvas is wide (800x200), source is square (100x100).
    const result = projectPoints(samplePoints, 100, 100, {
      canvasWidth: 800,
      canvasHeight: 200,
      fillRatio: 1.0,
    });
    // Scale = min(800/100, 200/100) = 2 (height-constrained).
    expect(result.scale).toBe(2);
    // Offset X = (800 - 100*2)/2 = 300.
    expect(result.offsetX).toBe(300);
    expect(result.offsetY).toBe(0);
    // Point at (50, 50) → (50*2 + 300, 50*2 + 0) = (400, 100).
    expect(result.points[0].x).toBe(400);
    expect(result.points[0].y).toBe(100);
  });

  it("applies the fillRatio cap (default 0.7)", () => {
    const samplePoints = [{ x: 0, y: 0, luminance: 0 }];
    const result = projectPoints(samplePoints, 100, 100, {
      canvasWidth: 400,
      canvasHeight: 400,
      fillRatio: 0.5,
    });
    // Scale = min(400*0.5/100, 400*0.5/100) = 2.
    expect(result.scale).toBe(2);
    // Offset = (400 - 100*2)/2 = 100.
    expect(result.offsetX).toBe(100);
    expect(result.offsetY).toBe(100);
  });

  it("preserves source coordinates in the projected points", () => {
    const samplePoints = [
      { x: 10, y: 20, luminance: 0 },
      { x: 30, y: 40, luminance: 0 },
    ];
    const result = projectPoints(samplePoints, 50, 50, {
      canvasWidth: 200,
      canvasHeight: 200,
    });
    expect(result.points[0].sourceX).toBe(10);
    expect(result.points[0].sourceY).toBe(20);
    expect(result.points[1].sourceX).toBe(30);
    expect(result.points[1].sourceY).toBe(40);
  });

  it("throws ProjectionError on invalid canvas dimensions", () => {
    expect(() =>
      projectPoints([], 100, 100, { canvasWidth: 0, canvasHeight: 0 }),
    ).toThrow(ProjectionError);
  });

  it("throws ProjectionError on invalid source dimensions", () => {
    expect(() =>
      projectPoints([], 0, 0, { canvasWidth: 100, canvasHeight: 100 }),
    ).toThrow(ProjectionError);
  });

  it("returns empty points for empty input", () => {
    const result = projectPoints([], 100, 100, {
      canvasWidth: 400,
      canvasHeight: 400,
    });
    expect(result.points).toEqual([]);
    expect(result.scale).toBeGreaterThan(0);
  });
});

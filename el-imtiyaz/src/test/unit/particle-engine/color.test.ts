/**
 * Tests for the particle engine colour interpolation utilities.
 *
 * Validates the pure functions in `color/interpolator.ts` — excitation,
 * relaxation, wave shift, rounding, and luminance computation.
 */
import { describe, it, expect } from "vitest";
import {
  exciteColor,
  relaxColor,
  waveColorShift,
  roundColor,
  luminance,
} from "../../../shared/particle-engine/color-interpolator";
import type { RGB } from "../../../shared/particle-engine/types";

describe("particle-engine / color/interpolator.ts", () => {
  describe("exciteColor", () => {
    it("moves colour toward the target by the lerp factor", () => {
      const color: RGB = [0, 0, 0];
      const target: RGB = [100, 100, 100];
      exciteColor(color, target, 0.5);
      expect(color).toEqual([50, 50, 50]);
    });

    it("mutates the input array in place", () => {
      const color: RGB = [10, 20, 30];
      const ref = color;
      exciteColor(color, [100, 100, 100], 0.1);
      expect(color).toBe(ref);
    });

    it("with speed=1.0 snaps to the target instantly", () => {
      const color: RGB = [10, 20, 30];
      exciteColor(color, [200, 100, 50], 1.0);
      expect(color).toEqual([200, 100, 50]);
    });

    it("with speed=0 leaves the colour unchanged", () => {
      const color: RGB = [10, 20, 30];
      exciteColor(color, [200, 100, 50], 0);
      expect(color).toEqual([10, 20, 30]);
    });

    it("uses a default speed of 0.4", () => {
      const color: RGB = [0, 0, 0];
      exciteColor(color, [100, 100, 100]);
      expect(color).toEqual([40, 40, 40]);
    });
  });

  describe("relaxColor", () => {
    it("moves colour toward the base by the lerp factor", () => {
      const color: RGB = [100, 100, 100];
      const base: RGB = [0, 0, 0];
      relaxColor(color, base, 0.5);
      expect(color).toEqual([50, 50, 50]);
    });

    it("with speed=1.0 snaps to the base instantly", () => {
      const color: RGB = [200, 100, 50];
      relaxColor(color, [0, 0, 0], 1.0);
      expect(color).toEqual([0, 0, 0]);
    });

    it("uses a default speed of 0.08", () => {
      const color: RGB = [100, 100, 100];
      relaxColor(color, [0, 0, 0]);
      // 100 - 100 * 0.08 = 92
      expect(color).toEqual([92, 92, 92]);
    });
  });

  describe("waveColorShift", () => {
    it("moves colour toward the wave colour by the lerp factor", () => {
      const color: RGB = [0, 0, 0];
      const wave: RGB = [100, 200, 50];
      waveColorShift(color, wave, 0.5);
      expect(color).toEqual([50, 100, 25]);
    });

    it("uses a default speed of 0.3", () => {
      const color: RGB = [0, 0, 0];
      waveColorShift(color, [100, 100, 100]);
      expect(color).toEqual([30, 30, 30]);
    });
  });

  describe("roundColor", () => {
    it("rounds each channel to the nearest integer", () => {
      const result = roundColor([10.4, 20.5, 30.6]);
      expect(result).toEqual([10, 21, 31]);
    });

    it("returns a NEW array (does not mutate input)", () => {
      const input: RGB = [10.4, 20.5, 30.6];
      const result = roundColor(input);
      expect(result).not.toBe(input);
      expect(input).toEqual([10.4, 20.5, 30.6]); // unchanged
    });
  });

  describe("luminance", () => {
    it("returns the arithmetic mean of R, G, B", () => {
      expect(luminance([0, 0, 0])).toBe(0);
      expect(luminance([255, 255, 255])).toBe(255);
      expect(luminance([100, 200, 50])).toBe((100 + 200 + 50) / 3);
    });

    it("returns 128 for mid-grey", () => {
      expect(luminance([128, 128, 128])).toBe(128);
    });
  });
});

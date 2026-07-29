/**
 * particle-import-engine — Colour Interpolation System
 *
 * Provides pure functions for colour state transitions:
 *   - Excitation (mouse proximity → white pulse).
 *   - Relaxation (return to base brand colour).
 *   - Wave colour shift (linear mode progress wave).
 *
 * These functions operate on mutable RGB arrays in-place for
 * performance (avoiding allocations per frame per particle).
 */

import { RGB } from '../types';

/**
 * Apply excitation interpolation toward the target colour.
 * Used when a particle is within the mouse interaction radius.
 *
 * @param color   - Current particle colour (mutated in place).
 * @param target  - Target colour (e.g., white [239, 242, 243]).
 * @param speed   - Lerp speed (0–1, default 0.4).
 */
export function exciteColor(color: RGB, target: RGB, speed = 0.4): void {
  for (let i = 0; i < 3; i++) {
    color[i] += (target[i] - color[i]) * speed;
  }
}

/**
 * Apply relaxation interpolation back toward the base colour.
 * Used when a particle leaves the interaction radius.
 *
 * @param color     - Current particle colour (mutated in place).
 * @param baseColor - Base brand colour to relax toward.
 * @param speed     - Lerp speed (0–1, default 0.08).
 */
export function relaxColor(color: RGB, baseColor: RGB, speed = 0.08): void {
  for (let i = 0; i < 3; i++) {
    color[i] += (baseColor[i] - color[i]) * speed;
  }
}

/**
 * Apply wave colour shift (used in linear mode).
 * Interpolates toward the wave colour within the wave envelope.
 *
 * @param color      - Current particle colour (mutated in place).
 * @param waveColor  - Wave colour target (e.g., cyan [110, 193, 228]).
 * @param speed      - Lerp speed (0–1, default 0.3).
 */
export function waveColorShift(color: RGB, waveColor: RGB, speed = 0.3): void {
  for (let i = 0; i < 3; i++) {
    color[i] += (waveColor[i] - color[i]) * speed;
  }
}

/**
 * Round colour values to integers for serialisation.
 * Returns a new RGB array — does not mutate the input.
 */
export function roundColor(color: RGB): RGB {
  return [
    Math.round(color[0]),
    Math.round(color[1]),
    Math.round(color[2]),
  ] as RGB;
}

/**
 * Compute the perceived luminance of an RGB colour.
 * Uses the standard formula: L = (R + G + B) / 3.
 */
export function luminance(color: RGB): number {
  return (color[0] + color[1] + color[2]) / 3;
}

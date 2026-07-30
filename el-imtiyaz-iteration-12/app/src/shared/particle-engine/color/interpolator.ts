/**
 * Colour interpolation utilities — pure functions operating on RGB triplets.
 *
 * Ported from `import-engine-particle/src/color/interpolator.ts`. The
 * physics modules inline equivalent logic for hot-path performance, but
 * these standalone functions are the canonical reference and are used by
 * tests + any future visual effects layer.
 */
import type { RGB } from "../types";

/**
 * Excite a colour toward a target colour (lerp).
 * Mutates the input array in place.
 *
 * @param color  - The current colour (mutable).
 * @param target - The colour to move toward.
 * @param speed  - Lerp factor in [0, 1] (default 0.4).
 */
export function exciteColor(color: RGB, target: RGB, speed = 0.4): void {
  color[0] += (target[0] - color[0]) * speed;
  color[1] += (target[1] - color[1]) * speed;
  color[2] += (target[2] - color[2]) * speed;
}

/**
 * Relax a colour back toward its base value (lerp).
 * Mutates the input array in place.
 *
 * @param color     - The current colour (mutable).
 * @param baseColor - The base colour to relax toward.
 * @param speed     - Lerp factor in [0, 1] (default 0.08).
 */
export function relaxColor(color: RGB, baseColor: RGB, speed = 0.08): void {
  color[0] += (baseColor[0] - color[0]) * speed;
  color[1] += (baseColor[1] - color[1]) * speed;
  color[2] += (baseColor[2] - color[2]) * speed;
}

/**
 * Wave colour shift — moves a colour toward the wave colour.
 * Mutates the input array in place.
 *
 * @param color     - The current colour (mutable).
 * @param waveColor - The wave colour to move toward.
 * @param speed     - Lerp factor in [0, 1] (default 0.3).
 */
export function waveColorShift(color: RGB, waveColor: RGB, speed = 0.3): void {
  color[0] += (waveColor[0] - color[0]) * speed;
  color[1] += (waveColor[1] - color[1]) * speed;
  color[2] += (waveColor[2] - color[2]) * speed;
}

/** Round each channel to the nearest integer. Returns a NEW array. */
export function roundColor(color: RGB): RGB {
  return [
    Math.round(color[0]),
    Math.round(color[1]),
    Math.round(color[2]),
  ];
}

/** Average luminance — used by the sampler for dark-pixel detection. */
export function luminance(color: RGB): number {
  return (color[0] + color[1] + color[2]) / 3;
}

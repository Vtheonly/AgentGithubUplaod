/**
 * Particle morphing — pure TypeScript target position computation.
 *
 * Ported from `import-engine-particle/src/physics/morphing.ts`. Computes
 * per-frame target positions for each animation mode; the spring physics
 * in `particle.ts` then smoothly drives particles toward those targets.
 *
 * Modes:
 *   - `logo`     → particles return to their original logo coordinates (one-shot reset).
 *   - `circular` → particles form counter-rotating concentric rings (time-dependent).
 *   - `linear`   → particles form a progress bar with a traveling wave (time-dependent).
 */
import type {
  ParticleState,
  LogoMode,
  CircularModeConfig,
  LinearModeConfig,
} from "../types";

export const DEFAULT_CIRCULAR: Required<CircularModeConfig> = {
  ringCount: 3,
  baseRadius: 90,
  ringSpacing: 10,
  harmonicAmplitude: 3,
  angularVelocity: 0.002,
  counterRotationFactor: 0.8,
};

export const DEFAULT_LINEAR: Required<LinearModeConfig> = {
  barWidthFraction: 0.75,
  maxBarWidth: 500,
  barHeight: 24,
  waveRadius: 45,
  waveAmplitude: 12,
  progressSpeed: 0.5,
  waveColor: [110, 193, 228],
  waveColorSpeed: 0.3,
  baseColorRelaxationSpeed: 0.05,
};

/**
 * Update particle targets for the given mode.
 *
 * For `logo` mode this is a one-shot reset (call once on mode switch).
 * For `circular` and `linear` modes this should be called every frame
 * to produce continuous animation.
 *
 * Mutates `targetX`, `targetY`, `stiffness`, and (in `linear` mode) the
 * particle's `color` channel directly.
 */
export function updateTargets(
  particles: ParticleState[],
  mode: LogoMode,
  canvasWidth: number,
  canvasHeight: number,
  time: number,
  circularCfg: CircularModeConfig = {},
  linearCfg: LinearModeConfig = {},
  progressValue: { value: number },
): void {
  const n = particles.length;
  if (n === 0) return;

  const cx = canvasWidth / 2;
  const cy = canvasHeight / 2;

  switch (mode) {
    case "logo":
      morphToLogo(particles);
      break;
    case "circular":
      morphToCircular(particles, n, cx, cy, time, circularCfg);
      break;
    case "linear":
      morphToLinear(particles, n, cx, cy, canvasWidth, canvasHeight, time, linearCfg, progressValue);
      break;
  }
}

function morphToLogo(particles: ParticleState[]): void {
  for (const p of particles) {
    p.targetX = p.logoX;
    p.targetY = p.logoY;
    // Randomise stiffness slightly for organic feel.
    p.stiffness = 0.08 + Math.random() * 0.04;
  }
}

function morphToCircular(
  particles: ParticleState[],
  n: number,
  cx: number,
  cy: number,
  time: number,
  cfg: CircularModeConfig,
): void {
  const c = { ...DEFAULT_CIRCULAR, ...cfg };
  const t = time * c.angularVelocity;

  for (let i = 0; i < n; i++) {
    const p = particles[i];
    const ringIndex = i % c.ringCount;
    const baseAngle = (i / n) * Math.PI * 2 * 3;

    // Counter-rotating rings: even rings clockwise, odd rings counter-clockwise.
    const rotationSpeed = ringIndex % 2 === 0 ? t : -t * c.counterRotationFactor;
    const angle = baseAngle + rotationSpeed;

    // Radial harmonic oscillation prevents a rigid geometric look.
    const radius =
      c.baseRadius +
      ringIndex * c.ringSpacing +
      Math.sin(i * 0.05 + t) * c.harmonicAmplitude;

    p.targetX = cx + Math.cos(angle) * radius;
    p.targetY = cy + Math.sin(angle) * radius;
    p.stiffness = 0.03 + Math.random() * 0.02;
  }
}

function morphToLinear(
  particles: ParticleState[],
  n: number,
  cx: number,
  cy: number,
  canvasWidth: number,
  canvasHeight: number,
  time: number,
  cfg: LinearModeConfig,
  progressValue: { value: number },
): void {
  const c = { ...DEFAULT_LINEAR, ...cfg };

  const barWidth = Math.min(canvasWidth * c.barWidthFraction, c.maxBarWidth);
  const barHeight = c.barHeight;
  const startX = cx - barWidth / 2;
  const startY = cy - barHeight / 2;

  // Grid geometry — square-ish aspect from the bar dimensions.
  const cols = Math.max(1, Math.floor(Math.sqrt(n * (barWidth / barHeight))));
  const rows = Math.ceil(n / cols);

  // Advance progress (wraps from 100 → -20 so the wave re-enters from the left).
  progressValue.value += c.progressSpeed;
  if (progressValue.value > 100) progressValue.value = -20;

  const progressX = startX + (progressValue.value / 100) * barWidth;

  for (let i = 0; i < n; i++) {
    const p = particles[i];
    const col = i % cols;
    const row = Math.floor(i / cols);

    p.targetX = startX + (col / cols) * barWidth;
    p.targetY = startY + (row / rows) * barHeight;
    p.stiffness = 0.05 + Math.random() * 0.03;

    // Wave displacement.
    const distance = Math.abs(p.targetX - progressX);
    if (distance < c.waveRadius) {
      const wave = (c.waveRadius - distance) / c.waveRadius;
      p.targetY = cy - barHeight / 2 - Math.sin(p.targetX * 0.05 + time * 0.01) * c.waveAmplitude * wave;

      // Colour shift to cyan within wave envelope.
      p.color[0] += (c.waveColor[0] - p.color[0]) * c.waveColorSpeed;
      p.color[1] += (c.waveColor[1] - p.color[1]) * c.waveColorSpeed;
      p.color[2] += (c.waveColor[2] - p.color[2]) * c.waveColorSpeed;
    } else {
      // Relax target Y back toward the centre line.
      p.targetY += (cy - p.targetY) * 0.05;

      // Relax colour back toward base.
      for (let j = 0; j < 3; j++) {
        p.color[j] += (p.baseColor[j] - p.color[j]) * c.baseColorRelaxationSpeed;
      }
    }
  }
}

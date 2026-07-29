/**
 * particle-import-engine — Particle State
 *
 * Server-side particle representation. Each particle stores its full
 * state vector (position, velocity, target, colour, size) and can
 * be updated by the physics simulation. The state is fully
 * serialisable for IPC transport to the Electron renderer.
 */

import {
  ParticleState,
  RGB,
  Palette,
  DEFAULT_PALETTE,
  PhysicsConfig,
  InteractionConfig,
} from '../types';

/** Default physics configuration. */
const DEFAULT_PHYSICS: Required<PhysicsConfig> = {
  damping: 0.88,
  stiffnessRange: [0.06, 0.10],
  sizeRange: [1.6, 3.0],
  colorProbabilities: [0.65, 0.20, 0.15],
  excitationColor: [239, 242, 243],
  excitationSpeed: 0.4,
  relaxationSpeed: 0.08,
  sizeExcitationMultiplier: 1.5,
  sizeRelaxationSpeed: 0.1,
};

/**
 * Create a new ParticleState from a projected canvas position.
 *
 * Particles spawn scattered around their target for a smooth
 * entry animation (the spring physics pulls them in over ~30 frames).
 *
 * @param id      - Unique particle index.
 * @param x       - Target x position (logo coordinate).
 * @param y       - Target y position (logo coordinate).
 * @param palette - Colour palette for random assignment.
 * @param physics - Physics configuration overrides.
 */
export function createParticle(
  id: number,
  x: number,
  y: number,
  palette: Palette = DEFAULT_PALETTE,
  physics: PhysicsConfig = {},
): ParticleState {
  const cfg = { ...DEFAULT_PHYSICS, ...physics };

  const [stiffMin, stiffMax] = cfg.stiffnessRange;
  const [sizeMin, sizeMax] = cfg.sizeRange;
  const [pPrimary, pDeep] = cfg.colorProbabilities;

  const stiffness = stiffMin + Math.random() * (stiffMax - stiffMin);
  const baseSize = sizeMin + Math.random() * (sizeMax - sizeMin);

  // Colour assignment based on probability distribution.
  const roll = Math.random();
  let baseColor: RGB;
  if (roll < pPrimary) {
    baseColor = [...palette.primary] as RGB;
  } else if (roll < pPrimary + pDeep) {
    baseColor = [...palette.deep] as RGB;
  } else {
    baseColor = [...palette.accent] as RGB;
  }

  return {
    id,
    // Spawn scattered around target for entry animation.
    x: x + (Math.random() - 0.5) * 200,
    y: y + (Math.random() - 0.5) * 200,
    vx: 0,
    vy: 0,
    targetX: x,
    targetY: y,
    logoX: x,
    logoY: y,
    stiffness,
    damping: cfg.damping,
    baseSize,
    size: baseSize,
    baseColor,
    color: [...baseColor] as RGB,
  };
}

/**
 * Update a particle's physics state for one frame.
 *
 * Applies:
 *   1. Mouse repulsion (if pointer is active and within radius).
 *   2. Hooke's Law spring force toward the target.
 *   3. Velocity damping.
 *   4. Euler position integration.
 *   5. Colour & size excitation/relaxation.
 *
 * @param p           - Particle state to mutate.
 * @param interaction - Mouse/pointer interaction state.
 * @param physics     - Physics configuration overrides.
 * @returns The same particle reference (mutated in place).
 */
export function updateParticle(
  p: ParticleState,
  interaction: InteractionConfig,
  physics: PhysicsConfig = {},
): ParticleState {
  const cfg = { ...DEFAULT_PHYSICS, ...physics };

  // ── Mouse Repulsion ───────────────────────────────────────────────────
  if (interaction.active && interaction.pointerX !== null && interaction.pointerY !== null) {
    const dx = interaction.pointerX - p.x;
    const dy = interaction.pointerY - p.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < interaction.radius) {
      const force = (interaction.radius - dist) / interaction.radius;
      const angle = Math.atan2(dy, dx);
      p.vx -= Math.cos(angle) * force * interaction.force;
      p.vy -= Math.sin(angle) * force * interaction.force;

      // Pulse white on contact (excitation).
      for (let i = 0; i < 3; i++) {
        p.color[i] += (cfg.excitationColor[i] - p.color[i]) * cfg.excitationSpeed;
      }
      p.size = p.baseSize * cfg.sizeExcitationMultiplier;
    } else {
      easeColorAndSize(p, cfg);
    }
  } else {
    easeColorAndSize(p, cfg);
  }

  // ── Spring Force Toward Target (Hooke's Law) ──────────────────────────
  const springX = (p.targetX - p.x) * p.stiffness;
  const springY = (p.targetY - p.y) * p.stiffness;

  p.vx += springX;
  p.vy += springY;

  // ── Damping ───────────────────────────────────────────────────────────
  p.vx *= p.damping;
  p.vy *= p.damping;

  // ── Position Integration (Euler) ──────────────────────────────────────
  p.x += p.vx;
  p.y += p.vy;

  return p;
}

/**
 * Ease colour and size back to their base values (relaxation).
 */
function easeColorAndSize(p: ParticleState, cfg: Required<PhysicsConfig>): void {
  for (let i = 0; i < 3; i++) {
    p.color[i] += (p.baseColor[i] - p.color[i]) * cfg.relaxationSpeed;
  }
  p.size += (p.baseSize - p.size) * cfg.sizeRelaxationSpeed;
}

/**
 * Convert a ParticleState to a compact frame representation for IPC.
 * Only sends the fields that change per frame, reducing bandwidth.
 */
export function toFrameData(p: ParticleState): {
  id: number;
  x: number;
  y: number;
  size: number;
  color: RGB;
} {
  return {
    id: p.id,
    x: p.x,
    y: p.y,
    size: p.size,
    color: [
      Math.round(p.color[0]),
      Math.round(p.color[1]),
      Math.round(p.color[2]),
    ] as RGB,
  };
}

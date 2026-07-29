/**
 * Particle physics — pure TypeScript, no platform dependencies.
 *
 * Ported from `import-engine-particle/src/physics/particle.ts`. The
 * algorithm is identical; only the import paths and TypeScript strictness
 * have been adjusted to match the El-Imtiyaz codebase conventions.
 */
import type {
  ParticleState,
  RGB,
  Palette,
  PhysicsConfig,
  InteractionConfig,
} from "../types";
import { DEFAULT_PALETTE } from "../types";

/** Default physics configuration. */
export const DEFAULT_PHYSICS: Required<PhysicsConfig> = {
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
 * Particles spawn scattered around their target for a smooth entry
 * animation — the spring physics pulls them in over ~30 frames.
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

  // Weighted colour assignment.
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
 * Pipeline (in order):
 *   1. Mouse repulsion (if pointer active and within radius) — excites colour + size.
 *   2. Hooke's Law spring force toward target.
 *   3. Velocity damping.
 *   4. Euler position integration.
 *   5. Colour & size relaxation (when not excited).
 *
 * Mutates the particle in place for performance (avoids per-frame allocations).
 */
export function updateParticle(
  p: ParticleState,
  interaction: InteractionConfig,
  physics: PhysicsConfig = {},
): ParticleState {
  const cfg = { ...DEFAULT_PHYSICS, ...physics };

  if (interaction.active && interaction.pointerX !== null && interaction.pointerY !== null) {
    const dx = interaction.pointerX - p.x;
    const dy = interaction.pointerY - p.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < interaction.radius) {
      const force = (interaction.radius - dist) / interaction.radius;
      const angle = Math.atan2(dy, dx);
      p.vx -= Math.cos(angle) * force * interaction.force;
      p.vy -= Math.sin(angle) * force * interaction.force;

      // Pulse toward excitation colour on contact.
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

  // Spring force toward target.
  p.vx += (p.targetX - p.x) * p.stiffness;
  p.vy += (p.targetY - p.y) * p.stiffness;

  // Damping.
  p.vx *= p.damping;
  p.vy *= p.damping;

  // Euler integration.
  p.x += p.vx;
  p.y += p.vy;

  return p;
}

function easeColorAndSize(p: ParticleState, cfg: Required<PhysicsConfig>): void {
  for (let i = 0; i < 3; i++) {
    p.color[i] += (p.baseColor[i] - p.color[i]) * cfg.relaxationSpeed;
  }
  p.size += (p.baseSize - p.size) * cfg.sizeRelaxationSpeed;
}

/** Compact frame representation used by the React canvas renderer. */
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

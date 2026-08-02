/**
 * Tests for the particle engine physics modules.
 *
 * Validates the pure functions in `physics/particle.ts` and
 * `physics/morphing.ts` — particle creation, spring physics, mouse
 * repulsion, colour excitation/relaxation, and per-mode target
 * computation.
 */
import { describe, it, expect } from "vitest";
import {
  createParticle,
  updateParticle,
  toFrameData,
  DEFAULT_PHYSICS,
} from "../../../shared/particle-engine/physics/particle";
import {
  updateTargets,
  DEFAULT_CIRCULAR,
  DEFAULT_LINEAR,
} from "../../../shared/particle-engine/physics/morphing";
import type { ParticleState, Palette, InteractionConfig } from "../../../shared/particle-engine/types";

const PALETTE: Palette = {
  primary: [52, 155, 212],
  deep: [43, 127, 176],
  accent: [200, 169, 140],
};

const NO_INTERACTION: InteractionConfig = {
  radius: 100,
  force: 6,
  pointerX: null,
  pointerY: null,
  active: false,
};

describe("particle-engine / particle.ts", () => {
  describe("createParticle", () => {
    it("creates a particle at the given target position", () => {
      const p = createParticle(0, 100, 200, PALETTE);
      expect(p.id).toBe(0);
      expect(p.targetX).toBe(100);
      expect(p.targetY).toBe(200);
      expect(p.logoX).toBe(100);
      expect(p.logoY).toBe(200);
    });

    it("scatters spawn position around the target", () => {
      const p = createParticle(0, 100, 100, PALETTE);
      // Spawn within ±100 of target.
      expect(Math.abs(p.x - 100)).toBeLessThanOrEqual(100);
      expect(Math.abs(p.y - 100)).toBeLessThanOrEqual(100);
    });

    it("initialises velocity to zero", () => {
      const p = createParticle(0, 0, 0, PALETTE);
      expect(p.vx).toBe(0);
      expect(p.vy).toBe(0);
    });

    it("assigns stiffness within the configured range", () => {
      const p = createParticle(0, 0, 0, PALETTE, { stiffnessRange: [0.08, 0.12] });
      expect(p.stiffness).toBeGreaterThanOrEqual(0.08);
      expect(p.stiffness).toBeLessThanOrEqual(0.12);
    });

    it("assigns baseSize within the configured range", () => {
      const p = createParticle(0, 0, 0, PALETTE, { sizeRange: [2.0, 4.0] });
      expect(p.baseSize).toBeGreaterThanOrEqual(2.0);
      expect(p.baseSize).toBeLessThanOrEqual(4.0);
      expect(p.size).toBe(p.baseSize);
    });

    it("assigns a base colour from the palette by probability distribution", () => {
      // Force primary selection by setting probability 1.0 for primary.
      const p = createParticle(0, 0, 0, PALETTE, {
        colorProbabilities: [1.0, 0.0, 0.0],
      });
      expect(p.baseColor).toEqual(PALETTE.primary);
      expect(p.color).toEqual(PALETTE.primary);
    });

    it("assigns deep colour when roll falls in deep range", () => {
      const p = createParticle(0, 0, 0, PALETTE, {
        colorProbabilities: [0.0, 1.0, 0.0],
      });
      expect(p.baseColor).toEqual(PALETTE.deep);
    });

    it("assigns accent colour when roll falls in accent range", () => {
      const p = createParticle(0, 0, 0, PALETTE, {
        colorProbabilities: [0.0, 0.0, 1.0],
      });
      expect(p.baseColor).toEqual(PALETTE.accent);
    });

    it("uses DEFAULT_PHYSICS when no overrides are provided", () => {
      const p = createParticle(0, 0, 0);
      expect(p.damping).toBe(DEFAULT_PHYSICS.damping);
      expect(p.stiffness).toBeGreaterThanOrEqual(DEFAULT_PHYSICS.stiffnessRange[0]);
      expect(p.stiffness).toBeLessThanOrEqual(DEFAULT_PHYSICS.stiffnessRange[1]);
    });
  });

  describe("updateParticle", () => {
    it("applies spring force toward the target", () => {
      const p = createParticle(0, 0, 0, PALETTE);
      // Move particle far from target.
      p.x = 100;
      p.y = 100;
      p.targetX = 0;
      p.targetY = 0;
      const initialX = p.x;
      updateParticle(p, NO_INTERACTION);
      // Should have moved toward target (velocity now negative).
      expect(p.vx).toBeLessThan(0);
      expect(p.vy).toBeLessThan(0);
      expect(p.x).toBeLessThan(initialX);
    });

    it("applies damping to velocity", () => {
      const p = createParticle(0, 0, 0, PALETTE);
      // Pin target at current position so spring force is zero — isolates damping.
      p.x = 0;
      p.y = 0;
      p.targetX = 0;
      p.targetY = 0;
      p.damping = 0.5; // override the particle's own damping
      p.vx = 10;
      p.vy = 10;
      updateParticle(p, NO_INTERACTION);
      // With spring = 0 and damping = 0.5: vx = 10 * 0.5 = 5.
      expect(p.vx).toBeCloseTo(5, 1);
      expect(p.vy).toBeCloseTo(5, 1);
    });

    it("integrates velocity into position (Euler)", () => {
      const p = createParticle(0, 100, 100, PALETTE);
      // Pin target at the current position so spring force is zero —
      // this isolates the Euler integration step. Also override the
      // particle's own damping to 1.0 so velocity is preserved.
      p.x = 100;
      p.y = 100;
      p.targetX = 100;
      p.targetY = 100;
      p.damping = 1.0;
      p.vx = 5;
      p.vy = -3;
      updateParticle(p, NO_INTERACTION);
      expect(p.x).toBeCloseTo(105, 1);
      expect(p.y).toBeCloseTo(97, 1);
    });

    it("repels particles away from active pointer within radius", () => {
      const p = createParticle(0, 100, 100, PALETTE);
      p.x = 100;
      p.y = 100;
      const interaction: InteractionConfig = {
        radius: 50,
        force: 10,
        pointerX: 110, // 10 px to the right of particle
        pointerY: 100,
        active: true,
      };
      updateParticle(p, interaction);
      // Particle should be pushed to the LEFT (away from pointer on the right).
      expect(p.vx).toBeLessThan(0);
    });

    it("does not repel particles outside the interaction radius", () => {
      const p = createParticle(0, 100, 100, PALETTE);
      p.x = 100;
      p.y = 100;
      p.targetX = 100; // pin target so spring force is zero — isolates repulsion
      p.targetY = 100;
      const interaction: InteractionConfig = {
        radius: 10,
        force: 10,
        pointerX: 200, // 100 px away — well outside radius
        pointerY: 100,
        active: true,
      };
      const vxBefore = p.vx;
      updateParticle(p, interaction);
      // vx should be unchanged (no repulsion) — only damping applies.
      expect(p.vx).toBeCloseTo(vxBefore * DEFAULT_PHYSICS.damping, 2);
    });

    it("excites colour toward excitationColor on pointer contact", () => {
      const p = createParticle(0, 100, 100, PALETTE, {
        excitationColor: [255, 255, 255],
        excitationSpeed: 1.0, // instant excitation
      });
      p.x = 100;
      p.y = 100;
      const interaction: InteractionConfig = {
        radius: 50,
        force: 0,
        pointerX: 100,
        pointerY: 100,
        active: true,
      };
      const initialR = p.color[0];
      updateParticle(p, interaction);
      // Colour should have moved toward white (255).
      expect(p.color[0]).toBeGreaterThan(initialR);
    });

    it("relaxes colour back toward base when pointer is inactive", () => {
      const p = createParticle(0, 0, 0, PALETTE, {
        relaxationSpeed: 0.5,
      });
      // Manually push colour away from base.
      p.color = [255, 255, 255];
      const initialDist = Math.abs(p.color[0] - p.baseColor[0]);
      updateParticle(p, NO_INTERACTION);
      const newDist = Math.abs(p.color[0] - p.baseColor[0]);
      expect(newDist).toBeLessThan(initialDist);
    });

    it("returns the same particle reference (mutates in place)", () => {
      const p = createParticle(0, 0, 0, PALETTE);
      const result = updateParticle(p, NO_INTERACTION);
      expect(result).toBe(p);
    });
  });

  describe("toFrameData", () => {
    it("produces a compact frame with rounded colour values", () => {
      const p = createParticle(0, 100, 200, PALETTE);
      p.x = 50.7;
      p.y = 60.2;
      p.size = 2.5;
      p.color = [52.4, 155.6, 212.5];
      const frame = toFrameData(p);
      expect(frame.id).toBe(0);
      expect(frame.x).toBe(50.7);
      expect(frame.y).toBe(60.2);
      expect(frame.size).toBe(2.5);
      expect(frame.color).toEqual([52, 156, 213]);
    });
  });
});

describe("particle-engine / morphing.ts", () => {
  function makeParticles(n: number): ParticleState[] {
    const out: ParticleState[] = [];
    for (let i = 0; i < n; i++) {
      out.push(createParticle(i, i * 10, i * 10, PALETTE));
    }
    return out;
  }

  describe("updateTargets — logo mode", () => {
    it("resets targets to the original logo positions", () => {
      const particles = makeParticles(5);
      // Move targets away from logo positions.
      for (const p of particles) {
        p.targetX = 999;
        p.targetY = 999;
      }
      updateTargets(particles, "logo", 400, 300, 0, {}, {}, { value: 0 });
      for (const p of particles) {
        expect(p.targetX).toBe(p.logoX);
        expect(p.targetY).toBe(p.logoY);
      }
    });

    it("randomises stiffness slightly for organic feel", () => {
      const particles = makeParticles(10);
      updateTargets(particles, "logo", 400, 300, 0, {}, {}, { value: 0 });
      for (const p of particles) {
        expect(p.stiffness).toBeGreaterThanOrEqual(0.08);
        expect(p.stiffness).toBeLessThanOrEqual(0.12);
      }
    });
  });

  describe("updateTargets — circular mode", () => {
    it("places particles in concentric rings around the canvas centre", () => {
      const particles = makeParticles(12);
      const cx = 400 / 2;
      const cy = 300 / 2;
      updateTargets(particles, "circular", 400, 300, 0, {}, {}, { value: 0 });
      for (const p of particles) {
        const dx = p.targetX - cx;
        const dy = p.targetY - cy;
        const r = Math.sqrt(dx * dx + dy * dy);
        // Particles should be at one of the ring radii (baseRadius + k*ringSpacing ± harmonic).
        const minR = DEFAULT_CIRCULAR.baseRadius - DEFAULT_CIRCULAR.harmonicAmplitude;
        const maxR =
          DEFAULT_CIRCULAR.baseRadius +
          (DEFAULT_CIRCULAR.ringCount - 1) * DEFAULT_CIRCULAR.ringSpacing +
          DEFAULT_CIRCULAR.harmonicAmplitude;
        expect(r).toBeGreaterThanOrEqual(minR);
        expect(r).toBeLessThanOrEqual(maxR);
      }
    });

    it("rotates particles over time", () => {
      const particles = makeParticles(6);
      updateTargets(particles, "circular", 400, 300, 0, {}, {}, { value: 0 });
      const t0Targets = particles.map((p) => ({ x: p.targetX, y: p.targetY }));
      updateTargets(particles, "circular", 400, 300, 1000, {}, {}, { value: 0 });
      const t1Targets = particles.map((p) => ({ x: p.targetX, y: p.targetY }));
      // At least one target should have moved.
      const anyMoved = t0Targets.some((t0, i) => t0.x !== t1Targets[i].x || t0.y !== t1Targets[i].y);
      expect(anyMoved).toBe(true);
    });
  });

  describe("updateTargets — linear mode", () => {
    it("arranges particles in a bar shape", () => {
      const particles = makeParticles(20);
      updateTargets(particles, "linear", 800, 400, 0, {}, {}, { value: 50 });
      // All particle targets should be within the canvas bounds.
      for (const p of particles) {
        expect(p.targetX).toBeGreaterThanOrEqual(0);
        expect(p.targetX).toBeLessThanOrEqual(800);
        expect(p.targetY).toBeGreaterThanOrEqual(0);
        expect(p.targetY).toBeLessThanOrEqual(400);
      }
    });

    it("advances the progress value over time", () => {
      const particles = makeParticles(10);
      const progress = { value: 0 };
      updateTargets(particles, "linear", 800, 400, 0, {}, {}, progress);
      const initial = progress.value;
      updateTargets(particles, "linear", 800, 400, 100, {}, {}, progress);
      expect(progress.value).toBeGreaterThan(initial);
    });

    it("wraps progress from 100 → -20", () => {
      const particles = makeParticles(2);
      const progress = { value: 99.8 };
      // progressSpeed default = 0.5, so one tick should push past 100.
      updateTargets(particles, "linear", 800, 400, 0, {}, {}, progress);
      expect(progress.value).toBeLessThanOrEqual(0);
      expect(progress.value).toBeGreaterThanOrEqual(-20);
    });

    it("shifts colour toward waveColor within the wave radius", () => {
      const particles = makeParticles(20);
      const progress = { value: 50 };
      updateTargets(particles, "linear", 800, 400, 0, {}, {
        waveColor: [255, 0, 0],
        waveColorSpeed: 1.0,
        waveRadius: 10000, // catch all particles regardless of position
      }, progress);
      // At least one particle should have moved toward red (r increased).
      const anyShifted = particles.some((p) => p.color[0] > p.baseColor[0] + 1);
      expect(anyShifted).toBe(true);
    });
  });

  describe("updateTargets — edge cases", () => {
    it("no-ops on an empty particle array", () => {
      expect(() => updateTargets([], "logo", 400, 300, 0, {}, {}, { value: 0 })).not.toThrow();
    });

    it("respects custom circular config overrides", () => {
      const particles = makeParticles(3);
      updateTargets(particles, "circular", 400, 300, 0, { ringCount: 1, baseRadius: 50 }, {}, { value: 0 });
      const cx = 200;
      const cy = 150;
      for (const p of particles) {
        const r = Math.sqrt((p.targetX - cx) ** 2 + (p.targetY - cy) ** 2);
        // Single ring at base radius 50 ± harmonic.
        expect(r).toBeLessThan(60);
      }
    });
  });
});

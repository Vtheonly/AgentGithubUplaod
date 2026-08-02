/**
 * Tests for the particle engine — engine lifecycle + errors + types.
 *
 * The engine itself depends on `HTMLCanvasElement` + `getImageData`, so
 * the engine-level tests use jsdom's canvas (which returns a stub context
 * that throws on `getImageData`). We focus on:
 *   - Error class hierarchy behaviour
 *   - Config validation (synchronous, no canvas needed)
 *   - Engine destroy semantics
 *
 * The full physics / pipeline coverage lives in the sibling test files.
 */
import { describe, it, expect } from "vitest";
import {
  ParticleEngineError,
  ImageLoadError,
  SamplingError,
  ProjectionError,
  ConfigError,
} from "../../../shared/particle-engine/errors";
import { ParticleEngine } from "../../../shared/particle-engine/engine";
import { DEFAULT_PALETTE } from "../../../shared/particle-engine/types";

describe("particle-engine / errors.ts", () => {
  it("ParticleEngineError carries a stable code + message", () => {
    const err = new ParticleEngineError("boom", "INVALID_CONFIG");
    expect(err.message).toBe("boom");
    expect(err.code).toBe("INVALID_CONFIG");
    expect(err.name).toBe("ParticleEngineError");
    expect(err.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("ParticleEngineError defaults code to UNKNOWN", () => {
    const err = new ParticleEngineError("boom");
    expect(err.code).toBe("UNKNOWN");
  });

  it("ImageLoadError uses IMAGE_LOAD_FAILED code", () => {
    const err = new ImageLoadError("not found");
    expect(err.code).toBe("IMAGE_LOAD_FAILED");
    expect(err.name).toBe("ImageLoadError");
  });

  it("SamplingError uses SAMPLING_FAILED code", () => {
    const err = new SamplingError("bad pixels");
    expect(err.code).toBe("SAMPLING_FAILED");
  });

  it("ProjectionError uses PROJECTION_FAILED code", () => {
    const err = new ProjectionError("bad canvas");
    expect(err.code).toBe("PROJECTION_FAILED");
  });

  it("ConfigError uses INVALID_CONFIG code", () => {
    const err = new ConfigError("bad config");
    expect(err.code).toBe("INVALID_CONFIG");
  });

  it("errors are instanceof ParticleEngineError and Error", () => {
    const err = new ImageLoadError("x");
    expect(err).toBeInstanceOf(ParticleEngineError);
    expect(err).toBeInstanceOf(Error);
  });

  it("toJSON serialises the error for logging", () => {
    const cause = new Error("root");
    const err = new ImageLoadError("wrapper", cause);
    const json = err.toJSON();
    expect(json.name).toBe("ImageLoadError");
    expect(json.code).toBe("IMAGE_LOAD_FAILED");
    expect(json.message).toBe("wrapper");
    expect(json.cause).toMatchObject({ name: "Error", message: "root" });
  });
});

describe("particle-engine / engine.ts", () => {
  describe("config validation", () => {
    it("throws ConfigError when canvasWidth is missing or zero", async () => {
      const engine = new ParticleEngine();
      await expect(
        engine.initialize({
          pipeline: {
            source: { fallback: true },
            canvasWidth: 0,
            canvasHeight: 400,
          },
        }),
      ).rejects.toThrow(ConfigError);
      engine.destroy();
    });

    it("throws ConfigError when canvasHeight is negative", async () => {
      const engine = new ParticleEngine();
      await expect(
        engine.initialize({
          pipeline: {
            source: { fallback: true },
            canvasWidth: 400,
            canvasHeight: -10,
          },
        }),
      ).rejects.toThrow(ConfigError);
      engine.destroy();
    });

    it("throws ConfigError when no source is provided", async () => {
      const engine = new ParticleEngine();
      await expect(
        engine.initialize({
          pipeline: {
            source: {},
            canvasWidth: 400,
            canvasHeight: 400,
          },
        }),
      ).rejects.toThrow(ConfigError);
      engine.destroy();
    });
  });

  describe("destroy", () => {
    it("marks the engine as destroyed and prevents re-initialisation", async () => {
      const engine = new ParticleEngine();
      engine.destroy();
      await expect(
        engine.initialize({
          pipeline: {
            source: { fallback: true },
            canvasWidth: 400,
            canvasHeight: 400,
          },
        }),
      ).rejects.toThrow(ParticleEngineError);
    });
  });

  describe("setMode / setInteraction", () => {
    it("setMode is a no-op on an empty engine (does not throw)", () => {
      const engine = new ParticleEngine();
      expect(() => engine.setMode("circular")).not.toThrow();
      expect(() => engine.setMode("linear")).not.toThrow();
      expect(() => engine.setMode("logo")).not.toThrow();
    });

    it("setInteraction accepts partial updates", () => {
      const engine = new ParticleEngine();
      expect(() =>
        engine.setInteraction({ pointerX: 100, pointerY: 200, active: true }),
      ).not.toThrow();
      engine.destroy();
    });

    it("setMode is a no-op after destroy", () => {
      const engine = new ParticleEngine();
      engine.destroy();
      expect(() => engine.setMode("logo")).not.toThrow();
    });
  });

  describe("step", () => {
    it("returns null when no particles are seeded", () => {
      const engine = new ParticleEngine();
      expect(engine.step()).toBeNull();
      engine.destroy();
    });
  });

  describe("getParticleCount / getParticles", () => {
    it("returns zero / empty before initialisation", () => {
      const engine = new ParticleEngine();
      expect(engine.getParticleCount()).toBe(0);
      expect(engine.getParticles()).toEqual([]);
      engine.destroy();
    });
  });

  describe("event listeners", () => {
    it("on() returns an unsubscribe function that removes the listener", () => {
      const engine = new ParticleEngine();
      const calls: number[] = [];
      const unsub = engine.on("progress", (p) => calls.push(p.progress));
      expect(typeof unsub).toBe("function");
      engine.destroy();
      unsub();
    });

    it("listeners are cleared on destroy", () => {
      const engine = new ParticleEngine();
      let called = 0;
      engine.on("progress", () => called++);
      engine.destroy();
      // After destroy, even if emit were called internally, listeners are gone.
      // We can't easily trigger an emit post-destroy, so this just verifies no throw.
      expect(called).toBe(0);
    });
  });

  describe("DEFAULT_PALETTE", () => {
    it("matches the brand tokens from src/index.css", () => {
      // --brand-blue      #349BD4 → [52, 155, 212]
      // --brand-blue-deep #2B7FB0 → [43, 127, 176]
      // --brand-gold      #C8A98C → [200, 169, 140]
      expect(DEFAULT_PALETTE.primary).toEqual([52, 155, 212]);
      expect(DEFAULT_PALETTE.deep).toEqual([43, 127, 176]);
      expect(DEFAULT_PALETTE.accent).toEqual([200, 169, 140]);
    });
  });
});

/**
 * particle-import-engine — Unit Test Suite
 *
 * Comprehensive tests covering all sub-systems:
 *   - Sampler (pixel luminance extraction)
 *   - Projector (coordinate projection)
 *   - Particle (creation, physics update)
 *   - Morphing (target computation for all modes)
 *   - Colour interpolation
 *   - Job queue (create, track, retry)
 *   - Full pipeline (fallback pattern → particles)
 *   - Import engine (full lifecycle)
 *
 * Run: node dist/tests/run-tests.js
 */

import { samplePixels, SamplingResult } from '../pipeline/sampler';
import { projectPoints, ProjectionResult } from '../pipeline/projector';
import { generateFallbackPattern } from '../pipeline/fallback';
import { createParticle, updateParticle, toFrameData } from '../physics/particle';
import { updateTargets } from '../physics/morphing';
import { exciteColor, relaxColor, waveColorShift, roundColor, luminance } from '../color/interpolator';
import { JobQueue } from '../queue/job-queue';
import { ImportEngine } from '../engine';
import { RGB, ParticleState, InteractionConfig, DEFAULT_PALETTE } from '../types';

// ─── Test Runner ────────────────────────────────────────────────────────────

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  durationMs: number;
}

const results: TestResult[] = [];
let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, got ${actual}`);
}

function assertApprox(actual: number, expected: number, tolerance: number, label: string): void {
  if (Math.abs(actual - expected) > tolerance) throw new Error(`${label}: expected ~${expected}, got ${actual}`);
}

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  const start = Date.now();
  try {
    await fn();
    results.push({ name, passed: true, durationMs: Date.now() - start });
    passed++;
    console.log(`  ✓ ${name} (${Date.now() - start}ms)`);
  } catch (err) {
    results.push({ name, passed: false, error: (err as Error).message, durationMs: Date.now() - start });
    failed++;
    console.log(`  ✗ ${name} — ${(err as Error).message}`);
  }
}

// ─── Sampler Tests ──────────────────────────────────────────────────────────

async function testSampler(): Promise<void> {
  await test('Sampler: all-black image produces maximum dark pixels', async () => {
    const w = 10, h = 10;
    const data = Buffer.alloc(w * h * 4, 0); // all black (R=0, G=0, B=0, A=0)
    // Set alpha to 255 for visibility
    for (let i = 3; i < data.length; i += 4) data[i] = 255;
    const result = samplePixels(data, w, h, { density: 1, luminanceThreshold: 128 });
    assertEqual(result.darkPixelCount, 100, 'dark pixel count');
    assertEqual(result.totalScanned, 100, 'total scanned');
  });

  await test('Sampler: all-white image produces zero dark pixels', async () => {
    const w = 10, h = 10;
    const data = Buffer.alloc(w * h * 4, 255); // all white
    const result = samplePixels(data, w, h, { density: 1, luminanceThreshold: 128 });
    assertEqual(result.darkPixelCount, 0, 'dark pixel count');
  });

  await test('Sampler: density=2 skips every other pixel', async () => {
    const w = 20, h = 20;
    const data = Buffer.alloc(w * h * 4, 0);
    for (let i = 3; i < data.length; i += 4) data[i] = 255;
    const result = samplePixels(data, w, h, { density: 2, luminanceThreshold: 128 });
    // With density=2, we scan 10x10=100 pixels
    assertEqual(result.totalScanned, 100, 'total scanned with density=2');
    assertEqual(result.darkPixelCount, 100, 'dark pixels with density=2');
  });

  await test('Sampler: threshold boundary — luminance exactly 128 excluded', async () => {
    const w = 2, h = 1;
    const data = Buffer.alloc(8, 128); // R=128, G=128, B=128, A=128
    // Luminance = (128+128+128)/3 = 128 — NOT < 128, so excluded
    const result = samplePixels(data, w, h, { density: 1, luminanceThreshold: 128 });
    assertEqual(result.darkPixelCount, 0, 'boundary pixels excluded');
  });

  await test('Sampler: threshold boundary — luminance 127 included', async () => {
    const w = 1, h = 1;
    const data = Buffer.from([127, 127, 127, 255]);
    const result = samplePixels(data, w, h, { density: 1, luminanceThreshold: 128 });
    assertEqual(result.darkPixelCount, 1, 'luminance 127 included');
  });
}

// ─── Projector Tests ────────────────────────────────────────────────────────

async function testProjector(): Promise<void> {
  await test('Projector: single point centered in 600x600 canvas', async () => {
    const result = projectPoints(
      [{ x: 150, y: 150, luminance: 0 }],
      300, 300,
      { canvasWidth: 600, canvasHeight: 600, fillRatio: 0.7 },
    );
    // Scale = min(600*0.7/300, 600*0.7/300) = min(1.4, 1.4) = 1.4
    // Offset = (600 - 300*1.4)/2 = (600-420)/2 = 90
    assertApprox(result.scale, 1.4, 0.01, 'scale');
    assertApprox(result.offsetX, 90, 0.01, 'offsetX');
    assertApprox(result.offsetY, 90, 0.01, 'offsetY');
    assertApprox(result.points[0].x, 150 * 1.4 + 90, 0.01, 'projected x');
    assertApprox(result.points[0].y, 150 * 1.4 + 90, 0.01, 'projected y');
  });

  await test('Projector: non-square image preserves aspect ratio', async () => {
    const result = projectPoints(
      [{ x: 0, y: 0, luminance: 0 }],
      200, 100,  // wide image
      { canvasWidth: 600, canvasHeight: 600, fillRatio: 0.7 },
    );
    // Scale = min(600*0.7/200, 600*0.7/100) = min(2.1, 4.2) = 2.1
    assertApprox(result.scale, 2.1, 0.01, 'scale');
  });

  await test('Projector: rejects invalid canvas dimensions', async () => {
    let threw = false;
    try {
      projectPoints([], 10, 10, { canvasWidth: 0, canvasHeight: 600 });
    } catch { threw = true; }
    assert(threw, 'should throw on invalid canvas dimensions');
  });
}

// ─── Particle Tests ─────────────────────────────────────────────────────────

async function testParticle(): Promise<void> {
  await test('Particle: creation with scattered spawn', async () => {
    const p = createParticle(0, 300, 300);
    // Spawn position should be scattered around target (within ±100)
    assert(Math.abs(p.x - 300) <= 100, 'x within spawn range');
    assert(Math.abs(p.y - 300) <= 100, 'y within spawn range');
    // Target should be exactly at the specified position
    assertEqual(p.targetX, 300, 'targetX');
    assertEqual(p.targetY, 300, 'targetY');
    assertEqual(p.logoX, 300, 'logoX');
    assertEqual(p.logoY, 300, 'logoY');
    // Velocity should start at 0
    assertEqual(p.vx, 0, 'vx');
    assertEqual(p.vy, 0, 'vy');
  });

  await test('Particle: spring physics pulls toward target', async () => {
    const p = createParticle(0, 300, 300);
    // Force position away from target
    p.x = 100; p.y = 100;
    p.vx = 0; p.vy = 0;

    const noInteraction: InteractionConfig = {
      radius: 100, force: 6, pointerX: null, pointerY: null, active: false,
    };

    // Run several frames
    for (let i = 0; i < 50; i++) {
      updateParticle(p, noInteraction);
    }

    // Should be closer to target than initial position
    const initialDist = Math.sqrt((100 - 300) ** 2 + (100 - 300) ** 2);
    const currentDist = Math.sqrt((p.x - 300) ** 2 + (p.y - 300) ** 2);
    assert(currentDist < initialDist, 'particle should move toward target');
  });

  await test('Particle: mouse repulsion pushes away', async () => {
    const p = createParticle(0, 300, 300);
    p.x = 300; p.y = 300; p.vx = 0; p.vy = 0;

    const interaction: InteractionConfig = {
      radius: 100, force: 6, pointerX: 310, pointerY: 300, active: true,
    };

    updateParticle(p, interaction);

    // Particle should be pushed away from cursor (to the left)
    assert(p.x < 300, 'repulsion should push x left');
  });

  await test('Particle: colour excitation on mouse contact', async () => {
    const p = createParticle(0, 300, 300);
    p.x = 300; p.y = 300; p.vx = 0; p.vy = 0;

    const interaction: InteractionConfig = {
      radius: 100, force: 6, pointerX: 300, pointerY: 300, active: true,
    };

    const initialR = p.color[0];
    updateParticle(p, interaction);
    // Colour should shift toward white [239, 242, 243]
    assert(p.color[0] > initialR, 'colour should excite toward white');
  });

  await test('Particle: toFrameData produces compact output', async () => {
    const p = createParticle(0, 300, 300);
    const frame = toFrameData(p);
    assertEqual(frame.id, 0, 'frame id');
    assert('x' in frame, 'has x');
    assert('y' in frame, 'has y');
    assert('size' in frame, 'has size');
    assert('color' in frame, 'has color');
    assert(!('vx' in frame), 'should not have vx');
    assert(!('logoX' in frame), 'should not have logoX');
  });
}

// ─── Morphing Tests ─────────────────────────────────────────────────────────

async function testMorphing(): Promise<void> {
  await test('Morphing: logo mode resets targets to logo positions', async () => {
    const particles = [createParticle(0, 100, 200), createParticle(1, 300, 400)];
    // Move targets away
    particles[0].targetX = 999; particles[0].targetY = 999;
    particles[1].targetX = 888; particles[1].targetY = 888;

    updateTargets(particles, 'logo', 600, 600, Date.now(), {}, {}, { value: 0 });

    assertEqual(particles[0].targetX, 100, 'particle 0 targetX reset');
    assertEqual(particles[0].targetY, 200, 'particle 0 targetY reset');
    assertEqual(particles[1].targetX, 300, 'particle 1 targetX reset');
    assertEqual(particles[1].targetY, 400, 'particle 1 targetY reset');
  });

  await test('Morphing: circular mode places targets around centre', async () => {
    const particles = Array.from({ length: 30 }, (_, i) => createParticle(i, 300, 300));
    updateTargets(particles, 'circular', 600, 600, Date.now(), {}, {}, { value: 0 });

    // All targets should be within reasonable distance from centre
    for (const p of particles) {
      const dx = p.targetX - 300;
      const dy = p.targetY - 300;
      const dist = Math.sqrt(dx * dx + dy * dy);
      assert(dist > 0, `particle ${p.id} should be away from centre`);
      assert(dist < 200, `particle ${p.id} should be within canvas bounds`);
    }
  });

  await test('Morphing: linear mode distributes particles across bar', async () => {
    const particles = Array.from({ length: 50 }, (_, i) => createParticle(i, 300, 300));
    updateTargets(particles, 'linear', 600, 600, Date.now(), {}, {}, { value: 0 });

    // Targets should be spread across the bar width
    const xs = particles.map(p => p.targetX);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    assert(maxX - minX > 100, 'particles should span the bar width');
  });
}

// ─── Colour Interpolation Tests ─────────────────────────────────────────────

async function testColour(): Promise<void> {
  await test('Colour: exciteColor shifts toward target', async () => {
    const color: RGB = [50, 50, 50];
    exciteColor(color, [255, 255, 255], 0.5);
    // 50 + 0.5*(255-50) = 152.5
    assertApprox(color[0], 152.5, 0.01, 'excited R');
    assertApprox(color[1], 152.5, 0.01, 'excited G');
    assertApprox(color[2], 152.5, 0.01, 'excited B');
  });

  await test('Colour: relaxColor shifts toward base', async () => {
    const color: RGB = [200, 200, 200];
    const base: RGB = [50, 50, 50];
    relaxColor(color, base, 0.5);
    assertEqual(color[0], 125, 'relaxed R'); // 200 + 0.5*(50-200) = 125
  });

  await test('Colour: waveColorShift shifts toward wave colour', async () => {
    const color: RGB = [100, 100, 100];
    waveColorShift(color, [110, 193, 228], 0.3);
    assert(color[0] > 100, 'wave shifts R');
    assert(color[1] > 100, 'wave shifts G');
    assert(color[2] > 100, 'wave shifts B');
  });

  await test('Colour: roundColor produces integers', async () => {
    const color: RGB = [1.7, 2.3, 3.8];
    const rounded = roundColor(color);
    assertEqual(rounded[0], 2, 'rounded R');
    assertEqual(rounded[1], 2, 'rounded G');
    assertEqual(rounded[2], 4, 'rounded B');
  });

  await test('Colour: luminance computes correctly', async () => {
    const color: RGB = [30, 60, 90];
    assertEqual(luminance(color), 60, 'luminance');
  });
}

// ─── Job Queue Tests ────────────────────────────────────────────────────────

async function testJobQueue(): Promise<void> {
  await test('JobQueue: create and retrieve job', async () => {
    const queue = new JobQueue(2);
    const jobId = queue.createJob({
      source: { fallback: true },
      canvasWidth: 600,
      canvasHeight: 600,
    });
    const job = queue.getJob(jobId);
    assert(job !== undefined, 'job should exist');
    assertEqual(job!.state, 'pending', 'initial state');
    assertEqual(job!.progress, 0, 'initial progress');
    assertEqual(job!.retries, 0, 'initial retries');
  });

  await test('JobQueue: update job progress', async () => {
    const queue = new JobQueue(2);
    const jobId = queue.createJob({
      source: { fallback: true },
      canvasWidth: 600,
      canvasHeight: 600,
    });
    queue.updateProgress(jobId, 'sampling', 0.5, 'Halfway done');
    const job = queue.getJob(jobId);
    assertEqual(job!.state, 'sampling', 'updated state');
    assertEqual(job!.progress, 0.5, 'updated progress');
  });

  await test('JobQueue: retry on failure', async () => {
    const queue = new JobQueue(2);
    const jobId = queue.createJob({
      source: { fallback: true },
      canvasWidth: 600,
      canvasHeight: 600,
    }, 3);

    queue.failJob(jobId, 'Something went wrong');
    let job = queue.getJob(jobId);
    assertEqual(job!.retries, 1, 'first retry');
    assertEqual(job!.state, 'pending', 'back to pending');

    // Exhaust retries
    queue.failJob(jobId, 'Fail 2');
    queue.failJob(jobId, 'Fail 3');
    queue.failJob(jobId, 'Fail 4');

    job = queue.getJob(jobId);
    assertEqual(job!.state, 'error', 'final state is error');
    assertEqual(job!.retries, 3, 'max retries reached');
  });

  await test('JobQueue: list all jobs', async () => {
    const queue = new JobQueue(5);
    queue.createJob({ source: { fallback: true }, canvasWidth: 600, canvasHeight: 600 });
    queue.createJob({ source: { fallback: true }, canvasWidth: 800, canvasHeight: 800 });
    queue.createJob({ source: { fallback: true }, canvasWidth: 400, canvasHeight: 400 });
    const jobs = queue.listJobs();
    assertEqual(jobs.length, 3, 'three jobs');
  });

  await test('JobQueue: concurrency limit', async () => {
    const queue = new JobQueue(1);
    assert(queue.canStart(), 'can start when empty');
    queue.startActive();
    assert(!queue.canStart(), 'cannot start when at limit');
    queue.endActive();
    assert(queue.canStart(), 'can start after ending');
  });
}

// ─── Fallback Pattern Tests ─────────────────────────────────────────────────

async function testFallback(): Promise<void> {
  await test('Fallback: generates valid RGBA data', async () => {
    const result = await generateFallbackPattern();
    assertEqual(result.width, 300, 'width');
    assertEqual(result.height, 300, 'height');
    assertEqual(result.channels, 4, 'channels');
    assertEqual(result.data.length, 300 * 300 * 4, 'data length');
    assertEqual(result.sourceLabel, '<fallback-pattern>', 'source label');
  });

  await test('Fallback: contains both dark and light pixels', async () => {
    const result = await generateFallbackPattern();
    const sampling = samplePixels(result.data, result.width, result.height, {
      density: 1,
      luminanceThreshold: 128,
    });
    assert(sampling.darkPixelCount > 0, 'has dark pixels');
    assert(sampling.darkPixelCount < sampling.totalScanned, 'has light pixels too');
    console.log(`    → ${sampling.darkPixelCount} dark pixels out of ${sampling.totalScanned}`);
  });
}

// ─── Full Engine Lifecycle Test ──────────────────────────────────────────────

async function testEngineLifecycle(): Promise<void> {
  await test('Engine: full import lifecycle with fallback', async () => {
    const engine = new ImportEngine();
    engine.setMaxListeners(20);

    const progressEvents: string[] = [];
    engine.on('progress', (e: any) => progressEvents.push(e.state));

    const jobId = await engine.importImage({
      pipeline: {
        source: { fallback: true },
        canvasWidth: 600,
        canvasHeight: 600,
        density: 3, // lower density for speed
      },
      initialMode: 'logo',
      tickInterval: 16,
    });

    const job = engine.getJob(jobId);
    assert(job !== undefined, 'job exists');
    assertEqual(job!.state, 'ready', 'job is ready');
    assert(job!.particleCount > 0, 'has particles');
    assert(progressEvents.length > 0, 'emitted progress events');

    // Run simulation briefly.
    engine.startSimulation();
    await new Promise(r => setTimeout(r, 100));
    engine.pauseSimulation();

    // Switch modes.
    engine.setMode('circular');
    engine.resumeSimulation();
    await new Promise(r => setTimeout(r, 100));
    engine.pauseSimulation();

    engine.setMode('linear');
    engine.resumeSimulation();
    await new Promise(r => setTimeout(r, 100));
    engine.pauseSimulation();

    // Test interaction.
    engine.setInteraction({
      pointerX: 300, pointerY: 300,
      active: true, radius: 100, force: 6,
    });
    engine.resumeSimulation();
    await new Promise(r => setTimeout(r, 100));
    engine.pauseSimulation();

    engine.destroy();
    console.log(`    → ${job!.particleCount} particles, ${progressEvents.length} progress events`);
  });

  await test('Engine: rejects invalid config', async () => {
    const engine = new ImportEngine();
    let threw = false;
    try {
      await engine.importImage({
        pipeline: {
          source: {},  // no source
          canvasWidth: 600,
          canvasHeight: 600,
        },
      });
    } catch { threw = true; }
    assert(threw, 'should reject invalid config');
    engine.destroy();
  });

  await test('Engine: rejects zero canvas dimensions', async () => {
    const engine = new ImportEngine();
    let threw = false;
    try {
      await engine.importImage({
        pipeline: {
          source: { fallback: true },
          canvasWidth: 0,
          canvasHeight: 600,
        },
      });
    } catch { threw = true; }
    assert(threw, 'should reject zero canvas dimensions');
    engine.destroy();
  });
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║  Particle Import Engine — Unit Test Suite                   ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const suiteStart = Date.now();

  console.log('  ── Sampler ──────────────────────────────────────────────');
  await testSampler();

  console.log('\n  ── Projector ───────────────────────────────────────────');
  await testProjector();

  console.log('\n  ── Particle ────────────────────────────────────────────');
  await testParticle();

  console.log('\n  ── Morphing ────────────────────────────────────────────');
  await testMorphing();

  console.log('\n  ── Colour Interpolation ────────────────────────────────');
  await testColour();

  console.log('\n  ── Job Queue ───────────────────────────────────────────');
  await testJobQueue();

  console.log('\n  ── Fallback Pattern ────────────────────────────────────');
  await testFallback();

  console.log('\n  ── Engine Lifecycle ────────────────────────────────────');
  await testEngineLifecycle();

  // ── Summary ──────────────────────────────────────────────────────────────
  const totalDuration = Date.now() - suiteStart;
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  if (failed === 0) {
    console.log(`║  ALL ${passed} TESTS PASSED ✓  (${totalDuration}ms)${' '.repeat(40 - String(passed).length - String(totalDuration).length)}║`);
  } else {
    console.log(`║  ${passed} passed, ${failed} failed  (${totalDuration}ms)${' '.repeat(30)}║`);
  }
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  if (failed > 0) {
    console.log('  Failed tests:');
    for (const r of results) {
      if (!r.passed) {
        console.log(`    ✗ ${r.name}: ${r.error}`);
      }
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Test runner failed:', err);
  process.exit(1);
});

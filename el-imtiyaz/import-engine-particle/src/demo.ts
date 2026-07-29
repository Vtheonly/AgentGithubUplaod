/**
 * particle-import-engine — Demo / Integration Test
 *
 * Runs the full import engine pipeline using the programmatic
 * fallback pattern (no external image file needed), then runs
 * the simulation for a few frames per mode and prints the results.
 *
 * Run: node dist/demo.js
 */

import { ImportEngine, LogoMode, SimulationFrame, ProgressEvent } from './index';

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  Particle Import Engine — Demo                         ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  const engine = new ImportEngine();
  engine.setMaxListeners(20);

  // ── Listen for events ──────────────────────────────────────────────────
  engine.on('progress', (event: ProgressEvent) => {
    console.log(`  [progress] ${event.state} ${Math.round(event.progress * 100)}% — ${event.message}`);
  });

  engine.on('ready', (data: { jobId: string; particleCount: number }) => {
    console.log(`\n  ✓ Import complete! ${data.particleCount} particles generated. Job: ${data.jobId}\n`);
  });

  // ── Step 1: Import with fallback pattern ───────────────────────────────
  console.log('  Step 1: Importing fallback pattern (no image file needed)…\n');

  const jobId = await engine.importImage({
    pipeline: {
      source: { fallback: true },
      canvasWidth: 600,
      canvasHeight: 600,
      density: 2,
      luminanceThreshold: 128,
    },
    physics: {
      damping: 0.88,
      stiffnessRange: [0.06, 0.10],
      sizeRange: [1.6, 3.0],
    },
    initialMode: 'logo' as LogoMode,
    tickInterval: 16,
    maxRetries: 3,
  });

  console.log(`  Job ID: ${jobId}\n`);

  // ── Step 2: Check job status ───────────────────────────────────────────
  const job = engine.getJob(jobId);
  if (job) {
    console.log('  Step 2: Job status:');
    console.log(`    State:     ${job.state}`);
    console.log(`    Progress:  ${Math.round(job.progress * 100)}%`);
    console.log(`    Particles: ${job.particleCount}`);
    console.log(`    Retries:   ${job.retries}`);
    console.log('');
  }

  // ── Step 3: Run simulation for 5 frames in each mode ──────────────────
  const modes: LogoMode[] = ['logo', 'circular', 'linear'];
  const frameData: Array<{ mode: LogoMode; frames: SimulationFrame[] }> = [];

  for (const mode of modes) {
    console.log(`  Step: Running 5 frames in ${mode} mode…`);
    engine.setMode(mode);

    const frames: SimulationFrame[] = [];
    const frameHandler = (frame: SimulationFrame) => {
      frames.push(frame);
    };
    engine.on('frame', frameHandler);

    engine.startSimulation();
    await sleep(120); // ~7 frames at 16ms interval
    engine.pauseSimulation();

    engine.removeListener('frame', frameHandler);
    frameData.push({ mode, frames: frames.slice(0, 5) });

    console.log(`    Got ${frames.length} frames, kept first 5.`);
    for (const f of frames.slice(0, 5)) {
      const sample = f.particles[0];
      console.log(`      t=${f.t} particles=${f.particles.length} first=(${sample.x.toFixed(1)}, ${sample.y.toFixed(1)})`);
    }
    console.log('');
  }

  // ── Step 4: Test mouse interaction ─────────────────────────────────────
  console.log('  Step 4: Testing mouse interaction (pointer at centre)…');
  engine.setMode('logo');
  engine.setInteraction({
    pointerX: 300,
    pointerY: 300,
    active: true,
    radius: 100,
    force: 6,
  });

  const interFrames: SimulationFrame[] = [];
  const interHandler = (frame: SimulationFrame) => {
    interFrames.push(frame);
  };
  engine.on('frame', interHandler);

  engine.startSimulation();
  await sleep(120);
  engine.pauseSimulation();
  engine.removeListener('frame', interHandler);

  if (interFrames.length > 0) {
    const f = interFrames[0];
    const displaced = f.particles.filter(
      (p) => Math.abs(p.x - 300) < 100 && Math.abs(p.y - 300) < 100,
    );
    console.log(`    ${displaced.length} particles within 100px of cursor (300, 300)`);
  }
  console.log('');

  // ── Step 5: Destroy ────────────────────────────────────────────────────
  console.log('  Step 5: Destroying engine…');
  engine.destroy();
  console.log('  ✓ Engine destroyed.\n');

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  Demo finished. All stages passed successfully.         ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
}

main().catch((err) => {
  console.error('Demo failed:', err);
  process.exit(1);
});

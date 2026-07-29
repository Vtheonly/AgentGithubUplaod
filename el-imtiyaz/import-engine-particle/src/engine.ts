/**
 * particle-import-engine — ImportEngine (Main Orchestrator)
 *
 * The central class that ties together all subsystems:
 *   - Image pipeline (load → sample → project)
 *   - Particle physics (spring, repulsion, morphing)
 *   - Job queue (track, retry, progress)
 *   - Simulation loop (tick-based frame production)
 *   - IPC handler (Electron integration)
 *
 * The engine is a standalone Node.js module — it does NOT create
 * a desktop application. It runs in the background and can be
 * invoked by an Electron app via IPC or direct API calls.
 */

import { EventEmitter } from 'events';
import {
  ImportEngineConfig,
  ImportJob,
  JobState,
  LogoMode,
  InteractionConfig,
  ParticleState,
  SimulationFrame,
  PipelineConfig,
  ProgressEvent,
  DEFAULT_PALETTE,
  Palette,
} from './types';
import { ImportEngineError, ConfigError } from './errors';
import { executePipeline, PipelineResult } from './pipeline/pipeline';
import { createParticle, updateParticle, toFrameData } from './physics/particle';
import { updateTargets } from './physics/morphing';
import { JobQueue } from './queue/job-queue';
import { IPCHandler } from './ipc/ipc-handler';

/** Default interaction state (no mouse). */
const DEFAULT_INTERACTION: InteractionConfig = {
  radius: 100,
  force: 6,
  pointerX: null,
  pointerY: null,
  active: false,
};

export class ImportEngine extends EventEmitter {
  // ── Subsystems ──────────────────────────────────────────────────────────
  private jobQueue: JobQueue;
  private ipcHandler: IPCHandler;

  // ── State ───────────────────────────────────────────────────────────────
  private particles: ParticleState[] = [];
  private mode: LogoMode = 'logo';
  private interaction: InteractionConfig = { ...DEFAULT_INTERACTION };
  private simulationRunning = false;
  private simulationInterval: ReturnType<typeof setInterval> | null = null;
  private destroyed = false;

  // ── Configuration ───────────────────────────────────────────────────────
  private config: ImportEngineConfig | null = null;
  private canvasWidth = 0;
  private canvasHeight = 0;
  private palette: Palette = DEFAULT_PALETTE;
  private physicsConfig: ImportEngineConfig['physics'];
  private circularConfig: ImportEngineConfig['circular'];
  private linearConfig: ImportEngineConfig['linear'];
  private progressValue = { value: 0 };
  private tickInterval = 16; // ~60 FPS

  // ── Pipeline result cached for mode switches ────────────────────────────
  private pipelineResult: PipelineResult | null = null;

  constructor() {
    super();
    this.jobQueue = new JobQueue(2);
    this.ipcHandler = new IPCHandler(this);
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Import an image and generate particles.
   *
   * This is the main entry point. It validates the config, creates
   * a job, runs the pipeline, and initialises particles.
   *
   * @param config - Complete engine configuration.
   * @returns Job ID for tracking progress.
   */
  async importImage(config: ImportEngineConfig): Promise<string> {
    if (this.destroyed) {
      throw new ImportEngineError('ENGINE_DESTROYED', 'Engine has been destroyed');
    }

    this.validateConfig(config);
    this.config = config;

    // Store derived values.
    this.canvasWidth = config.pipeline.canvasWidth;
    this.canvasHeight = config.pipeline.canvasHeight;
    this.palette = config.pipeline.palette ?? DEFAULT_PALETTE;
    this.physicsConfig = config.physics;
    this.circularConfig = config.circular;
    this.linearConfig = config.linear;
    this.tickInterval = config.tickInterval ?? 16;
    this.mode = config.initialMode ?? 'logo';
    this.interaction = {
      ...DEFAULT_INTERACTION,
      ...config.interaction,
    };

    // Create job.
    const jobId = this.jobQueue.createJob(config.pipeline, config.maxRetries ?? 3);
    this.jobQueue.startActive();

    try {
      // Run pipeline with progress events.
      this.jobQueue.updateProgress(jobId, 'loading', 0.1, 'Starting import pipeline…');

      this.pipelineResult = await executePipeline(config.pipeline, jobId, this);

      // Create particles from projected points.
      const { projection } = this.pipelineResult;
      this.particles = projection.points.map((pt, i) =>
        createParticle(i, pt.x, pt.y, this.palette, this.physicsConfig ?? {}),
      );

      // Set initial targets.
      updateTargets(
        this.particles,
        this.mode,
        this.canvasWidth,
        this.canvasHeight,
        Date.now(),
        this.circularConfig ?? {},
        this.linearConfig ?? {},
        this.progressValue,
      );

      // Mark job as ready.
      this.jobQueue.completeJob(jobId, this.particles.length);

      this.emit('ready', { jobId, particleCount: this.particles.length });

      return jobId;
    } catch (err) {
      this.jobQueue.failJob(jobId, (err as Error).message);
      this.emit('error', { jobId, error: (err as Error).message });
      throw err;
    } finally {
      this.jobQueue.endActive();
    }
  }

  /**
   * Set the animation mode.
   */
  setMode(mode: LogoMode): void {
    if (this.destroyed) return;
    this.mode = mode;
    this.progressValue.value = 0;
    updateTargets(
      this.particles,
      mode,
      this.canvasWidth,
      this.canvasHeight,
      Date.now(),
      this.circularConfig ?? {},
      this.linearConfig ?? {},
      this.progressValue,
    );
  }

  /**
   * Update interaction parameters (mouse/touch state).
   */
  setInteraction(interaction: Partial<InteractionConfig>): void {
    if (this.destroyed) return;
    Object.assign(this.interaction, interaction);
  }

  /**
   * Start the simulation loop.
   *
   * Produces SimulationFrame events at the configured tick rate.
   * The renderer can consume these to draw particles on the canvas.
   */
  startSimulation(): void {
    if (this.destroyed) return;
    if (this.simulationRunning) return;
    if (this.particles.length === 0) {
      throw new ImportEngineError('ENGINE_NOT_READY', 'No particles — call importImage first');
    }

    this.simulationRunning = true;

    this.simulationInterval = setInterval(() => {
      this.tick();
    }, this.tickInterval);
  }

  /**
   * Pause the simulation loop.
   */
  pauseSimulation(): void {
    this.simulationRunning = false;
    if (this.simulationInterval) {
      clearInterval(this.simulationInterval);
      this.simulationInterval = null;
    }
  }

  /**
   * Resume the simulation loop after pausing.
   */
  resumeSimulation(): void {
    if (this.destroyed) return;
    if (this.simulationRunning) return;
    this.startSimulation();
  }

  /**
   * Get the current number of particles.
   */
  getParticleCount(): number {
    return this.particles.length;
  }

  /**
   * Get a job by ID.
   */
  getJob(id: string): ImportJob | undefined {
    return this.jobQueue.getJob(id);
  }

  /**
   * List all jobs.
   */
  listJobs(): ImportJob[] {
    return this.jobQueue.listJobs();
  }

  /**
   * Get the IPC handler for Electron integration.
   */
  getIPCHandler(): IPCHandler {
    return this.ipcHandler;
  }

  /**
   * Get all particle states (full snapshot).
   */
  getParticles(): ParticleState[] {
    return this.particles;
  }

  /**
   * Destroy the engine — stop simulation, clean up resources.
   */
  destroy(): void {
    this.pauseSimulation();
    this.ipcHandler.close();
    this.jobQueue.clear();
    this.particles = [];
    this.pipelineResult = null;
    this.config = null;
    this.destroyed = true;
    this.removeAllListeners();
  }

  // ── Private Methods ─────────────────────────────────────────────────────

  /**
   * Execute one simulation tick.
   *
   * Updates targets (for time-dependent modes), applies physics,
   * and emits a SimulationFrame event.
   */
  private tick(): void {
    const time = Date.now();

    // Update targets for animated modes.
    if (this.mode === 'circular' || this.mode === 'linear') {
      updateTargets(
        this.particles,
        this.mode,
        this.canvasWidth,
        this.canvasHeight,
        time,
        this.circularConfig ?? {},
        this.linearConfig ?? {},
        this.progressValue,
      );
    }

    // Apply physics to each particle.
    for (const p of this.particles) {
      updateParticle(p, this.interaction, this.physicsConfig ?? {});
    }

    // Build compact frame for IPC.
    const frame: SimulationFrame = {
      t: time,
      mode: this.mode,
      particles: this.particles.map(toFrameData),
    };

    this.emit('frame', frame);
  }

  /**
   * Validate the engine configuration.
   */
  private validateConfig(config: ImportEngineConfig): void {
    const { pipeline } = config;

    if (!pipeline.canvasWidth || pipeline.canvasWidth <= 0) {
      throw new ConfigError('canvasWidth must be a positive number');
    }
    if (!pipeline.canvasHeight || pipeline.canvasHeight <= 0) {
      throw new ConfigError('canvasHeight must be a positive number');
    }

    const source = pipeline.source;
    if (!source.filePath && !source.url && !source.buffer && !source.fallback) {
      throw new ConfigError('At least one image source must be provided (filePath, url, buffer, or fallback)');
    }
  }
}

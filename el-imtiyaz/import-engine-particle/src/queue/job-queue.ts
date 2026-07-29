/**
 * particle-import-engine — Job Queue
 *
 * Manages import jobs with retry logic, progress tracking, and
 * concurrent execution limits. Each job represents a single image
 * import pipeline run.
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { ImportJob, JobState, PipelineConfig, ProgressEvent } from '../types';
import { JobError } from '../errors';

/** Events emitted by the job queue. */
export interface JobQueueEvents {
  progress: (event: ProgressEvent) => void;
  completed: (job: ImportJob) => void;
  failed: (job: ImportJob, error: string) => void;
  retry: (job: ImportJob, attempt: number) => void;
}

export class JobQueue extends EventEmitter {
  private jobs: Map<string, ImportJob> = new Map();
  private maxConcurrent: number;
  private activeCount = 0;

  constructor(maxConcurrent = 2) {
    super();
    this.maxConcurrent = maxConcurrent;
  }

  /**
   * Create a new import job and add it to the queue.
   *
   * @param config    - Pipeline configuration.
   * @param maxRetries - Maximum retry attempts on failure.
   * @returns The created job ID.
   */
  createJob(config: PipelineConfig, maxRetries = 3): string {
    const id = uuidv4();
    const now = Date.now();

    const job: ImportJob = {
      id,
      state: 'pending',
      config,
      retries: 0,
      maxRetries,
      createdAt: now,
      updatedAt: now,
      progress: 0,
      particleCount: 0,
    };

    this.jobs.set(id, job);
    return id;
  }

  /**
   * Get a job by ID.
   */
  getJob(id: string): ImportJob | undefined {
    return this.jobs.get(id);
  }

  /**
   * List all jobs.
   */
  listJobs(): ImportJob[] {
    return Array.from(this.jobs.values());
  }

  /**
   * Update a job's state.
   */
  updateJob(id: string, updates: Partial<ImportJob>): ImportJob {
    const job = this.jobs.get(id);
    if (!job) {
      throw new JobError('JOB_NOT_FOUND', `Job ${id} not found`);
    }
    Object.assign(job, updates, { updatedAt: Date.now() });
    this.jobs.set(id, job);
    return job;
  }

  /**
   * Update job progress.
   */
  updateProgress(id: string, state: JobState, progress: number, message: string): void {
    const job = this.updateJob(id, { state, progress });
    this.emit('progress', {
      jobId: id,
      state,
      progress,
      message,
    } as ProgressEvent);
  }

  /**
   * Mark a job as completed.
   */
  completeJob(id: string, particleCount: number): void {
    const job = this.updateJob(id, {
      state: 'ready',
      progress: 1,
      particleCount,
    });
    this.emit('completed', job);
  }

  /**
   * Mark a job as failed and attempt retry if possible.
   */
  failJob(id: string, error: string): void {
    const job = this.jobs.get(id);
    if (!job) return;

    if (job.retries < job.maxRetries) {
      job.retries++;
      job.state = 'pending';
      job.updatedAt = Date.now();
      this.jobs.set(id, job);
      this.emit('retry', job, job.retries);
    } else {
      job.state = 'error';
      job.error = error;
      job.updatedAt = Date.now();
      this.jobs.set(id, job);
      this.emit('failed', job, error);
    }
  }

  /**
   * Check if a new job can be started (concurrency limit).
   */
  canStart(): boolean {
    return this.activeCount < this.maxConcurrent;
  }

  /**
   * Increment the active job counter.
   */
  startActive(): void {
    this.activeCount++;
  }

  /**
   * Decrement the active job counter.
   */
  endActive(): void {
    this.activeCount = Math.max(0, this.activeCount - 1);
  }

  /**
   * Remove a job from the queue.
   */
  removeJob(id: string): boolean {
    return this.jobs.delete(id);
  }

  /**
   * Clear all jobs.
   */
  clear(): void {
    this.jobs.clear();
    this.activeCount = 0;
  }
}

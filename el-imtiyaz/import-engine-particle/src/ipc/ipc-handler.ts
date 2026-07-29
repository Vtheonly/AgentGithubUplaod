/**
 * particle-import-engine — IPC Handler for Electron Integration
 *
 * Provides a bidirectional communication channel between the
 * import engine (running in the main process or a background
 * worker) and the Electron renderer process.
 *
 * Two transport modes:
 *   1. **Electron IPC** — Uses ipcMain/ipcRenderer for native Electron.
 *   2. **WebSocket** — For remote or non-Electron integrations.
 *
 * The handler translates InboundMessages into engine actions
 * and sends OutboundMessages back to the client.
 */

import { EventEmitter } from 'events';
import {
  InboundMessage,
  OutboundMessage,
  IPCTransport,
  ImportEngineConfig,
  LogoMode,
  InteractionConfig,
  ProgressEvent,
} from '../types';

/**
 * IPC Handler — bridges the transport layer and the engine.
 *
 * Usage with Electron ipcMain:
 * ```typescript
 * const { ipcMain } = require('electron');
 * const handler = new IPCHandler(engine);
 * handler.attachElectronIPC(ipcMain);
 * ```
 *
 * Usage with a custom transport:
 * ```typescript
 * const handler = new IPCHandler(engine);
 * handler.attachTransport(myWebSocketTransport);
 * ```
 */
export class IPCHandler extends EventEmitter {
  private engine: any; // ImportEngine — typed loosely to avoid circular dep.
  private transport: IPCTransport | null = null;

  constructor(engine: any) {
    super();
    this.engine = engine;
  }

  /**
   * Attach a generic IPC transport.
   */
  attachTransport(transport: IPCTransport): void {
    this.transport = transport;
    transport.onMessage((message: InboundMessage) => {
      this.handleMessage(message);
    });

    // Forward engine events to the transport.
    this.engine.on('progress', (event: ProgressEvent) => {
      transport.send({ type: 'progress', data: event });
    });
    this.engine.on('frame', (frame: any) => {
      transport.send({ type: 'frame', data: frame });
    });
    this.engine.on('ready', (data: any) => {
      transport.send({ type: 'ready', data });
    });
    this.engine.on('error', (data: any) => {
      transport.send({ type: 'error', data });
    });
  }

  /**
   * Attach to Electron's ipcMain.
   *
   * @param ipcMain - Electron's ipcMain object.
   * @param channel - IPC channel name (default 'particle-engine').
   */
  attachElectronIPC(ipcMain: any, channel = 'particle-engine'): void {
    ipcMain.on(`${channel}:request`, (event: any, message: InboundMessage) => {
      const response = this.handleMessage(message);
      if (response) {
        event.reply(`${channel}:response`, response);
      }
    });

    // Forward engine events as Electron IPC sends.
    this.engine.on('progress', (data: ProgressEvent) => {
      ipcMain.emit(`${channel}:progress`, { data });
    });
    this.engine.on('frame', (data: any) => {
      ipcMain.emit(`${channel}:frame`, { data });
    });
  }

  /**
   * Handle an inbound message and dispatch it to the engine.
   */
  handleMessage(message: InboundMessage): OutboundMessage | undefined {
    try {
      const msg = message as InboundMessage & { type: string };
      switch (msg.type) {
        case 'import':
          return this.handleImport(msg.config);

        case 'setMode':
          return this.handleSetMode(msg.mode);

        case 'setInteraction':
          return this.handleSetInteraction(msg.interaction);

        case 'startSimulation':
          return this.handleStartSimulation();

        case 'pauseSimulation':
          this.engine.pauseSimulation();
          return undefined;

        case 'resumeSimulation':
          this.engine.resumeSimulation();
          return undefined;

        case 'destroy':
          this.engine.destroy();
          return undefined;

        case 'getJobStatus':
          return this.handleGetJobStatus(msg.jobId);

        case 'listJobs':
          return this.handleListJobs();

        default: {
          const unknownType = (message as Record<string, unknown>).type ?? 'unknown';
          return { type: 'error', data: { jobId: '', error: `Unknown message type: ${unknownType}` } };
        }
      }
    } catch (err) {
      return {
        type: 'error',
        data: { jobId: '', error: (err as Error).message },
      };
    }
  }

  private handleImport(config: ImportEngineConfig): OutboundMessage {
    const jobId = this.engine.importImage(config);
    return { type: 'progress', data: { jobId, state: 'pending', progress: 0, message: 'Import started' } };
  }

  private handleSetMode(mode: LogoMode): OutboundMessage {
    this.engine.setMode(mode);
    return { type: 'ready', data: { jobId: '', particleCount: this.engine.getParticleCount() } };
  }

  private handleSetInteraction(_interaction: Partial<InteractionConfig>): OutboundMessage | undefined {
    this.engine.setInteraction(_interaction);
    return undefined;
  }

  private handleStartSimulation(): OutboundMessage | undefined {
    this.engine.startSimulation();
    return undefined;
  }

  private handleGetJobStatus(jobId: string): OutboundMessage {
    const job = this.engine.getJob(jobId);
    return { type: 'jobStatus', data: job };
  }

  private handleListJobs(): OutboundMessage {
    return { type: 'jobList', data: this.engine.listJobs() };
  }

  /**
   * Close the transport and stop listening.
   */
  close(): void {
    if (this.transport) {
      this.transport.close();
      this.transport = null;
    }
    this.removeAllListeners();
  }
}

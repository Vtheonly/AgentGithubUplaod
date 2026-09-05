/**
 * SyncProvider — React context for the SyncService.
 *
 * Wires the SyncService into the React tree. The provider is mounted
 * once near the app root (after the AuthProvider so we know the
 * tenant ID + actor ID). Components consume the service via
 * `useSyncStatus()` (for the snapshot) or `useSyncActions()` (for
 * enqueue/syncNow/clear).
 *
 * The provider is responsible for:
 *   - Lazily constructing the SyncService singleton.
 *   - Wiring the `push` handler to the active Supabase client (only
 *     when Supabase is configured).
 *   - Starting the service on mount (which starts the online listener
 *     + the periodic poller).
 *   - Stopping the service on unmount (mostly relevant in tests).
 */

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  SyncService,
  initialiseSyncService,
  getSyncService,
  _resetSyncServiceForTests,
} from "../../infrastructure/sync/sync-service";
import type { SyncQueueEntry, SyncStatusSnapshot } from "../../infrastructure/sync/sync-types";
import { isSupabaseConfigured } from "../../infrastructure/supabase/supabase-client";
import { useAuth } from "../../app/providers/auth-provider";

const SyncStatusContext = createContext<SyncStatusSnapshot | null>(null);
const SyncActionsContext = createContext<SyncActions | null>(null);

export interface SyncActions {
  /** Enqueue a mutation. Returns the queue entry ID. */
  enqueue: (input: {
    entity: SyncQueueEntry["entity"];
    operation: SyncQueueEntry["operation"];
    payload: Record<string, unknown>;
    isMock: boolean;
    sourceFile?: string;
    importRunId?: string;
  }) => Promise<string>;
  /**
   * Enqueue MANY mutations in ONE shot. Returns the created queue entry IDs.
   *
   * Use this instead of calling `enqueue` in a loop — batching cuts the
   * snapshot emissions (and the resulting React re-renders) from N to 1,
   * which is the difference between a smooth Excel import and a UI that
   * freezes for seconds with a flood of sync notifications.
   */
  enqueueBatch: (inputs: ReadonlyArray<{
    entity: SyncQueueEntry["entity"];
    operation: SyncQueueEntry["operation"];
    payload: Record<string, unknown>;
    isMock: boolean;
    sourceFile?: string;
    importRunId?: string;
  }>) => Promise<string[]>;
  /** Manually trigger a sync drain. */
  syncNow: () => Promise<{ pushed: number; failed: number; skippedMock: number }>;
  /**
   * T-171 (SYNC-200): re-queue every terminal-failed entry for a fresh
   * retry cycle. Returns the number of entries re-queued.
   */
  retryFailed: () => Promise<number>;
  /**
   * T-171 (SYNC-200): permanently remove every terminal-failed entry
   * (stale residue). Destructive — callers must confirm with the user.
   * Returns the number of entries removed.
   */
  discardFailed: () => Promise<number>;
  /** Clear all queue entries (admin only — wire to a confirmation modal). */
  clearQueue: () => Promise<void>;
  /** Force an online probe. */
  probeNow: () => Promise<boolean>;
}

import { defaultPushHandler } from "../../infrastructure/sync/default-push-handler";

export function SyncProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const [snapshot, setSnapshot] = useState<SyncStatusSnapshot | null>(null);

  // Construct the service once.
  // (T-158: the session is read through `sessionRef` — a ref, not reactive
  // state — so an empty dependency array is genuinely correct here; the
  // stale eslint-disable directive the array used to need is gone.)
  const service = useMemo<SyncService>(() => {
    return initialiseSyncService({
      tenantId: () => sessionRef.current?.tenantId ?? "default",
      actorId: () => sessionRef.current?.userId ?? "system",
      isSupabaseConfigured: () => isSupabaseConfigured(),
      isMockMode: () => !isSupabaseConfigured(),
      push: defaultPushHandler,
      autoStart: true,
    });
  }, []);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    void (async () => {
      await service.start();
      unsub = service.subscribe(setSnapshot);
    })();
    return () => {
      if (unsub) unsub();
    };
  }, [service]);

  const actions = useMemo<SyncActions>(
    () => ({
      enqueue: (input) => service.enqueue(input),
      enqueueBatch: (inputs) => service.enqueueBatch(inputs),
      syncNow: () => service.syncNow(),
      retryFailed: () => service.retryFailed(),
      discardFailed: () => service.discardFailed(),
      clearQueue: () => service.clearQueue(),
      probeNow: () => getSyncServiceProbeNow(service),
    }),
    [service],
  );

  return (
    <SyncStatusContext.Provider value={snapshot}>
      <SyncActionsContext.Provider value={actions}>{children}</SyncActionsContext.Provider>
    </SyncStatusContext.Provider>
  );
}

/** Helper: trigger an online probe via the service's detector. */
async function getSyncServiceProbeNow(service: SyncService): Promise<boolean> {
  // Access the detector via reflection — it's not exposed publicly to
  // keep the API surface tight. This is fine because it's only used by
  // the settings UI for a manual "Check connection" button.
  const det = (service as unknown as { detector: { probe: () => Promise<boolean> } }).detector;
  return det.probe();
}

export function useSyncStatus(): SyncStatusSnapshot | null {
  return useContext(SyncStatusContext);
}

export function useSyncActions(): SyncActions {
  const ctx = useContext(SyncActionsContext);
  if (!ctx) throw new Error("useSyncActions must be used within a SyncProvider");
  return ctx;
}

/** Test-only: reset the singleton between tests. */
export function _resetSyncProviderForTests(): void {
  _resetSyncServiceForTests();
}

/** Re-export the underlying service for advanced consumers (tests). */
export { getSyncService };

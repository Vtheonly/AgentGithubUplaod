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
  /** Manually trigger a sync drain. */
  syncNow: () => Promise<{ pushed: number; failed: number; skippedMock: number }>;
  /** Clear all queue entries (admin only — wire to a confirmation modal). */
  clearQueue: () => Promise<void>;
  /** Force an online probe. */
  probeNow: () => Promise<boolean>;
}

/**
 * Default push handler — calls the appropriate Supabase table for the
 * entity kind. This is intentionally simple: production code may want
 * to add per-entity mapping logic. For now we route everything through
 * a single `sync_queue` table on Supabase that an Edge Function drains.
 */
async function defaultPushHandler(entry: SyncQueueEntry): Promise<void> {
  // We use the dynamic import so the renderer doesn't crash when
  // Supabase isn't configured (the import would throw).
  const { getSupabaseClient } = await import("../../infrastructure/supabase/supabase-client");
  const client = getSupabaseClient();
  const { error } = await client.from("sync_queue").upsert({
    id: entry.id,
    entity: entry.entity,
    operation: entry.operation,
    tenant_id: entry.tenantId,
    actor_id: entry.actorId,
    payload: entry.payload,
    source_file: entry.sourceFile ?? null,
    import_run_id: entry.importRunId ?? null,
    queued_at: entry.queuedAt,
    status: "pending",
  });
  if (error) throw error;
}

export function SyncProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const [snapshot, setSnapshot] = useState<SyncStatusSnapshot | null>(null);

  // Construct the service once.
  const service = useMemo<SyncService>(() => {
    return initialiseSyncService({
      tenantId: () => sessionRef.current?.tenantId ?? "default",
      actorId: () => sessionRef.current?.userId ?? "system",
      isSupabaseConfigured: () => isSupabaseConfigured(),
      isMockMode: () => !isSupabaseConfigured(),
      push: defaultPushHandler,
      autoStart: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      syncNow: () => service.syncNow(),
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

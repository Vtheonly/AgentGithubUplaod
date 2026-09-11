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
import type { SyncConflictRecord, SyncQueueEntry, SyncStatusSnapshot } from "../../infrastructure/sync/sync-types";
import { isSupabaseConfigured } from "../../infrastructure/supabase/supabase-client";
import { useAuth } from "../../app/providers/auth-provider";
import { useRepositories } from "../../app/providers/repository-provider";
import { conflictGuard } from "../../infrastructure/sync/conflict-detector";
import type { ConflictChoices } from "../../domain/calc/diff/three-way";

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
    /** T-298 (OFFLINE-400): the server-row snapshot at edit start (3-way base). */
    basePayload?: Record<string, unknown> | null;
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
    basePayload?: Record<string, unknown> | null;
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
  /**
   * T-298 (OFFLINE-400): list the entries parked in `conflict` status —
   * the resolver modal's work list.
   */
  listConflicts: () => Promise<SyncQueueEntry[]>;
  /**
   * T-298 (OFFLINE-400): apply the resolver's per-field choices (take-local /
   * take-remote / manual) to a conflict-parked entry. Returns the resolved
   * entry, or null when the entry is not parked in conflict status.
   */
  resolveConflict: (entryId: string, choices: ConflictChoices) => Promise<SyncQueueEntry | null>;
}

import { defaultPushHandler } from "../../infrastructure/sync/default-push-handler";

export function SyncProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const repos = useRepositories();
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const reposRef = useRef(repos);
  reposRef.current = repos;
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
      // T-298 (OFFLINE-400): the 3-way no-silent-overwrite guard — fetches
      // the live server row and parks entries whose payload diverges from it
      // on fields BOTH sides changed.
      conflictGuard,
      // Detection side-effects: the attributed audit entry + the user
      // notification (the mandate requires BOTH events to notify).
      onConflictDetected: (entry, record) => {
        const s = sessionRef.current;
        const id = conflictEntityId(entry);
        void reposRef.current.audit
          .log({
            action: "sync.conflict_detected",
            entityType: entry.entity,
            entityId: id,
            actorId: s?.userId ?? "system",
            actorName: s?.displayName ?? "Système",
            actorRole: s?.role ?? null,
            tenantId: s?.tenantId ?? null,
            diff: {
              before: entry.basePayload ?? null,
              after: record.remotePayload,
            },
            note: `Conflit d'édition concurrente détecté (${record.conflictPaths.length} champ(s): ${record.conflictPaths.join(", ")}). Résolution requise avant synchronisation.`,
          })
          .catch(() => undefined);
        void reposRef.current.notifications
          .create({
            title: "Conflit d'édition détecté",
            body: `Une modification concurrente a été détectée sur ${entry.entity} ${id}. ${s?.displayName ?? "Votre édition"} diverge du serveur sur ${record.conflictPaths.length} champ(s) — résolvez-la depuis l'indicateur de synchronisation.`,
            type: "system",
            priority: "high",
            sourceLabel: "Synchronisation",
            entityType: entry.entity,
            entityId: id,
            createdBy: s?.userId ?? "system",
          })
          .catch(() => undefined);
      },
      // Resolution side-effects: the audit-logged resolution (with the
      // before/after diff) + the second notification.
      onConflictResolved: (entry, resolved, resolution) => {
        const s = sessionRef.current;
        const id = conflictEntityId(entry);
        void reposRef.current.audit
          .log({
            action: "sync.conflict_resolved",
            entityType: entry.entity,
            entityId: id,
            actorId: s?.userId ?? "system",
            actorName: s?.displayName ?? "Système",
            actorRole: s?.role ?? null,
            tenantId: s?.tenantId ?? null,
            diff: {
              before: entry.payload,
              after: resolution.payload,
            },
            note: `Conflit résolu par ${s?.displayName ?? "l'utilisateur"} (${resolution.chosenPaths.length} choix appliqué(s): ${resolution.chosenPaths.join(", ")}). La version fusionnée est reprogrammée pour synchronisation.`,
          })
          .catch(() => undefined);
        void reposRef.current.notifications
          .create({
            title: "Conflit résolu",
            body: `Le conflit sur ${entry.entity} ${id} a été résolu (${resolution.chosenPaths.length} champ(s) fusionné(s)). La version fusionnée sera synchronisée.`,
            type: "system",
            priority: "medium",
            sourceLabel: "Synchronisation",
            entityType: entry.entity,
            entityId: id,
            createdBy: s?.userId ?? "system",
          })
          .catch(() => undefined);
      },
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
      listConflicts: () => service.listConflicts(),
      resolveConflict: (entryId, choices) => service.resolveConflict(entryId, choices),
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

/** T-298: a human-stable entity id for audit/notification attribution. */
function conflictEntityId(entry: Pick<SyncQueueEntry, "entity" | "payload">): string {
  const p = entry.payload ?? {};
  const id =
    (p.id as string) ??
    (p.code as string) ??
    (p.parent_code as string) ??
    (p.student_code as string) ??
    (p.receiptNumber as string) ??
    (p.payment_number as string) ??
    (p.entry_number as string) ??
    entry.entity;
  return String(id);
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

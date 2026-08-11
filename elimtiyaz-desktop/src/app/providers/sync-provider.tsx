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
 * Default push handler — calls the appropriate Supabase upsert RPC for the
 * entity kind. Each RPC is SECURITY DEFINER + idempotent (declared in
 * migration `0027_shared_unification.sql`), so re-pushing the same queue
 * entry is safe and never creates duplicates.
 *
 * Flow:
 *   1. Look up the entity kind (`parent` | `student` | `payment` |
 *      `ledger_entry` | ...).
 *   2. Map the queue `payload` to the RPC argument shape.
 *   3. Call the corresponding `upsert_*_from_import` RPC.
 *   4. On success, also upsert the queue row into `sync_queue` (for audit)
 *      and call `mark_sync_queue_processed(id, 'synced')`.
 *   5. On failure, call `mark_sync_queue_processed(id, 'failed', error)`
 *      so the next drain attempt respects backoff.
 */
async function defaultPushHandler(entry: SyncQueueEntry): Promise<void> {
  // We use the dynamic import so the renderer doesn't crash when
  // Supabase isn't configured (the import would throw).
  const { getSupabaseClient } = await import("../../infrastructure/supabase/supabase-client");
  const client = getSupabaseClient();
  const p = entry.payload ?? {};

  // Persist the queue row (audit trail — idempotent by primary key `id`).
  const { error: queueErr } = await client.from("sync_queue").upsert({
    id: entry.id,
    entity: entry.entity,
    operation: entry.operation,
    tenant_id: entry.tenantId,
    actor_id: entry.actorId,
    payload: p,
    source_file: entry.sourceFile ?? null,
    import_run_id: entry.importRunId ?? null,
    queued_at: entry.queuedAt,
    status: "pending",
  });
  if (queueErr) throw queueErr;

  try {
    switch (entry.entity) {
      case "parent": {
        const { error } = await client.rpc("upsert_parent_from_import", {
          p_tenant_id: entry.tenantId,
          p_parent_code: (p.code as string) ?? (p.parent_code as string) ?? `PAR-${new Date().getFullYear()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
          p_first_name: (p.firstName as string) ?? (p.first_name as string) ?? "",
          p_last_name: (p.lastName as string) ?? (p.last_name as string) ?? "",
          p_display_name: (p.displayName as string) ?? (p.display_name as string) ?? null,
          p_primary_phone: (p.phone as string) ?? (p.primary_phone as string) ?? "(inconnu)",
          p_secondary_phone: (p.whatsapp as string) ?? (p.secondary_phone as string) ?? null,
          p_email: (p.email as string) ?? null,
          p_occupation: (p.occupation as string) ?? null,
          p_address: (p.address as string) ?? null,
          p_relationship: null,
          p_preferred_language: (p.preferredLanguage as string) ?? "fr",
          p_is_active: true,
          // Migration 0028 — pass transport_destination + city_tier so the
          // queue safety-net path persists the same fields as the importer.
          p_transport_destination: (p.transportDestination as string) ?? (p.transport_destination as string) ?? null,
          p_city_tier: (p.cityTier as string) ?? (p.city_tier as string) ?? null,
        });
        if (error) throw error;
        break;
      }
      case "student": {
        const { error } = await client.rpc("upsert_student_from_import", {
          p_tenant_id: entry.tenantId,
          p_student_code: (p.code as string) ?? (p.student_code as string) ?? `ELV-${new Date().getFullYear()}-${Math.floor(Math.random() * 1_000_000).toString().padStart(6, "0")}`,
          p_parent_id: (p.parentId as string) ?? (p.parent_id as string),
          p_first_name: (p.firstName as string) ?? (p.first_name as string) ?? "",
          p_last_name: (p.lastName as string) ?? (p.last_name as string) ?? "",
          p_display_name: (p.displayName as string) ?? (p.display_name as string) ?? null,
          p_middle_name: null,
          p_date_of_birth: (p.birthDate as string) ?? (p.date_of_birth as string) ?? null,
          p_gender: (p.gender as string) === "unspecified" ? null : (p.gender as string) ?? null,
          p_grade_level_id: null,
          p_class_id: (p.classId as string) ?? (p.class_id as string) ?? null,
          p_enrollment_date: null,
          p_enrollment_status: "active",
          p_medical_notes: (p.medicalNotes as string) ?? (p.medical_notes as string) ?? null,
          p_is_active: true,
          // Migration 0028 — pass grade_level_code + transport_tier +
          // payment_plan so the queue safety-net path persists the same
          // fields as the importer.
          p_grade_level_code: (p.gradeLevel as string) ?? (p.grade_level_code as string) ?? null,
          p_transport_tier: (p.transportTier as string) ?? (p.transport_tier as string) ?? null,
          p_payment_plan: (p.paymentPlan as string) ?? (p.payment_plan as string) ?? "tranches",
        });
        if (error) throw error;
        break;
      }
      case "payment": {
        const { error } = await client.rpc("upsert_payment_from_import", {
          p_tenant_id: entry.tenantId,
          p_payment_number: (p.receiptNumber as string) ?? (p.payment_number as string) ?? `PAY-${new Date().getFullYear()}-${Math.floor(Math.random() * 1_000_000).toString().padStart(6, "0")}`,
          p_parent_id: (p.parentId as string) ?? (p.parent_id as string),
          p_student_id: (p.studentId as string) ?? (p.student_id as string) ?? null,
          p_amount: (p.amount as number) ?? 0,
          p_method: (p.method as string) ?? "cash",
          p_category: (p.category as string) ?? "other",
          p_status: (p.status as string) ?? null,
          p_proof_path: (p.proofUrl as string) ?? (p.proof_path as string) ?? null,
          p_collected_at: (p.collectedAt as string) ?? (p.collected_at as string) ?? null,
          p_collected_by: (p.collectedBy as string) ?? (p.collected_by as string) ?? null,
          p_notes: (p.notes as string) ?? null,
        });
        if (error) throw error;
        break;
      }
      case "ledger_entry": {
        const { error } = await client.rpc("upsert_ledger_entry_from_import", {
          p_tenant_id: entry.tenantId,
          p_entry_number: (p.id as string) ?? (p.entry_number as string) ?? null,
          p_parent_id: (p.parentId as string) ?? (p.parent_id as string),
          p_student_id: (p.studentId as string) ?? (p.student_id as string) ?? null,
          p_account_id: (p.accountId as string) ?? (p.account_id as string) ?? null,
          p_entry_type: (p.type as string) ?? (p.entry_type as string) ?? "charge",
          p_amount: (p.amount as number) ?? 0,
          p_category: (p.category as string) ?? "other",
          p_description: (p.description as string) ?? null,
          p_source_type: (p.sourceType as string) ?? (p.source_type as string) ?? "bulk_import",
          p_source_id: (p.sourceId as string) ?? (p.source_id as string) ?? null,
          p_method: (p.method as string) ?? null,
          p_receipt_number: (p.receiptNumber as string) ?? (p.receipt_number as string) ?? null,
          p_payment_status: (p.paymentStatus as string) ?? (p.payment_status as string) ?? null,
          p_reverses_id: (p.reversesId as string) ?? (p.reverses_id as string) ?? null,
          p_actor_id: (p.actorId as string) ?? (p.actor_id as string) ?? entry.actorId,
          p_actor_name: (p.actorName as string) ?? (p.actor_name as string) ?? "System",
          p_at: (p.at as string) ?? null,
          p_metadata: (p.metadata as Record<string, unknown>) ?? null,
        });
        if (error) throw error;
        break;
      }
      default:
        // Unknown entity kinds: just mark as synced without upserting. The
        // queue row from the upsert above is the audit trail.
        break;
    }

    // Mark the queue row as synced.
    await client.rpc("mark_sync_queue_processed", {
      p_id: entry.id,
      p_status: "synced",
      p_error: null,
    });
  } catch (err) {
    // Mark as failed so the next drain attempt respects exponential backoff.
    const msg = err instanceof Error ? err.message : String(err);
    try {
      await client.rpc("mark_sync_queue_processed", {
        p_id: entry.id,
        p_status: "failed",
        p_error: msg,
      });
    } catch { /* swallow — the original error is the one we throw */ }
    throw err;
  }
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

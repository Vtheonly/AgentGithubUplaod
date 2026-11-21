/**
 * The backend PORTS — the decoupling boundary between the application and any
 * data backend (LOCAL-FIRST-BLUEPRINT.md §5, "the decoupling boundary").
 *
 * T-550 (ARCH-033) — INTERFACES ONLY, zero runtime change:
 *   this module deliberately contains NO implementation, NO factory, NO
 *   provider wiring and NO side effects. It is the seam the later lanes
 *   implement against: the Stage B `LocalDatabaseService` (T-599), the local
 *   auth service, the relay transport and the diagnostics door. The existing
 *   Supabase adapters keep working unchanged behind `repository-provider.tsx`;
 *   T-552 routes the bypass files THROUGH these ports afterwards.
 *
 * Shape provenance:
 *   - `DataBackendPort`, `AuthPort`, `SyncTransportPort`, `DiagnosticsPort`:
 *     verbatim from LOCAL-FIRST-BLUEPRINT.md §5 (the S21/S24 evidence base).
 *   - `StoragePort`: named by EXECUTION-PLAN v2.3 §3 Step 6's five-port list
 *     (the blueprint's fifth port there was `NotificationPort`); its shape is
 *     derived from the migration-0018 private-bucket vault surface
 *     (`infrastructure/storage/media-vault.ts` — upload/fresh-signed-URL, the
 *     no-public-URL rule) and the diagnostics census (`listMedia`).
 *   - The blueprint's `NotificationPort` shape stays blueprint-side for now:
 *     the v2.3 card names five ports and `StoragePort` is one of them.
 *
 * v0 placeholders (doc-noted, NOT frozen):
 *   - `ReadSpec` / `BackendChange` get their FINAL wire shapes with the
 *     §14 query-minimization architecture (T-590..T-593). The v0 forms below
 *     keep the seam open without inventing a wire format this early.
 *   - `KeysetCursor` IS final (the 0143 composite keyset contract — the
 *     `pull_*_for_sync` RPCs' `(updated_at, id)` cursor).
 */

import type { Result } from "../../core/result";
import type { Session } from "../../core/rbac/session";
import type { Observable } from "../../domain/repository/repository";
import type { SyncOperation } from "../sync/sync-types";

/** Re-exported for port consumers (the transport adapters' op-kind vocabulary). */
export type { SyncOperation };

// ============================================================================
// Shared v0 wire placeholders (final shapes land with §14 / T-590..T-593)
// ============================================================================

/**
 * v0 read specification. The §14 read model (T-590) will replace this with
 * the canonical keyed/entity read language; until then a backend port only
 * needs to know WHICH TABLE a read targets (the per-repository adapters
 * today build their full queries themselves).
 */
export interface ReadSpec {
  readonly table: string;
}

/**
 * v0 backend change notification. The realtime channel replacement
 * (`changes()` below) streams these; the §14 lane finalizes the shape.
 */
export interface BackendChange {
  readonly table: string;
  readonly kind: "insert" | "update" | "delete";
  readonly id?: string;
}

// ============================================================================
// DataBackendPort — the formalized repository seam
// ============================================================================

/**
 * The formalized repository seam. Sits UNDER the 54-slot `Repositories`
 * interface (`repository-provider.tsx`) — one DataBackendPort implementation
 * backs one whole composite (mock / supabase-relay today, local-pglite in
 * Stage B).
 */
export interface DataBackendPort {
  /** The implementing backend kind — the fail-closed selection's discriminator. */
  readonly id: "local-pglite" | "supabase-relay" | "mock";

  /** Live reads — the existing Observable<T> contract (repository.ts:88-92). */
  observe<T>(spec: ReadSpec): Observable<T[]>;

  /** One-shot reads. */
  read<T>(spec: ReadSpec): Promise<T[]>;

  /**
   * Mutations are RPC-SHAPED (name + args), executed inside the backend with
   * full transactionality — `collect_and_allocate_payment`, `fn_*`, … keep
   * their names. The 56-RPC financial surface keeps its shape across
   * backends (the §4 engine ruling).
   */
  execute<T>(op: { rpc: string; args: Record<string, unknown> }): Promise<Result<T>>;

  /** The import/sync bulk path (ImportService / the sync push handlers). */
  upsertMany(table: string, rows: Record<string, unknown>[]): Promise<Result<number>>;

  /**
   * Transactional composition — the `tx` parameter is THE SAME PORT bound to
   * the enclosing transaction scope; nested `execute`/`upsertMany` calls on
   * it commit or roll back together.
   */
  transaction<T>(fn: (tx: DataBackendPort) => Promise<T>): Promise<T>;

  /** Replaces the realtime channel (`financial-realtime` / the sync provider). */
  changes(): Observable<BackendChange[]>;

  /** Chain replay/advance — the migration chain stays backend-owned. */
  migrate(target?: number): Promise<Result<{ applied: number }>>;
}

// ============================================================================
// AuthPort — local identity + admin account lifecycle
// ============================================================================

/** The admin provisioning input (the T-079 contract, repository.ts). */
export interface PortCreateAccountInput {
  email: string;
  fullName?: string;
  phone?: string;
  role: string;
  initialPassword?: string;
  personnelId?: string;
}

/** The created-account projection (the create-user-account EF's response). */
export interface PortCreatedAccount {
  userId: string;
  email: string;
  /** The generated/out-of-band initial password when the backend minted one. */
  generatedPassword?: string;
}

/** The admin's account-overview row (the user-account directory). */
export interface PortAccountOverviewEntry {
  userId: string;
  email: string;
  fullName?: string;
  role: string;
  active: boolean;
  lastSignIn?: string;
}

export interface AuthPort {
  signIn(email: string, password: string): Promise<Result<Session>>;
  signOut(scope: "local" | "all-devices"): Promise<Result<void>>;
  refreshSession(): Promise<Result<Session | null>>;
  /** The SEC-103 contract is kept: re-auth with the current password first. */
  changePassword(current: string, next: string): Promise<Result<void>>;
  // Admin surface (was UserAccountRepository + the approval EFs):
  createAccount(input: PortCreateAccountInput): Promise<Result<PortCreatedAccount>>;
  deleteAccount(id: string): Promise<Result<void>>;
  listAccounts(): Promise<Result<PortAccountOverviewEntry[]>>;
  /** ADR-011 lifecycle — single-use parent/portal activation codes. */
  issueActivationCode(parentId: string): Promise<Result<{ code: string }>>;
  bindActivationCode(code: string): Promise<Result<void>>;
}

// ============================================================================
// SyncTransportPort — dumb byte-pipe, swappable
// ============================================================================

/** The 0143 composite keyset contract — `pull_*_for_sync`'s cursor, verbatim. */
export type KeysetCursor = { updated_at: string; id: string };

export interface SyncTransportPort {
  /** Idempotent push (the `default-push-handler`'s `upsert_*_from_import` dispatch). */
  push(ops: SyncOperation[]): Promise<Result<{ acks: Array<{ id: string; seq?: number }> }>>;

  /** Keyset pull — the cursor semantics are kept verbatim (0143). */
  pull(
    cursor: KeysetCursor,
    limit?: number,
  ): Promise<Result<{ ops: SyncOperation[]; next?: KeysetCursor }>>;

  /** The invalidation bus — replaces the realtime channel for sync wake-ups. */
  onRemoteChange(cb: (n: { streams: string[] }) => void): () => void;

  /** Replaces the online-detector's Supabase `/auth/v1/health` probe. */
  status(): Observable<"online" | "offline" | "degraded">;
}

// ============================================================================
// StoragePort — the private-bucket media vault seam (migration 0018)
// ============================================================================

/** The 0018 private buckets — the vault call sites' union (media-vault.ts). */
export type PortMediaBucket =
  | "payment-proofs"
  | "student-documents"
  | "expense-receipts"
  | "homework-attachments"
  | "chat-attachments";

export interface PortUploadMediaResult {
  /** Storage path (`<tenantId>/<entityId>/<filename>`) — persist this. */
  readonly path: string;
  readonly bucket: PortMediaBucket;
  readonly sizeBytes: number;
  readonly contentType: string;
}

/**
 * The media-vault seam. The vault §12.07 rules are CONTRACT, not
 * implementation detail: PRIVATE buckets only, signed URLs (5-minute
 * expiry) only, never a public URL, never a client-side cache of the
 * signed URL.
 */
export interface StoragePort {
  /** Upload to a PRIVATE bucket (upsert:false — a path collision fails). */
  uploadPrivateMedia(params: {
    bucket: PortMediaBucket;
    entityId: string;
    tenantId: string;
    file: File;
  }): Promise<Result<PortUploadMediaResult>>;

  /** A FRESH signed URL on every display — 5-minute TTL, never cached. */
  freshSignedMediaUrl(params: {
    bucket: PortMediaBucket;
    path: string;
    download?: boolean;
  }): Promise<Result<string | null>>;

  /** The diagnostics media census (was `listBuckets` — diagnostics-runner.ts). */
  listMedia(): Promise<Result<MediaCensus>>;
}

/** The storage census row (the T-505/T-536 vault-audit shape, v0). */
export interface MediaCensus {
  readonly buckets: Array<{
    readonly id: string;
    readonly private: boolean;
    readonly objectCount?: number;
  }>;
}

// ============================================================================
// DiagnosticsPort — the Settings tooling behind one door
// ============================================================================

export interface DiagnosticsPort {
  describeBackend(): {
    kind: string;
    version?: string;
    writable: boolean;
    lastCheck?: string;
  };
  runReadProbe(table: string): Promise<Result<{ rows: number; ms: number }>>;
  /** supabase-only — ABSENT in local mode (the optional-marker contract). */
  runCrudProbe?(table: string): Promise<Result<{ ok: true }>>;
}

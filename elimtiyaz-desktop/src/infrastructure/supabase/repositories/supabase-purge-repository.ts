/**
 * SupabasePurgeRepository — the client half of T-416 (issue #12 / ADR-027):
 * the ONE desktop entry point to the canonical `purge_student_parent_domain`
 * RPC (migration 0120).
 *
 * WHY A DEDICATED MODULE (not a repository on the provider):
 *   The purge is a whole-domain administrative operation, not an entity
 *   repository — it has no observable cache, no mock twin, and no offline
 *   staging (mock mode has NO server data to purge; the UI disables the
 *   card there honestly). It deliberately does NOT go through the sync
 *   pipeline either: the purge IS a server-side reset — staging it in the
 *   queue would be exactly the PURGE-501 resurrection hazard the RPC's
 *   queue cleanup exists to prevent.
 *
 * THE CONTRACT (migration 0120):
 *   dryRun()   → rpc(p_confirm_phrase:'', p_dry_run:true)  — counts only,
 *                zero deletes, no phrase needed (read-only preview).
 *   execute()  → rpc(p_confirm_phrase:'PURGER', p_dry_run:false) — the
 *                destructive call; the phrase is typed by the operator in
 *                the Zone de danger card and re-checked server-side.
 *   Both return {ok, mode, tenant_id, counts, total, preserved, audit_entry_id?}
 *   or one of the server's gate codes: forbidden / tenant_unresolved /
 *   invalid_tenant / confirmation_required.
 *
 * NO-IDEMPOTENT-RETRY (deliberate deviation from rpcWithIdempotentRetry):
 *   A transient network error on a destructive call must NOT be retried
 *   blindly from the client — the first attempt may have committed and the
 *   error may be the RESPONSE getting lost (the second call would run the
 *   purge against an already-purged tenant: harmless here — the purge is
 *   idempotent by nature, counts would just be zero — but the discipline
 *   for destructive ops is single-shot + explicit operator re-trigger, so
 *   the pattern never calcifies on an operation where it WOULD matter).
 */
import { getSupabaseClient, isSupabaseConfigured } from "../supabase-client";
import { Err, type AppError, type Result } from "../../../core/result";
import { logger } from "../../../core/logger";

/** The server's purge verdict (migration 0120's jsonb contract). */
export interface PurgeVerdict {
  readonly ok: boolean;
  readonly mode: "dry_run" | "executed";
  readonly tenant_id: string;
  /** Per-family deleted (or, in dry-run, would-be-deleted) row counts. */
  readonly counts: Record<string, number>;
  readonly total: number;
  /** The non-interference evidence (ADR-027) returned with every call. */
  readonly preserved: {
    readonly backup_archives: string;
    readonly sync_queue_other: number;
    readonly audit_logs: string;
    readonly academic_catalog: string;
    readonly workforce_operations: string;
  };
  readonly audit_entry_id?: string | null;
}

/** A server gate rejection (ok:false codes from migration 0120). */
export interface PurgeRejection {
  readonly ok: false;
  readonly code: "forbidden" | "tenant_unresolved" | "invalid_tenant" | "confirmation_required";
}

export type PurgeOutcome = Result<PurgeVerdict, AppError & { serverCode?: string }>;

/** The user-facing French messages for the server's gate codes (the
 *  precise-error-mapping convention — T-153's activation-screen lesson). */
export const PURGE_REJECTION_MESSAGES_FR: Record<string, string> = {
  forbidden:
    "Cette opération est réservée au super administrateur (rôle serveur refusé).",
  tenant_unresolved:
    "Le tenant n'a pas pu être résolu — choisissez un établissement puis réessayez.",
  invalid_tenant: "Le tenant spécifié n'existe pas.",
  confirmation_required:
    "Phrase de confirmation invalide — saisissez exactement PURGER en majuscules.",
};

interface RpcReply {
  data: PurgeVerdict | PurgeRejection | null;
  error: { code?: string; message: string } | null;
}

async function callPurgeRpc(phrase: string, dryRun: boolean): Promise<PurgeOutcome> {
  if (!isSupabaseConfigured()) {
    return Err({
      code: "ERR_NOT_CONFIGURED",
      message: "Supabase is not configured",
      userMessage:
        "La purge nécessite le mode Supabase (Configuration → connexion) — les données locales de démonstration n'ont pas de serveur à purger.",
    });
  }
  const client = getSupabaseClient();
  const reply = (await client.rpc("purge_student_parent_domain", {
    p_confirm_phrase: phrase,
    p_dry_run: dryRun,
    p_tenant_id: null, // the RPC falls back to current_tenant_id() (the caller's context)
  })) as unknown as RpcReply;

  if (reply.error) {
    logger.warn("purge.rpc_error", { dryRun, code: reply.error.code, message: reply.error.message });
    return Err({
      code: reply.error.code ?? "ERR_PURGE_RPC",
      message: reply.error.message,
      userMessage:
        "L'appel serveur a échoué — vérifiez la connexion Supabase puis réessayez.",
      serverCode: reply.error.code,
    });
  }
  const body = reply.data;
  if (!body) {
    return Err({
      code: "ERR_PURGE_EMPTY",
      message: "The RPC returned no verdict",
      userMessage: "Le serveur n'a renvoyé aucun résultat.",
    });
  }
  if (body.ok === false) {
    // A gate rejection — map to the precise French message.
    const rejection = body as PurgeRejection;
    logger.warn("purge.rejected", { dryRun, code: rejection.code });
    return Err({
      code: `PURGE_${rejection.code.toUpperCase()}`,
      message: `purge_student_parent_domain rejected: ${rejection.code}`,
      userMessage:
        PURGE_REJECTION_MESSAGES_FR[rejection.code] ??
        "La purge a été refusée par le serveur.",
      serverCode: rejection.code,
    });
  }
  const verdict = body as PurgeVerdict;
  logger.info("purge.verdict", { mode: verdict.mode, total: verdict.total });
  return { ok: true, value: verdict };
}

/** Read-only preview: the exact blast radius the execute call would have. */
export async function dryRunPurge(): Promise<PurgeOutcome> {
  return callPurgeRpc("", true);
}

/**
 * The destructive call. The phrase MUST be 'PURGER' — it is re-checked
 * server-side (defense in depth: the UI gate can be bypassed by a REPL,
 * the server's cannot).
 */
export async function executePurge(confirmPhrase: string): Promise<PurgeOutcome> {
  return callPurgeRpc(confirmPhrase, false);
}

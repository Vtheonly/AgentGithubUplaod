/**
 * auto-releve-bridge — the desktop's canonical §09.06 auto-Relevé side effect
 * (T-482 / ADR-034 / migration 0141).
 *
 * The three Supabase classroom write paths (grade entry, roll call, homework
 * push) call `record_auto_releve_entry` through this bridge AFTER their
 * canonical write succeeds. The RPC is SECURITY DEFINER and resolves the
 * CALLER's own personnel row server-side — the client passes only the kind,
 * the class/subject context, and the human-readable note.
 *
 * THE FAIL-SAFE CONTRACT (the T-314 event-bridge pattern, restated for this
 * seam): the classroom write is the user's action and is ALREADY persisted
 * when this bridge runs; the ledger row is the documented side effect
 * (§09.06). A releve failure therefore NEVER propagates to the caller — the
 * primary write must not roll back or toast an error for it. The failure IS
 * console-warned (never silently swallowed — the WORKFORCE-510 distinction:
 * those were USER-INITIATED actions whose failures were hidden; this is a
 * secondary side effect whose failure is logged for forensics).
 *
 * Kind → activity mapping (ADR-034, the mock's §09.06 vocabulary, verbatim):
 *   grade_entry → correction · homework_push → task · roll_call → supervision.
 * The mapping lives SERVER-SIDE (the RPC); the client never re-derives it.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** The §09.06 auto kinds (migration 0141's whitelist, verbatim). */
export type AutoReleveKind = "grade_entry" | "homework_push" | "roll_call";

/**
 * Invoke the canonical auto-Relevé RPC as a fail-safe side effect.
 * Resolves to void ALWAYS (success and failure alike) — see the header.
 */
export async function logAutoReleveSideEffect(
  client: SupabaseClient,
  params: {
    kind: AutoReleveKind;
    note: string;
    classId?: string | null;
    classSubjectId?: string | null;
  },
): Promise<void> {
  try {
    const { error } = await client.rpc("record_auto_releve_entry", {
      p_kind: params.kind,
      p_class_id: params.classId ?? null,
      p_class_subject_id: params.classSubjectId ?? null,
      p_note: params.note,
    });
    if (error) {
      // Logged, never thrown: the primary write already succeeded.
      console.warn(
        `[auto-releve] record_auto_releve_entry failed (${params.kind}):`,
        error.message,
      );
    }
  } catch (err) {
    console.warn(
      `[auto-releve] record_auto_releve_entry threw (${params.kind}):`,
      err,
    );
  }
}

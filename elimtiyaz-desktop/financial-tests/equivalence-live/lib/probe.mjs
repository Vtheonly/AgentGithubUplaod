// ============================================================================
// lib/probe.mjs — Capability probe: detect which RPCs/indexes are deployed.
// ----------------------------------------------------------------------------
// The suite adapts to the database state: before migrations 0033-0037 some
// canonical functions don't exist; the affected checks are reported SKIPPED
// with the reason (never silently ignored).
// ============================================================================

import { rpcExists, select } from "./rest.mjs";

export async function probeCapabilities() {
  const has = {
    upsert_parent_from_import: await rpcExists("upsert_parent_from_import"),
    upsert_student_from_import: await rpcExists("upsert_student_from_import"),
    upsert_payment_from_import: await rpcExists("upsert_payment_from_import"),
    upsert_ledger_entry_from_import: await rpcExists("upsert_ledger_entry_from_import"),
    upsert_installment_from_import: await rpcExists("upsert_installment_from_import"),
    pull_parents_for_sync: await rpcExists("pull_parents_for_sync"),
    write_audit_log: await rpcExists("write_audit_log"),
    compute_parent_summary: await rpcExists("compute_parent_summary"),
    compute_account_balance: await rpcExists("compute_account_balance"),
    collect_and_allocate_payment: await rpcExists("collect_and_allocate_payment"),
    revert_payment_allocation: await rpcExists("revert_payment_allocation"),
    record_roll_call: await rpcExists("record_roll_call"),
    compute_gpa: await rpcExists("compute_gpa"),
    // 0037 ref-tolerance: student upsert with TEXT parent ref
    upsert_student_from_import_text_parent: false,
    ledger_source_unique: false,
  };

  // Detect 0037 ref-tolerance + unique index by probing OpenAPI param types.
  try {
    const { env } = await import("./env.mjs");
    const res = await fetch(`${env.supabaseUrl}/rest/v1/`, {
      headers: { apikey: env.serviceKey, Authorization: `Bearer ${env.serviceKey}` },
    });
    const spec = await res.json();
    const post = spec.paths?.["/rpc/upsert_student_from_import"]?.post;
    const props = post?.parameters?.[0]?.schema?.properties || {};
    // uuid params report format "uuid"; text params report format "text".
    if (props.p_parent_id?.format === "text") {
      has.upsert_student_from_import_text_parent = true;
    }
  } catch { /* detection failed -> stay false */ }

  // Detect the 0037 unique index on ledger source identity.
  try {
    const r = await select("ledger_entries", "select=id&limit=0");
    has.ledger_source_unique = r.ok; // presence verified structurally in layer 11 via behavior
  } catch { /* ignore */ }

  // The index existence is best verified by behavior in layer 11; here we
  // mark it conservatively based on the installment RPC (same migration).
  has.ledger_source_unique = has.upsert_installment_from_import;

  const migrationState = has.upsert_installment_from_import && has.compute_parent_summary
    ? "0037-applied (canonical surface deployed)"
    : has.compute_parent_summary
      ? "0034+ applied (0037 pending)"
      : "pre-0034 (canonical functions missing — apply migration package)";

  return { has, migrationState };
}

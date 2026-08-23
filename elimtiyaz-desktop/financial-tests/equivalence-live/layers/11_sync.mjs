// ============================================================================
// LAYER 11 — Synchronization layer equivalence.
// ----------------------------------------------------------------------------
// Verifies changes remain consistent after synchronization: idempotent
// re-submission creates no duplicates; the pull_*_for_sync read-back path
// (what BOTH clients run at startup / after queue drain) returns the pushed
// rows in canonical form; and concurrent duplicate submissions converge to a
// single authoritative row (last-write-wins, no duplication).
// ============================================================================

import { rpc, select } from "../lib/rest.mjs";
import { env } from "../lib/env.mjs";
import { canonicalFamily } from "../lib/canon.mjs";
import { DesktopClient, MobileClient } from "../lib/clients.mjs";

export default {
  id: "11-sync",
  name: "Synchronization layer — idempotency, round-trip, concurrent submits",
  requires: [],
  async run(ctx) {
    const checks = [];
    const probe = ctx.probe;

    // ---- 11.1 Idempotency: mobile double-submit (retry semantics) ----
    const canonM = canonicalFamily("M", { index: 77 });
    const mobile = new MobileClient(probe);
    const r1 = await mobile.upsertParent(canonM.parent);
    const r2 = await mobile.upsertParent(canonM.parent);
    if (r1.ok && r2.ok) {
      const sameId = r1.data?.[0]?.out_parent_id === r2.data?.[0]?.out_parent_id;
      const secondWasUpdate = r2.data?.[0]?.out_was_inserted === false;
      checks.push({
        check: "mobile sync retry (same payload twice) converges to one row",
        status: sameId && secondWasUpdate ? "PASS" : "FAIL",
        detail: `sameId=${sameId} secondWasUpdate=${secondWasUpdate}`,
      });

      // ---- 11.2 Pull round-trip: pull_parents_for_sync must return the row ----
      if (probe.has.pull_parents_for_sync) {
        const pull = await rpc("pull_parents_for_sync", {
          p_tenant_id: env.tenantId,
          p_since: "1970-01-01T00:00:00Z",
          p_limit: 2000,
        });
        if (pull.ok) {
          const rows = Array.isArray(pull.data) ? pull.data : [];
          const found = rows.find((p) => p.parent_code === canonM.parent.parentCode);
          checks.push({
            check: "pull_parents_for_sync returns the mobile-pushed row (round-trip)",
            status: found ? "PASS" : "FAIL",
            detail: found ? "" : "pushed parent not visible in pull payload",
          });
        } else {
          checks.push({
            check: "pull_parents_for_sync executes",
            status: "FAIL",
            detail: String(pull.error?.message).slice(0, 160),
          });
        }
      }

      // ---- 11.3 Concurrent duplicate submits (desktop + mobile, same canonical values) ----
      // Both clients push the SAME canonical parent (code collision is the
      // real-world concurrent-registration case): must converge to ONE row.
      const canonD = { ...canonM, parent: { ...canonM.parent, parentCode: canonM.parent.parentCode } };
      const desktop = new DesktopClient(probe);
      const [rm, rd] = await Promise.all([
        mobile.upsertParent(canonM.parent),
        desktop.upsertParent(canonD.parent),
      ]);
      if (rm.ok && rd.ok) {
        const converged = rm.data?.[0]?.out_parent_id === rd.data?.[0]?.out_parent_id;
        checks.push({
          check: "concurrent desktop+mobile submit of same canonical parent converges to one row",
          status: converged ? "PASS" : "FAIL",
          detail: converged ? "" : `mobile=${rm.data?.[0]?.out_parent_id} desktop=${rd.data?.[0]?.out_parent_id}`,
        });
        const cnt = await select("parents", `select=id&parent_code=eq.${canonM.parent.parentCode}`);
        checks.push({
          check: "no duplicate rows after concurrent submit",
          status: cnt.ok && cnt.data?.length === 1 ? "PASS" : "FAIL",
          detail: `rows=${cnt.data?.length}`,
        });
      }

      // ---- 11.4 Ledger idempotency via source identity (unique index, 0037) ----
      if (probe.has.upsert_ledger_entry_from_import && probe.has.ledger_source_unique) {
        const parentId = rm.data?.[0]?.out_parent_id || r1.data?.[0]?.out_parent_id;
        const payload = {
          p_tenant_id: env.tenantId,
          p_entry_number: "EQTEST-SYNC-IDEM",
          p_parent_id: parentId,
          p_student_id: null,
          p_account_id: `parent:${parentId}:category:tuition`,
          p_entry_type: "charge",
          p_amount: 1234.56,
          p_category: "tuition",
          p_description: "épreuve d'équivalence (sync idempotency)",
          p_source_type: "android_sync",
          p_source_id: `EQTEST-SYNC-IDEM`,
          p_method: null, p_receipt_number: null, p_payment_status: null, p_reverses_id: null,
          p_actor_id: env.actorId, p_actor_name: "Android",
          p_at: new Date().toISOString(),
          p_metadata: { client: "android", probe: "sync" },
        };
        const a = await rpc("upsert_ledger_entry_from_import", payload);
        const b = await rpc("upsert_ledger_entry_from_import", { ...payload, p_entry_number: "EQTEST-SYNC-IDEM-2" });
        const rows = await select("ledger_entries", `select=id,entry_number&source_id=eq.EQTEST-SYNC-IDEM`);
        if (a.ok && b.ok && rows.ok) {
          checks.push({
            check: "ledger source-identity idempotency: same source_id twice -> one row",
            status: rows.data?.length === 1 ? "PASS" : "FAIL",
            detail: `rows=${rows.data?.length} (expected 1)`,
          });
        } else {
          checks.push({
            check: "ledger source-identity idempotency",
            status: "FAIL",
            detail: `a=${a.ok} b=${b.ok} rows=${rows.ok} err=${String(b.error?.message || rows.error?.message || "").slice(0, 140)}`,
          });
        }
      } else {
        checks.push({
          check: "ledger source-identity idempotency (unique index)",
          status: "SKIPPED",
          detail: "requires migration 0037 unique index (pre-0037 relies on RPC-level matching)",
        });
      }
    } else {
      checks.push({
        check: "mobile parent push for sync probes",
        status: "FAIL",
        detail: String(r1.error?.message || r1.error).slice(0, 160),
      });
    }

    // cleanup handled by scope cleanup (PAR-2026-EQTEST-M77 prefix)
    return checks;
  },
};

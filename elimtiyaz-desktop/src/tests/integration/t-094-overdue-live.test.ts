/**
 * T-094 — LIVE integration test for `SupabaseOverdueAlertGenerator`
 * (T-080 follow-up).
 *
 * T-080 closed the mock-leak defect (ARCH-006) with 8 unit tests against a
 * fake client. THIS suite exercises the generator against the REAL Supabase
 * project — real PostgREST queries, real dedup keys, real notification
 * insert path — as required to reach VERIFIED status for the live
 * integration claim (AGENTS.md §11.1).
 *
 * ⚠️ ENV-GATED: the suite runs ONLY when BOTH
 *      SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
 *    are set in the environment (session-provided credentials — never
 *    committed). Without them, the suite SKIPS so the standard
 *    `npm test` run stays hermetic.
 *
 * Live expectations (verified 2026-08-31, live project hkvkefubghbbotgnteir):
 *   - 819 installments are overdue (status != 'paid', due_date < now);
 *   - ALL of them already carry an installment-linked notification, so a
 *     full `run()` exercises the scan + parent-map + dedup read path and
 *     returns **0 new** (the idempotency claim of T-080);
 *   - the INSERT path is verified with a sentinel notification
 *     (link_entity_type='installment', same shape the generator builds)
 *     that is DELETED again right after (self-cleaning — the live table
 *     is left with the same row count), and a `write_audit_log` call with
 *     the generator's audit shape (append-only entry, note marks it as a
 *     T-094 verification — audit_logs is never deleted by design).
 */
import { describe, it, expect } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SupabaseOverdueAlertGenerator } from "../../infrastructure/supabase/repositories/supabase-overdue-alert-generator";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const LIVE = Boolean(SUPABASE_URL && SERVICE_ROLE_KEY);

/** The canonical production tenant (0023 seed; the generator's fallback). */
const TENANT = "00000000-0000-0000-0000-000000000001";
const SENTINEL_TITLE = "T-094-LIVE-TEST — supprime-moi";

describe.skipIf(!LIVE)(
  "SupabaseOverdueAlertGenerator — LIVE integration (T-094)",
  () => {
    let client: SupabaseClient;

    it("bootstraps the live client", () => {
      expect(LIVE).toBe(true);
      client = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      expect(client).toBeTruthy();
    });

    it("run() completes against the live DB and the dedup path returns 0 new", { timeout: 120_000 }, async () => {
      // 819 overdue rows + chunked parent-map/dedup queries = many HTTP
      // round-trips to the remote project — far beyond vitest's 5s default.
      const gen = new SupabaseOverdueAlertGenerator(client);
      const result = await gen.run();
      expect(result.ok).toBe(true);
      if (result.ok) {
        // Every overdue installment already carries an installment-linked
        // notification (verified live: overdue_without_alert = 0), so the
        // idempotent dedup MUST produce zero new notifications.
        expect(Array.isArray(result.value)).toBe(true);
        expect(result.value.length).toBe(0);
      }
    });

    it("dedup keys really cover the overdue set (independent cross-check)", async () => {
      // The generator scans: tenant + status != 'paid' + due_date < now.
      const nowIso = new Date().toISOString();
      const { data: overdue, error: e1 } = await client
        .from("installments")
        .select("id")
        .eq("tenant_id", TENANT)
        .neq("status", "paid")
        .lt("due_date", nowIso);
      expect(e1).toBeNull();

      const { data: alerts, error: e2 } = await client
        .from("notifications")
        .select("link_entity_id")
        .eq("tenant_id", TENANT)
        .eq("link_entity_type", "installment");
      expect(e2).toBeNull();

      const covered = new Set((alerts ?? []).map((a) => a.link_entity_id));
      const missing = (overdue ?? []).filter((i) => !covered.has(i.id));
      expect(missing.length).toBe(0); // dedup fully covers the overdue set
    });

    it("the notification INSERT path accepts the generator's payload shape (self-cleaning)", async () => {
      // Pick a real overdue installment as the link target.
      const nowIso = new Date().toISOString();
      const { data: ins, error: e1 } = await client
        .from("installments")
        .select("id, tenant_id")
        .eq("tenant_id", TENANT)
        .neq("status", "paid")
        .lt("due_date", nowIso)
        .limit(1);
      expect(e1).toBeNull();
      expect((ins ?? []).length).toBe(1);
      const installmentId = ins![0].id as string;

      // The exact row shape the generator builds (title swapped for the
      // sentinel so cleanup can find it even if assertions change).
      const row = {
        tenant_id: TENANT,
        kind: "alert",
        title: SENTINEL_TITLE,
        body: "T-094 live integration — inserted and deleted again",
        priority: "high",
        source: "system",
        source_label: "Module Finances — Scan retards",
        target_user_id: null,
        target_role: "financial_officer",
        triggered_at: nowIso,
        link_entity_type: "installment",
        link_entity_id: installmentId,
        created_by: null,
      };

      const { data: inserted, error: insErr } = await client
        .from("notifications")
        .insert(row)
        .select("id")
        .single();
      expect(insErr).toBeNull();
      expect(inserted?.id).toBeTruthy();

      // Read-back through the same filter the alerts feed uses.
      const { data: found } = await client
        .from("notifications")
        .select("id")
        .eq("tenant_id", TENANT)
        .eq("title", SENTINEL_TITLE);
      expect((found ?? []).length).toBe(1);

      // Self-clean: leave the live table exactly as we found it.
      const { error: delErr } = await client
        .from("notifications")
        .delete()
        .eq("id", inserted!.id);
      expect(delErr).toBeNull();

      const { data: after } = await client
        .from("notifications")
        .select("id")
        .eq("tenant_id", TENANT)
        .eq("title", SENTINEL_TITLE);
      expect((after ?? []).length).toBe(0);
    });

    it("write_audit_log accepts the generator's audit shape (append-only)", async () => {
      const { data, error } = await client.rpc("write_audit_log", {
        p_tenant_id: TENANT,
        p_action: "dashboard.overdue_scan",
        p_entity_type: "installment",
        p_entity_id: null,
        p_actor_id: null,
        p_actor_name: "T-094 live verification",
        p_before_json: null,
        p_after_json: JSON.stringify({
          verification: "T-094",
          date: new Date().toISOString(),
          note: "live integration test of the overdue-scan audit path",
        }),
        p_note: "T-094 — SupabaseOverdueAlertGenerator live audit-path verification (append-only entry, intentional)",
        p_request_id: null,
      });
      expect(error).toBeNull();
      expect(data).toBeTruthy(); // the new audit_logs row id
    });
  },
);

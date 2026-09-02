/**
 * T-126 regression tests — the canonical send-push-notification Edge
 * Function + the workflow-execute wiring (PUSH-100 family).
 *
 * PUSH-100's evidence: the push-notification system had THREE compounding
 * defects, each independently fatal:
 *   1. No production invocation path (the workflow-execute
 *      `push_notification` action returned `stub: true`).
 *   2. [WEAK-014] The EF filtered device_tokens on `user_profile_id`, a
 *      column that does not exist (PostgREST 400 → 500 → zero sends).
 *   3. [WEAK-015] The registry's PEM-parsing claim — byte-level
 *      verification (2026-09-02) showed the current source ALREADY strips
 *      BEGIN + END + whitespace; the registry text had been corrupted by a
 *      redaction artifact. The parser is hardened to the idempotent regex
 *      form anyway.
 *
 * Separately (T-126's source-control half): the live-deployed EF's only
 * source lived in the WEBSITE repo (a drifted copy) while this hub repo —
 * the canonical EF owner per ADR-001 and the credentials sheet — carried
 * nothing. The fixed source is now canonical HERE; the website copy is
 * deleted (guarded by the website's own t-126 test).
 *
 * These source scans pin:
 *   1. The canonical EF exists in this repo.
 *   2. The device_tokens lookup filters on `user_id` (WEAK-014 stays dead).
 *   3. The PEM parser uses the regex form (idempotent hardening).
 *   4. `priority` + `type` propagate into the FCM `data` field (PUSH-101a).
 *   5. android click_action is an intent ACTION NAME (PUSH-101b).
 *   6. workflow-execute contains NO "STUB push_notification" and DOES
 *      invoke functions/v1/send-push-notification.
 *   7. The workflow action resolves role recipients via `role_assignments`
 *      (tenant-scoped, revoked-aware) and records per-recipient failures
 *      honestly (partial_failure) instead of swallowing them.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Repository root (…/elimtiyaz-desktop) — this file lives in src/tests/security/. */
const DESKTOP_ROOT = join(__dirname, "..", "..", "..");

const EF = "supabase/functions/send-push-notification/index.ts";
const WORKFLOW = "supabase/functions/workflow-execute/index.ts";

const read = (rel: string): string =>
  readFileSync(join(DESKTOP_ROOT, rel), "utf8");

describe("T-126 — canonical push EF (PUSH-100 family)", () => {
  it("the canonical EF source exists in the hub repo", () => {
    expect(existsSync(join(DESKTOP_ROOT, EF))).toBe(true);
  });

  it("[WEAK-014] device_tokens is filtered on `user_id`, not `user_profile_id`", () => {
    const src = read(EF);
    expect(src).toContain('.eq("user_id", payload.target_user_id)');
    // the notification_preferences query LEGITIMATELY uses user_profile_id
    // (0043 schema) — exactly one occurrence must remain.
    expect(src.match(/\.eq\("user_profile_id"/g)?.length).toBe(1);
  });

  it("[WEAK-015 hardened] the PEM parser strips BEGIN + END + artifacts via regex", () => {
    const src = read(EF);
    expect(src).toContain(".replace(/-----BEGIN PRIVATE KEY-----/g");
    expect(src).toContain(".replace(/-----END PRIVATE KEY-----/g");
  });

  it("[PUSH-101a] priority + type propagate into the FCM data field", () => {
    const src = read(EF);
    expect(src).toContain("const dataField: Record<string, string>");
    expect(src).toContain("data: dataField,");
  });

  it("[PUSH-101b] android click_action is an intent action name, not a URL", () => {
    const src = read(EF);
    expect(src).toContain(
      'const androidClickAction = "com.aistudio.elimtiyazstaff.bxmzlx.NOTIFICATION_CLICK"',
    );
    expect(src).toContain("click_action: androidClickAction");
    expect(src).not.toContain('click_action: payload.data?.url ?? "/"');
  });
});

describe("T-126 — workflow-execute push_notification wiring", () => {
  it("the STUB is gone and the EF invocation is present", () => {
    const src = read(WORKFLOW);
    expect(src).not.toContain("STUB push_notification");
    expect(src).toContain("functions/v1/send-push-notification");
  });

  it("recipients are resolved via tenant-scoped, revoked-aware role_assignments", () => {
    const src = read(WORKFLOW);
    expect(src).toContain('.from("role_assignments")');
    expect(src).toContain('.is("revoked_at", null)');
    expect(src).toContain('.eq("tenant_id", tenantId)');
  });

  it("per-recipient failures are recorded honestly (partial_failure), not swallowed", () => {
    const src = read(WORKFLOW);
    expect(src).toContain("partial_failure: true");
    expect(src).toContain("failures: perRecipient.filter");
  });
});

/**
 * Regression tests for T-056 (hygiene batch) — desktop items.
 *
 * WEAK-003: `mapLedgerRow` used to build `LedgerEntry.type` with
 *   `(r.entry_type ?? r.actor_id ?? "charge")` — when `entry_type` was
 *   missing, the mapper fell back to the ACTOR ID (a user id!) and cast it
 *   to the entry-type union, so the reconciler/balance replay downstream
 *   would misclassify the entry. The fallback chain must NEVER touch
 *   `actor_id`.
 *
 * DRIFT-005: the canonical `AuditActions` registry now carries the
 *   `server_secret.update` / `server_secret.delete` wire strings the
 *   update-server-secret Edge Function writes (previously ad-hoc string
 *   literals that the audit-log filter UI could not group).
 *
 * The mapLedgerRow scan is a source-level guard (T-001 technique): the
 * test fails against the pre-fix source by construction.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { AuditActions } from "../../core/audit-actions";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DESKTOP_ROOT = join(__dirname, "..", "..", "..");

describe("T-056 / WEAK-003 — mapLedgerRow never falls back to actor_id", () => {
  it("the type fallback chain no longer references actor_id", () => {
    const source = readFileSync(
      join(
        DESKTOP_ROOT,
        "src/infrastructure/supabase/repositories/supabase-shared-repositories.ts",
      ),
      "utf-8",
    );
    // The pre-fix line was:
    //   type: (r.entry_type ?? r.actor_id ?? "charge") as LedgerEntry["type"],
    expect(source).not.toContain("r.entry_type ?? r.actor_id");
    expect(source).toContain('type: (r.entry_type ?? "charge")');
  });
});

describe("T-056 / DRIFT-005 — server_secret.* registered in AuditActions", () => {
  it("the registry carries both wire strings", () => {
    expect(AuditActions.ServerSecretUpdate).toBe("server_secret.update");
    expect(AuditActions.ServerSecretDelete).toBe("server_secret.delete");
  });

  it("the update-server-secret EF uses the registry (no ad-hoc literals)", () => {
    const source = readFileSync(
      join(DESKTOP_ROOT, "supabase/functions/update-server-secret/index.ts"),
      "utf-8",
    );
    expect(source).not.toContain('"server_secret.update"');
    expect(source).not.toContain('"server_secret.delete"');
    expect(source).toContain("AuditActions.ServerSecretUpdate");
    expect(source).toContain("AuditActions.ServerSecretDelete");
  });
});

describe("T-056 / DEAD-002 — handleDelete is wired into Deno.serve", () => {
  it("the serve handler routes DELETE requests", () => {
    const source = readFileSync(
      join(DESKTOP_ROOT, "supabase/functions/update-server-secret/index.ts"),
      "utf-8",
    );
    expect(source).toMatch(/if \(req\.method === "DELETE"\) return handleDelete\(req\);/);
  });
});

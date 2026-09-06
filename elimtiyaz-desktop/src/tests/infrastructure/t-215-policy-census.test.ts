/**
 * Regression test for T-215 — the policy-census hardening script
 * (REG-004 class): scripts/policy_census.sh machine-checks the LIVE
 * pg_policy set against the canonical chain at session openings.
 *
 * The incidents this script guards against:
 *   - REG-004 (30th session): the live notifications_select policy was
 *     widened to `using (true)` by an unknown actor while the committed
 *     chain said otherwise — a silent all-users data leak.
 *   - ARCH-011/ARCH-015: applied-but-unregistered (or registered-but-
 *     unapplied) migration content.
 *
 * This suite pins the CHAIN-side parser against the REAL script (the live
 * fetch needs the sbp_ token and is exercised by the session-opening
 * ritual, not by npm test — same split as t-058):
 *   1. the REAL chain census parses and carries the expected shape —
 *      0019's policies, the 0076 restore, the 0080 re-creation — and the
 *      0079 receipts DROP TABLE cascade removed the receipts policies;
 *   2. storage-schema policies (0018, `on storage.objects`) are OUT of
 *      census scope (the live query filters schemaname='public');
 *   3. drop-policy / re-create sequences resolve to the LAST writer;
 *   4. a DROP TABLE cascades every policy of that table away;
 *   5. comment lines (the `-- create policy …` documentation idiom this
 *      chain uses) are never parsed as statements.
 */
import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** …/elimtiyaz-desktop (this file lives in src/tests/infrastructure/). */
const DESKTOP_ROOT = join(__dirname, "..", "..", "..");
const SCRIPT = join(DESKTOP_ROOT, "scripts", "policy_census.sh");
const REAL_MIGRATIONS = join(DESKTOP_ROOT, "supabase", "migrations");

type Census = { count: number; policies: Record<string, string> };

/** Runs the REAL script in --local-only mode (optionally on a custom dir). */
function census(dir?: string): Census {
  const args = ["--local-only", ...(dir ? ["--dir", dir] : [])];
  const out = execSync(
    `bash ${JSON.stringify(SCRIPT)} ${args.map((a) => JSON.stringify(a)).join(" ")} < /dev/null`,
    { stdio: ["ignore", "pipe", "ignore"] },
  ).toString();
  return JSON.parse(out);
}

/** Creates a throwaway migrations dir; returns the census over it. */
function censusOf(files: Record<string, string>): Census {
  const dir = mkdtempSync(join(tmpdir(), "policy-census-"));
  try {
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(dir, name), content);
    }
    return census(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("T-215 — policy census script (REG-004 hardening)", () => {
  it("the REAL chain census parses and counts the public-schema policies", () => {
    const data = census(REAL_MIGRATIONS);
    expect(data.count).toBeGreaterThan(150); // 189 at T-215 time
    // Spot-checks: the big policy families exist, LAST creator wins.
    expect(data.policies["service_enrollments.service_enrollments_select"]).toBe(
      "0080_service_enrollment_parent_scoping.sql",
    );
    expect(data.policies["notifications.notifications_select"]).toBe(
      "0076_restore_notifications_select_policy.sql",
    );
    expect(data.policies["students.students_parent_sees_own"]).toBeTruthy();
    // The 0079 receipts DROP TABLE cascaded its policies away.
    expect(data.policies["receipts.receipts_select"]).toBeUndefined();
    expect(data.policies["receipts.receipts_insert"]).toBeUndefined();
  });

  it("storage-schema policies are OUT of census scope", () => {
    const data = censusOf({
      "0001_init.sql": [
        "create policy payment_proofs_read on storage.objects",
        "  for select to authenticated using (true);",
        "create policy things_select on public.things",
        "  for select to authenticated using (true);",
      ].join("\n"),
    });
    expect(data.count).toBe(1);
    expect(data.policies["things.things_select"]).toBe("0001_init.sql");
    expect(data.policies["storage.payment_proofs_read"]).toBeUndefined();
  });

  it("drop-policy + re-create resolves to the LAST writer", () => {
    const data = censusOf({
      "0001_init.sql":
        "create policy p_select on items for select using (true);",
      "0002_tighten.sql": [
        "drop policy if exists p_select on items;",
        "create policy p_select on items for select using (tenant_id = 1);",
      ].join("\n"),
    });
    expect(data.count).toBe(1);
    expect(data.policies["items.p_select"]).toBe("0002_tighten.sql");
  });

  it("a DROP TABLE cascades every policy of that table away", () => {
    const data = censusOf({
      "0001_init.sql": [
        "create policy a_select on widgets for select using (true);",
        "create policy a_insert on widgets for insert with check (true);",
      ].join("\n"),
      "0002_drop.sql": "drop table public.widgets;",
    });
    expect(data.count).toBe(0);
  });

  it("comment lines are never parsed as statements", () => {
    const data = censusOf({
      "0001_init.sql": [
        "-- create policy ghost_select on items using (true);",
        "-- drop policy real_select on items;",
        "create policy real_select on items for select using (true);",
      ].join("\n"),
    });
    expect(data.count).toBe(1);
    expect(data.policies["items.ghost_select"]).toBeUndefined();
    expect(data.policies["items.real_select"]).toBe("0001_init.sql");
  });
});

/**
 * T-018 — deterministic identity codes regression suite (DRIFT-001,
 * desktop + sync portion).
 *
 * Problem: the sync-queue push handler generated RANDOM `PAR-YYYY-{4hex}`
 * and `ELV-YYYY-{6digits}` codes when a queued payload carried none — a
 * lost response + retry produced a NEW code, and since the server dedup is
 * `(tenant_id, parent_code)` / `(tenant_id, student_code)`, the retry
 * created a DUPLICATE parent/student server-side.
 *
 * Fixed: the canonical generators (moved to core/format/id.ts — ADR-003's
 * canonical home) derive the code DETERMINISTICALLY from the payload's
 * identity fields, seeded by the queue entry id when identity is missing —
 * stable across retries. No random fallback remains in the generators.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  stableHash,
  deterministicParentCode,
  deterministicStudentCode,
} from "../../core/format/id";

const SRC = join(__dirname, "../../");

describe("T-018 — the canonical generators are deterministic (no random fallback)", () => {
  it("stableHash is stable and 6-hex-uppercase", () => {
    expect(stableHash("0555123456|Karim Benali")).toBe(stableHash("0555123456|Karim Benali"));
    expect(stableHash("x")).toMatch(/^[0-9A-F]{6}$/);
  });

  it("the same identity always yields the same parent code", () => {
    const a = deterministicParentCode(2026, { phone: "0555123456", firstName: "Karim", lastName: "Benali" });
    const b = deterministicParentCode(2026, { firstName: "Karim", lastName: "Benali", phone: "0555123456" });
    expect(a).toBe(b);
    expect(a).toMatch(/^PAR-2026-[0-9A-F]{6}$/);
  });

  it("empty identity falls back to the STABLE seed (retry-stable), never random", () => {
    const a = deterministicParentCode(2026, {}, "sync-entry-42");
    const b = deterministicParentCode(2026, {}, "sync-entry-42");
    expect(a).toBe(b);
    expect(a).toMatch(/^PAR-2026-[0-9A-F]{6}$/);
    const c = deterministicStudentCode(2026, "", {}, "sync-entry-42");
    const d = deterministicStudentCode(2026, "", {}, "sync-entry-42");
    expect(c).toBe(d);
  });

  it("empty/whitespace identity fields are excluded from the hash (cross-platform rule)", () => {
    const withEmpty = deterministicParentCode(2026, { phone: "  ", firstName: "A", lastName: "B" });
    const without = deterministicParentCode(2026, { firstName: "A", lastName: "B" });
    expect(withEmpty).toBe(without);
  });

  it("the generators live in their canonical home (core/format/id.ts) and are re-exported", () => {
    const id = readFileSync(join(SRC, "core/format/id.ts"), "utf8");
    expect(id).toContain("export function deterministicParentCode");
    expect(id).toContain("export function deterministicStudentCode");
    const shared = readFileSync(
      join(SRC, "infrastructure/supabase/repositories/supabase-shared-repositories.ts"),
      "utf8",
    );
    expect(shared).toContain('export { stableHash, deterministicParentCode, deterministicStudentCode }');
  });
});

describe("T-018 — the sync push fallbacks are deterministic + retry-stable", () => {
  it("no random PAR-/ELV- generation remains in the push handler", () => {
    const text = readFileSync(join(SRC, "infrastructure/sync/default-push-handler.ts"), "utf8");
    const codeLines = text
      .split("\n")
      .filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//"));
    for (const l of codeLines) {
      expect(l, l).not.toMatch(/`(PAR|ELV)-\$\{[^}]*\}(.*Math\.random|.*\$\{Math\.random)/);
      expect(l, l).not.toMatch(/PAR-.*Math\.random|ELV-.*Math\.random/);
    }
    expect(text).toContain("deterministicParentCode(");
    expect(text).toContain("deterministicStudentCode(");
    // seeded by the queue entry id → stable across retries
    expect(text).toContain("entry.id);");
    expect(text).toContain("entry.id,\n            ),");
  });

  it("the generators contain NO Math.random fallback", () => {
    const text = readFileSync(join(SRC, "core/format/id.ts"), "utf8");
    const genStart = text.indexOf("T-018 (DRIFT-001 / ADR-003)");
    const genSection = text.slice(genStart);
    expect(genSection).not.toContain("Math.random");
  });
});

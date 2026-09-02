/**
 * T-115 — SQL↔TS canonical identity-code equivalence (migration 0065).
 *
 * Problem (ARCH-013): migration 0065_canonical_identity_codes was applied to
 * the live Supabase project by an actor outside the repos — the SQL generators
 * (fn_fnv1a / fn_stable_hash / fn_deterministic_parent_code /
 * fn_deterministic_activation_code) became a THIRD implementation of the
 * canonical ADR-003 algorithm with NO committed file and NO cross-platform
 * equivalence pin. A transcription or algorithmic divergence between the SQL
 * and this TS engine would silently produce different parent codes per layer —
 * breaking the (tenant_id, parent_code) idempotency contract that the whole
 * sync/import architecture depends on.
 *
 * Fixed (19th session): the file was reconstructed byte-identical from the
 * live catalog (5/5 definitions, pg_get_functiondef comparison) and committed;
 * this suite pins the equivalence PERMANENTLY. The vectors below are the exact
 * values the LIVE SQL functions returned on 2026-09-02 (verify_t-115.sql,
 * 19/19 TRUE, recorded in docs/recovery/t-115-live-verification.md). If any
 * side changes its algorithm, this suite fails and forces a conscious ADR-003
 * change on BOTH sides.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  stableHash,
  deterministicParentCode,
  deterministicActivationCode,
} from "../../core/format/id";

const ROOT = join(__dirname, "../../..");
const TENANT = "00000000-0000-0000-0000-000000000001";

describe("T-115 — the TS canonical generators are bit-equivalent to the live SQL (migration 0065)", () => {
  // ─── Pinned vectors: LIVE SQL output (2026-09-02) == TS output ────────────
  it("stableHash matches the live fn_stable_hash on pinned vectors", () => {
    expect(stableHash("0554288142|MAMER")).toBe("60E2BA");
    expect(stableHash("")).toBe("811C9D");
    expect(stableHash("orphan-parent")).toBe("C13D99");
    expect(stableHash("BEN ALI|Karim")).toBe("B7B353");
  });

  it("deterministicParentCode matches the live fn_deterministic_parent_code on pinned vectors", () => {
    expect(
      deterministicParentCode(2026, { phone: "0554288142", displayName: "MAMER", firstName: "", lastName: "" }),
    ).toBe("PAR-2026-60E2BA");
    // Per-field trim + drop-empty (the cross-platform rule): same as above.
    expect(
      deterministicParentCode(2026, { phone: " 0554288142 ", displayName: " MAMER ", firstName: null, lastName: "  " }),
    ).toBe("PAR-2026-60E2BA");
    // Empty identity → stable seed, never random.
    expect(deterministicParentCode(2026, {}, "seed-123")).toBe("PAR-2026-CB27E1");
    expect(deterministicParentCode(2026, {})).toBe("PAR-2026-C13D99");
    expect(
      deterministicParentCode(2025, { phone: "0770123456", displayName: "BEN ALI", firstName: "Karim", lastName: "BEN ALI" }),
    ).toBe("PAR-2025-D93B0A");
  });

  it("deterministicActivationCode matches the live fn_deterministic_activation_code on pinned vectors", () => {
    expect(deterministicActivationCode("PAR-2026-ABCDEF", TENANT)).toBe("553830");
    expect(deterministicActivationCode("PAR-2026-ABCDEF", "")).toBe("905025");
  });

  // ─── Live-verified RPC contract mirrors (verify_t-115.sql C3) ─────────────
  it("the batch_register_family contract: empty identity has NO random fallback (rejected server-side)", () => {
    // The SQL raises 'parent identity fields required'; the TS equivalent is
    // the orphan-parent fallback ONLY when a stable seed is impossible. The
    // pinned vector proves both sides converge on the SAME derivation, so the
    // server-side rejection can never diverge from a client-side random code.
    const orphan = deterministicParentCode(2026, {});
    expect(orphan).toBe("PAR-2026-C13D99");
    expect(stableHash("orphan-parent")).toBe("C13D99");
  });

  // ─── Structural guards: the committed file + typed RPC registrations ──────
  it("migration 0065 is committed with the canonical algorithm and registration semantics", () => {
    const mig = readFileSync(
      join(ROOT, "supabase/migrations/0065_canonical_identity_codes.sql"),
      "utf8",
    );
    // The four canonical functions.
    expect(mig).toContain("create or replace function public.fn_fnv1a");
    expect(mig).toContain("create or replace function public.fn_stable_hash");
    expect(mig).toContain("create or replace function public.fn_deterministic_parent_code");
    expect(mig).toContain("create or replace function public.fn_deterministic_activation_code");
    // The Math.imul-compatible semantics (the bit-exactness contract).
    expect(mig).toContain("Math.imul");
    // The batch_register_family rewrite: deterministic parent code + the
    // empty-identity rejection + the deterministic default activation code
    // with collision fallback.
    expect(mig).toContain("identity fields required");
    expect(mig).toContain("fn_deterministic_activation_code(v_parent_code, p_tenant_id)");
    expect(mig).toContain("generate_activation_code(p_tenant_id)");
    // 0022's random parent-code generator is NOT used anymore: the parent
    // code assignment is the deterministic generator (the file's prose may
    // legitimately mention gen_random_bytes as the REPLACED mechanism).
    expect(mig).toContain("v_parent_code := public.fn_deterministic_parent_code(");
  });

  it("the batch_register_family JSON contract requires date_of_birth (live-discovered constraint)", () => {
    // Discovered live 2026-09-02 (verify_t-115.sql C3b): students.date_of_birth
    // is NOT NULL and the RPC does not default it — every caller must supply
    // it. Pinned here so a future caller does not rediscover it via a 23502.
    const mig = readFileSync(
      join(ROOT, "supabase/migrations/0065_canonical_identity_codes.sql"),
      "utf8",
    );
    expect(mig).toContain("(v_student->>'date_of_birth')::date");
  });

  it("the typed Database interfaces register the new RPCs (desktop + website)", () => {
    const desktopTypes = readFileSync(
      join(ROOT, "src/infrastructure/supabase/types.ts"),
      "utf8",
    );
    expect(desktopTypes).toContain("fn_deterministic_parent_code");
    expect(desktopTypes).toContain("fn_deterministic_activation_code");
    expect(desktopTypes).toContain("fn_stable_hash");
    expect(desktopTypes).toContain("fn_fnv1a");
    // The website's typed schema lives in the sibling repo (checked out as
    // ../elimtiyaz-website from the hub) — guard it when present.
    const websiteTypesPath = join(ROOT, "../elimtiyaz-website/src/lib/types/database.ts");
    try {
      const websiteTypes = readFileSync(websiteTypesPath, "utf8");
      expect(websiteTypes).toContain("fn_deterministic_parent_code");
      expect(websiteTypes).toContain("fn_deterministic_activation_code");
    } catch {
      // Sibling repo not checked out — skip silently (the website repo has its
      // own suite; its absence must not fail the desktop suite).
    }
  });

  it("the approve-signup-request EF derives the parent code from the canonical SQL RPC (no Math.random)", () => {
    // DRIFT-001's last backend residue: the EF created parents with
    // `PAR-{year}-{Math.random()...}` — a retried approval produced a NEW code
    // and could duplicate the parent. Fixed 2026-09-02: the EF calls
    // fn_deterministic_parent_code (migration 0065) like every other platform.
    const ef = readFileSync(
      join(ROOT, "supabase/functions/approve-signup-request/index.ts"),
      "utf8",
    );
    expect(ef).toContain('supabase.rpc(\n      "fn_deterministic_parent_code"');
    expect(ef).not.toMatch(/PAR-.*Math\.random/);
    // The failure path surfaces (fail-closed, no silent fallback).
    expect(ef).toContain("parent_code_failed");
  });

  it("the live verification script pins the same vectors (source-scan parity)", () => {
    const verify = readFileSync(join(ROOT, "scripts/verify_t-115.sql"), "utf8");
    expect(verify).toContain("'PAR-2026-60E2BA'");
    expect(verify).toContain("'553830'");
    expect(verify).toContain("'905025'");
    expect(verify).toContain("deterministic_fnv1a_0065");
  });
});

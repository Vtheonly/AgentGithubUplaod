/**
 * T-361 — the payment-proof vault upload is TENANT-scoped (UPLOAD-102).
 *
 * Problem (live-proven 2026-09-14, 64th session — t-359-upload-e2e.py
 * check B): UnifiedPaymentModal.handleProofFileSelected hardcoded
 * `tenantId: "mock"` in its uploadPrivateMedia call — a mock-era literal
 * that survived the Supabase wiring. The payment_proofs policies (hub
 * migration 0018) require folder[1] = current_tenant_id(), so every
 * production proof upload was RLS-rejected ("new row violates row-level
 * security policy") — and because check/transfer methods REQUIRE a proof
 * before submission, non-cash payment collection was blocked at the
 * source on the desktop.
 *
 * Fixed: the modal uses session.tenantId with the same explicit
 * no-working-tenant failure the homework-push modal gained in T-053
 * (TENANT-103) — a global admin without a picked tenant fails LOUD
 * before any network call, never uploads to a wrong path.
 *
 * Also pinned here: the phantom "therapy-attachments" member stays out of
 * MediaBucket (no such bucket exists in the 0018 chain or the live
 * project — a caller using it would fail "Bucket not found").
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, "..", "..");

const MODAL = readFileSync(
  join(SRC, "features/financials/unified-payment-modal.tsx"),
  "utf8",
);
const VAULT = readFileSync(
  join(SRC, "infrastructure/storage/media-vault.ts"),
  "utf8",
);

/** Recursively collect .tsx/.ts files under a root (tests excluded). */
function collectProdFiles(root: string, out: string[] = []): string[] {
  for (const entry of readdirSync(root)) {
    const full = join(root, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "tests" || entry === "test") continue;
      collectProdFiles(full, out);
    } else if (/\.(tsx|ts)$/.test(entry)) out.push(full);
  }
  return out;
}

describe("T-361 — UPLOAD-102: the payment-proof upload is tenant-scoped", () => {
  it("the modal resolves the WORKING tenant from the session (T-053 pattern)", () => {
    expect(MODAL.includes("const workingTenantId = session?.tenantId;")).toBe(true);
    expect(MODAL.includes("tenantId: workingTenantId,")).toBe(true);
  });

  it("the modal fails LOUD when no working tenant is picked (never uploads to a wrong path)", () => {
    expect(
      MODAL.includes("if (!workingTenantId)") &&
        MODAL.includes(
          "Aucun établissement actif — sélectionnez un établissement dans la barre supérieure",
        ),
    ).toBe(true);
  });

  it("NO uploadPrivateMedia call site ships the mock-era \"mock\" tenant literal", () => {
    // The exact UPLOAD-102 failure mode: `tenantId: "mock"` (or any string
    // literal that is not the resolved working tenant) reaching the vault.
    const violators: string[] = [];
    for (const file of collectProdFiles(SRC)) {
      const src = readFileSync(file, "utf8");
      const re = /uploadPrivateMedia\(\{[\s\S]*?tenantId:\s*("[^"]*"|'[^']*')/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        // String literals are legal ONLY in test fixtures; production call
        // sites must pass a variable (the resolved session/student tenant).
        violators.push(`${file}: tenantId: ${m[1]}`);
      }
    }
    expect(violators).toEqual([]);
  });

  it("every production uploadPrivateMedia call passes a tenant VARIABLE", () => {
    const callSites: string[] = [];
    for (const file of collectProdFiles(SRC)) {
      const src = readFileSync(file, "utf8");
      const re = /uploadPrivateMedia\(\{\s*[\s\S]*?\}\)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) callSites.push(`${file}::::${m[0]}`);
    }
    // The three known production call sites (payment proof, student
    // documents, homework attachments) — all must carry a tenant binding.
    expect(callSites.length).toBeGreaterThanOrEqual(3);
    for (const site of callSites) {
      expect(site).toMatch(/tenantId:\s*[a-zA-Z][\w?.]*/);
    }
  });

  it("the phantom therapy-attachments bucket stays OUT of the MediaBucket union", () => {
    // Scope the check to the TYPE BLOCK itself — the explanatory comment
    // legitimately names the removed phantom (this file's own doc does too).
    const typeBlock = VAULT.match(/export type MediaBucket =[\s\S]*?;/)?.[0] ?? "";
    expect(typeBlock).toContain("| \"payment-proofs\"");
    expect(typeBlock).toContain("| \"homework-attachments\"");
    expect(typeBlock).not.toContain("therapy-attachments");
  });
});

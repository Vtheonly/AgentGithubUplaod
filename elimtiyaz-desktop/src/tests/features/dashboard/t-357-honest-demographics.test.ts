/**
 * T-357 regression suite (63rd session, 2026-09-14) — DATA-018:
 * the honest demographics for placeholder data.
 *
 * The workbook has NO birth-date and NO gender columns: the importer
 * writes birthDate "2000-01-01" (390/391 live rows) and gender NULL
 * (391/391). The dashboard's age derivation computed 2026−2000 = 26 →
 * every imported child landed in "18+ ans" (the owner's screenshot 8:
 * a single 100% adult bar) — placeholder data presented as demographic
 * intelligence.
 *
 * The fix: NULL and the PINNED placeholder route to a "Non renseigné"
 * slice; real birth dates bucket normally. The placeholder value lives
 * in ONE shared constant (IMPORTED_BIRTH_DATE_PLACEHOLDER) used by the
 * importer AND both demographics implementations — pinned by test so a
 * future importer change fails loudly.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseDashboardRepository } from "../../../infrastructure/supabase/repositories/supabase-dashboard-repository";
import { MockDashboardRepository } from "../../../infrastructure/mock/repositories/dashboard-repository";
import { IMPORTED_BIRTH_DATE_PLACEHOLDER } from "../../../domain/model/student";

const SRC = join(__dirname, "../../../");

beforeAll(() => {
  localStorage.setItem(
    "el-imtiyaz.session",
    JSON.stringify({ tenantId: "00000000-0000-0000-0000-000000000001", userId: "staff-1" }),
  );
});

// ============================================================
// 1. The pinned placeholder constant
// ============================================================

describe("T-357 — IMPORTED_BIRTH_DATE_PLACEHOLDER (the shared pin)", () => {
  it("is the documented import placeholder value", () => {
    expect(IMPORTED_BIRTH_DATE_PLACEHOLDER).toBe("2000-01-01");
  });

  it("the importer writes the SHARED constant (no literal)", () => {
    const adapterSrc = readFileSync(
      join(SRC, "infrastructure/excel/import-engine/storage/repository-adapter.ts"),
      "utf8",
    );
    expect(adapterSrc).not.toMatch(/birthDate:\s*"2000-01-01"/);
    expect(adapterSrc).toContain("birthDate: IMPORTED_BIRTH_DATE_PLACEHOLDER");
  });
});

// ============================================================
// 2. The Supabase demographics derivation
// ============================================================

type Row = Record<string, unknown>;

function makeClient(students: Row[], classes: Row[] = []) {
  const client = {
    from(table: string) {
      const q: Record<string, unknown> = {};
      const chain = () => q;
      q.select = () => q;
      q.eq = chain;
      q.neq = chain;
      q.gte = chain;
      q.lt = chain;
      q.lte = chain;
      q.in = chain;
      q.order = chain;
      q.then = (resolve: unknown) =>
        Promise.resolve({
          data: table === "students" ? students : classes,
          error: null,
        }).then(resolve as never);
      return q;
    },
  };
  return client as unknown as SupabaseClient;
}

function studentRow(birth: string | null, gender: string | null = null): Row {
  return {
    id: `s-${Math.random().toString(36).slice(2)}`,
    gender,
    date_of_birth: birth,
    class_id: null,
  };
}

describe("T-357 — SupabaseDashboardRepository.demographics (the honest age derivation)", () => {
  it("the import placeholder routes to 'Non renseigné' — NEVER a computed age", async () => {
    // The live-data shape: 3 placeholder children + 1 real 2012-born.
    const client = makeClient([
      studentRow(IMPORTED_BIRTH_DATE_PLACEHOLDER),
      studentRow(IMPORTED_BIRTH_DATE_PLACEHOLDER),
      studentRow(IMPORTED_BIRTH_DATE_PLACEHOLDER),
      studentRow("2012-05-01"),
    ]);
    const repo = new SupabaseDashboardRepository(client);
    const result = await repo.demographics();
    expect(result.ok).toBe(true);
    if (result.ok) {
      const age = result.value.age;
      // The 2012 child (14 years) lands in 12–14; the three placeholders
      // land in "Non renseigné" — the "18+ ans" bucket stays EMPTY.
      const bucket = (label: string) => age.find((a) => a.label === label);
      expect(bucket("12–14 ans")?.count).toBe(1);
      expect(bucket("Non renseigné")?.count).toBe(3);
      expect(bucket("Non renseigné")?.percent).toBe(75);
      expect(bucket("18+ ans")?.count).toBe(0);
    }
  });

  it("NULL birth dates also route to 'Non renseigné'", async () => {
    const client = makeClient([studentRow(null), studentRow("2015-03-01")]);
    const repo = new SupabaseDashboardRepository(client);
    const result = await repo.demographics();
    if (result.ok) {
      const bucket = (label: string) => result.value.age.find((a) => a.label === label);
      expect(bucket("Non renseigné")?.count).toBe(1);
      expect(bucket("9–11 ans")?.count).toBe(1);
    }
  });

  it("a fully-known population produces no 'Non renseigné' slice", async () => {
    const client = makeClient([studentRow("2013-01-01"), studentRow("2011-01-01")]);
    const repo = new SupabaseDashboardRepository(client);
    const result = await repo.demographics();
    if (result.ok) {
      expect(result.value.age.find((a) => a.label === "Non renseigné")).toBeUndefined();
    }
  });

  it("gender NULL still renders the honest 'Non spécifié' slice (unchanged behavior)", async () => {
    const client = makeClient([studentRow("2012-05-01", null)]);
    const repo = new SupabaseDashboardRepository(client);
    const result = await repo.demographics();
    if (result.ok) {
      expect(result.value.gender.find((g) => g.label === "Non spécifié")?.count).toBe(1);
    }
  });
});

// ============================================================
// 3. The mock parity
// ============================================================

describe("T-357 — MockDashboardRepository parity", () => {
  it("the mock's age derivation handles NULL/placeholder the same way (contract-identical)", async () => {
    const repo = new MockDashboardRepository();
    const result = await repo.demographics();
    expect(result.ok).toBe(true);
    if (result.ok) {
      // The mock seed carries REAL birth dates (no placeholders) — the
      // "Non renseigné" slice must be ABSENT, and every age slice must
      // come from computed real ages.
      expect(result.value.age.find((a) => a.label === "Non renseigné")).toBeUndefined();
      const knownTotal = result.value.age
        .filter((a) => a.label !== "Non renseigné")
        .reduce((s, a) => s + a.count, 0);
      expect(knownTotal).toBeGreaterThan(0);
    }
  });

  it("the mock source routes NULL/placeholder through the shared constant (source guard)", () => {
    const mockSrc = readFileSync(
      join(SRC, "infrastructure/mock/repositories/dashboard-repository.ts"),
      "utf8",
    );
    expect(mockSrc).toContain("IMPORTED_BIRTH_DATE_PLACEHOLDER");
    const supaSrc = readFileSync(
      join(SRC, "infrastructure/supabase/repositories/supabase-dashboard-repository.ts"),
      "utf8",
    );
    expect(supaSrc).toContain("IMPORTED_BIRTH_DATE_PLACEHOLDER");
  });
});

/**
 * T-403 — the promotion-cycle workflow.
 *
 * Pins the three layers:
 *   1. DOMAIN — the canonical decision-payload builder (ONE wire format,
 *      shared with the batch flow) + the incomplete-notes detector and its
 *      task-mandated warning text.
 *   2. REPOSITORY (Supabase, fake client) — confirmClass emits the exact
 *      fn_confirm_promotion_cycle_class wire shape (cycle/class/decisions/
 *      ack) and surfaces the server's [NOTES_INCOMPLETES] marker verbatim
 *      so the UI can offer the explicit confirmation.
 *   3. SOURCE guards — the one-shot per-class modal is RETIRED (no UI
 *      surface executes promotion outside the cycle workflow); the cycle
 *      tab + the contextual class-detail entry are the only surfaces.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildPromotionDecisionPayload,
} from "../../domain/calc/academics/promotion";
import type { PromotionCandidate } from "../../domain/calc/academics/promotion";
import {
  findStudentsWithIncompleteNotes,
  incompleteNotesWarning,
  PROMOTION_CYCLE_STATUS_LABELS_FR,
  PROMOTION_CYCLE_CLASS_STATUS_LABELS_FR,
} from "../../domain/model/promotion-cycle";
import { SupabasePromotionCycleRepository } from "../../infrastructure/supabase/repositories/supabase-academic-repository";

const TENANT = "00000000-0000-0000-0000-000000000001";
const UUID = "11111111-1111-1111-1111-111111111111";

beforeAll(() => {
  localStorage.setItem(
    "el-imtiyaz.session",
    JSON.stringify({ tenantId: TENANT, userId: "staff-1" }),
  );
});
afterAll(() => {
  localStorage.removeItem("el-imtiyaz.session");
});

// ============================================================================
// 1. Domain
// ============================================================================

function makeCandidate(overrides: Partial<PromotionCandidate> = {}): PromotionCandidate {
  return {
    student: {
      id: UUID,
      tenantId: TENANT,
      code: "ELV-2026-000001",
      parentId: "par-1",
      firstName: "Sara",
      lastName: "BENALI",
      displayName: null,
      gender: "female",
      birthDate: "2009-01-01",
      enrollmentDate: "2025-09-01",
      level: "lycee",
      gradeYear: 2,
      gradeLevel: "2eme_annee",
      filiereCode: null,
      specialiteCode: null,
      classId: "cls-1",
      photoUrl: null,
      medicalNotes: null,
      transportTier: null,
      status: "active",
      paymentPlan: "tranches",
      createdAt: "2025-09-01T00:00:00Z",
      updatedAt: "2025-09-01T00:00:00Z",
    },
    yearlyGpa: 14.5,
    suggestedDecision: "promoted",
    isPassing: true,
    nextGradeLevel: "3eme_annee",
    nextAcademicLevel: "lycee",
    nextGradeYear: 3,
    ...overrides,
  };
}

describe("T-403 §1 — buildPromotionDecisionPayload (ONE wire format)", () => {
  it("builds the execute_batch_promotion payload from the review decisions", () => {
    const decisions = buildPromotionDecisionPayload(
      [{ candidate: makeCandidate(), finalDecision: "promoted" }],
      "2026-2027",
    );
    expect(decisions).toHaveLength(1);
    const d = decisions[0]!;
    expect(d.student_id).toBe(UUID);
    expect(d.decision).toBe("promoted");
    expect(d.next_grade_code).toBe("3eme_annee");
    expect(d.academic_year).toBe("2026-2027");
    expect(d.cycle).toBe("lycee");
    expect(d.grade_code).toBe("2eme_annee");
    expect(typeof d.gpa).toBe("number");
  });

  it("a repeated decision carries NO next grade (the student stays)", () => {
    const decisions = buildPromotionDecisionPayload(
      [{ candidate: makeCandidate({ suggestedDecision: "repeated", isPassing: false }), finalDecision: "repeated" }],
      "2026-2027",
    );
    expect(decisions[0]!.decision).toBe("repeated");
    expect(decisions[0]!.next_grade_code).toBeNull();
  });

  it("mock-era ids are skipped (they cannot execute server-side)", () => {
    const decisions = buildPromotionDecisionPayload(
      [
        { candidate: makeCandidate(), finalDecision: "promoted" },
        { candidate: makeCandidate({ student: { ...makeCandidate().student, id: "stu-001" } as never }), finalDecision: "promoted" },
      ],
      "2026-2027",
    );
    expect(decisions).toHaveLength(1);
    expect(decisions[0]!.student_id).toBe(UUID);
  });
});

describe("T-403 §1b — the incomplete-notes detector", () => {
  const students = [
    { id: "s1", firstName: "Complete", lastName: "Student" },
    { id: "s2", firstName: "Missing", lastName: "Marks" },
    { id: "s3", firstName: "No", lastName: "Rows" },
  ];

  it("flags students whose marks are incomplete or absent (never silently zero)", () => {
    const assessments = [
      { studentId: "s1", devoir1: 15, devoir2: 14, examen: 16, academicYear: "2026-2027" },
      { studentId: "s2", devoir1: 12, devoir2: null, examen: 10, academicYear: "2026-2027" },
    ];
    const incomplete = findStudentsWithIncompleteNotes(students, assessments, "2026-2027");
    expect(incomplete.map((s) => s.id)).toEqual(["s2", "s3"]);
  });

  it("ignores assessments of other academic years", () => {
    const assessments = [
      { studentId: "s1", devoir1: 15, devoir2: 14, examen: 16, academicYear: "2025-2026" },
    ];
    const incomplete = findStudentsWithIncompleteNotes(students, assessments, "2026-2027");
    expect(incomplete).toHaveLength(3);
  });

  it("the warning text is the task-mandated shape", () => {
    const text = incompleteNotesWarning([{ name: "Missing Marks" }]);
    expect(text).toContain("Les notes ne sont pas encore toutes renseignées");
    expect(text).toContain("1 élève(s)");
    expect(text).toContain("Missing Marks");
    expect(text).toContain("Êtes-vous sûr de vouloir continuer ?");
  });

  it("the status label maps exist for every status", () => {
    expect(PROMOTION_CYCLE_STATUS_LABELS_FR.partially_processed).toBe("Partiellement traité");
    expect(PROMOTION_CYCLE_CLASS_STATUS_LABELS_FR.processed).toBe("Traité");
  });
});

// ============================================================================
// 2. Repository wire (fake client with rpc capture)
// ============================================================================

type RpcCall = { fn: string; args: Record<string, unknown> };

function makeRpcClient(handlers: Record<string, unknown>) {
  const rpcs: RpcCall[] = [];
  return {
    rpcs,
    client: {
      rpc(fn: string, args: Record<string, unknown>) {
        rpcs.push({ fn, args });
        const handler = handlers[fn];
        if (handler instanceof Error) return Promise.resolve({ data: null, error: { message: handler.message, code: "P0001" } });
        return Promise.resolve({ data: handler ?? {}, error: null });
      },
    } as unknown as SupabaseClient,
  };
}

describe("T-403 §2 — SupabasePromotionCycleRepository.confirmClass wire shape", () => {
  it("emits the exact fn_confirm_promotion_cycle_class payload (incl. the ack flag)", async () => {
    const { client, rpcs } = makeRpcClient({
      fn_confirm_promotion_cycle_class: {
        ok: true, cycle_id: "11111111-1111-1111-1111-111111111111", class_id: "11111111-1111-1111-1111-111111111111", class_name: "2A-A",
        promoted: 3, repeated: 1, deferred: 0, incomplete_notes_count: 2, incomplete_notes_acked: false,
      },
    });
    const repo = new SupabasePromotionCycleRepository(client);
    const result = await repo.confirmClass({
      cycleId: "11111111-1111-1111-1111-111111111111",
      classId: "11111111-1111-1111-1111-111111111111",
      decisions: [{ student_id: "s1", decision: "promoted" }],
      acknowledgeIncompleteNotes: true,
      performedBy: "staff-1",
      performedByName: "Staff",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.promoted).toBe(3);
      expect(result.value.repeated).toBe(1);
    }
    const call = rpcs.find((r) => r.fn === "fn_confirm_promotion_cycle_class");
    expect(call).toBeDefined();
    expect(call!.args.p_cycle_id).toBe("11111111-1111-1111-1111-111111111111");
    expect(call!.args.p_class_id).toBe("11111111-1111-1111-1111-111111111111");
    expect(call!.args.p_ack_incomplete_notes).toBe(true);
    expect(Array.isArray(call!.args.p_decisions)).toBe(true);
  });

  it("surfaces the server's [NOTES_INCOMPLETES] marker verbatim (the two-phase ack)", async () => {
    const { client } = makeRpcClient({
      fn_confirm_promotion_cycle_class: new Error(
        "[NOTES_INCOMPLETES] Les notes ne sont pas encore toutes renseignées (2 élève(s) : A B). Êtes-vous sûr de vouloir continuer ?",
      ),
    });
    const repo = new SupabasePromotionCycleRepository(client);
    const result = await repo.confirmClass({
      cycleId: "11111111-1111-1111-1111-111111111111",
      classId: "11111111-1111-1111-1111-111111111111",
      decisions: [],
      performedBy: "staff-1",
      performedByName: "Staff",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const msg = result.error.message || result.error.userMessage || "";
      expect(msg).toContain("[NOTES_INCOMPLETES]");
    }
  });

  it("completeCycle / cancelCycle / reopenClass / listCycles / getCycleClasses all route to their 0108 RPCs", async () => {
    const { client, rpcs } = makeRpcClient({
      fn_get_promotion_cycles: [],
      fn_get_promotion_cycle_classes: [],
      fn_complete_promotion_cycle: { ok: true },
      fn_cancel_promotion_cycle: { ok: true },
      fn_reopen_promotion_cycle_class: { ok: true },
    });
    const repo = new SupabasePromotionCycleRepository(client);
    await repo.listCycles();
    await repo.getCycleClasses("11111111-1111-1111-1111-111111111111");
    await repo.completeCycle("11111111-1111-1111-1111-111111111111", "staff-1", "Staff");
    await repo.cancelCycle("11111111-1111-1111-1111-111111111111", null, "staff-1", "Staff");
    await repo.reopenClass("11111111-1111-1111-1111-111111111111", "11111111-1111-1111-1111-111111111111", null, "staff-1", "Staff");
    const fns = rpcs.map((r) => r.fn);
    expect(fns).toContain("fn_get_promotion_cycles");
    expect(fns).toContain("fn_get_promotion_cycle_classes");
    expect(fns).toContain("fn_complete_promotion_cycle");
    expect(fns).toContain("fn_cancel_promotion_cycle");
    expect(fns).toContain("fn_reopen_promotion_cycle_class");
  });
});

// ============================================================================
// 3. Source guards — the scattered entry points are retired
// ============================================================================

describe("T-403 §3 — no promotion execution outside the cycle workflow", () => {
  it("the one-shot per-class modal + hook are RETIRED; the cycle surfaces are the entry points", async () => {
    const { readFileSync } = await import("node:fs");
    const { join, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const base = join(dirname(fileURLToPath(import.meta.url)), "../..");

    const exists = (p: string) => {
      try {
        readFileSync(join(base, p));
        return true;
      } catch {
        return false;
      }
    };
    // The retired files are gone.
    expect(exists("features/academics/batch-promotion-modal.tsx")).toBe(false);
    expect(exists("features/academics/hooks/use-batch-promotion.ts")).toBe(false);

    // The class-detail page's contextual entry goes through the cycle repo.
    const detail = readFileSync(join(base, "features/academics/class-detail-page.tsx"), "utf-8");
    expect(detail).toContain("promotionCycles.openOrCreateCycle");
    expect(detail).not.toContain("BatchPromotionModal");

    // The cycles tab + the class review exist and reuse the canonical engine.
    const tab = readFileSync(join(base, "features/academics/promotion-cycles/promotion-cycles-tab.tsx"), "utf-8");
    expect(tab).toContain("PromotionCyclesTab");
    const review = readFileSync(join(base, "features/academics/promotion-cycles/promotion-class-review-modal.tsx"), "utf-8");
    expect(review).toContain("buildPromotionReviewQueue");
    expect(review).toContain("promotionCycles.confirmClass");
    expect(review).toContain("NOTES_INCOMPLETES");
  });
});

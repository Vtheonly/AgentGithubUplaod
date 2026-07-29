/**
 * Iteration 9 — Installment domain tests.
 *
 * Covers the new flexible installment schedules + cycle-based customization
 * introduced in spec §6.1 / §6.2 / §6.3.
 */
import { describe, it, expect } from "vitest";
import {
  ACADEMIC_CYCLE_LABELS_FR,
  DEFAULT_CYCLE_TRANCHE_MONTHS,
  type AcademicCycle,
  type Installment,
} from "../../domain/model/payment";

describe("Iteration 9 — Installment domain", () => {
  describe("ACADEMIC_CYCLE_LABELS_FR", () => {
    it("provides French labels for every cycle", () => {
      const cycles: AcademicCycle[] = ["primaire", "cem", "lycee"];
      for (const c of cycles) {
        expect(ACADEMIC_CYCLE_LABELS_FR[c]).toBeTruthy();
        expect(typeof ACADEMIC_CYCLE_LABELS_FR[c]).toBe("string");
      }
    });

    it("labels Primaire correctly", () => {
      expect(ACADEMIC_CYCLE_LABELS_FR.primaire).toBe("Primaire");
    });

    it("labels CEM correctly", () => {
      expect(ACADEMIC_CYCLE_LABELS_FR.cem).toBe("CEM / Collège");
    });

    it("labels Lycée correctly", () => {
      expect(ACADEMIC_CYCLE_LABELS_FR.lycee).toBe("Lycée");
    });
  });

  describe("DEFAULT_CYCLE_TRANCHE_MONTHS", () => {
    it("provides a 3-tranche template for every cycle", () => {
      const cycles: AcademicCycle[] = ["primaire", "cem", "lycee"];
      for (const c of cycles) {
        const months = DEFAULT_CYCLE_TRANCHE_MONTHS[c];
        expect(months).toHaveLength(3);
        for (const m of months) {
          expect(m).toBeGreaterThanOrEqual(1);
          expect(m).toBeLessThanOrEqual(12);
        }
      }
    });

    it("uses Sept / Dec / March for Primaire (legacy Excel default)", () => {
      expect(DEFAULT_CYCLE_TRANCHE_MONTHS.primaire).toEqual([9, 12, 3]);
    });

    it("uses Sept / Dec / April for CEM (3rd tranche later than Primaire)", () => {
      expect(DEFAULT_CYCLE_TRANCHE_MONTHS.cem).toEqual([9, 12, 4]);
    });

    it("uses Sept / Jan / May for Lycée (3rd tranche latest)", () => {
      expect(DEFAULT_CYCLE_TRANCHE_MONTHS.lycee).toEqual([9, 1, 5]);
    });

    it("shifts the 3rd tranche later as the cycle level rises (Primaire < CEM < Lycée)", () => {
      const primaire3rd = DEFAULT_CYCLE_TRANCHE_MONTHS.primaire[2];
      const cem3rd = DEFAULT_CYCLE_TRANCHE_MONTHS.cem[2];
      const lycee3rd = DEFAULT_CYCLE_TRANCHE_MONTHS.lycee[2];
      expect(primaire3rd).toBeLessThan(cem3rd);
      expect(cem3rd).toBeLessThan(lycee3rd);
    });
  });

  describe("Installment entity — iteration 9 fields", () => {
    it("supports optional academicCycle field", () => {
      const ins: Installment = {
        id: "ins-001",
        parentId: "par-001",
        studentId: "stu-001",
        category: "tuition",
        label: "Tranche 1",
        amountDue: 30000,
        amountPaid: 30000,
        dueDate: "2025-09-15",
        paidDate: "2025-09-15",
        status: "paid",
        academicCycle: "primaire",
      };
      expect(ins.academicCycle).toBe("primaire");
    });

    it("supports optional customSchedule field for per-parent overrides", () => {
      const ins: Installment = {
        id: "ins-002",
        parentId: "par-002",
        studentId: "stu-002",
        category: "tuition",
        label: "Tranche 2",
        amountDue: 30000,
        amountPaid: 0,
        dueDate: "2026-01-15",
        paidDate: null,
        status: "pending",
        academicCycle: "cem",
        customSchedule: true,
        customScheduleNote: "Échelonnement exceptionnel",
      };
      expect(ins.customSchedule).toBe(true);
      expect(ins.customScheduleNote).toBe("Échelonnement exceptionnel");
    });

    it("defaults customSchedule to undefined when not set (backward compat)", () => {
      const ins: Installment = {
        id: "ins-003",
        parentId: "par-003",
        studentId: "stu-003",
        category: "tuition",
        label: "Tranche 3",
        amountDue: 30000,
        amountPaid: 0,
        dueDate: "2026-03-15",
        paidDate: null,
        status: "pending",
      };
      expect(ins.customSchedule).toBeUndefined();
      expect(ins.academicCycle).toBeUndefined();
    });
  });
});

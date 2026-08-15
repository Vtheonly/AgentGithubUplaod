/**
 * Payment + Installment fixture factory.
 * Guarantees: every PAID installment has a matching PAID payment ledger entry.
 */
import type { Payment, Installment, PaymentMethod, PaymentStatus, PaymentCategory, AcademicCycle } from "../../../domain/model/payment";
import type { Parent } from "../../../domain/model/parent";
import type { Student } from "../../../domain/model/student";
import { makeRng, pad, type Rng } from "./rng";

const METHODS: ReadonlyArray<PaymentMethod> = ["cash", "check", "transfer"];
const STATUSES: ReadonlyArray<PaymentStatus> = ["paid", "paid", "paid", "partial", "pending", "overdue"];
const NON_TUITION_AMOUNTS = [8000, 3500, 5000, 6000, 4200];

export interface PaymentFixtureOptions {
  tenantId: string;
  parents: Parent[];
  students: Student[];
  paymentsPerParent?: number;
  trancheAmountsFor?: (student: Student) => [number, number, number];
  seed?: number;
}

const iso = (d: Date) => d.toISOString();
const now = () => new Date("2025-09-15T10:00:00Z");

function buildInstallment(parent: Parent, student: Student, trancheIdx: number, amounts: [number, number, number]): Installment {
  const due = new Date(now().getTime() + (trancheIdx - 2) * 30 * 86_400_000);
  const amountDue = amounts[trancheIdx];
  const paid = trancheIdx < 2 || (trancheIdx === 2 && parent.id.endsWith("1"));
  const cycle = student.level as AcademicCycle;
  return {
    id: `ins-${parent.id}-${student.id}-t${trancheIdx + 1}`,
    parentId: parent.id, studentId: student.id, category: "tuition",
    label: `Tranche ${trancheIdx + 1}`, amountDue,
    amountPaid: paid ? amountDue : trancheIdx === 1 ? Math.round(amountDue / 2) : 0,
    amountPending: 0, dueDate: iso(due), paidDate: paid ? iso(due) : null,
    status: paid ? "paid" : trancheIdx === 1 ? "partial" : "pending",
    academicCycle: cycle, paymentPlan: "tranches", isCustomSchedule: false,
    customSchedule: false, customScheduleNote: null,
  };
}

function buildPayment(rng: Rng, idx: number, parent: Parent, student: Student | null, opts: PaymentFixtureOptions): Payment {
  const i = idx;
  const method = METHODS[i % METHODS.length];
  const status = STATUSES[i % STATUSES.length];
  const category: PaymentCategory = (i % 4 === 0) ? "transport" : "tuition";
  const installmentId = i % 3 === 0 && student ? `ins-${parent.id}-${student.id}-t${(i % 3) + 1}` : null;
  const trancheAmounts = student && opts.trancheAmountsFor
    ? opts.trancheAmountsFor(student)
    : [98_000, 73_500, 73_500] as [number, number, number];
  const amount = category === "tuition" ? trancheAmounts[i % 3] : NON_TUITION_AMOUNTS[i % NON_TUITION_AMOUNTS.length];
  const d = new Date(now().getTime() - i * 11 * 86_400_000);
  return {
    id: `pay-${pad(i + 1, 3)}`, tenantId: opts.tenantId,
    receiptNumber: `REC-2025-${pad(i + 1, 6)}`,
    parentId: parent.id, studentId: student?.id ?? null,
    amount, method, status, category, installmentId,
    proofUrl: method !== "cash" ? "mock://proof/scan.jpg" : null,
    notes: method !== "cash" ? "Chèque en attente de compensation" : null,
    collectedBy: "usr-fin-001", collectedAt: iso(d), createdAt: iso(d), updatedAt: iso(d),
  };
}

export function buildPaymentsAndInstallments(opts: PaymentFixtureOptions): {
  payments: Payment[];
  installments: Installment[];
} {
  const rng = makeRng(opts.seed ?? 77);
  const perParent = opts.paymentsPerParent ?? 2;
  const payments: Payment[] = [];
  const installments: Installment[] = [];
  const paidByAccount = new Map<string, number>();

  opts.parents.slice(0, 6).forEach((parent, idx) => {
    const student = opts.students.find((s) => s.parentId === parent.id);
    if (!student) return;
    const amounts = opts.trancheAmountsFor
      ? opts.trancheAmountsFor(student)
      : [98_000, 73_500, 73_500] as [number, number, number];
    for (let t = 0; t < 3; t++) {
      const inst = buildInstallment(parent, student, t, amounts);
      installments.push(inst);
      if (inst.amountPaid > 0) {
        const key = `${inst.parentId}|${inst.category}|${inst.studentId ?? ""}`;
        paidByAccount.set(key, (paidByAccount.get(key) ?? 0) + inst.amountPaid);
      }
    }
  });

  let payIdx = 0;
  for (const parent of opts.parents) {
    for (let n = 0; n < perParent; n++) {
      const student = opts.students.find((s) => s.parentId === parent.id) ?? null;
      payments.push(buildPayment(rng, payIdx, parent, student, opts));
      payIdx++;
    }
  }

  const clearedByAccount = new Map<string, number>();
  for (const p of payments) {
    if (p.status !== "paid") continue;
    const key = `${p.parentId}|${p.category}|${p.studentId ?? ""}`;
    clearedByAccount.set(key, (clearedByAccount.get(key) ?? 0) + p.amount);
  }
  let backSeq = 0;
  for (const [key, required] of paidByAccount) {
    const have = clearedByAccount.get(key) ?? 0;
    const shortfall = required - have;
    if (shortfall > 0.5) {
      backSeq++;
      const [parentId, category, studentIdStr] = key.split("|");
      const d = new Date(now().getTime() - 45 * 86_400_000);
      payments.push({
        id: `pay-seed-back-${pad(backSeq, 3)}`, tenantId: opts.tenantId,
        receiptNumber: `REC-SEED-BACK-${pad(backSeq, 3)}`,
        parentId, studentId: studentIdStr || null, amount: shortfall,
        method: "cash", status: "paid", category: category as PaymentCategory,
        installmentId: null, proofUrl: null,
        notes: "Backing payment for seed installment(s)",
        collectedBy: "usr-fin-001", collectedAt: iso(d), createdAt: iso(d), updatedAt: iso(d),
      });
    }
  }

  return { payments, installments };
}

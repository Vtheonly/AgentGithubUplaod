/**
 * verify_t-338_live.ts — T-341 (STATS-400): the LIVE cross-verification.
 *
 * Runs the SAME canonical TS derivations the Executive Command Center
 * renders (src/features/dashboard/components/analytics/
 * executive-statistics.ts — T-338) over the LIVE Supabase raw rows, then
 * diffs every value against the server-side SQL truth
 * (scripts/verify_t-338.sql — executed through the Management API SQL
 * endpoint inside BEGIN; … ROLLBACK;, so the live DB is never mutated).
 *
 * This is the owner's zero-hardcoded-numbers mandate made executable:
 * the numbers the DASHBOARD renders must equal the numbers the DATABASE
 * computes — independently, through two different code paths (TypeScript
 * derivation family vs hand-written SQL aggregation).
 *
 * Run (from elimtiyaz-desktop/):
 *   SUPABASE_ACCESS_TOKEN=sbp_… npx tsx scripts/verify_t-338_live.ts
 *
 * Env:
 *   SUPABASE_ACCESS_TOKEN  the Management API token (REQUIRED)
 *   SUPABASE_PROJECT_REF   default hkvkefubghbbotgnteir
 *
 * The pinned NOW matches the SQL truth: 2026-09-14T12:00:00Z.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  deriveTrancheWaves,
  deriveDiscountErosion,
  deriveDebtTriage,
  deriveFamilyConcentration,
  deriveTransportYield,
  deriveServiceYield,
  deriveEnrollmentDynamics,
} from "../src/features/dashboard/components/analytics/executive-statistics";
import type { Installment, Payment } from "../src/domain/model/payment";
import type { LedgerEntry } from "../src/domain/model/ledger";
import type { Student } from "../src/domain/model/student";
import type { Parent } from "../src/domain/model/parent";
import type { AcademicClass } from "../src/domain/model/academic";

const __dirname = dirname(fileURLToPath(import.meta.url));

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN ?? "";
const REF = process.env.SUPABASE_PROJECT_REF ?? "hkvkefubghbbotgnteir";
const API = `https://api.supabase.com/v1/projects/${REF}/database/query`;
const NOW_EPOCH_MS = Date.parse("2026-09-14T12:00:00Z");

if (!TOKEN) {
  console.error("ERROR: SUPABASE_ACCESS_TOKEN must be set (the Management API token).");
  process.exit(2);
}

async function sql(query: string): Promise<Record<string, unknown>[]> {
  const res = await fetch(API, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const body = (await res.json()) as unknown;
  if (!res.ok || (body as { message?: string }).message?.startsWith("Failed")) {
    throw new Error(`SQL failed (${res.status}): ${JSON.stringify(body).slice(0, 600)}`);
  }
  return body as Record<string, unknown>[];
}

/* ============================================================
 *  Row shapes (the Management API returns lower_snake_case columns)
 * ============================================================ */

interface RawInstallment {
  id: string; parent_id: string; student_id: string | null;
  category: string; label: string | null; tranche_number: number | null;
  amount_due: number | string; amount_paid: number | string; amount_pending: number | string | null;
  due_date: string; status: string;
}
interface RawLedger {
  id: string; parent_id: string; category: string | null;
  amount: number | string; entry_type: string | null; description: string | null;
  metadata: Record<string, unknown> | null;
}
interface RawStudent {
  id: string; parent_id: string; class_id: string | null;
  transport_tier: string | null; enrollment_status: string | null;
}
interface RawParent {
  id: string; display_name: string | null; first_name: string | null; last_name: string | null;
}
interface RawClass {
  id: string; name: string; grade_code: string | null; is_active: boolean | null;
}
interface RawPayment {
  id: string; amount: number | string; status: string; category: string | null; student_id: string | null;
}

const num = (v: number | string | null | undefined): number => Number(v ?? 0);

/* ============================================================
 *  The diff machinery — every mismatch is a loud FAIL
 * ============================================================ */

let failures = 0;
let checks = 0;

function expectEq(section: string, field: string, expected: unknown, actual: unknown): void {
  checks++;
  const e = typeof expected === "number" ? Math.round(expected * 100) / 100 : expected;
  const a = typeof actual === "number" ? Math.round(actual * 100) / 100 : actual;
  if (e !== a) {
    failures++;
    console.error(`  ✗ ${section}.${field}: SQL=${JSON.stringify(e)} TS=${JSON.stringify(a)}`);
  }
}

async function main(): Promise<void> {
  console.log("verify_t-338_live — the executive-statistics LIVE truth diff");
  console.log(`now pinned at 2026-09-14T12:00:00Z; ref ${REF}\n`);

  // ── 1. The server-side truth (BEGIN…ROLLBACK — never mutates) ──────────
  const truthSql = readFileSync(join(__dirname, "verify_t-338.sql"), "utf-8");
  const truthRows = await sql(truthSql);
  const truthBySection = new Map<string, Record<string, unknown>[]>();
  for (const r of truthRows as { section: string; truth: Record<string, unknown> }[]) {
    const list = truthBySection.get(r.section) ?? [];
    list.push(r.truth);
    truthBySection.set(r.section, list);
  }

  // ── 2. The raw rows (the same tables the repository reads) ─────────────
  const [
    rawInstallments, rawLedger, rawStudents, rawParents, rawClasses, rawPayments,
  ] = await Promise.all([
    sql(`select id, parent_id, student_id, category, label, tranche_number, amount_due,
                amount_paid, amount_pending, due_date::text as due_date, status
         from installments order by created_at`),
    sql(`select id, parent_id, category, amount, entry_type, description, metadata
         from ledger_entries order by created_at`),
    sql(`select id, parent_id, class_id, transport_tier, enrollment_status from students order by id`),
    sql(`select id, display_name, first_name, last_name from parents`),
    sql(`select id, name, grade_code, is_active from classes`),
    sql(`select id, amount, status, category, student_id from payments`),
  ]);
  console.log(
    `rows: ${rawInstallments.length} installments · ${rawLedger.length} ledger · ` +
    `${rawStudents.length} students · ${rawParents.length} parents · ${rawClasses.length} classes · ${rawPayments.length} payments`,
  );

  // ── 3. Map to the DOMAIN models (the supabase-mapper conventions) ──────
  const installments: Installment[] = (rawInstallments as unknown as RawInstallment[]).map((r) => ({
    id: r.id,
    parentId: r.parent_id,
    studentId: r.student_id,
    category: r.category,
    label: r.label ?? "",
    trancheNumber: (r.tranche_number ?? 1) as 1 | 2 | 3,
    amountDue: num(r.amount_due),
    amountPaid: num(r.amount_paid),
    amountPending: num(r.amount_pending),
    dueDate: r.due_date,
    paidDate: null,
    status: r.status,
    academicCycle: undefined,
    paymentPlan: "tranches",
    isCustomSchedule: false,
    customSchedule: false,
    customScheduleNote: null,
  }));

  const ledger: LedgerEntry[] = (rawLedger as unknown as RawLedger[]).map((r) => ({
    id: r.id,
    tenantId: "t1",
    accountId: `parent:${r.parent_id}:category:${r.category ?? "tuition"}`,
    parentId: r.parent_id,
    studentId: null,
    category: r.category ?? "tuition",
    amount: num(r.amount),
    type: (r.entry_type ?? "charge") as LedgerEntry["type"],
    sourceType: "bulk_import",
    sourceId: "run-1",
    method: null,
    receiptNumber: null,
    paymentStatus: null,
    reversesId: null,
    description: r.description ?? "",
    actorId: "system",
    actorName: "System",
    at: "2026-09-14T12:00:00.000Z",
    metadata: (r.metadata ?? {}) as Record<string, unknown>,
  }));

  const students: Student[] = (rawStudents as unknown as RawStudent[]).map((r) => ({
    id: r.id,
    tenantId: "t1",
    code: r.id,
    parentId: r.parent_id,
    firstName: r.id,
    lastName: "Test",
    displayName: null,
    gender: "unspecified",
    birthDate: "2015-01-01",
    enrollmentDate: "2025-09-01",
    level: "primaire",
    gradeYear: 1,
    gradeLevel: "1ap",
    classId: r.class_id,
    photoUrl: null,
    medicalNotes: null,
    transportTier: r.transport_tier,
    status: (r.enrollment_status ?? "active") as Student["status"],
    paymentPlan: "tranches",
    createdAt: "2025-09-01T00:00:00.000Z",
    updatedAt: "2025-09-01T00:00:00.000Z",
  }));

  const parents: Parent[] = (rawParents as unknown as RawParent[]).map((r) => ({
    id: r.id,
    tenantId: "t1",
    code: r.id,
    firstName: r.first_name ?? "",
    lastName: r.last_name ?? "",
    displayName: r.display_name ?? "",
    phone: "0",
    email: null,
    address: null,
    cityTier: null,
    authUserId: null,
    activationCode: null,
    status: "active",
    notes: null,
    createdAt: "2025-09-01T00:00:00.000Z",
    updatedAt: "2025-09-01T00:00:00.000Z",
  })) as unknown as Parent[];

  const enrolledByClass = new Map<string, number>();
  for (const s of students) {
    if (s.classId) enrolledByClass.set(s.classId, (enrolledByClass.get(s.classId) ?? 0) + 1);
  }
  const classes: AcademicClass[] = (rawClasses as unknown as RawClass[]).map((r) => ({
    id: r.id,
    tenantId: "t1",
    academicYearId: "ay-1",
    academicLevelId: "lvl-1",
    code: r.id,
    name: r.name,
    gradeCode: (r.grade_code ?? "1ap"),
    level: "primaire",
    gradeYear: 1,
    section: "A",
    room: null,
    capacity: null,
    enrolledCount: enrolledByClass.get(r.id) ?? 0,
    homeroomTeacherId: null,
    homeroomTeacherName: null,
    notes: null,
    academicYear: "2026-2027",
    isActive: r.is_active ?? true,
  })) as unknown as AcademicClass[];

  const payments: Payment[] = (rawPayments as unknown as RawPayment[]).map((r) => ({
    id: r.id,
    tenantId: "t1",
    receiptNumber: r.id,
    parentId: "p",
    studentId: r.student_id,
    amount: num(r.amount),
    method: "cash",
    status: r.status as Payment["status"],
    category: (r.category ?? "tuition") as Payment["category"],
    installmentId: null,
    proofUrl: null,
    notes: null,
    collectedBy: "usr",
    collectedAt: "2026-09-01T10:00:00.000Z",
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-01T10:00:00.000Z",
  })) as unknown as Payment[];

  // ── 4. The canonical derivations (the SAME ones the dashboard runs) ────
  const waves = deriveTrancheWaves(installments, NOW_EPOCH_MS);
  const erosion = deriveDiscountErosion(ledger);
  const triage = deriveDebtTriage(installments, NOW_EPOCH_MS);
  const concentration = deriveFamilyConcentration({
    installments, parents, students, topN: 10, nowEpochMs: NOW_EPOCH_MS,
  });
  const transport = deriveTransportYield({ students, installments });
  const services = deriveServiceYield(payments, {
    therapy_psychology: "Psychologie",
    therapy_speech: "Orthophonie",
    extracurricular: "Activité parascolaire",
    canteen: "Cantine",
    uniform: "Uniforme",
    books: "Livres",
    second_apron: "2ème Tablier",
    other: "Autre",
  });
  const dynamics = deriveEnrollmentDynamics({ students, parents, classes });

  // ── 5. The section-by-section diff (TS engine ≡ SQL) ────────────────────
  console.log("\n── waves ──");
  const truthWaves = truthBySection.get("waves") ?? [];
  const waveByKey = new Map(truthWaves.map((w) => [`${w.category}#${w.tranche_number}`, w]));
  expectEq("waves", "section count", truthWaves.length, waves.length);
  for (const w of waves) {
    const t = waveByKey.get(`${w.category}#${w.wave}`);
    if (!t) { failures++; console.error(`  ✗ waves: SQL has no row for ${w.category}#${w.wave}`); continue; }
    expectEq(`waves[${w.category}#${w.wave}]`, "installmentCount", t.installment_count, w.installmentCount);
    expectEq(`waves[${w.category}#${w.wave}]`, "paidCount", t.paid_count, w.paidCount);
    expectEq(`waves[${w.category}#${w.wave}]`, "familyCount", t.family_count, w.familyCount);
    expectEq(`waves[${w.category}#${w.wave}]`, "debtorFamilyCount", t.debtor_family_count, w.debtorFamilyCount);
    expectEq(`waves[${w.category}#${w.wave}]`, "dueTotal", t.due_total, w.dueTotal);
    expectEq(`waves[${w.category}#${w.wave}]`, "paidTotal", t.paid_total, w.paidTotal);
    expectEq(`waves[${w.category}#${w.wave}]`, "remainingTotal", t.remaining_total, w.remainingTotal);
    expectEq(`waves[${w.category}#${w.wave}]`, "collectedPct", t.collected_pct, w.collectedPct);
  }

  console.log("── erosion ──");
  const [tErosion] = truthBySection.get("erosion") ?? [{}];
  expectEq("erosion", "remiseCount", tErosion.remise_count, erosion.remiseCount);
  expectEq("erosion", "remiseTotal", tErosion.remise_total, erosion.remiseTotal);
  expectEq("erosion", "cancelCount", tErosion.cancel_count, erosion.cancelCount);
  expectEq("erosion", "cancelTotal", tErosion.cancel_total, erosion.cancelTotal);
  expectEq("erosion", "netRemiseTotal", tErosion.net_remise_total, erosion.netRemiseTotal);
  expectEq("erosion", "grossCharges", tErosion.gross_charges, erosion.grossCharges);
  expectEq("erosion", "stickerTotal", tErosion.sticker_total, erosion.stickerTotal);
  expectEq("erosion", "erosionPct", tErosion.erosion_pct, erosion.erosionPct);
  expectEq("erosion", "averageRemise", tErosion.average_remise, erosion.averageRemise);

  console.log("── triage ──");
  const truthTriage = truthBySection.get("triage") ?? [];
  const triageByBucket = new Map(truthTriage.map((b) => [String(b.bucket), b]));
  const SQL_BUCKET_ORDER = ["not_due", "current", "reminder", "chronic"] as const;
  for (const b of triage.buckets) {
    const key = SQL_BUCKET_ORDER[b.bucket as keyof typeof SQL_BUCKET_ORDER] ?? String(b.bucket);
    const t = triageByBucket.get(key) ?? { amount: 0, installment_count: 0, family_count: 0 };
    expectEq(`triage[${key}]`, "amount", t.amount, b.amount);
    expectEq(`triage[${key}]`, "installmentCount", t.installment_count, b.installmentCount);
    expectEq(`triage[${key}]`, "familyCount", t.family_count, b.familyCount);
  }
  expectEq("triage", "totalOutstanding",
    (truthTriage as { amount?: number }[]).reduce((s, b) => s + Number(b.amount ?? 0), 0),
    triage.totalOutstanding);

  console.log("── call list ──");
  const truthCall = truthBySection.get("call_list") ?? [];
  const callById = new Map(truthCall.map((c) => [String(c.parent_id), c]));
  expectEq("call_list", "family count", truthCall.length, triage.callList.length);
  for (const c of triage.callList) {
    const t = callById.get(c.parentId);
    if (!t) { failures++; console.error(`  ✗ call_list: SQL has no ${c.parentId} (TS outstanding=${c.outstanding})`); continue; }
    expectEq(`call_list[${c.parentId.slice(0, 8)}]`, "outstanding", t.outstanding, c.outstanding);
    expectEq(`call_list[${c.parentId.slice(0, 8)}]`, "worstDaysOverdue", t.worst_days, c.worstDaysOverdue);
  }

  console.log("── concentration ──");
  const [tConc] = truthBySection.get("concentration") ?? [{}];
  expectEq("concentration", "totalOutstanding", tConc.total_outstanding, concentration.totalOutstanding);
  expectEq("concentration", "debtorFamilyCount", tConc.debtor_family_count, concentration.debtorFamilyCount);
  const truthTop = truthBySection.get("top_families") ?? [];
  expectEq("concentration", "top-10 count", truthTop.length, concentration.topFamilies.length);
  const topById = new Map(truthTop.map((f) => [String(f.parent_id), f]));
  for (const f of concentration.topFamilies) {
    const t = topById.get(f.parentId);
    if (!t) { failures++; console.error(`  ✗ top_families: SQL has no ${f.parentId}`); continue; }
    expectEq(`top_families[${f.parentName}]`, "outstanding", t.outstanding, f.outstanding);
    expectEq(`top_families[${f.parentName}]`, "childCount", t.child_count, f.childCount);
    expectEq(`top_families[${f.parentName}]`, "shareOfTotalDebt", t.share_pct, f.shareOfTotalDebt);
    expectEq(`top_families[${f.parentName}]`, "worstDaysOverdue", t.worst_days, f.worstDaysOverdue);
  }

  console.log("── transport ──");
  const [tTransport] = truthBySection.get("transport") ?? [{}];
  expectEq("transport", "riders", tTransport.riders, transport.riders);
  expectEq("transport", "nonRiders", tTransport.non_riders, transport.nonRiders);
  expectEq("transport", "unresolved value count", tTransport.unresolved_value_count, transport.unresolvedRawValues.length);
  const truthRoutes = truthBySection.get("transport_routes") ?? [];
  const routeByDest = new Map(truthRoutes.map((r) => [String(r.dest), r]));
  expectEq("transport", "route count", truthRoutes.length, transport.routes.length);
  for (const r of transport.routes) {
    const t = routeByDest.get(r.destination);
    if (!t) { failures++; console.error(`  ✗ transport_routes: SQL has no ${r.destination}`); continue; }
    expectEq(`transport_routes[${r.destination}]`, "riders", t.riders, r.riders);
    expectEq(`transport_routes[${r.destination}]`, "dueTotal", t.due_total, r.dueTotal);
    expectEq(`transport_routes[${r.destination}]`, "paidTotal", t.paid_total, r.paidTotal);
    expectEq(`transport_routes[${r.destination}]`, "remainingTotal", t.remaining_total, r.remainingTotal);
    expectEq(`transport_routes[${r.destination}]`, "collectedPct", t.collected_pct, r.collectedPct);
  }

  console.log("── services ──");
  const truthServices = truthBySection.get("services") ?? [];
  expectEq("services", "category count", truthServices.length, services.length);
  const svcByCat = new Map(truthServices.map((s) => [String(s.category), s]));
  for (const s of services) {
    const t = svcByCat.get(s.category);
    if (!t) { failures++; console.error(`  ✗ services: SQL has no ${s.category}`); continue; }
    expectEq(`services[${s.category}]`, "revenue", t.revenue, s.revenue);
    expectEq(`services[${s.category}]`, "paymentCount", t.payment_count, s.paymentCount);
    expectEq(`services[${s.category}]`, "studentCount", t.student_count, s.studentCount);
  }

  console.log("── dynamics ──");
  const [tDyn] = truthBySection.get("dynamics") ?? [{}];
  expectEq("dynamics", "totalStudents", tDyn.total_students, dynamics.totalStudents);
  expectEq("dynamics", "totalFamilies", tDyn.total_families, dynamics.totalFamilies);
  expectEq("dynamics", "siblingIndex", tDyn.sibling_index, dynamics.siblingIndex);
  expectEq("dynamics", "multiChildFamilyCount", tDyn.multi_child_families, dynamics.multiChildFamilyCount);
  expectEq("dynamics", "multiChildFamilyPct", tDyn.multi_child_pct, dynamics.multiChildFamilyPct);

  console.log("── section imbalance ──");
  const truthSections = truthBySection.get("sections") ?? [];
  const secByGrade = new Map(truthSections.map((s) => [String(s.grade_code), s]));
  expectEq("sections", "grade count", truthSections.length, dynamics.imbalances.length);
  for (const i of dynamics.imbalances) {
    const t = secByGrade.get(i.gradeLabel.includes("(") ? i.gradeLabel.slice(i.gradeLabel.lastIndexOf("(") + 1, -1).toLowerCase() : i.gradeLabel);
    const bySpread = truthSections.find((s) => Number(s.spread) === i.spread && Number(s.max_enrolled) === i.maxEnrolled);
    const target = t ?? bySpread;
    if (!target) { failures++; console.error(`  ✗ sections: SQL has no grade for ${i.gradeLabel}`); continue; }
    expectEq(`sections[${i.gradeLabel}]`, "sectionCount", target.section_count, i.sectionCount);
    expectEq(`sections[${i.gradeLabel}]`, "maxEnrolled", target.max_enrolled, i.maxEnrolled);
    expectEq(`sections[${i.gradeLabel}]`, "minEnrolled", target.min_enrolled, i.minEnrolled);
    expectEq(`sections[${i.gradeLabel}]`, "averageEnrolled", target.average_enrolled, i.averageEnrolled);
    expectEq(`sections[${i.gradeLabel}]`, "spread", target.spread, i.spread);
    expectEq(`sections[${i.gradeLabel}]`, "imbalanced", target.imbalanced, i.imbalanced);
  }

  // ── 6. The verdict ───────────────────────────────────────────────────────
  console.log(`\n${"=".repeat(60)}`);
  if (failures === 0) {
    console.log(`LIVE TRUTH DIFF PASSED — ${checks} checks, TS engine ≡ SQL on every value.`);
    console.log("(The Executive Command Center renders exactly what the database computes.)");
  } else {
    console.log(`LIVE TRUTH DIFF FAILED — ${failures} mismatch(es) of ${checks} checks.`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("RUNNER ERROR:", e instanceof Error ? e.message : e);
  process.exit(2);
});

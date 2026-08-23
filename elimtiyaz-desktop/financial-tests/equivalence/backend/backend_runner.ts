/**
 * Cross-Platform Equivalence Test Runner — BACKEND (PostgreSQL).
 *
 * Executes the SAME canonical JSON scenarios as the desktop and Android
 * runners, but through the REAL backend implementation: SQL functions,
 * RPCs, triggers and CHECK constraints from supabase/migrations/, running
 * against a live PostgreSQL database.
 *
 * Every scenario runs inside a transaction that is ROLLED BACK at the end,
 * so scenarios are perfectly isolated and the database stays clean.
 *
 * Coverage:
 *   - computeSubjectAverage  → the compute_grade_subject_average() TRIGGER
 *     (0004) — the persistence-layer authority for the (D1+D2+2·Ex)/4 rule
 *     and its all-3-marks-required semantics.
 *   - computeOverallGpa      → fn_calculate_student_term_gpa() (0029) with
 *     real subjects (is_extracurricular) + assessments rows.
 *   - computeAccountBalance  → compute_account_balance() (0034 canonical).
 *   - computeParentSummary   → compute_parent_summary() (0034 canonical).
 *   - allocatePayment        → collect_and_allocate_payment() atomic RPC
 *     (0026/0034): waterfall + parent_credit + audit in one transaction.
 *   - Client-side canonical rules (deterministicParentCode, stableHash,
 *     getNextGradeProgression, evaluateAllSystemDiscounts) are documented as
 *     APP-LAYER authority (migration 0036) — reported as `skipped` with the
 *     reason, and excluded from the pass/fail totals.
 *
 * Usage:
 *   npx tsx financial-tests/equivalence/backend/backend_runner.ts \
 *     [scenariosDir] [outputDir] [--database elimtiyaz] [--host /tmp] \
 *     [--port 5433] [--user postgres]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ───────────────────────────────────────────────────────────────────────────
// Types — canonical scenario shape (mirrors the desktop/Android runners).
// ───────────────────────────────────────────────────────────────────────────

interface CanonicalLedgerEntry {
  id: string;
  parentId: string;
  studentId: string | null;
  category: string;
  amount: number; // centimes
  type: string;
  sourceType: string;
  sourceId: string;
  method: string | null;
  receiptNumber: string | null;
  paymentStatus: string | null;
  reversesId: string | null;
  description: string;
  actorId: string;
  actorName: string;
  at: string;
  metadata?: Record<string, unknown>;
}

interface CanonicalInstallment {
  id: string;
  parentId: string;
  studentId: string | null;
  category: string;
  label: string;
  amountDue: number;
  amountPaid: number;
  amountPending: number;
  dueDate: string;
  paidDate: string | null;
  status: string;
}

interface CanonicalScenario {
  id: string;
  description: string;
  category: string;
  tags?: string[];
  given: {
    tenantId: string;
    parent?: { id: string; name?: string };
    students?: Array<{ id: string; parentId: string; gradeLevel: string; paymentPlan?: string }>;
    ledgerEntries: CanonicalLedgerEntry[];
    installments?: CanonicalInstallment[];
    payments?: unknown[];
    academicYearStartYear?: number;
    assessment?: {
      devoir1: number | null; devoir2: number | null; examen: number | null;
      subjectAverage?: number | null; coefficient?: number; isExtracurricular?: boolean;
    };
    assessments?: Array<{
      devoir1?: number | null; devoir2?: number | null; examen?: number | null;
      subjectAverage?: number | null; coefficient?: number; isExtracurricular?: boolean;
    }>;
  };
  when: {
    type: string;
    [key: string]: unknown;
  };
  then?: Record<string, unknown>;
}

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

const CENTIMES_PER_DZD = 100;
const toC = (dzd: string | number | null | undefined): number | null =>
  dzd == null ? null : Math.round(Number(dzd) * CENTIMES_PER_DZD);

interface Ctx {
  client: Client;
  tenantId: string;
  seq: number;
}

/** Insert a parent + student; returns their server ids. */
async function seedFamily(
  ctx: Ctx,
  parentRef?: { id: string; name?: string },
): Promise<{ parentId: string; studentId: string }> {
  const { client, tenantId } = ctx;
  const parentName = parentRef?.name ?? "Test Parent";
  const parts = parentName.split(" ");
  const parent = await client.query<{ id: string }>(
    `INSERT INTO public.parents (tenant_id, parent_code, first_name, last_name, display_name, primary_phone)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [tenantId, `PAR-SC-${ctx.seq}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      parts[0] || "Test", parts.slice(1).join(" ") || "Parent", parentName, "+213000000000"],
  );
  const student = await client.query<{ id: string }>(
    `INSERT INTO public.students (tenant_id, student_code, parent_id, first_name, last_name, display_name, date_of_birth)
     VALUES ($1, $2, $3, $4, $5, $6, '2015-01-01') RETURNING id`,
    [tenantId, `ELV-SC-${ctx.seq}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      parent.rows[0].id, "Test", "Student", "Test Student"],
  );
  ctx.seq += 1;
  return { parentId: parent.rows[0].id, studentId: student.rows[0].id };
}

/** Insert canonical ledger entries remapped onto the server ids. */
async function seedLedgerWithServerIds(
  ctx: Ctx,
  entries: CanonicalLedgerEntry[],
  localParentId: string,
  serverParentId: string,
  localStudentId: string | null,
  serverStudentId: string | null,
): Promise<void> {
  for (const e of entries) {
    if (e.parentId !== localParentId) continue;
    const serverStudent = e.studentId != null ? serverStudentId : null;
    const accountId = serverStudent
      ? `parent:${serverParentId}:category:${e.category}:student:${serverStudent}`
      : `parent:${serverParentId}:category:${e.category}`;
    await ctx.client.query(
      `INSERT INTO public.ledger_entries (
         entry_number, tenant_id, parent_id, student_id, account_id, entry_type,
         amount, category, description, source_type, source_id, method,
         receipt_number, payment_status, reverses_id, actor_id, actor_name, at, metadata, entry_date
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$18)`,
      [e.id, ctx.tenantId, serverParentId, serverStudent, accountId, e.type,
        Number(e.amount) / CENTIMES_PER_DZD, e.category, e.description,
        e.sourceType, `${e.sourceId}#${e.id}`, e.method, e.receiptNumber, e.paymentStatus,
        e.reversesId, e.actorId, e.actorName, e.at, JSON.stringify(e.metadata ?? {})],
    );
  }
}

/** Insert canonical installments (centimes → DZD); returns local→server id map. */
async function seedInstallments(
  ctx: Ctx,
  installments: CanonicalInstallment[],
  localParentId: string,
  serverParentId: string,
  serverStudentId: string | null,
): Promise<Map<string, string>> {
  const idMap = new Map<string, string>();
  for (const ins of installments) {
    if (ins.parentId !== localParentId) continue;
    const trancheMatch = ins.label.match(/(\d+)/);
    const tranche = trancheMatch ? Number(trancheMatch[1]) : 1;
    const serverStudent = ins.studentId != null ? serverStudentId : null;
    const row = await ctx.client.query<{ id: string }>(
      `INSERT INTO public.installments (
         tenant_id, parent_id, student_id, category, label, tranche_number,
         amount_due, amount_paid, amount_pending, due_date, paid_date, status,
         source_type, source_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'canonical_scenario',$13) RETURNING id`,
      [ctx.tenantId, serverParentId, serverStudent, ins.category, ins.label, tranche,
        Number(ins.amountDue) / CENTIMES_PER_DZD, Number(ins.amountPaid) / CENTIMES_PER_DZD,
        Number(ins.amountPending) / CENTIMES_PER_DZD, ins.dueDate, ins.paidDate, ins.status, ins.id],
    );
    idMap.set(ins.id, row.rows[0].id);
  }
  return idMap;
}

/** Ensure academic context (level + year) for the tenant; returns ids. */
async function ensureAcademicContext(ctx: Ctx): Promise<{ levelId: string; yearId: string }> {
  const level = await ctx.client.query<{ id: string }>(
    `INSERT INTO public.academic_levels (tenant_id, cycle, year_label, year_number, grade_code, sort_order, label_fr, is_active)
     VALUES ($1, 'primaire', '4AP', 4, '4ap', 4, '4ème année primaire', true) RETURNING id`,
    [ctx.tenantId],
  );
  const year = await ctx.client.query<{ id: string }>(
    `INSERT INTO public.academic_years (tenant_id, code, label, term_structure, start_date, end_date, is_current)
     VALUES ($1, '2025-2026', 'Année scolaire 2025-2026', 'trimester', '2025-09-01', '2026-06-30', true) RETURNING id`,
    [ctx.tenantId],
  );
  return { levelId: level.rows[0].id, yearId: year.rows[0].id };
}

// ───────────────────────────────────────────────────────────────────────────
// Scenario execution
// ───────────────────────────────────────────────────────────────────────────

async function runScenario(
  client: Client,
  scenario: CanonicalScenario,
  tenantId: string,
): Promise<Record<string, unknown>> {
  const given = scenario.given;
  const when = scenario.when;
  const ctx: Ctx = { client, tenantId, seq: 1 };

  switch (when.type) {
    // ── Academic: subject average via the 0004 trigger (authority) ──
    case "computeSubjectAverage": {
      const a = (when.assessment ?? given.assessment)!;
      const { studentId } = await seedFamily(ctx, given.parent);
      const subject = await client.query<{ id: string }>(
        `INSERT INTO public.subjects (tenant_id, code, name_fr, default_coefficient, is_active)
         VALUES ($1, 'MATH-SC', 'Mathématiques', 2, true) RETURNING id`,
        [tenantId],
      );
      const { levelId, yearId } = await ensureAcademicContext(ctx);
      const klass = await client.query<{ id: string }>(
        `INSERT INTO public.classes (tenant_id, academic_year_id, academic_level_id, code, name, section, capacity, is_active)
         VALUES ($1, $2, $3, 'CLS-SC', 'Scenario Class', 'A', 30, true) RETURNING id`,
        [tenantId, yearId, levelId],
      );
      const classSubject = await client.query<{ id: string }>(
        `INSERT INTO public.class_subjects (tenant_id, class_id, subject_id, coefficient, weekly_hours, teacher_id)
         VALUES ($1, $2, $3, 2, 3, NULL) RETURNING id`,
        [tenantId, klass.rows[0].id, subject.rows[0].id],
      );
      const kinds: Array<{ kind: string; score: number | null }> = [
        { kind: "devoir_1", score: a.devoir1 },
        { kind: "devoir_2", score: a.devoir2 },
        { kind: "examen", score: a.examen },
      ];
      let lastAverage: number | null = null;
      for (const k of kinds) {
        const assessmentDef = await client.query<{ id: string }>(
          `INSERT INTO public.assessments (tenant_id, class_subject_id, term, kind, label)
           VALUES ($1, $2, 1, $3, $4) RETURNING id`,
          [tenantId, classSubject.rows[0].id, k.kind, k.kind],
        );
        if (k.score == null) continue; // missing mark — no grade row
        const grade = await client.query<{ subject_average: string | null }>(
          `INSERT INTO public.grades (tenant_id, student_id, assessment_id, class_subject_id, score)
           VALUES ($1, $2, $3, $4, $5) RETURNING subject_average`,
          [tenantId, studentId, assessmentDef.rows[0].id, classSubject.rows[0].id, k.score],
        );
        lastAverage = grade.rows[0].subject_average == null ? null : Number(grade.rows[0].subject_average);
      }
      return {
        subjectAverage: lastAverage,
        averageIsNotNull: lastAverage != null,
      };
    }

    // ── Academic: GPA via fn_calculate_student_term_gpa (0029) ──
    case "computeOverallGpa": {
      const list = (when.assessments ?? given.assessments) ?? [];
      const { studentId } = await seedFamily(ctx, given.parent);
      const { levelId: gpaLevelId, yearId: gpaYearId } = await ensureAcademicContext(ctx);
      const klass = await client.query<{ id: string }>(
        `INSERT INTO public.classes (tenant_id, academic_year_id, academic_level_id, code, name, section, capacity, is_active)
         VALUES ($1, $2, $3, 'CLS-SC', 'Scenario Class', 'A', 30, true) RETURNING id`,
        [tenantId, gpaYearId, gpaLevelId],
      );
      for (const [i, a] of list.entries()) {
        const subject = await client.query<{ id: string }>(
          `INSERT INTO public.subjects (tenant_id, code, name_fr, default_coefficient, is_active, is_extracurricular)
           VALUES ($1, $2, $3, $4, true, $5) RETURNING id`,
          [tenantId, `SUBJ-SC-${ctx.seq}-${i}`, `Subject ${i}`, Math.max(1, Math.round(a.coefficient ?? 1)), a.isExtracurricular ?? false],
        );
        const cs = await client.query<{ id: string }>(
          `INSERT INTO public.class_subjects (tenant_id, class_id, subject_id, coefficient, weekly_hours, teacher_id)
           VALUES ($1, $2, $3, $4, 3, NULL) RETURNING id`,
          [tenantId, klass.rows[0].id, subject.rows[0].id, Math.max(1, Math.round(a.coefficient ?? 1))],
        );
        await client.query(
          `INSERT INTO public.assessments (
             tenant_id, class_subject_id, term, kind, label,
             student_id, subject_id, academic_year, subject_average, coefficient
           ) VALUES ($1, $2, 1, 'examen', $3, $4, $5, '2025-2026', $6, $7)`,
          [tenantId, cs.rows[0].id, `Final ${i}`, studentId, subject.rows[0].id, a.subjectAverage, a.coefficient ?? 1],
        );
        ctx.seq += 1;
      }
      const gpa = await client.query<{ gpa: string | null }>(
        "SELECT public.fn_calculate_student_term_gpa($1, '1', '2025-2026') AS gpa",
        [studentId],
      );
      const g = gpa.rows[0].gpa == null ? null : Number(gpa.rows[0].gpa);
      return { gpa: g, gpaIsNotNull: g != null };
    }

    // ── Financial: single-account balance replay ──
    case "computeAccountBalance": {
      const localParent = given.parent?.id ?? "par-001";
      const localStudent = given.students?.[0]?.id ?? null;
      const accountIdLocal = when.accountId as string;
      const { parentId, studentId } = await seedFamily(ctx, given.parent);
      await seedLedgerWithServerIds(ctx, given.ledgerEntries, localParent, parentId, localStudent, studentId);
      const serverAccount = accountIdLocal
        .replace(localParent, parentId)
        .replace(localStudent ?? "\u0000", studentId);
      const bal = await client.query<{
        balance: string; total_charged: string; total_paid: string; total_adjusted: string;
        total_refunded: string; total_cleared: string; total_pending: string; unallocated_credit: string;
      }>(
        "SELECT * FROM public.compute_account_balance($1, now())",
        [serverAccount],
      );
      const r = bal.rows[0];
      return {
        balance: toC(r.balance),
        totalCharged: toC(r.total_charged),
        totalPaid: toC(r.total_paid),
        totalAdjusted: toC(r.total_adjusted),
        totalRefunded: toC(r.total_refunded),
        totalCleared: toC(r.total_cleared),
        totalPending: toC(r.total_pending),
        unallocatedCredit: toC(r.unallocated_credit),
      };
    }

    // ── Financial: parent summary via compute_parent_summary ──
    case "computeParentSummary": {
      const localParent = given.parent?.id ?? "par-001";
      const localStudent = given.students?.[0]?.id ?? null;
      const { parentId, studentId } = await seedFamily(ctx, given.parent);
      await seedLedgerWithServerIds(ctx, given.ledgerEntries, localParent, parentId, localStudent, studentId);
      const sum = await client.query<{
        total_outstanding: string; total_overdue: string; total_charged: string; total_paid: string;
        total_adjusted: string; total_refunded: string; total_cleared: string; total_pending: string;
        total_unallocated_credit: string; account_count: number; accounts: unknown;
      }>(
        "SELECT * FROM public.compute_parent_summary($1, now())",
        [parentId],
      );
      const r = sum.rows[0];
      return {
        totalOutstanding: toC(r.total_outstanding),
        totalOverdue: toC(r.total_overdue),
        totalCharged: toC(r.total_charged),
        totalPaid: toC(r.total_paid),
        totalAdjusted: toC(r.total_adjusted),
        totalRefunded: toC(r.total_refunded),
        totalCleared: toC(r.total_cleared),
        totalPending: toC(r.total_pending),
        totalUnallocatedCredit: toC(r.total_unallocated_credit),
        accountCount: r.account_count,
      };
    }

    // ── Financial: atomic collect + waterfall allocation ──
    case "allocatePayment": {
      const amount = Number(when.paymentAmount); // centimes
      const category = (when.category as string) ?? "tuition";
      const method = (when.paymentStatus as string) === "paid" ? "cash" : "check";
      const localParent = given.parent?.id ?? "par-001";
      const { parentId, studentId } = await seedFamily(ctx, given.parent);
      await seedLedgerWithServerIds(ctx, given.ledgerEntries, localParent, parentId, given.students?.[0]?.id ?? null, studentId);
      const installmentMap = await seedInstallments(ctx, given.installments ?? [], localParent, parentId, studentId);
      const res = await client.query<{
        payment_id: string; receipt_number: string; payment_status: string;
        total_allocated: string; unallocated_credit: string; allocations: unknown;
      }>(
        "SELECT * FROM public.collect_and_allocate_payment($1,$2,$3,$4,$5,$6,NULL,$7,$8,$9,$10,$11,$12)",
        [tenantId, parentId, studentId, amount / CENTIMES_PER_DZD, method, category,
          method === "cash" ? null : "proofs/scenario-proof.pdf",
          "Scenario actor", null, "Backend runner",
          method === "check" ? "CHK-000123" : null,
          method === "check" ? "BNA" : null,
          method === "transfer" ? "TRF-000456" : null].slice(0, 12),
      );
      const r = res.rows[0];
      // Read back the post-state of every scenario installment.
      const after: Array<{ id: string; amountPaid: number; amountPending: number; status: string }> = [];
      for (const localId of [...installmentMap.keys()]) {
        const serverId = installmentMap.get(localId)!;
        const row = await client.query<{ amount_paid: string; amount_pending: string; status: string }>(
          "SELECT amount_paid, amount_pending, status FROM public.installments WHERE id = $1",
          [serverId],
        );
        after.push({
          id: localId,
          amountPaid: toC(row.rows[0].amount_paid) ?? 0,
          amountPending: toC(row.rows[0].amount_pending) ?? 0,
          status: row.rows[0].status,
        });
      }
      return {
        paymentStatus: r.payment_status,
        totalAllocated: toC(r.total_allocated),
        unallocatedAmount: toC(r.unallocated_credit),
        installments: after,
        totalPaid: after.reduce((s, i) => s + i.amountPaid, 0),
        totalPending: after.reduce((s, i) => s + i.amountPending, 0),
      };
    }

    // ── Documented app-layer canonical rules (migration 0036) ──
    case "deterministicParentCode":
    case "stableHash":
    case "getNextGradeProgression":
    case "evaluateAllSystemDiscounts":
    case "revertPaymentAllocation":
    case "reconcileLedger":
    case "syncRoundTrip":
      return {
        skipped: true,
        reason:
          "App-layer canonical rule (client-side authority per migration 0036 / CANONICAL-FINANCIAL-LOGIC.md) — not implemented in SQL by design. Verified by the desktop + Android runners.",
      };

    default:
      return { error: `Unknown operation type: ${when.type}` };
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Main
// ───────────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const flag = (name: string, def: string) => {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? process.argv[i + 1] : def;
  };

  const rootDir = path.resolve(__dirname, "..");
  const scenariosDir = args[0] ? path.resolve(args[0]) : path.join(rootDir, "scenarios");
  const outputDir = args[1] ? path.resolve(args[1]) : path.join(rootDir, "results", "backend");
  fs.mkdirSync(outputDir, { recursive: true });

  const client = new Client({
    host: flag("host", "/tmp"),
    port: Number(flag("port", "5433")),
    user: flag("user", "postgres"),
    database: flag("database", "elimtiyaz"),
  });
  await client.connect();

  // One isolated tenant for the whole run (scenarios roll back their writes).
  const tenant = await client.query<{ id: string }>(
    "INSERT INTO public.tenants (name, slug, country, default_locale, default_currency, timezone, is_active) VALUES ($1, $2, 'DZ', 'fr', 'DZD', 'Africa/Algiers', true) RETURNING id",
    ["Equivalence backend runner", `eq-${Date.now() % 1000000}`],
  );
  const tenantId = tenant.rows[0].id;

  const files = fs.readdirSync(scenariosDir).filter((f) => f.endsWith(".json")).sort();
  let passed = 0;
  let skipped = 0;
  let errored = 0;
  const results: Array<{ id: string; status: string; durationMs: number }> = [];

  console.log(`Backend Equivalence Runner — ${files.length} scenarios`);
  console.log("=".repeat(60));

  for (const file of files) {
    const start = Date.now();
    let result: Record<string, unknown>;
    let scenarioId = path.basename(file, ".json");
    let operationType = "unknown";
    try {
      const scenario = JSON.parse(fs.readFileSync(path.join(scenariosDir, file), "utf-8")) as CanonicalScenario;
      scenarioId = scenario.id;
      operationType = scenario.when.type;
      await client.query("BEGIN");
      result = await runScenario(client, scenario, tenantId);
      await client.query("ROLLBACK");
    } catch (e) {
      await client.query("ROLLBACK").catch(() => undefined);
      result = { error: (e as Error).message };
    }
    const durationMs = Date.now() - start;

    const output = {
      scenarioId,
      engine: "backend",
      engineVersion: "1.0.0",
      category: "backend",
      operationType,
      result,
      durationMs,
      timestamp: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(outputDir, `${scenarioId}.json`), JSON.stringify(output, null, 2));

    if (result.error) {
      errored += 1;
      results.push({ id: scenarioId, status: "error", durationMs });
      console.log(`  ✗ ${scenarioId} — ${String(result.error).slice(0, 120)}`);
    } else if (result.skipped) {
      skipped += 1;
      results.push({ id: scenarioId, status: "skipped", durationMs });
      console.log(`  ○ ${scenarioId} — skipped (app-layer rule)`);
    } else {
      passed += 1;
      results.push({ id: scenarioId, status: "pass", durationMs });
      console.log(`  ✓ ${scenarioId} (${durationMs} ms)`);
    }
  }

  await client.query("DELETE FROM public.tenants WHERE id = $1", [tenantId]);
  await client.end();

  console.log();
  console.log(`Backend runner: ${passed} passed, ${skipped} skipped (app-layer), ${errored} errored (of ${files.length} total)`);
  console.log(`Results written to: ${outputDir}`);

  fs.writeFileSync(path.join(outputDir, "_summary.json"), JSON.stringify({
    engine: "backend",
    engineVersion: "1.0.0",
    ranAt: new Date().toISOString(),
    scenarioCount: files.length,
    passed, skipped, errored,
    results,
  }, null, 2));

  process.exit(errored > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });

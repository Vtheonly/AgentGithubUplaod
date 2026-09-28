/**
 * t-434-wave-reconciliation-probe.ts — READ-ONLY live verification of the
 * owner's two wave-card questions (the 113th session, T-434):
 *
 *   Q1: "Why is Finance showing 75 % for the first tranche while Statistics
 *       is showing 77 %?" — the two surfaces' ACTUAL rendered numbers over
 *       the live rows, on their documented bases (the Statistics card
 *       isolates scolarité; the Finance strip pools every category).
 *   Q2: "Why is the first tranche showing red — is it not due yet?" — the
 *       live due dates + the phase each wave card derives.
 *
 * The probe imports the REAL derivations (the same modules the app renders
 * through — executive-statistics.ts's deriveTrancheWaves for the Statistics
 * card, installment-schedule-tab.tsx's deriveTrancheWaves for the Finance
 * strip) and runs them over the REAL live collection (the service-role REST
 * client, keyset-paginated, zero writes — the t-425 probe convention).
 *
 * The headless shims (localStorage + window.localStorage, the t-433 driver
 * convention) let the tab module's provider import chain evaluate under
 * Node; nothing renders and no provider call executes.
 *
 * Exit code 0 = the invariants hold; 1 = a violation (fail-loud).
 */
import { createClient } from "@supabase/supabase-js";
import { deriveTrancheWaveStats } from "../src/domain/calc/payment/tranche-waves";
import type { Installment, PaymentCategory } from "../src/domain/model/payment";

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const SUPABASE_URL = process.env.SUPABASE_URL ?? "https://vebfehrpzajhstyhinnw.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const out = (...a: unknown[]) => console.log(...a);
const dzd = (n: number) => new Intl.NumberFormat("fr-DZ").format(Math.round(n));

/** The repo's mapInstallmentRow (supabase-shared-repositories.ts:4009) — verbatim semantics. */
function mapInstallmentRow(r: Record<string, unknown>): Installment {
  const n = r.tranche_number as number | null;
  return {
    id: r.id as string,
    parentId: r.parent_id as string,
    studentId: (r.student_id ?? null) as string | null,
    category: ((r.category ?? "tuition") as PaymentCategory),
    label: (r.label ?? `Tranche ${r.tranche_number}`) as string,
    trancheNumber: n === 0 || n === 1 || n === 2 || n === 3 ? n : undefined,
    amountDue: Number(r.amount_due ?? 0),
    amountPaid: Number(r.amount_paid ?? 0),
    amountPending: Number(r.amount_pending ?? 0),
    dueDate: (r.due_date ?? new Date().toISOString()) as string,
    paidDate: (r.paid_date ?? null) as string | null,
    status: (r.status ?? "unpaid") as Installment["status"],
    academicCycle: (r.academic_cycle ?? undefined) as Installment["academicCycle"],
    paymentPlan: (r.payment_plan ?? "tranches") as Installment["paymentPlan"],
    isCustomSchedule: Boolean(r.is_custom_schedule),
    customScheduleNote: (r.custom_schedule_note ?? null) as string | null,
    customSchedule: Boolean(r.is_custom_schedule),
  } as Installment;
}

async function main(): Promise<void> {
  if (!SERVICE_KEY) {
    console.error("FATAL: SUPABASE_SERVICE_KEY env var required (service role)");
    process.exit(1);
  }

  // ── The headless shims (BEFORE the provider-chain imports evaluate) ──
  const memStore = new Map<string, string>();
  const localStorageShim = {
    getItem: (k: string) => memStore.get(k) ?? null,
    setItem: (k: string, v: string) => void memStore.set(k, v),
    removeItem: (k: string) => void memStore.delete(k),
    clear: () => void memStore.clear(),
  };
  (globalThis as Record<string, unknown>).localStorage = localStorageShim;
  // A REAL EventTarget (CacheFreshness subscribes window listeners at
  // repository-construction time inside the provider's import chain).
  (globalThis as Record<string, unknown>).window = Object.assign(new EventTarget(), {
    localStorage: localStorageShim,
  });

  // The REAL surface derivations (dynamic — after the shims).
  const { deriveTrancheWaves: deriveStatisticsWaves } = await import(
    "../src/features/dashboard/components/analytics/executive-statistics"
  );
  const { deriveTrancheWaves: deriveFinanceStrip } = await import(
    "../src/features/financials/installment-schedule-tab"
  );

  const db = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ── 1. The live collection (keyset-paginated, the t-425 convention) ──
  const all: Record<string, unknown>[] = [];
  let lastId = "";
  for (;;) {
    let q = db
      .from("installments")
      .select(
        "id, parent_id, student_id, category, tranche_number, label, amount_due, amount_paid, amount_pending, due_date, paid_date, status, academic_cycle, payment_plan, is_custom_schedule, custom_schedule_note",
      )
      .eq("tenant_id", TENANT_ID)
      .order("id", { ascending: true })
      .limit(1000);
    if (lastId) q = q.gt("id", lastId);
    const { data, error } = await q;
    if (error) {
      console.error("installments read failed:", error.message);
      process.exit(1);
    }
    all.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
    lastId = (data as Record<string, unknown>[])[data.length - 1].id as string;
  }
  const rows = all.map(mapInstallmentRow);
  out(`=== T-434 — the live wave-card reconciliation (READ-ONLY) ===`);
  out(`live installments: ${rows.length} rows (tenant ${TENANT_ID})`);
  out(`probe now: ${new Date().toISOString()}\n`);

  // ── 2. Q1 — the Statistics surface (scolarité isolée) ──
  const statisticsWaves = deriveStatisticsWaves(rows, Date.now());
  const tuitionWaves = statisticsWaves.filter((w) => w.category === "tuition");
  out("--- STATISTICS (Vélocité par Vague — scolarité isolée) ---");
  for (const w of tuitionWaves) {
    out(
      `  Tranche ${w.wave}: ${w.collectedPct}% collecté (amount basis) · ${w.clearedPct}% soldée (count basis)` +
        ` · ${w.paidCount}/${w.installmentCount} dossiers` +
        ` · phase=${w.phase} · dueDate=${w.dueDate ?? "n/a"}` +
        ` · Familles en retard=${w.overdueDebtorFamilyCount}/${w.familyCount}` +
        ` · Reste dû=${dzd(w.remainingTotal)} (facturé ${dzd(w.dueTotal)}, encaissé ${dzd(w.paidTotal)})`,
    );
  }

  // ── 3. Q1 — the Finance surface (toutes catégories confondues) ──
  const financeStrip = deriveFinanceStrip(rows);
  out("\n--- FINANCE (Tranches strip — toutes catégories confondues) ---");
  for (const w of financeStrip) {
    out(
      `  Tranche ${w.index}: ${w.pct}% (pooled) · dont scolarité : ${w.tuitionPct ?? "n/a"}%` +
        ` · isNextTarget=${w.isNextTarget}` +
        ` · Encaissé=${dzd(w.paid)} / Dû=${dzd(w.due)}`,
    );
  }

  // ── 4. Q2 — the phases against the live due dates ──
  const stats = deriveTrancheWaveStats(rows, Date.now());
  out("\n--- THE LIVE DUE DATES (every wave, both categories) ---");
  for (const s of stats) {
    const due = s.dueDateMin !== null ? new Date(s.dueDateMin).toISOString().slice(0, 10) : "n/a";
    out(
      `  ${s.category} Tranche ${s.wave}: due ${due} · anyUnsettledOverdue=${s.anyUnsettledOverdue}` +
        ` · anyUnsettledFuture=${s.anyUnsettledFuture} · overdueFamilies=${s.overdueDebtorFamilyCount}`,
    );
  }

  // ── 5. The invariants (fail-loud) ──
  out("\n--- THE INVARIANTS ---");
  const failures: string[] = [];

  // I1: the reconciliation — the Statistics tuition rate is character-identical
  //     to the Finance strip's "dont scolarité" line for the same wave.
  for (const w of tuitionWaves) {
    const strip = financeStrip.find((f) => f.index === w.wave);
    if (!strip) {
      failures.push(`wave ${w.wave}: absent from the Finance strip`);
      continue;
    }
    if (strip.tuitionPct !== w.collectedPct) {
      failures.push(
        `wave ${w.wave}: the strip's tuitionPct (${strip.tuitionPct}) != the Statistics collectedPct (${w.collectedPct})`,
      );
    }
  }

  // I2: the two surfaces' T1 numbers are the two DIFFERENT bases over the
  //     same canonical rows (pooled vs tuition-isolated — the very
  //     difference the owner is asking about).
  const stripT1 = financeStrip.find((f) => f.index === 1);
  const statsT1 = tuitionWaves.find((w) => w.wave === 1);
  if (!stripT1 || !statsT1) {
    failures.push("T1 missing from a surface");
  } else {
    out(
      `  I2: Finance T1 (pooled) = ${stripT1.pct}% vs Statistics T1 (scolarité) = ${statsT1.collectedPct}%` +
        ` — different bases by design (reconciled by the "dont scolarité" line)`,
    );
  }

  // I3: Q2 — the T1 phase is overdue BECAUSE its live due date is past and
  //     unpaid rows remain; T2/T3 are not_due (their due dates are future).
  const phaseOf = (n: number) => tuitionWaves.find((w) => w.wave === n)?.phase ?? "absent";
  out(
    `  I3: T1 phase=${phaseOf(1)} (due ${statsT1?.dueDate?.slice(0, 10)}) · ` +
      `T2 phase=${phaseOf(2)} · T3 phase=${phaseOf(3)}`,
  );
  if (statsT1 && statsT1.phase !== "overdue") {
    failures.push(`T1 phase expected overdue (due ${statsT1.dueDate}), got ${statsT1.phase}`);
  }
  if (statsT1 && statsT1.dueDate && new Date(statsT1.dueDate).getTime() >= Date.now()) {
    failures.push(`T1 due date ${statsT1.dueDate} is NOT past — the red would be wrong (investigate!)`);
  }
  for (const n of [2, 3] as const) {
    const w = tuitionWaves.find((x) => x.wave === n);
    if (w && w.remainingTotal > 0 && w.phase !== "not_due") {
      failures.push(`T${n} phase expected not_due, got ${w.phase}`);
    }
  }

  if (failures.length > 0) {
    out("\nFAILURES:");
    for (const f of failures) out(`  ✗ ${f}`);
    process.exit(1);
  }
  out("\nALL INVARIANTS GREEN — the two surfaces reconcile; the phases match the live due dates.");
}

main().catch((e) => {
  console.error("probe crashed:", e);
  process.exit(1);
});

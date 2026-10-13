/**
 * t529-diagnostics-purpose-probe.ts — the LIVE read-only forensics for the
 * owner's 173rd-session critique on the « Diagnostic Webhooks » engine:
 *
 *   (1) The re-pasted finding card « Facture liée à une échéance
 *       introuvable / Conflit confirmé / MERSEL MERSELFARes / 365 000 DA »
 *       (entry e8afa61f-3f75-4a18-bde1-40900f219057 / reg-ELV-2026-0CF277-t1)
 *       — is it STILL produced by the CURRENT (T-528-fixed) engine, or is
 *       the card from a PRE-FIX build? WHO is « MERSEL MERSELFARes »?
 *   (2) The all-origins mandate: what charge source-identity forms exist on
 *       the real books (PK / reg-identity / manual stems / other), and does
 *       any form escape the resolver?
 *   (3) The diagnostics-purpose mandate: the configured-price checks —
 *       the owner's example: an ENCAISSEMENT of 25,000 DZD for FI while the
 *       CONFIGURED registration fee is 5,000 DZD. What do the FI payments
 *       actually carry, what does the live pricing config say, and does the
 *       current engine see ANY of it?
 *
 * READ-ONLY: zero writes. Sign-in through the app's OWN client (admin),
 * the t511 warm-up seam, the CURRENT engine, SELECT-only censuses.
 *
 * Usage:
 *   npx tsx scripts/t529-diagnostics-purpose-probe.ts
 */
import * as process from "node:process";

// ── Environment shims — BEFORE any src import ──────────────────────────────
import "fake-indexeddb/auto";

const memStore = new Map<string, string>();
const localStorageShim = {
  getItem: (k: string) => memStore.get(k) ?? null,
  setItem: (k: string, v: string) => void memStore.set(k, String(v)),
  removeItem: (k: string) => void memStore.delete(k),
  clear: () => memStore.clear(),
  key: (i: number) => [...memStore.keys()][i] ?? null,
  get length() { return memStore.size; },
};
(globalThis as Record<string, unknown>).localStorage = localStorageShim;
(globalThis as Record<string, unknown>).window = {
  localStorage: localStorageShim,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  dispatchEvent: () => true,
};

// ── Constants ───────────────────────────────────────────────────────────────
const SUPABASE_URL = "https://vebfehrpzajhstyhinnw.supabase.co";
const PUBLISHABLE_KEY = "sb_publishable_IPUtQMYQzr1wNnfGTcl5MA_wuz3RUdg";
const ADMIN_EMAIL = process.env.T511_ADMIN_EMAIL ?? "admin@elimtiyaz.dz";
const ADMIN_PASSWORD = process.env.T511_ADMIN_PASSWORD ?? "elimtiyaz@admin2026";
const REPORTED_ENTRY = "e8afa61f-3f75-4a18-bde1-40900f219057";
const REPORTED_PARENT = "e3506a7c-8bb9-4d5d-b668-3477a90de1d9";

const TAG = `t529-${Date.now().toString(36)}`;
const log = (...a: unknown[]) => console.log(`[${TAG}]`, ...a);

function banner(t: string): void {
  console.log(`\n${"=".repeat(78)}\n  ${t}\n${"=".repeat(78)}`);
}

async function main(): Promise<void> {
  const { getSupabaseRepositories } = await import(
    "../src/infrastructure/supabase/supabase-repositories"
  );
  const { runWebhookDiagnostics } = await import(
    "../src/domain/calc/payment/webhook-diagnostics"
  );
  const { warmExportSources } = await import("../src/infrastructure/export/export-warmup");

  // ── Sign-in through the app's OWN client ────────────────────────────────
  localStorageShim.setItem(
    "el-imtiyaz.local-config",
    JSON.stringify({ supabase_url: SUPABASE_URL, supabase_anon_key: PUBLISHABLE_KEY, supabase_use_supabase: true }),
  );
  const { getSupabaseClient } = await import("../src/infrastructure/supabase/supabase-client");
  const client = getSupabaseClient();
  const signIn = await client.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  if (signIn.error || !signIn.data?.user) {
    throw new Error(`app-client sign-in failed: ${signIn.error?.message ?? "no user"}`);
  }
  const actorId = signIn.data.user.id;
  log("admin sign-in OK:", signIn.data.user.email ?? "");

  localStorageShim.setItem(
    "el-imtiyaz.session",
    JSON.stringify({
      userId: actorId,
      tenantId: "00000000-0000-0000-0000-000000000001",
      email: signIn.data.user.email,
      displayName: "T529 Probe",
      role: "super_admin",
      permissions: [],
      accessToken: "probe",
      refreshToken: "probe",
      expiresAt: Date.now() + 3600_000,
      locale: "fr",
    }),
  );

  // ── Warm ALL the audit's sources (incl. the pricing config) ────────────
  const repos = getSupabaseRepositories();
  const warmup = await warmExportSources(repos as never);
  const allocationsObs = repos.payments.observeAllocations?.();
  await new Promise((resolve) => setTimeout(resolve, 2500));
  const payments = repos.payments.observe().get();
  const installments = repos.installments.observe().get();
  const ledgerEntries = repos.ledger.observe().get();
  const debtSummaries = repos.debt.observeSummary().get();
  const parents = repos.parents.observe().get();
  const students = repos.students.observe().get();
  const allocations = allocationsObs ? allocationsObs.get() : [];
  const pricing = repos.pricing.observe().get();
  log(
    `streams: parents=${parents.length} students=${students.length} payments=${payments.length} ` +
    `installments=${installments.length} ledger=${ledgerEntries.length} debtSummaries=${debtSummaries.length} allocations=${allocations.length}`,
  );
  log("warmup:", warmup.map((w) => `${w.source}:${w.status}`).join(" "));

  /* ====================================================================== */
  banner("Q1. The CURRENT-engine verdict on the re-pasted finding (e8afa61f)");
  /* ====================================================================== */
  const report = runWebhookDiagnostics({
    payments, installments, ledgerEntries, allocations, debtSummaries, parents, students,
  });
  log("engine counts:", JSON.stringify(report.counts));
  const dangling = report.findings.find(
    (f) => f.id === `confirmed_mismatch:charge-dangling:${REPORTED_ENTRY}`,
  );
  const resolved = report.findings.find(
    (f) => f.id === `reconciled:charge-reg-resolved:${REPORTED_ENTRY}`,
  );
  log("Q1a dangling finding for e8afa61f:", dangling ? `PRESENT — ${dangling.title}` : "ABSENT");
  log("Q1b reg-resolved finding for e8afa61f:", resolved ? `PRESENT — ${resolved.title}` : "ABSENT");
  const allDangling = report.findings.filter((f) => f.id.startsWith("confirmed_mismatch:charge-dangling:"));
  log("Q1c global charge-dangling findings:", allDangling.length,
    allDangling.map((f) => `${f.id.split(":")[2]} (${f.amount} DZD)`).join(" · "));

  /* ====================================================================== */
  banner("Q2. WHO is « MERSEL MERSELFARes »? (the re-pasted card's family)");
  /* ====================================================================== */
  const entry = ledgerEntries.find((e) => e.id === REPORTED_ENTRY);
  if (entry) {
    log("Q2a the entry:", JSON.stringify({
      id: entry.id, type: entry.type, sourceType: entry.sourceType, sourceId: entry.sourceId,
      parentId: entry.parentId, studentId: entry.studentId, amount: entry.amount,
      category: entry.category, description: entry.description, at: entry.at,
    }));
  } else {
    log("Q2a the entry e8afa61f NOT in the ledger stream!");
  }
  const parent = parents.find((p) => p.id === (entry?.parentId ?? REPORTED_PARENT));
  if (parent) {
    const { parentDisplayName } = await import("../src/domain/model/parent");
    log("Q2b the parent record:", JSON.stringify({
      id: parent.id, code: (parent as { code?: string }).code,
      firstName: parent.firstName, lastName: parent.lastName,
      displayName: parent.displayName, computedDisplay: parentDisplayName(parent),
      createdAt: parent.createdAt,
    }));
  } else {
    log(`Q2b parent ${entry?.parentId ?? REPORTED_PARENT} NOT in the parents stream`);
  }
  const regTokenStudent = students.find((s) => s.code === "ELV-2026-0CF277");
  log("Q2c student ELV-2026-0CF277:", regTokenStudent
    ? JSON.stringify({ id: regTokenStudent.id, code: regTokenStudent.code, name: `${regTokenStudent.firstName} ${regTokenStudent.lastName}`, grade: regTokenStudent.gradeLevel, parentId: regTokenStudent.parentId })
    : "NOT FOUND by code");
  // Any parent whose name contains MERSEL?
  const merselParents = parents.filter((p) =>
    `${p.firstName ?? ""} ${p.lastName ?? ""} ${p.displayName ?? ""}`.toUpperCase().includes("MERSEL"));
  log("Q2d parents matching MERSEL:", merselParents.length,
    merselParents.map((p) => `${p.id} · ${(p as { code?: string }).code} · ${p.firstName} ${p.lastName} (${p.displayName})`).join(" | "));

  /* ====================================================================== */
  banner("Q3. The charge source-identity forms census (the all-origins question)");
  /* ====================================================================== */
  const forms = new Map<string, { count: number; sample: string[]; total: number }>();
  for (const e of ledgerEntries) {
    if (e.type !== "charge") continue;
    let form: string;
    if (e.sourceType === "installment") {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(e.sourceId);
      const isReg = /^reg-/.test(e.sourceId);
      form = isUuid ? "installment-pk" : isReg ? "installment-reg-identity" : `installment-OTHER:${e.sourceId.slice(0, 30)}`;
    } else {
      form = `charge-source:${e.sourceType}`;
    }
    const f = forms.get(form) ?? { count: 0, sample: [], total: 0 };
    f.count += 1; f.total += e.amount;
    if (f.sample.length < 3) f.sample.push(`${e.id.slice(0, 13)}… src=${e.sourceId.slice(0, 44)} ${e.amount} DZD`);
    forms.set(form, f);
  }
  for (const [form, f] of [...forms.entries()].sort((a, b) => b[1].count - a[1].count)) {
    log(`Q3 ${form}: ${f.count} charges · ${f.total.toLocaleString("fr-FR")} DZD`);
    for (const s of f.sample) log(`     · ${s}`);
  }

  /* ====================================================================== */
  banner("Q4. The live PRICING CONFIG (the configured prices)");
  /* ====================================================================== */
  if (pricing) {
    log("Q4a registrationFee (flat, family):", pricing.registrationFee, "DZD");
    log("Q4b registrationFeeByGrade (per-student):");
    for (const [grade, fee] of Object.entries(pricing.registrationFeeByGrade ?? {})) {
      log(`     ${grade}: ${fee}`);
    }
    log("Q4c tuitionByGradeLevel (annuals):");
    for (const [grade, t] of Object.entries(pricing.tuitionByGradeLevel ?? {})) {
      log(`     ${grade}: annual=${(t as { annualAmount: number }).annualAmount} installments=${JSON.stringify((t as { installments: unknown }).installments)}`);
    }
    log("Q4d additionalServices:", JSON.stringify((pricing.additionalServices ?? []).map((s) => `${s.qualifier}=${s.amount}`)));
    log("Q4e complementaryServices:", JSON.stringify((pricing.complementaryServices ?? []).map((s) => `${s.qualifier}=${s.semesterAmount}/${s.annualAmount}`)));
  } else {
    log("Q4 pricing config stream: NULL (unseeded)");
  }

  /* ====================================================================== */
  banner("Q5. The FI encaissements census (the owner's 25,000 example)");
  /* ====================================================================== */
  const fiPayments = payments.filter((p) =>
    /frais\s*d'inscription|\bFI\b/i.test(p.notes ?? "") ||
    (p.receiptNumber ?? "").endsWith("-FI"));
  const byAmount = new Map<number, { count: number; total: number; sample: string[] }>();
  for (const p of fiPayments) {
    const b = byAmount.get(p.amount) ?? { count: 0, total: 0, sample: [] };
    b.count += 1; b.total += p.amount;
    if (b.sample.length < 3) {
      b.sample.push(`${p.receiptNumber} · ${p.amount} DZD · expected=${p.expectedAmount ?? "—"} · ${p.collectedAt?.slice(0, 10)} · notes=${(p.notes ?? "").slice(0, 60)}`);
    }
    byAmount.set(p.amount, b);
  }
  log(`Q5a FI-tagged payments: ${fiPayments.length} totaling ${fiPayments.reduce((s, p) => s + p.amount, 0).toLocaleString("fr-FR")} DZD`);
  for (const [amount, b] of [...byAmount.entries()].sort((a, b) => b[1].count - a[1].count)) {
    log(`Q5  ${amount.toLocaleString("fr-FR")} DZD × ${b.count} (Σ ${b.total.toLocaleString("fr-FR")})`);
    for (const s of b.sample) log(`     · ${s}`);
  }
  // The exact owner example: FI payments of 25,000
  const fi25 = fiPayments.filter((p) => p.amount === 25_000);
  log(`Q5b FI payments at exactly 25,000: ${fi25.length}`);
  if (fi25.length > 0) {
    const sampleParent = parents.find((p) => p.id === fi25[0].parentId);
    log(`     sample: ${fi25[0].receiptNumber} · parent ${fi25[0].parentId} (${sampleParent ? `${sampleParent.firstName} ${sampleParent.lastName}` : "?"}) · expected=${fi25[0].expectedAmount}`);
  }
  // Payments of 25,000 in general (any category) — the owner said "encaissement of 25,000 for FI"
  const any25 = payments.filter((p) => p.amount === 25_000);
  const catCounts = new Map<string, number>();
  for (const p of any25) {
    const k = p.category ?? "null";
    catCounts.set(k, (catCounts.get(k) ?? 0) + 1);
  }
  log(`Q5c ALL payments at 25,000 DZD: ${any25.length} — by category:`, JSON.stringify([...catCounts.entries()]));

  /* ====================================================================== */
  banner("Q6. The FI/registration LEDGER CHARGES census (both conventions)");
  /* ====================================================================== */
  const fiCharges = ledgerEntries.filter(
    (e) => e.type === "charge" && /inscription|\bFI\b|registration_fee/i.test(`${e.description ?? ""} ${JSON.stringify(e.metadata ?? {})}`));
  const chargeByAmount = new Map<number, number>();
  for (const c of fiCharges) chargeByAmount.set(c.amount, (chargeByAmount.get(c.amount) ?? 0) + 1);
  log(`Q6a FI/registration-tagged ledger charges: ${fiCharges.length}`);
  for (const [amount, count] of [...chargeByAmount.entries()].sort((a, b) => b[1] - a[1])) {
    log(`Q6  ${amount.toLocaleString("fr-FR")} DZD × ${count}`);
  }
  for (const c of fiCharges.slice(0, 8)) {
    log(`     · ${c.id.slice(0, 13)}… ${c.amount} DZD · cat=${c.category} · src=${c.sourceType}/${c.sourceId.slice(0, 40)} · «${(c.description ?? "").slice(0, 60)}» · meta=${JSON.stringify(c.metadata).slice(0, 80)}`);
  }

  /* ====================================================================== */
  banner("Q7. Does the CURRENT engine see the FI price question at all?");
  /* ====================================================================== */
  const fiRelatedFindings = report.findings.filter((f) =>
    f.id.includes("price-fi") || /frais d'i/i.test(f.title));
  log("Q7a price-fi findings:", fiRelatedFindings.length,
    fiRelatedFindings.slice(0, 5).map((f) => `${f.id} (${f.amount} DZD)`).join(" · "));
  // What the FI installments (tranche 0) carry vs the configured fees:
  const fiInstalls = installments.filter((i) => i.trancheNumber === 0);
  log(`Q7b tranche-0 (FI) installment rows: ${fiInstalls.length}`);
  const instByAmount = new Map<number, number>();
  for (const i of fiInstalls) instByAmount.set(i.amountDue, (instByAmount.get(i.amountDue) ?? 0) + 1);
  for (const [amount, count] of [...instByAmount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    log(`Q7  ${amount.toLocaleString("fr-FR")} DZD × ${count}`);
  }
  // The expected-vs-configured arithmetic the owner described:
  if (pricing) {
    const flat = pricing.registrationFee;
    const n25 = fiPayments.filter((p) => p.amount === 25_000).length;
    log(`Q7c THE OWNER'S EXAMPLE ARITHMETIC: ${n25} FI encaissements at 25,000 vs configured flat fee ${flat} → excess ${(25_000 - flat).toLocaleString("fr-FR")} DZD each`);
  }

  /* ====================================================================== */
  banner("Q8. The read-only/determinism guard (re-run byte-identical)");
  /* ====================================================================== */
  const report2 = runWebhookDiagnostics({
    payments, installments, ledgerEntries, allocations, debtSummaries, parents, students,
    now: report.asOf,
  });
  const identical =
    JSON.stringify(report2.counts) === JSON.stringify(report.counts) &&
    report2.findings.length === report.findings.length;
  log("Q8 deterministic re-run:", identical ? "IDENTICAL" : "DRIFT!");
  log("Q8 stream counts stable:",
    `payments=${repos.payments.observe().get().length} (was ${payments.length}) ·`,
    `ledger=${repos.ledger.observe().get().length} (was ${ledgerEntries.length})`);

  log("\nDONE — read-only probe complete.");
  await client.auth.signOut();
  process.exit(0);
}

main().catch((err) => {
  console.error(`[${TAG}] FATAL:`, err);
  process.exit(1);
});

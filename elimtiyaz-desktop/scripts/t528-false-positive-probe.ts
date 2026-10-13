/**
 * t528-false-positive-probe.ts — the LIVE read-only forensics for the two
 * false-positive classes the owner reported on the « Diagnostic Webhooks »
 * (T-511) engine:
 *
 *   ISSUE 1 (critical): billing entry e8afa61f-3f75-4a18-bde1-40900f219057
 *   references installment reg-ELV-2026-0CF277-t1 (365,000 DZD) on a NEWLY
 *   created account — the engine reports « Facture liée à une échéance
 *   introuvable » (charge-dangling) although the payment is legitimate.
 *
 *   ISSUE 2: sibling payments of identical amounts (same family, same
 *   pricing) flagged as duplicate_event (dup-tuple) although they belong
 *   to DIFFERENT students.
 *
 * READ-ONLY: SELECT-only through the Management API SQL endpoint; the
 * token comes from the ENVIRONMENT (§15.14 — never persisted).
 *
 * Usage:
 *   SUPABASE_ACCESS_TOKEN=<token> npx tsx scripts/t528-false-positive-probe.ts
 */
import * as process from "node:process";

const PROJECT_REF = "vebfehrpzajhstyhinnw";
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN ?? "";
if (!TOKEN) {
  console.error("SUPABASE_ACCESS_TOKEN not exported (the §15.14 env-only convention)");
  process.exit(1);
}

async function sql(query: string): Promise<Record<string, unknown>[]> {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`SQL ${res.status}: ${text.slice(0, 400)}\n  query: ${query.slice(0, 200)}`);
  }
  return (await res.json()) as Record<string, unknown>[];
}

function show(title: string, rows: Record<string, unknown>[]): void {
  console.log(`\n=== ${title} (${rows.length} row${rows.length === 1 ? "" : "s"}) ===`);
  for (const r of rows) console.log(JSON.stringify(r));
}

async function main(): Promise<void> {
  // ── ISSUE 1: the exact ledger entry the owner named ────────────────────
  show(
    "Q1. the reported billing entry",
    await sql(`
      SELECT id, entry_number, entry_type, source_type, source_id,
             parent_id, student_id, amount, category, description,
             entry_date::date AS entry_date, at, metadata
        FROM ledger_entries
       WHERE id = 'e8afa61f-3f75-4a18-bde1-40900f219057'`),
  );

  // The student behind the reg- code (ELV-2026-0CF277)
  show(
    "Q2. the student ELV-2026-0CF277",
    await sql(`
      SELECT id, student_code, first_name, last_name, is_active, created_at::date AS created
        FROM students
       WHERE student_code = 'ELV-2026-0CF277'`),
  );

  // The student's installments (does the tranche exist at all? what IDs?)
  show(
    "Q3. installments of that student",
    await sql(`
      SELECT i.id, i.category, i.tranche_number, i.label,
             i.amount_due, i.amount_paid, i.status,
             i.due_date::date AS due_date, i.source_type, i.source_id,
             i.academic_year_id, ay.code AS year_code
        FROM installments i
        LEFT JOIN academic_years ay ON ay.id = i.academic_year_id
       WHERE i.student_id = (SELECT id FROM students WHERE student_code = 'ELV-2026-0CF277')
       ORDER BY i.category, i.tranche_number NULLS LAST`),
  );

  // How does the ledger entry's source_id relate to those installment rows?
  // (by PK? by installments.source_id? by nothing?)
  show(
    "Q4. installment whose source_id = the ledger source_id",
    await sql(`
      SELECT i.id, i.category, i.tranche_number, i.amount_due, i.status, i.source_id
        FROM installments i
       WHERE i.source_id IN (
             SELECT source_id FROM ledger_entries
              WHERE id = 'e8afa61f-3f75-4a18-bde1-40900f219057')`),
  );

  // The family's full registration charge set (the other siblings' charges)
  show(
    "Q5. all registration-path charges of that family",
    await sql(`
      SELECT le.id, le.entry_type, le.source_type, le.source_id, le.amount,
             le.category, le.student_id, s.student_code,
             le.entry_date::date AS entry_date
        FROM ledger_entries le
        LEFT JOIN students s ON s.id = le.student_id
       WHERE le.parent_id = (SELECT parent_id FROM ledger_entries
                              WHERE id = 'e8afa61f-3f75-4a18-bde1-40900f219057')
         AND le.entry_type = 'charge'
       ORDER BY s.student_code, le.source_id`),
  );

  // ── The census of the whole false-dangling class ────────────────────────
  // charge entries with source_type='installment' whose source_id matches
  // NO installments.id (the engine's current lookup key).
  show(
    "Q6. CENSUS: installment-sourced charges whose source_id is NOT an installments.id",
    await sql(`
      SELECT count(*)::int AS dangling_charges,
             coalesce(sum(le.amount), 0)::bigint AS total_dzd,
             count(DISTINCT le.parent_id)::int AS parents_hit
        FROM ledger_entries le
       WHERE le.entry_type = 'charge'
         AND le.source_type = 'installment'
         AND NOT EXISTS (SELECT 1 FROM installments i WHERE i.id::text = le.source_id)`),
  );

  // Of those, how many DO resolve through the REGISTRATION identity
  // (installments.source_id = the student:category:T<n> form, or the
  // reg- token mapping)? First: what installments.source_id forms exist?
  show(
    "Q7. installments source_id form census (top patterns)",
    await sql(`
      SELECT CASE
               WHEN source_id LIKE 'reg-%' THEN 'reg-…'
               WHEN source_id LIKE '%:tuition:T%' THEN '<uuid>:tuition:T<n>'
               WHEN source_id LIKE '%:transport:T%' THEN '<uuid>:transport:T<n>'
               WHEN source_id IS NULL THEN '(null)'
               ELSE 'other'
             END AS form,
             count(*)::int AS rows
        FROM installments
       GROUP BY 1 ORDER BY rows DESC`),
  );

  // The resolving key: a reg-<X>-t<n> ledger source_id resolves to the
  // installment of student X (code or uuid), category tuition, tranche n.
  // Q8: of the Q6 dangling set, how many resolve by (student, category,
  // tranche) through the reg- identity?
  show(
    "Q8. of the dangling set: resolvable via reg-<student>-t<n> → (student, tuition, tranche)",
    await sql(`
      WITH dangling AS (
        SELECT le.* FROM ledger_entries le
         WHERE le.entry_type = 'charge'
           AND le.source_type = 'installment'
           AND NOT EXISTS (SELECT 1 FROM installments i WHERE i.id::text = le.source_id)
      )
      SELECT count(*)::int AS dangling_total,
             count(*) FILTER (WHERE resolved.id IS NOT NULL)::int AS resolvable_by_student_tranche,
             count(*) FILTER (WHERE resolved.id IS NULL)::int AS truly_unresolvable
        FROM dangling d
        LEFT JOIN LATERAL (
          SELECT i.id
            FROM installments i
            JOIN students s ON s.id = i.student_id
           WHERE i.category = d.category
             AND i.tranche_number = (regexp_match(d.source_id, '-t([0-9]+)$'))[1]::int
             AND (s.id::text = split_part(d.source_id, '-', 2)
                  OR s.student_code = split_part(d.source_id, '-', 2) || '-' ||
                     split_part(d.source_id, '-', 3) || '-' ||
                     split_part(d.source_id, '-', 4))
             AND i.parent_id = d.parent_id
           LIMIT 1
        ) resolved ON true`),
  );

  // ── ISSUE 2: the sibling-duplicate census ──────────────────────────────
  // payment groups the engine's dup-tuple check (parent|amount|method|
  // collectedAt|status) would flag, split by whether the members carry
  // DISTINCT studentIds (siblings = false positive class).
  show(
    "Q9. CENSUS: dup-tuple groups — distinct-student (siblings) vs same-student",
    await sql(`
      WITH groups AS (
        SELECT parent_id, amount, method, collected_at, status,
               count(*)::int AS n, count(DISTINCT student_id)::int AS distinct_students,
               array_agg(student_id ORDER BY student_id) AS students
          FROM payments
      GROUP BY parent_id, amount, method, collected_at, status
        HAVING count(*) >= 2
               AND count(DISTINCT coalesce(receipt_number, id)) >= 2
      )
      SELECT count(*) FILTER (WHERE distinct_students = n)::int AS sibling_groups_diff_students,
             count(*) FILTER (WHERE distinct_students = 1)::int AS same_student_groups,
             coalesce(sum(n) FILTER (WHERE distinct_students = n), 0)::int AS payments_in_sibling_groups,
             coalesce(sum(n) FILTER (WHERE distinct_students = 1), 0)::int AS payments_in_same_student_groups
        FROM groups`),
  );

  // Concrete examples of the sibling class (top by amount)
  show(
    "Q10. sibling false-positive examples (top 8)",
    await sql(`
      WITH groups AS (
        SELECT parent_id, amount, method, collected_at, status,
               count(*)::int AS n, count(DISTINCT student_id)::int AS distinct_students
          FROM payments
      GROUP BY parent_id, amount, method, collected_at, status
        HAVING count(*) >= 2
               AND count(DISTINCT student_id)::int = count(*)
      )
      SELECT g.amount, g.method, g.collected_at::date AS day, g.status, g.n,
             p.display_name AS parent,
             (SELECT string_agg(s.first_name || ' ' || s.last_name, ' | ')
                FROM payments pp JOIN students s ON s.id = pp.student_id
               WHERE pp.parent_id = g.parent_id AND pp.amount = g.amount
                 AND pp.method = g.method AND pp.collected_at = g.collected_at) AS students
        FROM groups g JOIN parents p ON p.id = g.parent_id
       ORDER BY g.amount DESC, g.day DESC
       LIMIT 8`),
  );

  // Same-student groups (the class that MUST keep being flagged)
  show(
    "Q11. same-student duplicate examples (must remain flagged — top 5)",
    await sql(`
      WITH groups AS (
        SELECT parent_id, amount, method, collected_at, status,
               count(*)::int AS n, count(DISTINCT student_id)::int AS distinct_students
          FROM payments
      GROUP BY parent_id, amount, method, collected_at, status
        HAVING count(*) >= 2 AND count(DISTINCT student_id) = 1
               AND count(DISTINCT coalesce(receipt_number, id)) >= 2
      )
      SELECT g.amount, g.method, g.collected_at::date AS day, g.status, g.n,
             p.display_name AS parent,
             (SELECT string_agg(coalesce(pp.receipt_number, pp.id), ' | ')
                FROM payments pp
               WHERE pp.parent_id = g.parent_id AND pp.amount = g.amount
                 AND pp.method = g.method AND pp.collected_at = g.collected_at) AS receipts
        FROM groups g JOIN parents p ON p.id = g.parent_id
       ORDER BY g.amount DESC
       LIMIT 5`),
  );

  // How do payments link to students at all? (nullability census)
  show(
    "Q12. payments student_id census",
    await sql(`
      SELECT count(*)::int AS total,
             count(student_id)::int AS with_student,
             count(*) - count(student_id)::int AS null_student
        FROM payments`),
  );

  console.log("\nDONE — all queries read-only.");
}

main().catch((e) => {
  console.error("PROBE FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});

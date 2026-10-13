/**
 * t528-false-positive-probe2.ts — the ISSUE 2 (sibling duplicates) census +
 * the ISSUE 1 resolution-matrix follow-up. Read-only. Env-token convention.
 *
 * Usage:
 *   SUPABASE_ACCESS_TOKEN=<token> npx tsx scripts/t528-false-positive-probe2.ts
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
  // ── ISSUE 2: the sibling-duplicate census (fixed coalesce types) ───────
  show(
    "Q9. CENSUS: engine dup-tuple groups — distinct-student (siblings) vs same-student",
    await sql(`
      WITH groups AS (
        SELECT parent_id, amount, method, collected_at, status,
               count(*)::int AS n,
               count(DISTINCT student_id)::int AS distinct_students,
               count(DISTINCT coalesce(receipt_number, id::text))::int AS distinct_receipts
          FROM payments
      GROUP BY parent_id, amount, method, collected_at, status
        HAVING count(*) >= 2
               AND count(DISTINCT coalesce(receipt_number, id::text)) >= 2
      )
      SELECT count(*) FILTER (WHERE distinct_students = n)::int AS sibling_groups_diff_students,
             count(*) FILTER (WHERE distinct_students = 1)::int AS same_student_groups,
             count(*) FILTER (WHERE distinct_students > 1 AND distinct_students < n)::int AS mixed_groups,
             coalesce(sum(n) FILTER (WHERE distinct_students = n), 0)::int AS payments_in_sibling_groups,
             coalesce(sum(n) FILTER (WHERE distinct_students = 1), 0)::int AS payments_in_same_student_groups,
             coalesce(sum(amount * n) FILTER (WHERE distinct_students = n), 0)::bigint AS sibling_dzd,
             coalesce(sum(amount * n) FILTER (WHERE distinct_students = 1), 0)::bigint AS same_student_dzd
        FROM groups`),
  );

  // Concrete examples of the sibling class
  show(
    "Q10. sibling false-positive examples (top 10)",
    await sql(`
      WITH groups AS (
        SELECT parent_id, amount, method, collected_at, status,
               count(*)::int AS n, count(DISTINCT student_id)::int AS distinct_students
          FROM payments
      GROUP BY parent_id, amount, method, collected_at, status
        HAVING count(*) >= 2 AND count(DISTINCT student_id)::int = count(*)
               AND count(DISTINCT coalesce(receipt_number, id::text)) >= 2
      )
      SELECT g.amount, g.method, g.collected_at::date AS day, g.status, g.n,
             p.display_name AS parent,
             (SELECT string_agg(s.first_name || ' ' || s.last_name || ' (' || coalesce(pp.receipt_number, 'no-receipt') || ')', ' | ')
                FROM payments pp JOIN students s ON s.id = pp.student_id
               WHERE pp.parent_id = g.parent_id AND pp.amount = g.amount
                 AND pp.method = g.method AND pp.collected_at = g.collected_at) AS students
        FROM groups g JOIN parents p ON p.id = g.parent_id
       ORDER BY g.amount DESC, g.collected_at DESC
       LIMIT 10`),
  );

  // Same-student groups (the class that MUST keep being flagged)
  show(
    "Q11. same-student duplicate examples (must remain flagged — top 6)",
    await sql(`
      WITH groups AS (
        SELECT parent_id, amount, method, collected_at, status,
               count(*)::int AS n, count(DISTINCT student_id)::int AS distinct_students
          FROM payments
      GROUP BY parent_id, amount, method, collected_at, status
        HAVING count(*) >= 2 AND count(DISTINCT student_id) = 1
               AND count(DISTINCT coalesce(receipt_number, id::text)) >= 2
      )
      SELECT g.amount, g.method, g.collected_at::date AS day, g.status, g.n,
             p.display_name AS parent,
             (SELECT string_agg(coalesce(pp.receipt_number, pp.id::text) || ' → ' || coalesce(s.first_name || ' ' || s.last_name, '(no student)'), ' | ')
                FROM payments pp LEFT JOIN students s ON s.id = pp.student_id
               WHERE pp.parent_id = g.parent_id AND pp.amount = g.amount
                 AND pp.method = g.method AND pp.collected_at = g.collected_at) AS receipts
        FROM groups g JOIN parents p ON p.id = g.parent_id
       ORDER BY g.amount DESC
       LIMIT 6`),
  );

  // Payments student_id nullability census
  show(
    "Q12. payments student_id census",
    await sql(`
      SELECT count(*)::int AS total,
             count(student_id)::int AS with_student,
             count(*) - count(student_id)::int AS null_student
        FROM payments`),
  );

  // ISSUE 1 follow-up: the exact resolvability matrix for the engine fix —
  // for every installment-sourced charge, which resolution form succeeds?
  show(
    "Q13. resolution matrix for installment-sourced charges",
    await sql(`
      SELECT CASE
               WHEN EXISTS (SELECT 1 FROM installments i WHERE i.id::text = le.source_id)
                 THEN 'A: direct installments.id PK'
               WHEN EXISTS (
                    SELECT 1 FROM installments i
                     WHERE i.source_id = le.source_id)
                 THEN 'B: installments.source_id literal'
               WHEN EXISTS (
                    SELECT 1 FROM installments i
                      JOIN students s ON s.id = i.student_id
                     WHERE i.parent_id = le.parent_id
                       AND i.category = le.category
                       AND s.id::text = le.student_id::text
                       AND (le.source_id ~ '-transport-t[0-9]+$'
                            AND i.tranche_number = (regexp_match(le.source_id, '-transport-t([0-9]+)$'))[1]::int
                         OR le.source_id ~ '-t[0-9]+$' AND le.source_id !~ '-transport-t[0-9]+$'
                            AND i.tranche_number = (regexp_match(le.source_id, '-t([0-9]+)$'))[1]::int))
                 THEN 'C: reg-identity (student+category+tranche)'
               ELSE 'D: UNRESOLVABLE'
             END AS resolution_form,
             count(*)::int AS charges,
             coalesce(sum(le.amount), 0)::bigint AS dzd
        FROM ledger_entries le
       WHERE le.entry_type = 'charge' AND le.source_type = 'installment'
       GROUP BY 1 ORDER BY charges DESC`),
  );

  // For form C rows: do the amounts agree with the resolved installment?
  show(
    "Q14. form-C amount agreement (the false-positive set must be coherent)",
    await sql(`
      SELECT le.id, le.source_id, le.amount::bigint AS charge_amount,
             i.id AS installment_id, i.amount_due::bigint AS due, i.amount_paid::bigint AS paid,
             i.label, i.status,
             (le.amount = i.amount_due) AS amounts_agree
        FROM ledger_entries le
        JOIN LATERAL (
          SELECT i.* FROM installments i
            JOIN students s ON s.id = i.student_id
           WHERE i.parent_id = le.parent_id
             AND i.category = le.category
             AND s.id::text = le.student_id::text
             AND ((le.source_id ~ '-transport-t[0-9]+$'
                   AND i.tranche_number = (regexp_match(le.source_id, '-transport-t([0-9]+)$'))[1]::int)
               OR (le.source_id ~ '-t[0-9]+$' AND le.source_id !~ '-transport-t[0-9]+$'
                   AND i.tranche_number = (regexp_match(le.source_id, '-t([0-9]+)$'))[1]::int))
           LIMIT 1
        ) i ON true
       WHERE le.entry_type = 'charge' AND le.source_type = 'installment'
         AND NOT EXISTS (SELECT 1 FROM installments ix WHERE ix.id::text = le.source_id)
       ORDER BY le.source_id`),
  );

  console.log("\nDONE — all queries read-only.");
}

main().catch((e) => {
  console.error("PROBE FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});

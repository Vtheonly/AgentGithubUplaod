-- verify_t-338.sql — T-341 (STATS-400): the LIVE-DB truth for every
-- EXECUTIVE statistic the desktop T-338 engine derives.
--
-- Convention (AGENTS.md §11.1, the verify_t-285 pattern): wrapped in
-- BEGIN; … ROLLBACK; so it can be re-run any time without mutating the
-- live DB; results land in temp tables the final SELECTs surface. Run via
-- the Management API SQL endpoint (the apply-script pattern) or:
--   supabase db query --linked < scripts/verify_t-338.sql
--
-- WHAT IT PROVES: the canonical numbers the Executive Command Center
-- renders — the tranche-wave staircase (category × tranche_number), the
-- discount-erosion census (the STRUCTURED metadata markers), the 4-tier
-- debt triage with the >45j call list, the top-10 family concentration,
-- the transport-town yield (the alias table expressed in SQL), the
-- sibling index, and the section-imbalance detector — are exactly what
-- the DATABASE computes from its raw rows. The live runner
-- (scripts/verify_t-338_live.ts) then runs the SAME TS derivations over
-- the SAME raw rows and diffs against these numbers: TS engine ≡ SQL.
--
-- All money columns are the DB's NATIVE integral DZD (the desktop domain
-- unit — the derivations' native unit on the desktop side; the Android
-- engine mirrors them in centimes with the ×100 boundary).

BEGIN;

-- ── 0. The transport alias table (the TOWN_ALIASES mirror in SQL) ────────
-- (domain/calc/pricing/transport.ts is the canonical copy; this SQL VALUES
-- table lets the DATABASE independently normalize the messy spellings.)
CREATE TEMP TABLE town_aliases (raw TEXT PRIMARY KEY, dest TEXT NOT NULL);
INSERT INTO town_aliases (raw, dest) VALUES
  ('BOUMERDES', 'boumerdes'), ('BOUMRDES', 'boumerdes'), ('BOUMREDES', 'boumerdes'),
  ('BOUMERDES20000', 'boumerdes'), ('CHABAT', 'chabat'), ('CHABET', 'chabet'),
  ('CORSO', 'corso'), ('SAHEL', 'sahel'), ('FIGUIER', 'figuier'), ('TIDJELABINE', 'tidjelabine'),
  ('BOUDOUAOU', 'boudouaou'), ('THENIA', 'thenia'),
  ('ZEMMOURI', 'zemmouri'), ('ZEMOURI', 'zemmouri'),
  ('DJENAT', 'djenet'), ('DJENET', 'djenet'), ('CAPDJENET', 'cap_djenet'),
  ('BORDJMNAIL', 'bordj_menaiel'), ('SIMUSTAPHA', 'si_mustapha'), ('ISSER', 'isser'),
  ('OULEDMOUSSA', 'ouled_moussa'),
  ('KHEMISKHECHNA', 'khemis_el_khechna'), ('KHEMISELKHCHNA', 'khemis_el_khechna'),
  ('KHEMISKHCHNA', 'khemis_el_khechna'), ('KHEMISKHENCHELA', 'khemis_el_khechna'),
  ('BENYOUNES', 'benyounes'), ('SOUKELHAD', 'souk_elhad'),
  ('BENIAMRAN', 'beni_amrane'), ('REGHAIA', 'reghaia'), ('REGHIAA', 'reghaia'),
  ('ROUIBA', 'rouiba'), ('OULEDHEDADJ', 'ouled_heddadj'), ('OULEDHDADJ', 'ouled_heddadj'),
  ('OULEDHEDDAJ/HOUCHEMEKHEFI', 'ouled_heddadj'), ('OULEDHADADJ', 'ouled_heddadj'),
  ('LAGATA', 'lagata'),
  ('TIDJELABINE_SAHEL_FIGUIER_CORSO', 'tidjelabine_sahel_figuier_corso'),
  ('BOUDOUAOU_THENIA_ZEMMOURI', 'boudouaou_thenia_zemmouri'),
  ('VILLEBOUMERDES', 'ville_boumerdes');

-- ── 1. Tranche waves (category × tranche_number — NEVER label parsing) ───
CREATE TEMP TABLE t338_waves AS
WITH inv AS (
  SELECT category,
         tranche_number,
         parent_id,
         amount_due::bigint AS due,
         amount_paid::bigint AS paid,
         coalesce(amount_pending, 0)::bigint AS pending,
         status,
         due_date
  FROM installments
),
rem AS (
  SELECT *, greatest(0, due - paid - pending)::bigint AS remaining
  FROM inv WHERE status <> 'paid'
)
SELECT
  category,
  tranche_number,
  (SELECT count(*) FROM inv i WHERE i.category = w.category AND i.tranche_number = w.tranche_number)::int AS installment_count,
  (SELECT count(*) FROM inv i WHERE i.category = w.category AND i.tranche_number = w.tranche_number AND i.status = 'paid')::int AS paid_count,
  (SELECT count(DISTINCT parent_id) FROM inv i WHERE i.category = w.category AND i.tranche_number = w.tranche_number)::int AS family_count,
  (SELECT count(DISTINCT parent_id) FROM rem r WHERE r.category = w.category AND r.tranche_number = w.tranche_number AND r.remaining > 0)::int AS debtor_family_count,
  (SELECT coalesce(sum(due), 0) FROM inv i WHERE i.category = w.category AND i.tranche_number = w.tranche_number)::bigint AS due_total,
  (SELECT coalesce(sum(paid), 0) FROM inv i WHERE i.category = w.category AND i.tranche_number = w.tranche_number)::bigint AS paid_total,
  (SELECT coalesce(sum(remaining), 0) FROM rem r WHERE r.category = w.category AND r.tranche_number = w.tranche_number)::bigint AS remaining_total
FROM (SELECT DISTINCT category, tranche_number FROM inv) w
ORDER BY category, tranche_number;

-- ── 2. Discount erosion (the STRUCTURED metadata markers) ────────────────
CREATE TEMP TABLE t338_erosion AS
WITH markers AS (
  SELECT
    amount::bigint AS amount,
    entry_type,
    description,
    metadata,
    coalesce(metadata->>'field', '') = 'REMISE' AS field_marker,
    coalesce(metadata->>'reason', '') = 'double_remise_cancel' AS reason_marker
  FROM ledger_entries
),
remises AS (
  SELECT * FROM markers
  WHERE entry_type = 'adjustment' AND amount < 0
    AND ((metadata->>'field') = 'REMISE' OR description LIKE 'Remise sur devis%')
),
cancels AS (
  SELECT * FROM markers
  WHERE reason_marker AND entry_type = 'adjustment' AND amount > 0
),
charges AS (
  SELECT coalesce(sum(amount), 0)::bigint AS gross FROM markers WHERE entry_type = 'charge' AND amount > 0
)
SELECT
  (SELECT count(*) FROM remises)::int AS remise_count,
  (SELECT coalesce(sum(-amount), 0) FROM remises)::bigint AS remise_total,
  (SELECT count(*) FROM cancels)::int AS cancel_count,
  (SELECT coalesce(sum(amount), 0) FROM cancels)::bigint AS cancel_total,
  (SELECT gross FROM charges)::bigint AS gross_charges;

-- ── 3. Debt triage (the 4 action tiers + the >45j call list) ─────────────
-- now := the runner's pinned instant 2026-09-14T12:00:00Z (epoch-ms
-- 1789396800000). days_overdue = floor((now - due_date)/86400s), floored
-- toward zero — the daysBetweenFloor convention.
CREATE TEMP TABLE t338_triage AS
WITH unpaid AS (
  SELECT
    parent_id,
    greatest(0, amount_due - amount_paid - coalesce(amount_pending, 0))::bigint AS remaining,
    floor(extract(epoch FROM (timestamptz '2026-09-14T12:00:00Z' - due_date::timestamptz)) / 86400.0)::int AS days_overdue
  FROM installments WHERE status <> 'paid'
),
kept AS (SELECT * FROM unpaid WHERE remaining > 0),
buckets AS (
  SELECT
    CASE
      WHEN days_overdue <= 0 THEN 'not_due'
      WHEN days_overdue < 15 THEN 'current'
      WHEN days_overdue <= 45 THEN 'reminder'
      ELSE 'chronic'
    END AS bucket,
    remaining,
    parent_id
  FROM kept
)
SELECT bucket,
       sum(remaining)::bigint AS amount,
       count(*)::int AS installment_count,
       count(DISTINCT parent_id)::int AS family_count
FROM buckets GROUP BY bucket;

CREATE TEMP TABLE t338_call_list AS
WITH fam AS (
  SELECT parent_id, sum(remaining)::bigint AS outstanding, max(days_overdue)::int AS worst_days
  FROM (
    SELECT parent_id,
           greatest(0, amount_due - amount_paid - coalesce(amount_pending, 0))::bigint AS remaining,
           floor(extract(epoch FROM (timestamptz '2026-09-14T12:00:00Z' - due_date::timestamptz)) / 86400.0)::int AS days_overdue
    FROM installments WHERE status <> 'paid'
  ) u WHERE remaining > 0
  GROUP BY parent_id
  HAVING max(days_overdue) > 45
)
SELECT f.parent_id,
       coalesce(p.display_name, trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), f.parent_id::text) AS parent_name,
       f.outstanding,
       f.worst_days
FROM fam f LEFT JOIN parents p ON p.id = f.parent_id
ORDER BY f.outstanding DESC
LIMIT 10; -- the derivation's .slice(0, 10) — the immediate call list is the TOP 10 exposures

-- ── 4. Family concentration (the 80/20 view, top-10) ─────────────────────
CREATE TEMP TABLE t338_concentration AS
WITH fam AS (
  SELECT parent_id,
         sum(greatest(0, amount_due - amount_paid - coalesce(amount_pending, 0)))::bigint AS outstanding,
         max(floor(extract(epoch FROM (timestamptz '2026-09-14T12:00:00Z' - due_date::timestamptz)) / 86400.0))::int AS worst_days
  FROM installments WHERE status <> 'paid'
  GROUP BY parent_id
  HAVING sum(greatest(0, amount_due - amount_paid - coalesce(amount_pending, 0))) > 0
),
kids AS (
  SELECT parent_id, count(*)::int AS child_count FROM students
  WHERE enrollment_status = 'active' GROUP BY parent_id
),
total AS (SELECT coalesce(sum(outstanding), 0)::bigint AS total_outstanding, count(*)::int AS debtor_families FROM fam)
SELECT
  (SELECT total_outstanding FROM total) AS total_outstanding,
  (SELECT debtor_families FROM total) AS debtor_family_count;

CREATE TEMP TABLE t338_top_families AS
WITH fam AS (
  SELECT parent_id,
         sum(greatest(0, amount_due - amount_paid - coalesce(amount_pending, 0)))::bigint AS outstanding
  FROM installments WHERE status <> 'paid'
  GROUP BY parent_id
  HAVING sum(greatest(0, amount_due - amount_paid - coalesce(amount_pending, 0))) > 0
),
kids AS (
  SELECT parent_id, count(*)::int AS child_count FROM students
  WHERE enrollment_status = 'active' GROUP BY parent_id
),
total AS (SELECT coalesce(sum(outstanding), 0)::bigint AS t FROM fam)
SELECT f.parent_id,
       coalesce(p.display_name, trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), f.parent_id::text) AS parent_name,
       f.outstanding,
       coalesce(k.child_count, 0) AS child_count,
       round(f.outstanding::numeric * 100 / t.t)::int AS share_pct,
       max(floor(extract(epoch FROM (timestamptz '2026-09-14T12:00:00Z' - i.due_date::timestamptz)) / 86400.0))::int AS worst_days
FROM fam f
LEFT JOIN parents p ON p.id = f.parent_id
LEFT JOIN kids k ON k.parent_id = f.parent_id
LEFT JOIN total t ON true
JOIN installments i ON i.parent_id = f.parent_id AND i.status <> 'paid'
GROUP BY f.parent_id, p.display_name, p.first_name, p.last_name, f.outstanding, k.child_count, t.t
ORDER BY f.outstanding DESC
LIMIT 10;

-- ── 5. Transport yield (normalized towns + route money) ──────────────────
CREATE TEMP TABLE t338_transport AS
WITH riders AS (
  SELECT
    s.parent_id,
    s.id AS student_id,
    upper(regexp_replace(trim(coalesce(s.transport_tier, '')), '\s+', '', 'g')) AS raw_tier
  FROM students s
  WHERE coalesce(trim(s.transport_tier), '') <> ''
),
norm AS (
  SELECT r.*, coalesce(a.dest, 'autres') AS dest
  FROM riders r LEFT JOIN town_aliases a ON a.raw = r.raw_tier
),
rider_parents AS (
  SELECT DISTINCT dest, parent_id FROM norm
),
inv AS (
  SELECT parent_id,
         greatest(0, amount_due - amount_paid - coalesce(amount_pending, 0))::bigint AS remaining,
         amount_due::bigint AS due, amount_paid::bigint AS paid
  FROM installments WHERE category = 'transport'
)
SELECT
  (SELECT count(*) FROM norm)::int AS riders,
  (SELECT count(*) FROM students WHERE coalesce(trim(transport_tier), '') = '')::int AS non_riders,
  (SELECT count(DISTINCT raw_tier) FROM norm WHERE dest = 'autres')::int AS unresolved_value_count;

CREATE TEMP TABLE t338_transport_routes AS
WITH riders AS (
  SELECT s.id AS student_id, s.parent_id,
         upper(regexp_replace(trim(coalesce(s.transport_tier, '')), '\s+', '', 'g')) AS raw_tier
  FROM students s
  WHERE coalesce(trim(s.transport_tier), '') <> ''
),
norm AS (
  SELECT r.*, coalesce(a.dest, 'autres') AS dest
  FROM riders r LEFT JOIN town_aliases a ON a.raw = r.raw_tier
),
-- riders per route = DISTINCT rider PARENTS per destination (a parent with
-- children on two routes counts in both — the TS riderParentsByDestination
-- semantics).
rider_parents AS (
  SELECT DISTINCT dest, parent_id FROM norm
),
-- installment attribution = the FIRST-SEEN destination per parent (the TS
-- first-match rule; the runner orders students by id, so min(student_id)
-- is the deterministic mirror of "first seen").
first_dest AS (
  SELECT DISTINCT ON (parent_id) parent_id, dest
  FROM norm
  ORDER BY parent_id, student_id
),
inv AS (
  SELECT parent_id,
         amount_due::bigint AS due,
         amount_paid::bigint AS paid,
         greatest(0, amount_due - amount_paid - coalesce(amount_pending, 0))::bigint AS remaining
  FROM installments WHERE category = 'transport'
),
route_money AS (
  SELECT fd.dest,
         coalesce(sum(i.due), 0)::bigint AS due_total,
         coalesce(sum(i.paid), 0)::bigint AS paid_total,
         coalesce(sum(i.remaining), 0)::bigint AS remaining_total
  FROM first_dest fd
  LEFT JOIN inv i ON i.parent_id = fd.parent_id
  GROUP BY fd.dest
  UNION ALL
  -- transport installments whose parent has NO rider student → autres
  SELECT 'autres',
         coalesce(sum(i.due), 0)::bigint, coalesce(sum(i.paid), 0)::bigint, coalesce(sum(i.remaining), 0)::bigint
  FROM inv i WHERE i.parent_id NOT IN (SELECT parent_id FROM first_dest)
),
route_riders AS (
  SELECT dest, count(DISTINCT parent_id)::int AS riders FROM rider_parents GROUP BY dest
)
SELECT rm.dest,
       coalesce(rr.riders, 0)::int AS riders,
       sum(rm.due_total)::bigint AS due_total,
       sum(rm.paid_total)::bigint AS paid_total,
       sum(rm.remaining_total)::bigint AS remaining_total,
       CASE WHEN sum(rm.due_total) > 0 THEN round(sum(rm.paid_total)::numeric * 100 / sum(rm.due_total))::int ELSE 0 END AS collected_pct
FROM route_money rm
LEFT JOIN route_riders rr ON rr.dest = rm.dest
GROUP BY rm.dest, rr.riders
ORDER BY riders DESC, remaining_total DESC;

-- ── 6. Sibling index + family sizes ──────────────────────────────────────
CREATE TEMP TABLE t338_dynamics AS
WITH active_kids AS (
  SELECT parent_id FROM students WHERE enrollment_status = 'active'
),
fam AS (
  SELECT parent_id, count(*)::int AS kids FROM active_kids GROUP BY parent_id
)
SELECT
  (SELECT count(*) FROM active_kids)::int AS total_students,
  (SELECT count(*) FROM fam)::int AS total_families,
  (SELECT round(sum(kids)::numeric * 100 / count(*))::numeric / 100 FROM fam) AS sibling_index,
  (SELECT count(*) FROM fam WHERE kids >= 2)::int AS multi_child_families,
  (SELECT round(count(*) FILTER (WHERE kids >= 2)::numeric * 100 / count(*))::int FROM fam) AS multi_child_pct;

-- ── 7. Section imbalance (spread ≥ 10 OR max ≥ 1.5 × min — NO ceilings) ──
CREATE TEMP TABLE t338_sections AS
WITH enrolled AS (
  SELECT c.id, c.name, c.grade_code, c.is_active,
         (SELECT count(*) FROM students s WHERE s.class_id = c.id)::int AS enrolled_count
  FROM classes c
),
by_grade AS (
  SELECT grade_code,
         count(*)::int AS section_count,
         max(enrolled_count)::int AS max_enrolled,
         min(enrolled_count)::int AS min_enrolled,
         round(avg(enrolled_count))::int AS average_enrolled,
         max(enrolled_count) - min(enrolled_count) AS spread
  FROM enrolled WHERE is_active
  GROUP BY grade_code
  HAVING count(*) >= 2
)
SELECT grade_code, section_count, max_enrolled, min_enrolled, average_enrolled, spread,
       (spread >= 10 OR (min_enrolled > 0 AND max_enrolled >= 1.5 * min_enrolled)) AS imbalanced
FROM by_grade ORDER BY spread DESC;

-- ── 8. Services yield (the PAID specialized stream) ────────────────────
CREATE TEMP TABLE t338_services AS
WITH paid AS (
  SELECT category, amount::numeric AS amt, student_id
  FROM payments WHERE status = 'paid'
  AND category IN ('therapy_psychology','therapy_speech','extracurricular',
                   'canteen','uniform','books','second_apron','other')
)
SELECT category,
       count(*)::int AS payment_count,
       round(sum(amt))::bigint AS revenue,
       count(DISTINCT student_id)::int AS student_count
FROM paid GROUP BY category ORDER BY revenue DESC;

-- ── The surfaced truth (one JSON blob per section) ───────────────────────
SELECT 'waves' AS section, row_to_json(t) AS truth FROM (
  SELECT category, tranche_number, installment_count, paid_count, family_count,
         debtor_family_count, due_total, paid_total, remaining_total,
         CASE WHEN due_total > 0 THEN round(paid_total::numeric * 100 / due_total)::int ELSE 0 END AS collected_pct
  FROM t338_waves ORDER BY category, tranche_number
) t
UNION ALL
SELECT 'erosion', row_to_json(t) FROM (
  SELECT e.remise_count, e.remise_total, e.cancel_count, e.cancel_total,
         e.remise_total - e.cancel_total AS net_remise_total,
         e.gross_charges,
         e.gross_charges + e.remise_total AS sticker_total,
         CASE WHEN e.gross_charges + e.remise_total > 0
              THEN round(e.remise_total::numeric * 100 / (e.gross_charges + e.remise_total))::int ELSE 0 END AS erosion_pct,
         CASE WHEN e.remise_count > 0 THEN round(e.remise_total::numeric / e.remise_count)::bigint ELSE 0 END AS average_remise
  FROM t338_erosion e
) t
UNION ALL
SELECT 'triage', row_to_json(t) FROM (
  SELECT bucket, amount, installment_count, family_count FROM t338_triage
  ORDER BY array_position(ARRAY['not_due','current','reminder','chronic'], bucket)
) t
UNION ALL
SELECT 'call_list', row_to_json(t) FROM (
  SELECT parent_id, parent_name, outstanding, worst_days FROM t338_call_list
) t
UNION ALL
SELECT 'concentration', row_to_json(t) FROM (
  SELECT total_outstanding, debtor_family_count FROM t338_concentration
) t
UNION ALL
SELECT 'top_families', row_to_json(t) FROM (
  SELECT parent_id, parent_name, outstanding, child_count, share_pct, worst_days
  FROM t338_top_families ORDER BY outstanding DESC
) t
UNION ALL
SELECT 'transport', row_to_json(t) FROM (
  SELECT riders, non_riders, unresolved_value_count FROM t338_transport
) t
UNION ALL
SELECT 'transport_routes', row_to_json(t) FROM (
  SELECT dest, riders, due_total, paid_total, remaining_total, collected_pct
  FROM t338_transport_routes ORDER BY riders DESC, remaining_total DESC
) t
UNION ALL
SELECT 'dynamics', row_to_json(t) FROM (
  SELECT total_students, total_families, sibling_index, multi_child_families, multi_child_pct FROM t338_dynamics
) t
UNION ALL
SELECT 'sections', row_to_json(t) FROM (
  SELECT grade_code, section_count, max_enrolled, min_enrolled, average_enrolled, spread, imbalanced
  FROM t338_sections ORDER BY spread DESC
) t
UNION ALL
SELECT 'services', row_to_json(t) FROM (
  SELECT category, payment_count, revenue, student_count FROM t338_services
) t
ORDER BY section;

ROLLBACK;

-- verify_t-285.sql — T-285 (PARITY-002): the LIVE-DB truth for every
-- dashboard statistic the Android StatisticsEngine derives.
--
-- Convention (AGENTS.md §11.1): wrapped in BEGIN; … ROLLBACK; so it can be
-- re-run any time without mutating the live DB; results land in a temp
-- table (t285_truth) that the final SELECT surfaces (the CLI surfaces no
-- RAISE NOTICE output). Run via the Management API SQL endpoint
-- (scripts/apply pattern) or: supabase db query --linked < scripts/verify_t-285.sql
--
-- WHAT IT PROVES: the canonical numbers the desktop Analytics tab renders
-- (891 encaissements, 55 227 100 DZD total, panier moyen 61 983 DZD,
-- médiane 61 000 DZD, σ(sample) 44 951 DZD, best month Août, bins with
-- 50k+ dominant, Scolarité/Transport mix, the 91–180 j / 180+ j aging
-- census, the outstanding 58 355 700 DZD, the 49% collection rate) are
-- exactly what the DATABASE computes from its raw rows — and the Android
-- LiveDatabaseEquivalenceTest asserts the Kotlin engine reproduces every
-- one of them from the same rows (the DZD→centimes ×100 boundary mirrors
-- the pull mapper).
--
-- All money columns are emitted in CENTIMES (round(dzd * 100)) for direct
-- comparison with the Android engine output.

BEGIN;

CREATE TEMP TABLE t285_truth AS
WITH paid AS (
  SELECT amount::double precision AS amt, method, category, collected_at
  FROM payments WHERE status = 'paid'
),
stats AS (
  SELECT
    count(*)::int AS ops,
    round(sum(amt))::double precision AS total_dzd,
    round(avg(amt))::double precision AS mean_dzd,
    round(stddev_samp(amt))::double precision AS stddev_dzd,
    min(amt)::double precision AS min_dzd,
    max(amt)::double precision AS max_dzd
  FROM paid
),
median_row AS (
  SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY amt))::double precision AS median_dzd
  FROM paid
),
best_month AS (
  SELECT to_char(collected_at, 'Mon') AS label, sum(amt) AS amount
  FROM paid GROUP BY 1 ORDER BY 2 DESC LIMIT 1
),
bins AS (
  SELECT
    count(*) FILTER (WHERE amt >= 0 AND amt < 5000)::int AS b0_5,
    count(*) FILTER (WHERE amt >= 5000 AND amt < 10000)::int AS b5_10,
    count(*) FILTER (WHERE amt >= 10000 AND amt < 20000)::int AS b10_20,
    count(*) FILTER (WHERE amt >= 20000 AND amt < 50000)::int AS b20_50,
    count(*) FILTER (WHERE amt >= 50000)::int AS b50p
  FROM paid
),
categories AS (
  SELECT category, sum(amt) AS amount, count(*)::int AS cnt
  FROM paid GROUP BY 1
),
unpaid AS (
  SELECT
    parent_id::text AS parent_id,
    greatest(0, amount_due - amount_paid - coalesce(amount_pending, 0))::double precision AS remaining,
    greatest(0, floor(extract(epoch FROM (now()::timestamp - due_date::timestamp)) / 86400.0))::int AS days_overdue
  FROM installments WHERE status <> 'paid'
),
census AS (
  SELECT
    CASE
      WHEN days_overdue <= 30 THEN '0_30'
      WHEN days_overdue <= 60 THEN '31_60'
      WHEN days_overdue <= 90 THEN '61_90'
      WHEN days_overdue <= 180 THEN '91_180'
      ELSE '180_plus'
    END AS bucket,
    remaining,
    parent_id
  FROM unpaid WHERE remaining > 0
),
census_agg AS (
  SELECT bucket, sum(remaining) AS amount, count(DISTINCT parent_id)::int AS debtors
  FROM census GROUP BY 1
),
totals AS (
  SELECT
    coalesce(sum(remaining), 0)::double precision AS outstanding,
    coalesce(sum(remaining) FILTER (WHERE days_overdue > 0), 0)::double precision AS overdue,
    count(DISTINCT parent_id)::int AS overdue_families
  FROM unpaid WHERE remaining > 0
),
classes AS (
  SELECT
    count(*)::int AS total_classes,
    count(*) FILTER (WHERE is_active)::int AS active_classes
  FROM classes
),
attendance AS (
  SELECT
    count(*)::int AS total,
    count(*) FILTER (WHERE status IN ('present', 'late'))::int AS presentish
  FROM attendance_records WHERE date = current_date
)
SELECT
  (SELECT ops FROM stats) AS ops,
  (SELECT round(total_dzd * 100)::bigint FROM stats) AS total_centimes,
  (SELECT round(mean_dzd * 100)::bigint FROM stats) AS mean_centimes,
  (SELECT median_dzd * 100::bigint FROM median_row) AS median_centimes_raw,
  (SELECT round(stddev_dzd * 100)::bigint FROM stats) AS stddev_centimes,
  (SELECT min_dzd * 100 FROM stats) AS min_centimes,
  (SELECT max_dzd * 100 FROM stats) AS max_centimes,
  (SELECT label FROM best_month) AS best_month_label,
  (SELECT round(amount * 100)::bigint FROM best_month) AS best_month_centimes,
  (SELECT b0_5 FROM bins) AS b0_5, (SELECT b5_10 FROM bins) AS b5_10,
  (SELECT b10_20 FROM bins) AS b10_20, (SELECT b20_50 FROM bins) AS b20_50,
  (SELECT b50p FROM bins) AS b50p,
  (SELECT json_agg(json_build_object('category', category, 'amount', round(amount*100)::bigint, 'count', cnt, 'percent', round(amount / (SELECT sum(amt) FROM paid) * 100)::int) ORDER BY amount DESC) FROM categories) AS category_mix,
  (SELECT json_object_agg(bucket, json_build_object('amount', round(amount*100)::bigint, 'debtors', debtors)) FROM census_agg) AS census,
  (SELECT round(outstanding * 100)::bigint FROM totals) AS outstanding_centimes,
  (SELECT round(overdue * 100)::bigint FROM totals) AS overdue_centimes,
  (SELECT overdue_families FROM totals) AS overdue_families,
  (SELECT total_classes FROM classes) AS total_classes,
  (SELECT active_classes FROM classes) AS active_classes,
  (SELECT CASE WHEN total > 0 THEN round(presentish::numeric / total * 100)::int ELSE NULL END FROM attendance) AS attendance_pct,
  (SELECT round((SELECT total_dzd FROM stats) / ((SELECT total_dzd FROM stats) + (SELECT outstanding FROM totals)) * 100)::int) AS collection_rate
;

SELECT * FROM t285_truth;

ROLLBACK;

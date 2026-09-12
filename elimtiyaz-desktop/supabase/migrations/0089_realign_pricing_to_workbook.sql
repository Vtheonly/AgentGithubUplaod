-- ============================================================================
-- 0089_realign_pricing_to_workbook.sql
-- ============================================================================
-- T-315 (54th session, 2026-09-12) — CALC-001: the ENTIRE pricing catalog
-- was built on a fictional "Prices.md" price book that matched NOTHING in
-- the school's actual records. The REAL 2026/2027 model was extracted from
-- the legacy workbook `Suivis clients  2026_2027.xlsx` (raw Excel formulas —
-- see the desktop `src/domain/calc/pricing/school-price-matrix.ts` for the
-- formula-level evidence and
-- `src/tests/domain/pricing/real-school-corpus.test.ts` for the 390-row
-- verification).
--
-- THE REAL MODEL (workbook evidence):
--   1. FI (frais d'inscription) is PER STUDENT, PER GRADE (18 000 – 30 000),
--      never a flat family fee. Evidence: ETAT column R is per-student; the
--      Devis sheet lists an F I column per student line (HEBBAZ: 33 000 +
--      33 000 + 18 000 for three children).
--   2. Scolarité per grade (135 000 – 365 000) with the official tranche
--      schedule V2/2V/v3 where 2V = v3 = ~30% of the scolarité (fixed per
--      class) and V2 = ~40% — the REMISE is deducted from V2 ONLY (the
--      workbook's S-column formulas: `=122000-J58`, `=132000-J57`).
--   3. Transport: 20 real towns with per-town totals and tranche splits
--      (40 000 / 43 000 / 52 000 / 55 000 / 57 000 / 65 000 tiers) — the
--      legacy 4-zone tranche splits were WRONG even for their own totals
--      (live: 15k+15k+10k for ville_boumerdes; real: 20k+10k+10k).
--   4. Early annual payment: 5% of the FRAIS DE SCOLARISATION ONLY (the
--      Devis formula `=+SUM(F15:F26)*0.05`) — never of FI or transport, and
--      never 10%.
--   5. Discounts: only sibling_fixed (−5 000 per additional child, the
--      default component of the negotiated remise) and full_annual (5%) are
--      REAL. passage_palier / highest_average / seniority_5y NEVER EXISTED
--      at the school (the 10 000 DZD remises decompose as two 5 000
--      sibling components) → deactivated.
--   6. Services: the REAL billable catalog is the ETAT columns PSY1 / PSY2 /
--      ORTH1 / ORTH2 / E-PLANT / Ratrapage (+ the AUTISTE integration
--      track). The fictional chess/canteen/uniform catalog is retired
--      (additional_services was EMPTY live — nothing to retire).
--
-- SCOPE / SAFETY: this migration touches ONLY the pricing catalog for the
-- CURRENT academic year (future quotes). The historical financial corpus
-- (ledger_entries, installments, payments — imported and reconciled by
-- T-105) is NOT modified: balances are replayed from stored rows, never
-- recomputed from the pricing tables. Older configs (if any) are left
-- untouched for historical reference.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. grade_level_tuition.registration_fee — the per-grade FI (additive column)
-- ----------------------------------------------------------------------------
alter table public.grade_level_tuition
    add column if not exists registration_fee numeric(10,2) check (registration_fee is null or registration_fee >= 0);

-- ----------------------------------------------------------------------------
-- 1b. Missing updated_at columns (the 0006 DDL partially missed the live
--     catalog — the touch_updated_at() triggers exist but their columns
--     never landed, so ANY update on these tables crashed. Additive fix.)
-- ----------------------------------------------------------------------------
alter table public.grade_level_tuition
    add column if not exists updated_at timestamptz not null default now();
alter table public.transport_destinations
    add column if not exists updated_at timestamptz not null default now();
alter table public.additional_services
    add column if not exists updated_at timestamptz not null default now();
alter table public.discounts
    add column if not exists updated_at timestamptz not null default now();
alter table public.complementary_services
    add column if not exists updated_at timestamptz not null default now();

comment on column public.grade_level_tuition.registration_fee is
  'CALC-001 (0088): FI (frais d''inscription) charged PER STUDENT at this grade. NULL = fall back to the client-side real matrix default. The flat pricing_configs.registration_fee is the LEGACY family fee (deprecated).';

-- ----------------------------------------------------------------------------
-- 2. The real 2026/2027 grid for the CURRENT year's active config
-- ----------------------------------------------------------------------------
-- Grade rows: (grade_code, FI, scolarité, V2, 2V, v3) — the tranches sum to
-- the scolarité exactly (constraint tranches_sum_check).
with cfg as (
    select pc.id
      from public.pricing_configs pc
      join public.academic_years ay on ay.id = pc.academic_year_id
     where ay.is_current = true
     order by pc.updated_at desc
     limit 1
),
real_grid(grade_code, fi, annual, t1, t2, t3) as (values
    ('prescolaire_1', 18000.00, 135000.00,  54000.00,  40500.00,  40500.00),
    ('prescolaire_2', 18000.00, 165000.00,  66000.00,  49500.00,  49500.00),
    ('1ap',           25000.00, 220000.00,  89000.00,  65500.00,  65500.00),
    ('2ap',           25000.00, 240000.00,  97000.00,  71500.00,  71500.00),
    ('3ap',           25000.00, 255000.00, 103000.00,  76000.00,  76000.00),
    ('4ap',           25000.00, 265000.00, 107000.00,  79000.00,  79000.00),
    ('5ap',           30000.00, 270000.00, 110000.00,  80000.00,  80000.00),
    ('1am',           25000.00, 305000.00, 122000.00,  91500.00,  91500.00),
    ('2am',           25000.00, 320000.00, 128000.00,  96000.00,  96000.00),
    ('3am',           25000.00, 330000.00, 132000.00,  99000.00,  99000.00),
    ('4am',           30000.00, 340000.00, 136000.00, 102000.00, 102000.00),
    ('1ere_annee',    25000.00, 350000.00, 140000.00, 105000.00, 105000.00),
    ('2eme_annee',    25000.00, 355000.00, 142000.00, 106500.00, 106500.00),
    ('3eme_annee',    30000.00, 365000.00, 146000.00, 109500.00, 109500.00)
)
update public.grade_level_tuition glt
   set registration_fee  = g.fi,
       annual_amount     = g.annual,
       tranche_1_amount  = g.t1,   -- V2 sticker (~40%): the REMISE lands here
       tranche_2_amount  = g.t2,   -- 2V sticker (~30%): fixed
       tranche_3_amount  = g.t3    -- v3 sticker (~30%): fixed
  from cfg, real_grid g, public.academic_levels al
 where glt.pricing_config_id = cfg.id
   and al.id = glt.academic_level_id
   and al.grade_code = g.grade_code;

-- ----------------------------------------------------------------------------
-- 3. Transport: fix the legacy zone splits + add the 20 real towns
-- ----------------------------------------------------------------------------
with cfg as (
    select pc.id
      from public.pricing_configs pc
      join public.academic_years ay on ay.id = pc.academic_year_id
     where ay.is_current = true
     order by pc.updated_at desc
     limit 1
)
-- 3a. CORRECT the legacy zones' tranche splits (their totals were right but
--     the splits were invented: 15k+15k+10k for ville_boumerdes etc.).
update public.transport_destinations td
   set tranche_1_amount = case td.code
           when 'ville_boumerdes' then 20000.00
           when 'tidjelabine_sahel_figuier_corso' then 20000.00
           when 'boudouaou_thenia_zemmouri' then 30000.00
           when 'autres' then 30000.00 end,
       tranche_2_amount = case td.code
           when 'ville_boumerdes' then 10000.00
           when 'tidjelabine_sahel_figuier_corso' then 13000.00
           when 'boudouaou_thenia_zemmouri' then 12000.00
           when 'autres' then 15000.00 end,
       tranche_3_amount = case td.code
           when 'ville_boumerdes' then 10000.00
           when 'tidjelabine_sahel_figuier_corso' then 10000.00
           when 'boudouaou_thenia_zemmouri' then 10000.00
           when 'autres' then 10000.00 end
  from cfg
 where td.pricing_config_id = cfg.id
   and td.code in ('ville_boumerdes','tidjelabine_sahel_figuier_corso','boudouaou_thenia_zemmouri','autres');

-- 3b. INSERT the 20 real towns (idempotent via the unique (config, code)).
with cfg as (
    select pc.id
      from public.pricing_configs pc
      join public.academic_years ay on ay.id = pc.academic_year_id
     where ay.is_current = true
     order by pc.updated_at desc
     limit 1
),
towns(code, label_fr, annual, t1, t2, t3) as (values
    ('boumerdes',         'Boumerdès (ville)',        40000.00, 20000.00, 10000.00, 10000.00),
    ('chabat',            'Chabet',                   55000.00, 30000.00, 15000.00, 10000.00),
    ('chabet',            'Chabet (El Chabet)',       55000.00, 30000.00, 15000.00, 10000.00),
    ('corso',             'Corso',                    43000.00, 20000.00, 13000.00, 10000.00),
    ('sahel',             'Sahel',                    43000.00, 20000.00, 13000.00, 10000.00),
    ('figuier',           'Figuier',                  43000.00, 20000.00, 13000.00, 10000.00),
    ('tidjelabine',       'Tidjelabine',              43000.00, 20000.00, 13000.00, 10000.00),
    ('boudouaou',         'Boudouaou',                52000.00, 30000.00, 12000.00, 10000.00),
    ('thenia',            'Thénia',                   52000.00, 30000.00, 12000.00, 10000.00),
    ('zemmouri',          'Zemmouri',                 57000.00, 30000.00, 15000.00, 12000.00),
    ('djenet',            'Cap Djinet',               55000.00, 30000.00, 15000.00, 10000.00),
    ('cap_djenet',        'Cap Djenet',               55000.00, 30000.00, 15000.00, 10000.00),
    ('bordj_menaiel',     'Bordj Menaïel',            55000.00, 30000.00, 15000.00, 10000.00),
    ('si_mustapha',       'Si Mustapha',              55000.00, 30000.00, 15000.00, 10000.00),
    ('isser',             'Isser',                    55000.00, 30000.00, 15000.00, 10000.00),
    ('ouled_moussa',      'Ouled Moussa',             55000.00, 30000.00, 15000.00, 10000.00),
    ('khemis_el_khechna', 'Khemis El Khechna',        55000.00, 30000.00, 15000.00, 10000.00),
    ('benyounes',         'Benyounes',                55000.00, 30000.00, 15000.00, 10000.00),
    ('souk_elhad',        'Souk El Had',              55000.00, 30000.00, 15000.00, 10000.00),
    ('beni_amrane',       'Beni Amrane',              65000.00, 30000.00, 20000.00, 15000.00),
    ('reghaia',           'Reghaïa',                  65000.00, 30000.00, 20000.00, 15000.00),
    ('rouiba',            'Rouiba',                   65000.00, 30000.00, 20000.00, 15000.00),
    ('ouled_heddadj',     'Ouled Heddadj',            65000.00, 30000.00, 20000.00, 15000.00),
    ('lagata',            'Lagata',                   65000.00, 30000.00, 20000.00, 15000.00)
)
insert into public.transport_destinations
    (pricing_config_id, code, label_fr, annual_amount, tranche_1_amount, tranche_2_amount, tranche_3_amount)
select cfg.id, t.code, t.label_fr, t.annual, t.t1, t.t2, t.t3
  from cfg, towns t
on conflict (pricing_config_id, code) do update
   set annual_amount = excluded.annual_amount,
       tranche_1_amount = excluded.tranche_1_amount,
       tranche_2_amount = excluded.tranche_2_amount,
       tranche_3_amount = excluded.tranche_3_amount,
       label_fr = excluded.label_fr;

-- ----------------------------------------------------------------------------
-- 4. The REAL services (PSY1/PSY2/ORTH1/ORTH2/E-PLANT/Ratrapage/AUTISTE)
-- ----------------------------------------------------------------------------
with cfg as (
    select pc.id
      from public.pricing_configs pc
      join public.academic_years ay on ay.id = pc.academic_year_id
     where ay.is_current = true
     order by pc.updated_at desc
     limit 1
),
services(code, label_fr, amount) as (values
    ('psy1',      'Séances de psychologie — 1er semestre (PSY1)',      10000.00),
    ('psy2',      'Séances de psychologie — 2ème semestre (PSY2)',     10000.00),
    ('orth1',     'Séances d''orthophonie — 1er semestre (ORTH1)',     10000.00),
    ('orth2',     'Séances d''orthophonie — 2ème semestre (ORTH2)',    10000.00),
    ('e_plant',   'Plan d''accompagnement éducatif (E-PLANT)',         20000.00),
    ('ratrapage', 'Rattrapage / soutien scolaire',                     10000.00),
    ('autiste',   'Programme d''intégration (autisme)',                40000.00)
)
insert into public.additional_services
    (pricing_config_id, code, label_fr, amount, billing_model)
select cfg.id, s.code, s.label_fr, s.amount, 'one_time'
  from cfg, services s
on conflict (pricing_config_id, code) do update
   set label_fr = excluded.label_fr,
       amount = excluded.amount,
       is_active = true;

-- ----------------------------------------------------------------------------
-- 5. Discounts: deactivate the 3 fictional rules; full_annual → 5%
-- ----------------------------------------------------------------------------
with cfg as (
    select pc.id
      from public.pricing_configs pc
      join public.academic_years ay on ay.id = pc.academic_year_id
     where ay.is_current = true
     order by pc.updated_at desc
     limit 1
)
update public.discounts d
   set is_active = case d.code
           when 'passage_palier' then false   -- fictional (CALC-001)
           when 'highest_average' then false  -- fictional (CALC-001)
           when 'seniority_5y' then false     -- fictional (CALC-001)
           else true
       end,
       amount = case d.code when 'full_annual' then 5.00 else d.amount end,
       label_fr = case d.code
           when 'full_annual' then 'Paiement annuel avant le 30 juin (−5% scolarité)'
           when 'passage_palier' then 'Passage de palier [RÈGLE FICTIVE — désactivée]'
           when 'highest_average' then 'Meilleure moyenne du palier [RÈGLE FICTIVE — désactivée]'
           when 'seniority_5y' then 'Ancienneté > 5 ans [RÈGLE FICTIVE — désactivée]'
           else d.label_fr
       end
  from cfg
 where d.pricing_config_id = cfg.id;

-- ----------------------------------------------------------------------------
-- 6. pricing_configs: pin the 5% rate + the June 30 deadline (current year)
-- ----------------------------------------------------------------------------
with cfg as (
    select pc.id, ay.start_date
      from public.pricing_configs pc
      join public.academic_years ay on ay.id = pc.academic_year_id
     where ay.is_current = true
     order by pc.updated_at desc
     limit 1
)
update public.pricing_configs pc
   set early_payment_bonus_pct = 5.00,
       early_payment_deadline = make_date(date_part('year', cfg.start_date)::int, 6, 30),
       updated_at = now()
  from cfg
 where pc.id = cfg.id;

-- -- ============================================================================
-- Registration (T-091/MIG-TOKENS pattern: file + registration in ONE atomic
-- transaction when applied live — the apply script handles that).
-- ============================================================================

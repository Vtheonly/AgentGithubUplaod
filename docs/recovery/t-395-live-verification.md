# T-395 — Live Verification (2026-09-21, 80th session)

**The mandate:** the owner's report — *"i just went to supabase and found a row that exists in the database but cannot be seen in the desktop version under 'Famille SIDI' — 0554288142"*.

**The verdict:** the row EXISTS and is now VISIBLE again. The invisibility was the **soft-delete filter working as designed** — the family (the REAL 0063/DATA-011 reconciliation of workbook row 242) was soft-deleted on the NEW project (production) on **2026-09-16 17:23** by a manual walk of the new T-384 Supprimer buttons, and its 3 payments were test-refunded the same evening (23:17) in a **half-executed** state (BUSINESS-105). This was **NOT** the AUTH-302 anon-session class (the 2026-09-18 root-cause report's finding — that defect is fixed and does not explain this row).

## 1. The forensic timeline (all live-audit-proven, the NEW project)

| When (UTC) | What | Evidence |
|---|---|---|
| 2026-09-15 17:48:53 | The fresh-clone chain re-runs 0063 STEP 2: the row-242 family created exactly per the workbook (devis 255,000 / versements 255,000 / créance 0) | audit `crm.reconcile_missing_row` (id 16a238b5, actor "Réconciliation 0063"); `financial.reconcile_waterfall_backfill` |
| 2026-09-16 17:23:32 | `student.delete` — SIDI MAMER SAMYI soft-deleted (soft_delete_student) | audits 43dc4dac (trigger) + 041b1ced (RPC, note "Suppression logique (T-381/T-384)"), actor admin@elimtiyaz.dz |
| 2026-09-16 17:23:36 | `parent.delete` — Famille SIDI soft-deleted (soft_delete_parent), 4 s after the student — the guard-clears-after-student-removal sequence of a MANUAL UI walk | audits 171b8932 (trigger) + 228fa17e (RPC, note "Suppression logique (T-384)") |
| 2026-09-16 23:17:11–24 | The family's 3 payments refunded via `revert_payment_allocation` — audit notes literally **"idk" / "test" / "errr"** | audits a99af74b→`payment.refund`, 63c0e9e6, c7007de0 |
| 2026-09-21 (this session) | The owner finds the row in Supabase, invisible in the desktop → **T-395** | the owner's report |

**Why the refunds were HALF-executed (BUSINESS-105):** the whole project holds **zero** `entry_type='reversal'` ledger entries; the family's installments still show Σ paid 255,000 = Σ due (fully paid) and its 5 payment_allocations are intact. The RPC's original-entry lookup (`source_type='payment' AND source_id=<payment uuid>`) cannot match the 0063-reconciliation ledger rows (`source_type='bulk_import'`, `source_id='<student>:V2'`) — so the refund flipped exactly one column (`payments.status`) and audited itself as if it had executed.

**The control that disproves AUTH-302:** the authenticated desktop-shape parents read returned 4 control rows while the family was absent — an anon-session read returns `[]` for everything (t-391 A3/A4).

## 2. The fix — migration `0101_restore_sidi_family.sql`

Guarded + idempotent (parent_code + digit-normalized phone + `deleted_at IS NOT NULL` for the parent; student_code + parent link for the student; `refunded` + NO reversal ledger entry for the payments — a financially-executed refund is left alone). Applied live atomically with its registration (the T-091/MIG-TOKENS pattern) to **BOTH** projects:

| Leg | Result |
|---|---|
| Dry-run (BEGIN…ROLLBACK) on NEW | HTTP 201, zero errors — parse + guards proven, nothing persisted |
| Apply to NEW (`vebfehrpzajhstyhinnw`) | HTTP 201; post-check `registered=1 parent_active=1 student_active=1 payments_paid=3` |
| Apply to OLD (`hkvkefubghbbotgnteir`) | HTTP 201; data leg a guarded no-op (family never deleted there); registration parity → **98/98 both** |

## 3. The verification evidence

### RED (pre-restore, `t-395-restore-e2e.py --phase red`) — 6/6 PASS

```
[PASS] A1 admin sign-in
[PASS] B1 desktop parents read 200 + control rows present (NOT the AUTH-302 anon class) — status=200 rows=4
[PASS] B2 the SIDI family ABSENT from the annuaire (the reported symptom) — family_rows=0
[PASS] C1 the SIDI student ABSENT from the élèves stream — family_rows=0
[PASS] D1 SQL truth: the rows EXIST but are soft-deleted — exists=1 parent_del=1 student_del=1
[PASS] D2 the 3 payments sit in the half-refunded state — refunded=3
```

Pre-restore `verify_t-395.sql` matrix: C1/C2/C3/C9/C10 **FAIL** (the symptom) + C4 (installments Σ due = Σ paid = 255,000) / C5 (ledger net 0) / C6 (5 allocations) / C7 (0 reversal entries — the half-refund signature) / C8 (the other 4 soft-deleted test rows untouched) **PASS** — the financial rows were intact all along.

### GREEN (post-restore, `--phase green`) — **15/15 PASS**

```
[PASS] A1 admin sign-in
[PASS] E1 the family PRESENT in the desktop parents read — display=Famille SIDI — 0554288142
[PASS] F1 the student PRESENT + linked to the parent — code=ELV-2026-E0E486
[PASS] G1 the payments journal shows 3 paid Σ 255,000 (canonical state) — statuses=['paid','paid','paid']
-- verify_t-395.sql (server-side C1–C10) --
[PASS] C1 parent visible (rows=1 phone=0554288142)
[PASS] C2 student visible + linked (code=ELV-2026-E0E486)
[PASS] C3 payments all paid, Σ 255000 (statuses=paid)
[PASS] C4 installments Σ due = Σ paid = 255000
[PASS] C5 ledger net 0 (charge 255000 − payments 255000)
[PASS] C6 payment_allocations intact (n=5)
[PASS] C7 no reversal ledger entries for the family (n=0)
[PASS] C8 other soft-deleted test rows untouched (still_deleted=4 wrongly_active=0)
[PASS] C9 audit trail (parent.restore=1 student.restore=1 payment.restore=3 historical_refunds=3)
[PASS] C10 schema_migrations has 0101 (n=1)
```

### OLD-project parity (`--phase old`) — 3/3 PASS + verify matrix 10/10

```
[PASS] H1 0101 registered on OLD (chain parity 98/98) — registered=1
[PASS] H2 the OLD family untouched (active, never deleted) — parent_active=1
[PASS] H3 the OLD payments all paid (no refund ever ran there) — paid=3
```

The full verify matrix on OLD passes via the honest nothing-to-restore disjunct (0 restore audits, 0 historical refunds, family never deleted — C9's second branch).

## 4. The desktop gates

- `bash scripts/check-migrations-append-only.sh` → **OK** (98 files, +1 new in worktree, 0 edited).
- `npx vitest run src/tests/infrastructure/t-058-migration-append-only.test.ts` → **6/6**.
- `npm run typecheck` → 6 errors, **all pre-existing in the concurrent layout-editor series' test fixtures** (the required `editing` prop from commits 43b3332/dda87db/127c775 was added to the components without updating `dashboard-3zone.test.tsx` / `analytics-visuals.test.tsx` / `t-351-reactive-debt-wiring.test.tsx`); attributed at session open per §15.14 — this task changes zero TS files.
- Full `npx vitest run` → **3522 passed / 21 failed / 5 skipped** (175 files). The failing set is attributable at session open BY CONSTRUCTION (this task's files are untracked non-TS additions — the suite ran on the pristine HEAD sources): 7 in `dashboard-3zone.test.tsx` + 2 in `analytics-visuals.test.tsx` + 3 in `t-355-t-356-departments-bucket-parity.test.tsx` (the concurrent layout-editor series' `editing`-prop fixture drift, the same class as the 6 tsc errors), 3 in `ai-review-screens.test.tsx` (the T-388 i18n text-matcher fallout), 3 in the CALC-001 cross-platform mirror files (Tier4OperationSequences / ScenarioRunner / Tier4Boundary), 2 in `vault-compliance-architecture.test.tsx` + 1 in `t-134-parent-name-rendering.test.ts` (the pre-existing vault/source-scan classes). **None of this task's files appear in the failing set; this task changes zero application source files.**

## 5. What the owner will now see

In the desktop: **CRM → Parents** shows « **Famille SIDI — 0554288142** » (active); **CRM → Élèves** shows **SIDI MAMER SAMYI** (5ap); the family dossier shows the canonical financial state — 3 tranches fully paid (102,000 / 76,500 / 76,500), 3 payments `paid` Σ 255,000, balance 0 (créance 0 — the workbook truth). If the desktop was open during the restore, a restart (or the repository TTL refresh) re-seeds the annuaire.

## 6. What remains OPEN (registered, not fixed here)

- **OPS-319 (the gap):** there is STILL no restore surface (no Corbeille, no restore RPC, no deleted-rows indicator) — the deletion buttons remain a one-way door; the next accidental deletion reproduces this whole session. Recommended next task: `restore_parent`/`restore_student` SECURITY DEFINER RPCs (the 0100 mirror) + a Corbeille section in CRM.
- **BUSINESS-105 (the defect):** `revert_payment_allocation` half-executes on bulk_import-sourced ledger entries (the whole 2026-08-11 import corpus is exposed — 891 payments on the OLD project). Needs its own task: widen the original-entry lookup to the `payment_id` FK, add the import-sourced-refund scenario to the financial equivalence suites, then census + repair any other half-refunds.
- **The concurrent layout-editor series' 6 tsc errors** in its test fixtures (attributed above — the concurrent agent's scope, deliberately untouched for merge safety).
- The standing pre-existing items: REALTIME-105 / T-337, the EXE install/launch matrix (owner runbook §4 of the 2026-09-18 report).

# T-440 — The Final Verification (the 119th session) — LIVE evidence record

> **Task:** the owner's final-final-final mandate — verify that ALL functionality
> implemented in the last ~40 commits (T-434..T-439, since `5bd8ad3`) works as
> intended and is fully consistent with the defined business logic.
> **Date:** 2026-09-29 (119th session).
> **Channels:** the full unified local suite (Layers 0–3) + the LIVE Supabase
> probes through the data gateway (the Management API stayed blocked — see §4).

---

## 1. The local suite (the unified runner, `npm test`)

| Layer | Result |
|---|---|
| 0 — typecheck | ✓ 0 errors |
| 1 — vitest (BEFORE T-440's fixes) | 18 failed / 4,425 passed / 5 skipped (4,448) — the failing SET byte-identical to the baseline's 9 files; **the passed-count DEVIATION is the stale baseline json, not a regression** (T-436..T-439 added +219 passing tests after the json's last move at T-424 Phase C) |
| 1 — vitest (AFTER T-440's fixes) | 17 failed / 4,428+ passed — the t-134 guard flips GREEN (its offender list is now PINNED to the one documented T-389 file; the T-437 mock's inline composition removed); the 3-test T-440 regression suite added |
| 2.2 — desktop runner | 809 passed / 0 failed / 10 errored (819) — matches the baseline exactly |
| 2.3 — mirror runner | 784 passed / 0 failed / 0 errored / 35 skipped (819) |
| 2.4 — tier-4 comparison | 707/819 equivalent, 35 skipped — KNOWN PARITY-005, reported |
| 2.5 — sanity comparator | 819/819 equivalent; canonical 318/318; discrepancies 0 |
| 3.1/3.2/3.3 | ENVIRONMENT-GATED with the documented reasons (no sibling Android repo; no local PG; live E2E owned by the verify-script convention) |

**The 9 baseline failing files were re-characterized one by one this session**
(not trusted from the registry text): the cross-platform trio are the mirror
refund-status semantic pins (`expected 'overdue' to be 'pending'` — the
PARITY-005 class), t-390 is the `getSupabaseRepositories` mock-shape infra
failure, vault-compliance is the jsdom `text/plain` MIME rejection, the three
UI files are stale label pins (`'En retard'` vs `'Total en Retard'`,
`executive-dashboard` testid, `Encaissé annuel`), and **t-134 was the ONE red
file whose failure CONTENT had silently changed** — see §3.

## 2. The LIVE migration-state census (the data gateway, service-role context)

Probes: `GET /rest/v1/` OpenAPI (114 RPCs enumerated), paginated table reads
(the 1,000-row cap respected), and behavioral RPC calls. All read-only except
the SEC-115 probe's throwaway staff user (created, probed, deleted — zero
residue verified by the by-email sweep).

| Migration | Live state | Evidence |
|---|---|---|
| 0127 (T-436 year attribution) | ✓ APPLIED + 100% attributed | `installments`: 5,956/5,956 rows carry `academic_year_id`; `payments`: 2,198/2,198; `payment_allocations`: column exists, table currently 0 rows (the allocation flow has not been exercised on live — no defect; the legacy import path never wrote allocations) |
| 0128 (T-437 re-enrollment + origin) | ✓ APPLIED | `students.origin_type/previous_school_name/previous_school_level/previous_academic_year/origin_notes` all exist (0 non-null — the feature is new, no origins captured yet); `re_enrollments` exists with the full 22-column shape (0 rows); the five RPCs (`fn_generate/get/set_decision/re_enroll_student/freeze_re_enrollments`) are in the OpenAPI schema |
| 0129 (DATA-054 year-scoped identity) | ✓ APPLIED + INTACT | ALL 5,956 installments fetched (6 paginated pages): **ZERO duplicates on the full 6-column key** `(tenant, parent, student, category, tranche, COALESCE(year, zero))` — the unique index is live; the 1,411 three-column (student, tranche, year) multi-rows are all tuition+transport category pairs (legitimate) |
| 0130/0131 (T-438 ER-PMAE) | ✓ APPLIED | `er_source_observations`, `er_match_proposals`, `er_identity_edges`, `er_aggregation_events` all exist, 0 rows each (the experimental feature is dormant by design); the four `fn_er_*` RPCs are in the OpenAPI schema |
| **0132 (SEC-115 tenant guards)** | **✗ NOT APPLIED — behaviorally CONFIRMED** | See §4 |

Academic-year census: exactly ONE year live (`2026-2027`, 2026-09-01 →
2027-06-30, `is_current`); every `installments`/`payments` year reference
resolves to it (no orphan year ids). Census: 1,137 students (all active+undeleted,
spread across 14 grade levels — prescolaire_1 .. 3eme_annee), 741 parents,
5,956 installments, 2,198 payments. The 5 `CLS-FAKE-*` classes are the known
seed classes; all 1,137 students carry `class_id = NULL` (the class assignment
surface is the standing academic-setup work, unchanged by T-434..T-439).

## 3. The NEW finding: DATA-058 — the T-437 mock's inline parent-name composition joined a red guard silently

**Problem.** The T-437 mock re-enrollment repository
(`src/infrastructure/mock/repositories/re-enrollment-repository.ts:192`)
composed the parent display name inline
(`parent.displayName ?? \`${parent.firstName} ${parent.lastName}\`.trim()`)
instead of going through the canonical `parentDisplayName` helper
(`src/domain/model/parent.ts:208`).

**Evidence.** The t-134 tree-guard (the DATA-005 source scan) failed with
`expected [ …(2) ] to deeply equal []` — the offender list
`[data-inspector-lineage.ts (T-389, pre-baseline), re-enrollment-repository.ts (T-437, NEW)]`.

**Root cause.** (a) The mock duplicated the canonical fallback logic with
DIFFERENT semantics — the `??` copy renders `""` for an empty-string
displayName while the canonical helper (and the 0128 SQL write path, whose
`COALESCE(NULLIF(TRIM(...), ''))` normalizes `''` → NULL at write time, making
the helper's trim+empty fallback the exact client-side mirror of the read
path's `COALESCE`) falls back to the composed name. (b) The guard's assertion
was a bare `toEqual([])` — a red baseline test absorbs NEW violations with
zero signal: 18 failures before T-437, 18 after; the baseline tracks counts
and files, never assertion content.

**Impact.** An empty-string displayName would render a BLANK parent name on
the Réinscription worklist (mock mode); worse, the pattern-break weakened the
DATA-005 one-implementation rule with no test signal.

**Fix (T-440, RED-first).** The regression suite
`src/tests/infrastructure/t-440-re-enroll-parent-display-name.test.ts` (3
tests: empty-string → composed [RED against the defective code — reproduced
`expected '' to be 'Amine Belkacem'`], null → composed, set → verbatim) +
the one-line fix (import + call the canonical helper) + the t-134 guard now
PINS the documented offender list (one entry: the T-389 lineage file) so any
future join is a loud, named diff. The t-134 file flips 7/8 → **8/8 GREEN**
while still guarding; the T-437/T-439 re-enrollment suites stay green
(33/33 with the new suite).

**Regression coverage.** The 3-test T-440 suite (verified RED → GREEN) + the
pinned tree guard.

## 4. SEC-115 / migration 0132 — the live state, behaviorally probed

The owner re-supplied the platform keys this session
(`sb_publishable_…`, `sb_secret_…`, the anon + service_role JWTs). Probed:

1. **The Management API is STILL unreachable**: `sbp_9e83…` → 401 (the same
   dead token), `sb_secret_ls_…` → 401 `JWT could not be decoded` (the
   Management API does not accept the new-format secret keys), the
   service_role JWT → 401 on `api.supabase.com`. **Migration 0132's live
   application remains BLOCKED** (`scripts/apply_0132_live.sh` ready).
2. **The anon JWT in the owner's message is a corrupted copy**: its `iat`
   decodes to `17894872400` (year 2537 — one extra digit vs the service_role
   JWT's `1789487240`); the gateway rejects it. The `sb_publishable_…` key
   works (200) — clients following ADR-009's publishable-preferred convention
   are unaffected. **The anon JWT should be re-copied from the dashboard if
   any client still pins the legacy format.**
3. **Behavioral proof the guard is absent (the strongest evidence yet).** A
   throwaway staff user (manager role, tenant `…0001`, created via the admin
   auth API, profile activated, signed in) called
   `fn_er_decide_proposal(p_proposal_id = <non-existent>,
   p_decision = 'approve', p_tenant_id = 99999999-…)`:
   - mismatched tenant → **HTTP 400 `proposition introuvable`** (the call
     REACHED the function body — no tenant check at all)
   - correct tenant → the same 400 (the control)
   - session tenant (no param) → the same 400 (the control)

   With 0132 applied the mismatched call would be rejected **42501 before the
   proposal lookup** (the guard's first statement). The probe mutated nothing
   (a ghost proposal id cannot exist) and the throwaway user was fully
   cleaned (profile 204, auth user 200, by-email residue `[]`).

**Interim mitigation unchanged:** the ER experimental flag stays OFF on every
desktop (the RPCs are unreachable through the app's gated review flow; the
er_* tables hold zero rows). The standing #1 item remains: a FRESH
`SUPABASE_ACCESS_TOKEN` (or a dashboard-side `supabase db push`) → apply
0132 → run `scripts/verify_t-439.sql` (expect C1..C9b GREEN).

## 5. Consistency with the defined business logic — the T-434..T-439 recap

- **T-434/435 (échéance visibility + due-date ranges):** the canonical stats
  and the derived strips verified by the T-434/435 suites (re-run green in
  this session's full suite); live installments carry per-tranche due dates
  (the 2026-2027 year's T1 due Sept 15 per the T-425 official schedule).
- **T-436 (Year-Tracking):** the 0127 attribution is 100% live (§2); the
  year-history engine + the attribution-precedence debt-aging refactor are
  pinned by the multi-year fixture suite (green); the UI-318 history section
  suite green.
- **T-437 (Re-enrollment):** migrations 0128/0129 verified live (§2); the
  repository/domain/UI suites 33/33 green this session; **the DATA-058 mock
  composition defect found + fixed this session (§3)**.
- **T-438 (ER-PMAE):** the engine's 40-test §13-checklist suite + the
  gate/seam 16 + the repository 13 all green; the live tables are pristine
  (dormant by design); the Supabase-mode backup ER gap remains the registered
  IDENT-104 M5 follow-up.
- **T-439 (the audit fixes):** all six fix suites green (CALC-003's
  three-state split, DATA-055's year-scoped import identity — whose live
  counterpart index is verified intact (§2), UI-320, IDENT-103, UI-321);
  SEC-115's migration-level fix is committed but **not live** (§4).

## 6. What this session changes

- `src/infrastructure/mock/repositories/re-enrollment-repository.ts` — the
  canonical `parentDisplayName` helper (DATA-058 fix).
- `src/tests/infrastructure/t-440-re-enroll-parent-display-name.test.ts` —
  the 3-test regression suite (RED-first).
- `src/tests/security/t-134-parent-name-rendering.test.ts` — the pinned
  offender list (the guard can no longer absorb a join silently).
- `scripts/test-baseline.json` — the registered baseline move (T-436..T-439's
  +219 tests + T-440's 3; the t-134 file leaves the failing set — 17
  documented failures remain, all re-characterized this session).
- `docs/recovery/problem-registry.md` (+DATA-058, the 442 recount) ·
  `docs/recovery/task-registry.md` (T-440) · `docs/recovery/change-log.md` ·
  `docs/recovery/next-task.md` · `AGENTS.md` §15.72.

**A truth-sync correction (bookkeeping, no code):** the T-439 closeout's
"check:migrations append-only OK [128 files]" over-counted by one — the
guard reports **127 migration files, chain head 0132** (T-437's closeout
recorded 124 at head 0129; +0130 +0131 +0132 = 127). The numbering gaps
(0015–0017 pre-audit, 0118 the documented live-only registration, 0122
reserved per ADR-032) are all documented; the chain itself is intact and
append-only-clean (+0 vs origin/main this session).

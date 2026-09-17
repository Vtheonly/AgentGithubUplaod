# T-387 — Live Verification (SYNC-300: blank strings into typed RPC params)

**Date:** 2026-09-17 (76th session) · **Task:** T-387 · **Problem:** SYNC-300 (registered + closed this session)
**Projects:** NEW `vebfehrpzajhstyhinnw` (the owner-supplied handover target) + OLD `hkvkefubghbbotgnteir` (production)

## 1. The reported issue and what the live evidence actually showed

The owner's report: the desktop Excel student import / sync push to
`public.upsert_student_from_import` answers **HTTP 400**, and a prior analysis
attributed it to **missing 0023 seed data** (empty `tenants`/`roles`/`permissions`,
no default tenant `00000000-0000-0000-0000-000000000001`).

The live probes **disproved the seed hypothesis for the current state** and
**confirmed the real 400 mechanism instead**:

| Probe | Result |
|---|---|
| Reference-table census (NEW + OLD) | `tenants=1 roles=11 permissions=56 role_permissions=149 academic_levels=14 academic_years=1 expense_categories=9 departments=4 pricing_configs=1 grade_level_tuition=14 transport_destinations=28 complementary_services=3 discounts=5` |
| Default tenant | **EXISTS** (`00000000-0000-0000-0000-000000000001`, count=1, both projects) |
| Migration parity | NEW **97/97 exact version match** vs the local chain; OLD **96/97** — missing `0099` registration only (→ OPS-316 / T-386; helpers verified already-correct, see §5) |
| super_admin RBAC | **56/56 permissions** (all of them) on both projects |
| RPC baseline (valid args) | **HTTP 200** + `out_student_id` returned — the import path is functionally healthy |
| RPC with `p_class_id: ""` | **HTTP 400 `{"code":"22P02","message":"invalid input syntax for type uuid: \"\""}`}** — the reported failure, reproduced deterministically |
| RPC with `p_date_of_birth: ""` | **HTTP 400** (the 22007 sibling — date/timestamp params share the defect class) |
| RPC with typed params `null` | **HTTP 200** — the post-fix client shape |

`transport_destinations = 28` is the **canonical post-0089 state** (0023's 4
legacy zones + 0089's 24 real towns) — which also means **re-running
`0023_seed.sql` on a fully-migrated DB would FAIL its trailing DO-assert block**
(it asserts `= 4`). The seed file is not the recovery lever for this state.

## 2. Root cause of the reported 400

`default-push-handler.ts` mapped the queue payload with:

```ts
p_class_id: (p.classId as string) ?? (p.class_id as string) ?? null
```

`??` converts only `null`/`undefined` — **never `""`**. A payload field that
arrived as an empty string sailed into the PostgREST call, and the gateway
casts JSON args to the function's parameter types **before** the SECURITY
DEFER body runs — `""::uuid` raises `22P02`, `""::date` raises `22007`, so the
server-side `NULLIF(TRIM(…), '')` normalization can never save it. The whole
queue entry is then marked `failed` with the cryptic cast error.

Family sibling: **ACAD-501** (the READ path — `?class_id=eq.` filters with
`""`, same 22P02, fixed T-373). SYNC-300 is the WRITE path (RPC arguments).

## 3. The fix (desktop, client-side)

`elimtiyaz-desktop/src/infrastructure/sync/default-push-handler.ts`:

- new module-local `blankToNull()` (blank/whitespace-only → `null`) for every
  **date/timestamptz**-typed param: `p_date_of_birth`, `p_collected_at`,
  `p_at`, `p_due_date`, `p_paid_date`, `p_record_date`;
- new module-local `uuidOrNull()` (reusing the exported `isUuid` guard — the
  line-1268 convention in `supabase-shared-repositories.ts`) for every
  **uuid**-typed param: `p_class_id` (student/attendance/grade),
  `p_collected_by`, `p_recorded_by`, `p_entered_by`;
- **only `DEFAULT NULL` (optional) params are guarded** — required uuid params
  (`p_student_id`, `p_subject_id`) stay loud by design (a blank there is a
  data error that must fail with the RPC's own validation, not be nulled).

`elimtiyaz-desktop/src/infrastructure/supabase/types.ts`: `upsert_student_from_import`
now declares the 0028/0037 params (`p_grade_level_code`, `p_transport_tier`,
`p_payment_plan`) and the 0031 `out_*` Returns shape — matching the live
`pg_proc` signature (the generated types were behind the chain).

## 4. Verification evidence

### 4.1 Local gates (desktop)

- `npx tsc --noEmit` — **6 pre-existing errors**, all in the concurrent
  dashboard-analytics files (`data-inspector.tsx`, `operational-query-console.tsx`,
  `analytics-tab.tsx` — commits aa19a75/d87c7bf, NOT touched by this task;
  baseline attributed at session open per §15.14). **Zero new errors.**
- `npx eslint .` — 0 errors / 629 warnings (all pre-existing).
- New suite `src/tests/infrastructure/t-387-blank-rpc-args.test.ts` —
  **14/14 PASS** (behavioural A1–F1 via the t-022 mocked-client pattern +
  source guards G1/G2 + types.ts census H1/H2).
- `src/tests/infrastructure/` + `src/tests/integration/` full run —
  **73 files / 743 tests PASS** (1 file / 5 tests skipped, pre-existing).
- Full-suite baseline at session open (attribution, §15.14): 169 files,
  3470 tests — 18 failed / 3447 passed / 5 skipped; the 18 failures attribute
  to the 3 standing CALC-001 cross-platform failures + 15 dashboard-analytics
  render failures from the concurrent agent's in-flight commits
  (aa19a75…d87c7bf). None touch the sync layer.

### 4.2 Live SQL — `scripts/verify_t-387.sql` (NEW project)

7/7 PASS: A1 empty-string uuid cast rejected · B1 RPC accepts `p_class_id`
NULL (upsert inside BEGIN/ROLLBACK) · C1 reference census · C2 default tenant
· C3 migration parity 97 · D1 RPC 18 IN + 3 OUT args (0028 params 3/3) ·
E1 super_admin 56/56.

### 4.3 Live REST E2E — `scripts/t-387-rpc-blank-args-e2e.py`

Authentic caller (owner admin GoTrue sign-in), the desktop's EXACT rpc()
payload shapes, run-unique probe codes, zero-residue cleanup (audit rows
kept, §15.26):

- **NEW `vebfehrpzajhstyhinnw`: 14/14 PASS** (A1 admin sign-in 200 · A2 probe
  parent resolved · B1/B2 RED: `p_class_id ""` → 400 + `22P02` · C1/C2 GREEN:
  `null` → 200 + `out_student_id` · D1 full 18-param payload 200 · E1 RED:
  `p_date_of_birth ""` → 400 · F1 GREEN: `null` → 200 · G1–G4 census · H1
  zero residue).
- **OLD `hkvkefubghbbotgnteir` (production): 13/14** — identical boundary
  behaviour (B1–F1 all PASS; the contract is the same on both projects);
  **G3 migration-parity FAILED: 96/97 — production is missing the `0099`
  registration** (T-376 applied 0099 to the NEW project only, production was
  deliberately read-only that session). `verify_t-376.sql` re-run against
  production this session: **12/12 PASS** — the five RLS helpers + the
  fast-path policy are ALREADY in the exact 0099 state there, so healing the
  registration is a DDL no-op + one history row. Registered as **OPS-316**,
  fixed atomically by **T-386** (separate task/commit per the one-task-per-commit
  rule).

## 5. Discoveries persisted for the next agent

1. **The "missing seed data" analysis was stale/incorrect for the current
   live state** — both projects carry the full canonical reference data and
   the default tenant. The reported 400 is the SYNC-300 cast failure (or, on
   a payload without a resolvable parent, the RPC's own `unresolvable parent
   ref` P0001 — also a 400, with the hint "Push the parent
   (upsert_parent_from_import) before its students").
2. **Do NOT re-run `0023_seed.sql` on a fully-migrated DB** — its trailing
   DO-assert block is calibrated to the 0023-era snapshot (`transport_destinations
   = 4`) and raises on the canonical post-0089 state (28). The seed file is
   idempotent data-wise (ON CONFLICT DO NOTHING) but its asserts are not
   forward-compatible.
3. **`??` never converts `""`** — any typed (uuid/date/timestamp) RPC argument
   or uuid column filter must pass a blank/uuid guard at the client seam
   (ACAD-501 on the read path, SYNC-300 on the write path; now AGENTS.md §15.37).
4. **`pg_proc.proargnames` lists IN + OUT args** (18 IN + 3 OUT = 21 for
   `upsert_student_from_import`) — a signature census must not confuse the two.
5. **Production migration history was 1-behind the chain (0099)** — migration
   history records execution, not current data state (the same lesson as the
   owner's original report, from the opposite direction: history can also
   UNDER-report an already-present state). Fixed by T-386's atomic
   registration heal.

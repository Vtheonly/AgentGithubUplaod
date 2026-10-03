# T-470 — Live verification (the 137th session, 2026-10-03): the 0138 application state settled + the TEST-502 repair's live legs

> The session's live mandate had two halves: (1) settle migration 0138's live-application state (the 136th session's one owner-gated step — the owner re-supplied working tokens), and (2) verify the TEST-502 repair's conclusions against the live backend where they touched server semantics. This document is the evidence record (AGENTS.md §11.1 / §13: no VERIFIED claim without it).

## 1. The credentials (verified working, data-gateway-first per §15.77)

| Leg | Result |
|---|---|
| Data gateway (`sb_secret_…` as apikey+Bearer on `/rest/v1/`) | **GREEN** — `system_settings` SELECT returned rows (HTTP 200, body `[{"key":"supabase.url"}]`) |
| Management API SQL endpoint (`sbp_…` on `api.supabase.com/v1/projects/vebfehrpzajhstyhinnw/database/query`) | **GREEN** — HTTP 201 on every query (the §15.26 documented success code) |

## 2. The session-opening drift census (§15.11)

Local chain: **133 files** (0001–0138, no 0118, 0122 reserved-absent). Live `supabase_migrations.schema_migrations`: **134 rows** — the local chain **plus the stray `0118 / purge_student_parent_domain`** registration.

**Verdict: NO actionable drift.** The stray 0118 row is the DOCUMENTED live state (the off-repo actor of 2026-09; migration 0120's header carries "THE LIVE-0118 RECONCILIATION (PURGE-500, AGENTS.md §57c)" and drops every existing overload of the function before creating the canonical one — so the double application is reconciled by design, and the extra registration row is inert metadata). A fresh deployment from the local chain produces the same schema.

## 3. Migration 0138's live state — ALREADY APPLIED (by the owner or the concurrent agent, before this session)

The live chain head is `0138 / debt_amount_thresholds_and_messages`. The 136th session's closeout recorded the apply as the one owner-gated step whose token was lost; by the time this session ran, the registration row, the six seeds, and the recreated reader were all live. **This session did NOT re-apply anything** (§15.9: never re-run an applied migration); it VERIFIED the application in place.

### 3.1 The first verify run — 9/12, and the three failures were VERIFY-SCRIPT defects, not migration defects

`SUPABASE_ACCESS_TOKEN=sbp_… bash scripts/run_verify_sql_live.sh scripts/verify_t-469.sql` → HTTP 201, **9/12**:

| Check | Result | Root cause of the failure |
|---|---|---|
| C3_reader_extended_payload | ✗ `READER-FAILED` | The check called the staff-gated reader **at session role** (no JWT, no tenant) — the gate correctly raised `forbidden: debt thresholds are a staff surface` (captured by a direct probe). The check as authored could never pass, on any correctly applied migration. |
| C4_day_keys_unchanged | ✗ | Same probe-context defect as C3 (shared `v_reader`). |
| C7_staff_reads_extended | ✗ `invalid input syntax for type json` | **Operator-precedence bug in the check's own detail string**: `coalesce(v_payload->'levelMessages'::text,'?')` parses as `v_payload -> ('levelMessages'::text)` → a `jsonb` fed to `coalesce` against the text `'?'` → Postgres coerces the literal to jsonb → `'?'` is not valid JSON → the INSERT throws inside the check's own exception handler. The reader call itself had SUCCEEDED. Confirmed by a minimal live probe: the buggy expression reproduces the exact error; `(v_payload->'levelMessages')::text` returns the object. |

All other checks were GREEN on the first run: C1 (six seeds per tenant), C2 (yellow 20000 / red 60000 / four empty messages), C5/C5b/C5c (the ACL: anon denied, authenticated granted), C6 (registration row), C8 (the configured round-trip), C9 (the non-staff refusal), C10 (the boundary matrix).

### 3.2 The repair + the second run — 12/12

**The convergence note (recorded during the rebase onto the concurrent round):** the concurrent T-469 live-apply round (`fix/t469-0138-live-apply`, merged as origin/main `c984924`) had ALSO discovered and repaired the same three verify-script defects in the same window — converging on the IDENTICAL C7 cast fix, with their C3/C4 repair taking the catalog-level `pg_get_functiondef` route while this round's took the role-downgraded runtime-payload route. The reconciled script keeps BOTH layers: their definition checks (C3/C4) prove the reader's SOURCE carries the contract; this round's runtime assertions (C3b/C4b) prove the RETURNED jsonb actually does. The merged script's live re-run: **14/14** (the 12 checks + C3b/C4b), all True — see §3.3. The round also carried the DOA VALUES-typing repair of migration 0138 itself (the first apply died 22P02; §15.83a/b of AGENTS.md) — which is why this session found 0138 already applied and in place.

The three defects as this session repaired them (the original record, pre-rebase):

- C3/C4 moved into the role-downgraded `$behavior$` block as payload-key assertions on the same admin read C7 performs; the C7 detail cast fixed to `(v_payload->'levelMessages')::text`. Re-run of this round's version:

```
C1_six_seeds_per_tenant    | True | tenants=1 tenants_missing_keys=0
C10_boundary_matrix        | True | below_yellow=true, at_yellow_inclusive=true, at_red_inclusive=true, above_red_exclusive=true
C2_seeded_values           | True | yellow=20000 red=60000 empty_messages=4
C3_reader_extended_payload | True | keys={"redDays": 60, "yellowDays": 15, "amountRedDzd": 60000, "levelMessages": {...}, "amountYello…
C4_day_keys_unchanged      | True | the T-443 day contract intact
C5_acl                     | True | args= (acl: check via has_function_privilege below)
C5b_anon_denied            | True | anon EXECUTE revoked
C5c_authenticated_allowed  | True | authenticated EXECUTE granted
C6_registration            | True | rows=1
C7_staff_reads_extended    | True | yellow=20000 red=60000 msgs={"red": "", "green": "", "orange": "", "yellow": ""}
C8_configured_round_trip   | True | yellow=35000 msg_red=Contentieux — convoquer la famille.
C9_non_staff_refused       | True | refused: forbidden: debt thresholds are a staff surface
VERDICT: 12/12 checks PASS
```

**Conclusion: migration 0138 is correctly and completely applied on the live backend.** The 136th session's "one owner-gated step" is settled — no further action is required for DEBT-103's server leg.

## 4. The recent-task live sentinels (the audit's frontend→backend trace, server side)

One-query census through the Management API (all **GREEN**):

| Sentinel | Task / migration | Live state |
|---|---|---|
| `create_manual_debt(p_parent_id text, p_student_id text, p_category text, p_label text, p_amount_due numeric, p_due_date date, p_academic_year text, p_note text, p_reference text, p_actor_id uuid, p_actor_name text)` | T-466 / 0137 | **EXISTS** with the documented signature |
| `save_dashboard_layout()` | T-448 / 0134 | **EXISTS** |
| `chat_channels.scope` column | T-463 / 0135 | **EXISTS** |
| `dashboard_layouts` table | T-448 / 0134 | **EXISTS** |
| `storage.objects` policies `chat_attachments_member_read/write` | T-464 / 0136 | **EXISTS** (member-scoped, tenant-prefixed) |
| `storage.objects` policies `homework_attachments_read/write` | 0018/0043 chain | **EXISTS** |
| `system_settings` category `debt` rows | 0125 + 0138 | **10 rows** (4 day keys + 6 amount/message keys) |

## 5. The TEST-502 class-(a) live parity evidence (the INV-8 settlement)

The three failing tests pinned `'pending'` where the engines return `'overdue'`. The settlement required cross-platform parity evidence (T-470's scope), collected from the three canonical implementations:

1. **Desktop TS** (`src/domain/calc/payment/lifo-reversal.ts`): `reevaluateInstallmentStatus` → `amountPaid=0` + `isStrictlyPast(dueDate, now)` → `"overdue"`, else `"pending"`.
2. **Kotlin mirror** (`financial-tests/equivalence/android_mirror/kotlin_mirror_engine.ts`): identical branch structure (`dueMs >= 1 && dueMs < nowEpochMs ? "overdue" : "pending"`).
3. **SQL RPC** (migration 0034, `revert_payment_allocation`, both the pending and cleared branches): `ELSIF v_ins.due_date < NOW() THEN v_new_status := 'overdue';`

**All three agree: past-due + zero-paid post-revert → `overdue`.** The tests were the wrong side — the §15.81 wall-clock time-bomb class (authored while the real clock preceded the fixtures' 2026-09-15 due dates; the calls omitted the explicit evaluation clock the engines accept). The repair pins BOTH branches deterministically (future-due → `pending`, past-due → `overdue`) and adds two companion tests so neither branch can silently lose coverage again.

**The residual divergence REGISTERED (PARITY-010, not fixed in T-470):** the SQL RPC's future-due zero-paid branch writes `'unpaid'` where both TS engines return `'pending'`. No test pins either side of that specific value today; the divergence is invisible to every current surface (the DB CHECK constraint allows both; the desktop read-side tolerates both). Settling it is an owner/ADR question (INV-8's post-revert vocabulary), registered in the problem registry rather than unilaterally "fixed" (§15.2).

## 6. Residue

ZERO. Every probe ran inside `BEGIN; … ROLLBACK;` (the stripped-trailing-ROLLBACK convention); no live row was mutated by this session's verification. The two temp-table probes and the drift census were read-only or transaction-scoped.

### 3.3 The reconciled script's live re-run (the union of both rounds' fixes) — 14/14

After the rebase onto the concurrent round, the merged `verify_t-469.sql` (their catalog-level C3/C4 + this round's runtime C3b/C4b + the identical C7 fix) was re-run through the same runner:

```
C1_six_seeds_per_tenant        | True | tenants=1 tenants_missing_keys=0
C10_boundary_matrix            | True | below_yellow=true, at_yellow_inclusive=true, at_red_inclusive=true, above_red_exclusive=true
C2_seeded_values               | True | yellow=20000 red=60000 empty_messages=4
C3_reader_extended_payload     | True | keys=CREATE OR REPLACE FUNCTION public.read_debt_aging_thresholds()…
C3b_runtime_payload_extended…  | True | keys={"redDays": 60, "yellowDays": 15, "amountRedDzd": 60000, "levelMessages": {…
C4_day_keys_unchanged          | True | the T-443 day contract intact (function definition)
C4b_runtime_payload_day_keys   | True | the T-443 day contract intact at runtime
C5_acl / C5b / C5c             | True | anon EXECUTE revoked · authenticated EXECUTE granted
C6_registration                | True | rows=1
C7_staff_reads_extended        | True | yellow=20000 red=60000 msgs={"red": "", "green": "", "orange": "", "yellow": ""}
C8_configured_round_trip       | True | yellow=35000 msg_red=Contentieux — convoquer la famille.
C9_non_staff_refused           | True | refused: forbidden: debt thresholds are a staff surface
VERDICT: 14/14 checks PASS
```

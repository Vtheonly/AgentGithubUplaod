# T-446 — The 0132+0133 LIVE APPLICATION + the full post-apply verification (the owner's fourth token WORKED)

**Session:** 123rd (2026-09-30) · **Status:** DONE — migrations 0132 + 0133
APPLIED, REGISTERED, and verified live end-to-end; the ONE owner-gated
step from T-445 is closed.

## The mandate

The owner re-supplied the credentials block with a FOURTH `sbp_`
Management token and asked where the year-tracking feature lives. The
standing #1 recommendation of three consecutive sessions (the 0132+0133
live application) was therefore executable this session.

## What happened (all live, all GREEN)

1. **The fourth token WORKED** — `GET /v1/projects` → HTTP 200 with the
   project `vebfehrpzajhstyhinnw` ACTIVE_HEALTHY (the first live
   Management token after three dead hand-offs, §15.77a's supply pattern
   reversed at last).
2. **`apply_0132_live.sh`** → HTTP 201 (the ER-PMAE RPC tenant guards;
   the migration self-registers in-file, so the chain head moved to 0132
   immediately).
3. **`apply_0133_live.sh`** → HTTP 201 (the debt-thresholds CLIENT
   contract: `applied_thresholds` on `compute_debt_aging_summary` +
   the staff-gated `read_debt_aging_thresholds` reader).
4. **verify_t-445_live_datagateway.py — 18/18 PASS** (re-run twice:
   post-apply and post-reconciliation — byte-identical outcomes). The
   former CHECK-9/CHECK-10 pending-state probes (404 PGRST202) were
   REWRITTEN to verify the APPLIED state:
   - `read_debt_aging_thresholds` → 200 with the four camelCase values
     == the live `system_settings` rows (5/15/60/15);
   - the reader's own staff gate rejects the service key (400
     "forbidden: debt thresholds are a staff surface");
   - **634/634 summary rows carry `applied_thresholds` == the reader's
     object** — the client contract holds by construction;
   - `fn_er_resolve_tenant` → 200 resolving the caller's tenant.
   CHECK-1..8 unchanged and green (the 548-row yellow round-trip, zero
   residue).
5. **THE 0133 CHAIN RECONCILIATION** (the 0125 precedent, ARCH-016
   class): 0133's FILE never carried the self-registration insert its
   sibling 0132 carries, so the DDL landed while the registry did not
   (probed: head read 0132, `v0133_rows=0`).
   `scripts/apply_chain_reconciliation_0133.sh` (NEW, committed) ran
   ONE atomic transaction — the idempotent 0133 body (drop-if-exists +
   create-or-replace + grants, safe to repeat) + the ON CONFLICT
   registration. Post-check: `v0133_rows=1`, head
   **`0133 > 0132 > 0131`**, reader present, applied column present.
   The 0133 FILE itself is NOT edited (§15.9 + the check:migrations
   append-only guard).
6. **verify_t-439.sql — 14/14 PASS** (first live run, through the NEW
   `run_verify_sql_live.sh` runner): the 0132 guards — mismatch
   refusals (42501), the service_role explicit-tenant path, the
   decide/merge/unmerge happy paths (0130/0131 semantics preserved),
   the read-only census, the registration row, the ACLs (anon/public
   revoked, authenticated kept).
7. **verify_t-405.sql — 33/33 PASS** (first live run with the T-429
   amendment block actually executing — see the repairs below): the
   full aging sandbox + structure + INV-14 attribution + matview +
   staff-gate checks, plus all five T-429 checks (settings seeded n=4,
   defaults n=4, default-fallback, tenant-resolves, the 4-tier CASE in
   the summary definition).
8. **verify_t-338.sql — ran clean** (first live run through the
   runner): every section returned (concentration, dynamics, erosion,
   sections, top_families, transport, transport_routes, triage, waves);
   the triage buckets read `debt_aging_thresholds()` — the retired
   hardcoded 15/45 edges stay retired. The single `not_due` bucket is
   the pinned-clock truth (2026-09-14, before any due date — hence
   `worst_days: -1` throughout), not a defect.
9. **Zero live residue**: the four debt settings re-read at baseline
   (5/15/60/15); the census byte-identical (green 86 · yellow 548); the
   endpoint-behavior probes (`BEGIN; create table public._t446_probe`)
   verified rolled back (uncommitted sessions are discarded — see the
   runner's safety note); temp tables never survive a request.

## The two verify-script repairs (script maintenance, not migration edits)

- **`verify_t-405.sql` — the T-429 amendment block was DEAD CODE in both
  execution paths as committed.** It sat AFTER the script's
  `ROLLBACK;` — in psql the transaction's temp table dies at ROLLBACK so
  the block's inserts would raise 42P01; in any single-payload runner
  the block runs but the report SELECT already executed. Fix: the
  Report SELECT + ROLLBACK moved to the TRUE end of the file (both
  paths now correct; the note is in the file).
- **`verify_t-405.sql` — the T-429 block ran under the C12 block's
  downgraded context.** C12 ends with `set local role authenticated` +
  a role-less synthetic sub, under which `system_settings`' RLS (0024)
  hides the debt rows → the block's first live run read n=0 and skipped
  `T429-T2-tenant-resolves` (its tenant lookup returned null). Fix: the
  block restores the session context first
  (`set_config('role','none')` + the script's original service_role
  claims) — the context its psql-era design assumed. n=4 after.

## The NEW committed tooling

- **`scripts/apply_chain_reconciliation_0133.sh`** — the 0125-precedent
  reconciliation (pre-check → the atomic body+registration →
  post-check), env-gated on `SUPABASE_ACCESS_TOKEN`.
- **`scripts/run_verify_sql_live.sh`** — the GENERIC §11.1 runner for
  the `verify_t-*.sql` suites through the Management-API SQL endpoint.
  It strips only the TRAILING `ROLLBACK;` (a comment-aware guard
  refuses anything else) so the final results SELECT is the last
  statement (endpoint quirk #32c: only the last statement's result set
  returns), and relies on the PROBED endpoint semantics for safety: an
  open uncommitted transaction is discarded at session end
  (`BEGIN; create table public._t446_probe` → probe table absent on the
  next request), so the script's all-or-nothing guarantee is preserved
  without the ROLLBACK. Prints a check_id/ok table + a verdict line.

## The year-tracking answer (the owner's question this session)

The per-year "who owes what" feature is **« Par année »** — the
T-442 surface, present on main since the T-444 restoration:

- **Finances → « Suivi des Dettes » → click a family row → the drawer's
  « Par année » tab** — per-year cards (Facturé/Payé/En attente, « Reste
  fin d'année », « Reste aujourd'hui », « Reporté »), the banner « Dette
  des années antérieures encore due aujourd'hui » with per-year chips,
  per-service breakdowns, per-payment coverage lines.
- **Élèves & Parents → a family → « Finances & Échéances » →
  « Historique par Année Scolaire »** — the same component/engine.
- The table itself carries the « Année d'origine » column + the
  « Filtrer par année d'origine » dropdown.
- If the owner ran a build from between `1cead9d` (the new-UI commit
  that destroyed the drawer) and the T-444 restoration, the feature was
  genuinely absent — it is back on main; a package older than the
  T-444 delivery should be rebuilt.

## Gates

18/18 (verify_t-445, post-reconciliation) · 14/14 (verify_t-439) ·
33/33 (verify_t-405 incl. T-429) · verify_t-338 clean · chain head
`0133 > 0132 > 0131` · zero live residue.

## Left

None for this mandate. The standing queue is in next-task.md; the
T-436 `payment_allocations` backfill remains the only live-data
caveat affecting the per-year coverage lines (the amounts themselves
are unaffected).

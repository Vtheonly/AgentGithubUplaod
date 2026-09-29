# T-445 DELIVERY — the 0132+0133 live-application attempt + the data-gateway live re-verification

**Session:** 122nd (2026-09-30) · **Task:** T-445 · **Merged at:** the
`merge: T-445` commit on main (this zip is the hub tree at that commit).

## The mandate

The owner re-supplied the credentials block ("here are all the tokens you
need from infrastructure to test if it works make sure it works") asking
for the remaining migration (0132 SEC-115 + 0133 DEBT-101's client
contract) and the live scripts.

## The verdict

**Everything the credentials reach is verified GREEN; the DDL apply
itself is the ONE 60-second owner step.** The fresh `sbp_` Management
token is 401 on every Management-API endpoint (curl + the supabase CLI —
the THIRD consecutive dead hand-off token) while the sibling
`sb_secret_` key works perfectly on the data gateway; the DB connection
strings carry the literal `[YOUR-PASSWORD]` placeholder; the
JWT-as-password pooler mode is rejected (probed and documented —
AGENTS.md §15.77d). No exposed RPC or Edge Function executes arbitrary
SQL — the correct security posture — so DDL requires a valid Management
token or the database password, neither of which is in the block.

**What ran live, all GREEN:**
1. **`elimtiyaz-desktop/scripts/verify_t-445_live_datagateway.py` — NEW,
   16/16** — the debt-configuration chain verified end-to-end through the
   data gateway only: the admin sign-in; the staff gate (the service key
   rejected); migration 0125's four rows at the seed defaults 5/15/60/15
   with their validation bounds; 634 debtors (green 86 · yellow 548) with
   634/634 conforming to the per-row status invariant; **THE ROUND-TRIP:
   PATCH yellow 15→10 through the Configuration tab's own path flipped
   548 rows yellow→orange and back — the configuration provably DRIVES
   the business logic**; zero residue; the 0132/0133 pending states
   confirmed (the documented version-skew mode — safe today because the
   live values equal the DEFAULTS the desktop degrades to).
2. **`t-442-live-verify.mjs` — 17/17** (first live run): the per-year
   debt-origin breakdown reconciles on the real corpus.
3. **`t-441-live-e2e.ts` — DB-1…DB-9 ALL GREEN** (first live run with the
   key): 118/118 periods, 0 unplaced, Gate 1 + Gate 3 PASS on the real
   problem — a complete, conflict-free school timetable; the draft
   version was then deleted per §15.77c (the agent run restores the
   pre-test clean slate; the owner's in-app « Générer » is the identical
   path and is the run that may keep the draft).

## The one owner-gated step (60 seconds, three options — full runbook in
`docs/recovery/t-445-live-verification.md`)

- **(A)** Generate a FRESH Management token at
  `supabase.com/dashboard/account/tokens` IMMEDIATELY before use, then:
  `SUPABASE_ACCESS_TOKEN=<fresh> bash elimtiyaz-desktop/scripts/apply_0132_live.sh`
  and the same for `apply_0133_live.sh` (both committed, env-gated,
  self-verifying).
- **(B)** Reveal/reset the database password (Supabase dashboard →
  Settings → Database) and supply it — the session pooler path is proven
  reachable.
- **(C)** Paste the two migration files (`0132_er_rpc_tenant_guards.sql`
  then `0133_debt_aging_thresholds_client_contract.sql`) into the
  Supabase Studio SQL editor.

After the apply: re-run `verify_t-445_live_datagateway.py` (CHECK-9/10
flip to "applied") and the four post-apply checks documented in
`apply_0133_live.sh`'s header.

## What changed in this delivery (no client source changed)

- `elimtiyaz-desktop/scripts/verify_t-445_live_datagateway.py` — the NEW
  re-runnable data-gateway verification (16/16 live).
- `scripts/t445-build-zips.sh` + this README (the delivery convention).
- `docs/recovery/t-445-live-verification.md` (the evidence record) · the
  task-registry T-445 entry (DONE) · current-state + next-task +
  change-log truth-synced · AGENTS.md §15.77 (four discoveries: the
  dead-token supply pattern → data-gateway-first authoring; derived
  round-trip expectations; the agent-run artifact-restoration rule; the
  pooler-credential exhaustion map).
- The concurrent T-444 closeout (merged mid-session) is preserved
  verbatim; this session renumbered its own knowledge entry §15.76 →
  §15.77 accordingly.

## The zips

| Zip | Content |
|---|---|
| `AgentGithubUplaod-T445.zip` | the hub repo tree at the T-445 merge (this archive's source) |
| `elimtiyaz-website-T445.zip` | the website tree, byte-identical to the T-440 delivery (no website file changed since) |
| `elimtiyaz-all-systems-T445.zip` | both trees under `all-systems-T445/` |

The desktop application source is UNCHANGED from the T-444 delivery (the
verification-only session) — the T-444 zip remains a valid build source;
this delivery adds the verification script + the runbooks + the docs.

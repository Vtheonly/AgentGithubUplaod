# T-407 — Delivery Archive (85th session, 2026-09-22)

The UI + mouse-interaction integration mandate, fully delivered and verified on production:

- **T-407 — The T-401/T-402/T-403 UI + Mouse-Interaction Integration Suite**
  (32 tests, all green): three feature suites driving the REAL components with
  REAL pointer events — the shared `src/tests/_helpers/radix-mouse.ts` (the
  §15.40 contract extracted) — pinning the filière forms, the academic-history
  card, and the promotion-cycle workflow end to end, at the wire level.
- **ACAD-504 closed** (the defects the suites surfaced, all fixed):
  1. The batch-registration classification was DROPPED end-to-end —
     **migration 0112** (`register_family_batch` threads the filière/spécialité
     into the canonical upsert; live-verified **6/6**, zero residue, chain head 0112).
  2. The promotion override's STALE destination (a repeat→promu override never
     advanced the student) — `applyDecisionOverride` + the progression-derived payload.
  3. The « Générale » sentinel family (the blank untagged trigger + the literal
     "general" on the wire) — the catalog's own code as the sentinel +
     `normalizeTrackCode` at every submit + mock/Supabase parity.
- **Gates:** tsc 0 errors; FULL vitest **3723/21/5** (the failing set
  byte-identical to the documented baseline — the concurrent agent's subtree);
  lint 0 errors on every touched file.
- **Concurrent-agent coordination honored:** their live 0111 + their committed
  SCHED-103 0112 (never applied) → renumbered to 0113 in the merge with every
  reference annotated; their T-406 registration and their AGENTS.md rule 44
  preserved (mine renumbered to 45); their T-404/T-405 work merged cleanly.

## The archives

| File | Content |
|---|---|
| `AgentGithubUplaod-main-t407.zip` | The hub repo at main `b55e0a2` (desktop app + canonical Supabase backend — chain head 0112 — + the documentation system) |
| `elimtiyaz-website-main-t407.zip` | The parent portal at main `8f1894e` (incl. the T-401 filière parity + the concurrent session's T-405 debt-aging parity) |

Evidence: `docs/recovery/t-407-live-verification.md` (the 6-check live matrix +
the 32-test gate), plus `t-401/t-402/t-403/t-404/t-405-live-verification.md`;
the registries (task/problem/change-log/next-task) are all updated.

**Owner runbook (the one gated step, inherited from SCHED-103):**
`SUPABASE_ACCESS_TOKEN=sbp_… bash elimtiyaz-desktop/scripts/apply_0113_live.sh`
then `bash elimtiyaz-desktop/scripts/t404-postgrest-smoke.sh --expect-fk`
(P2 must flip 400 → 200).

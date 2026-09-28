# T-438 DELIVERY README — ER-PMAE (Experimental User Aggregation & Identity Resolution Engine)

**Task:** T-438 · **Issues:** GitHub #15 + #16 (issue #16 is #15's technical annex) · **Session:** 117th (2026-09-29) · **Hub commit:** `29fbf3f` (main) · **Live chain head:** migration **0131** (0130 + 0131 applied atomically, verify_t-438.sql 20/20 GREEN, zero residue).

## What this delivery contains

The **complete, merged, DORMANT** ER-PMAE system per issues #15/#16:

1. **The pure-TS identity engine** — `elimtiyaz-desktop/src/domain/identity/` (normalize → block → veto → score → cluster → synthesize), the ONE implementation of `docs/domain/identity-rules.md` (INV-40..58).
2. **The persistence** — migrations `0130` + `0131` (four additive tenant-scoped RLS-guarded tables + the decide/merge/unmerge/state RPCs), the mock twin, the Supabase twin, and the EXISTING backup system extended (a pre-aggregation archive restores ZERO residue).
3. **The experimental gate** — Settings → **Expérimental** (the ONLY activation path; every capability OFF by default; per-desktop-local, never the server feature_flags).
4. **The import-time review/confirmation flow** — with the flag ON, an Excel upload shows the proposed identity matches (evidence + confidence + band) BEFORE anything binds; each proposal requires explicit approve/reject; the commit binds ONLY approved pairs through the canonical write path (the T-414 EntityMatcher seam).
5. **The reversible merge/unmerge** — two duplicate families merge in ONE transaction (every relationship re-pointed, the complete prior mapping recorded); the unmerge replays it exactly.
6. **69 new tests** (40 engine + 13 repository + 16 gate/seam) — FULL suite 4,389 passed / 18 failed (the failing set byte-identical to the documented 9-file environment baseline — ZERO regressions).

## How to enable (the owner's deliberate opt-in)

Settings → **Expérimental** → « Agrégation & Résolution d'Identité (ER-PMAE) » → **Activer**. The tab also hosts the review queue (pending proposals) and the merge history with the unmerge actions. With the flag OFF, nothing ER-related runs or reads anywhere — pinned by tests.

## The zips

| File | Contents |
|---|---|
| `AgentGithubUplaod-T438.zip` | The hub repo (desktop + backend chain + docs) at the delivery commit |
| `elimtiyaz-website-T438.zip` | The website repo (unchanged this session — the delivery-set convention) |
| `elimtiyaz-all-systems-T438.zip` | Both systems in one archive |

(node_modules ship as empty placeholders — run `npm install` in `elimtiyaz-desktop/` before `npm run dev` / `npm test`.)

## Evidence

- `docs/recovery/t-438-live-verification.md` — the live application + the 20/20 verification table + the defects the live run caught (0131's jsonb cast repair)
- `docs/recovery/change-log.md` — the 117th-session entry
- `docs/decisions/ADR-032-identity-resolution-engine.md` — the architecture decision
- `docs/domain/identity-rules.md` — the canonical rules (INV-40..58)
- `AGENTS.md` §15.70 — the session's four reusable discoveries

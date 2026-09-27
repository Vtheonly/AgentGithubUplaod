# T-423 delivery — GitHub issue #23 (the finance-zeros fix) — 2026-09-27

## What this delivery contains

| Archive | Contents |
|---|---|
| `AgentGithubUplaod-T423.zip` | The hub repo (desktop + backend + docs) at main `16fe2ad` — the T-423 fix complete |
| `elimtiyaz-website-T423.zip` | The website repo at its green main `5c530b6` (unchanged by T-423 — the portal is parent-scoped; its installments read was already paginated per DATA-032/B9 and its queries surface failures as react-query error states, so no website change was needed for issue #23) |
| `elimtiyaz-all-systems-T423.zip` | Both systems in one archive (`all-systems-T423/AgentGithubUplaod/` + `all-systems-T423/elimtiyaz-website/`) |

Both zips exclude `.git`, `node_modules` contents (an empty placeholder marks the desktop's), `.next`, `.env*`, and logs — the documented 102nd/103rd-session convention. Run `npm ci` in `elimtiyaz-desktop/` (and the website) to restore dependencies.

## What was fixed (the short version — the full record: `docs/recovery/t-423-finance-zeros-fix-verification.md`)

The owner's report — *Finances → Encaissement shows every KPI at 0 DZD, "Aucune tranche T1/T2/T3", while the Suivi des Dettes tab shows the real debts* — is fixed end to end, live-verified:

1. **CACHE-103 — the honest degradation:** a failed read now retries (3 attempts, backoff), keeps the last known data (a failed refresh can never wipe a loaded page), and surfaces *"Échec du chargement — Réessayer"*; degraded+empty KPI cards show "—", never a fabricated "0 DZD".
2. **DATA-038 + DATA-040 — the keyset pagination:** the installments seed (was 1,000 of 5,963 = T1-only forever), the debt summary's reads (1,000 of 4,227 unpaid), the ledger (1,000 of 3,342), the students seed (1,000 of 1,137 — **137 students were silently missing from the CRM**), and the parents seed now walk the primary key and read whole collections.
3. **PERF-505 — migration 0123 (live-applied, chain head):** four SECURITY DEFINER staff-gated read RPCs; the seeds read RPC-first (live: **12/12 at 0.3–1.7s** vs the direct reads' 6.5–19.9s at 80–90%). The definitive attribution: the SQL executes in 50ms — the cost was the per-row RLS policy chain.
4. **DATA-039 — the basis label:** the Créances KPI now reads *"base échéancier · dont X échues"* with the excess bridge explained in the tooltip.

**The live acceptance run (all eight checks pass):** Encaissé **162,713,000 DZD** · Revenu mensuel **162,713,000 DZD** · Créances **207,773,800 DZD** (matching the Dettes tab's RPC) · installments **5,963 rows with T1+T2+T3(+T4)** · ledger **3,342** · the anon gate rejects.

## How to verify (the owner's packaged-app pass)

1. Unzip, `cd elimtiyaz-desktop && npm ci`, `npm run dev:electron` (or rebuild the Windows package), sign in as `admin@elimtiyaz.dz`.
2. Finances → Encaissement: the KPIs show 162.7M / 162.7M / 207.8M DZD; Tranches shows all three tranches; a read failure (if one ever occurs) shows the banner + the kept data.
3. The CRM students list shows the full roster (1,137).
4. Re-run the evidence any time: `node scripts/t-423-post-fix-verification.mjs` (read-only, live).

## Commits (this delivery)

`c285286` registration (+DATA-040) → `25fca3b` Phase A1+A2 (CACHE-103 + DATA-039) → `eab9ea7` Phase A3 (DATA-038 + DATA-040) → `2e7cebc` Phase B (migration 0123 + PERF-505) → `16fe2ad` the closeout — each pushed and merged to main individually.

Gates: tsc 0 · eslint 0 · FULL vitest 4,191/21 **BASELINE-MATCHED** (the baseline moved by the registered change: t-034's 4 environment-class failures fixed) · check:migrations OK · the regression suite `t-423-finance-seed-degradation.test.ts` 11/11.

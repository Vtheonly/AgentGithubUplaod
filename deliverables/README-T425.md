# T-425 delivery — the official 3-tranche model + the Statistics-vs-Finance unification — 2026-09-27

## What this delivery contains

| Archive | Contents |
|---|---|
| `AgentGithubUplaod-T425.zip` | The hub repo (desktop + backend + docs) at main `2f3449e` — T-424 + T-425 complete |
| `elimtiyaz-website-T425.zip` | The website repo at its green main `5c530b6` (unchanged by T-424/T-425 — the portal is parent-scoped and reads through its own RLS policies; the tranche-model change is desktop + DB) |
| `elimtiyaz-all-systems-T425.zip` | Both systems in one archive (`all-systems-T425/AgentGithubUplaod/` + `all-systems-T425/elimtiyaz-website/`) |

Both zips exclude `.git`, `node_modules` contents (an empty placeholder marks the desktop's), `.next`, `.env*`, and logs — the documented 102nd/103rd-session convention. Run `npm ci` in `elimtiyaz-desktop/` (and the website) to restore dependencies.

## What was fixed (the short version — the full record: `docs/recovery/t-425-official-tranche-model-verification.md`)

The owner's two reports are answered end to end:

1. **T-424 — Statistics ≡ Finance (one data flow):** the import's canonical **waterfall attribution** (DATA-041 — V1 payments were booked onto T2 while T1 stayed permanently unpaid for 1,132/1,137 students), the **ONE canonical** `isInstallmentSettled` + `deriveTrancheWaveStats` (DATA-042 — both tabs are now view models over the same domain derivation), and the **dashboard's full-collection reads** (DATA-043 — the Statistics KPIs were a 1,000-of-4,227 capped sample). "Tranche 1 not paid in Statistics while its payments show paid in Finance" is now structurally impossible — pinned by the cross-surface unit invariant.
2. **T-425 — the OFFICIAL 3-tranche model (the owner's confirmation): there is NO 4th tranche.** The registration fee (FI) is a **fee, not a tranche** — a non-wave row at tranche 0, due at signup (Sept 15). Tuition is **exactly 3 tranches** — Tranche 1 (V1) due Sept 15, Tranche 2 (2V) due Dec 15, Tranche 3 (v3) due Mar 15. Transport stays 3 tranches. The phantom "Tranche 4 (Juin)" is deleted from every surface, migration **0124** re-tightened the DB CHECK to (0,1,2,3), and the live DB was rebuilt through the corrected pipeline.

**The live state (verified read-only):** FI n=1,137 · Tranche 1/2/3 = V1/2V/v3 on the official dates · **ZERO T4 rows** · **0 overpaid rows** · **Encaissé 162,713,000 DZD** · Créances 194,230,700 DZD (installment basis).

**The Excel source-of-truth verification:** **1,130 of 1,138 students match the workbook's OWN TOTAL*CREANCE column exactly (±1 DZD)** — the 7 divergences are all explained (6 school hand-adjusted Q values + 1 real payment the sheet's own P formula misses). The workbook's ground truth pinned: Σ P-column = Σ R+S+T+U+W+X+Y = 162,649,000 exactly.

## How to verify (the owner's packaged-app pass)

1. Unzip, `cd elimtiyaz-desktop && npm ci`, `npm run dev:electron` (or rebuild the Windows package), sign in.
2. Finances → the Tranches tab: the wave strip shows **THREE cards** (Tranche 1 Septembre / Tranche 2 Décembre / Tranche 3 Mars) — no "Tranche 4"; the échéancier shows "Frais d'inscription (FI)" as its own line.
3. Statistics vs Finances: the same wave numbers on both tabs (the cross-surface invariant).
4. Re-run the evidence any time (read-only, live): `node scripts/t-425-no-4th-tranche-probe.mjs` (the census), `node scripts/t-425-live-verify.mjs` (the Excel oracle).

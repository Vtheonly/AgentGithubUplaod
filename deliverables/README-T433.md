# T-433 delivery — the purge + WB2 re-import + the live 0126 application — 2026-09-28

## What this delivery contains

| Archive | Contents |
|---|---|
| `AgentGithubUplaod-T433.zip` | The hub repo (desktop + backend + docs) at main `673f1f0` + this delivery commit — T-433 complete |
| `elimtiyaz-website-T433.zip` | The website repo at its green main `5c530b6` (unchanged by T-433 — the purge/import touched the shared backend data, not the portal code) |
| `elimtiyaz-all-systems-T433.zip` | Both systems in one archive (`all-systems-T433/AgentGithubUplaod/` + `all-systems-T433/elimtiyaz-website/`) |

Both zips exclude `.git`, `node_modules` contents (an empty placeholder marks the desktop's), `.next`, `.env*`, and logs — the documented 102nd/103rd-session convention. Run `npm ci` in `elimtiyaz-desktop/` (and the website) to restore dependencies.

## What was done (the short version — the full record: `docs/recovery/t-433-live-verification.md`)

The owner's mandate — **"purge everything first and remove all existing data, then use the WB2 Excel file"** — executed end to end, on top of the standing 0126 live application:

1. **ARCH-016 reconciled:** migration 0125's DDL was live but its registration never landed (the file lacks the self-registration insert its siblings carry) — the live chain head had read 0124 since 2026-09-27. Reconciled atomically (`apply_chain_reconciliation_0125.sh`): the head now reads **0125**.
2. **Migration 0126 applied LIVE** (the 111th session's standing owner-gated top item — the boot-storm fix): the RLS InitPlan hoist on the 15 hot SELECT policies + the debt-aging attribution materialization + 3 read indexes. `verify_t-432.sql` — after this session repaired its three never-run-layer defects — **15/15 GREEN**, with the timing evidence: the aging summary ~100 ms, every count/month read single-digit ms.
3. **The purge EXECUTED** (the canonical `purge_student_parent_domain` RPC, migrations 0120/0121, driven through the exact UI path — the owner admin's GoTrue grant → the PostgREST call): **14,114 rows removed**; every domain table verified ZERO; the academic catalog / workforce / tenants / the owner admin account all preserved (the ADR-027 no-interference contract); the audit trail fully attributes the run (+1,879 entries).
4. **The fresh WB2 import landed** (`Excel/2027-2026.xlsx` through the REAL ImportEngine + repositories — 91 s, 0 rejected): 741 parents · 1,137 students · 5,956 installments (FI + 3 tuition tranches + 3 transport tranches, **zero T4**) · 2,198 payments (100% attributed — the corrected driver's actor seam, +IMPORT-120) · 3,342 ledger · **Encaissé 162,713,000 DZD — the acceptance value exactly**.
5. **Verified against the Excel source of truth:** 1,130 of 1,138 students match the workbook's OWN créance column exactly (±1 DZD); the 7 divergences are the school's documented hand-overrides; 0 overpaid rows. The boot-path health probe (the read family that was 500ing in the owner's console storm): **ALL 200s**.

## How to verify (the owner's packaged-app pass)

1. Pull main + rebuild the desktop app; sign in as the owner admin.
2. The CRM shows the full 741-family / 1,137-student roster; the Finances page loads through the RPC path (sub-second, no storm); the Tranches tab shows FI + 3 tuition tranches + the transport tranches on the official dates — no "Tranche 4".
3. Statistics and Finance agree on the canonical derivation (the "dont scolarité" reconciliation line under the pooled wave rate).
4. The 6 override families (METAH NADA, DAHMANI FARES, LAOUAR ANES, AITHAMOUDA ANAIS, TASLGHOUA NAILA, BERDAI MAROUAN) still show the formula-derived figures — the school's hand-adjusted créance values (+433,500 DZD total) remain the documented difference until they are recorded properly (a REMISE / DETTES reduction / ledger adjustment) and re-imported.

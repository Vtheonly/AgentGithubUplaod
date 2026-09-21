# T-405 — Delivery Archives (88th session, 2026-09-22)

**T-405 — Cross-Year Debt Aging & Payment-Behavior Tracking** — COMPLETE, VERIFIED on production.

The task's core question — *« Who still owes money from previous school years, how old is that debt, and have they continued paying in later years or stopped paying altogether? »* — is now answered by ONE canonical calculation (financial-rules.md §15, INV-14/15/16), mirrored across every surface with ZERO duplication of the existing Finance system:

- **The rules** (§15): thresholds pinned to the EXISTING aging-bucket edges (60/90/180 days) + the INV-4 epsilon — old debt + payment within 60 days = **GREEN/Actif**; old debt + >180 days of silence = **RED/Critique**; debt age NEVER resets on partial payment; never-paid inactivity = debt age.
- **The TS reference engine** (`src/domain/calc/ledger/debt-aging.ts`, 32/32 tests): pure, deterministic; inputs are ONLY existing canonical facts (REAL installment rows with the Créances-tab formula + non-reversed payment ledger entries).
- **Migration 0111** (applied live, registered): `compute_debt_aging_rows` (the single computation) + the staff-gated `compute_debt_aging_summary` RPC + `attribute_academic_year` + `mv_debt_aging` extended with the payment-behavior columns (legacy columns byte-identical).
- **The repository layer**: `DebtRepository.observeAging()` — the Supabase RPC client (with a live client↔server parity cross-check), the reactive mock, and the T-390 realtime recompute on every financial mutation.
- **The desktop « Suivi des Dettes » tab** (FinancialsPage): the status-distribution KPIs, the full §15 column set, statut/année filters, the drill-down drawer (obligations + behavior + "pourquoi ce statut"), Fiche famille + Encaisser.
- **The website portal parity**: the sha-pinned canonical port + the parent's own DebtAgingStatusCard (fr/ar/en).

**Live verification: verify_t-405.sql 29/29 PASS, zero residue** (the two archetype parents — the SAME 100 000 DZD debt from 2024-2025 — GREEN/active_payer (10 subsequent-year payments) vs RED/critical_delinquency (591 days of silence) at the same pinned clock on the TS engine AND the SQL mirror).

## The archives

| File | Content |
|---|---|
| `AgentGithubUplaod-main-t405.zip` | The hub repo at main `dd564f5` (desktop app + canonical Supabase backend migrations 0001–0112 + the documentation system + all T-405 evidence) |
| `elimtiyaz-website-main-t405.zip` | The parent portal at main `8f1894e` (the §15 canonical port + the DebtAgingStatusCard) |

Both zips exclude `node_modules` / build outputs / `.git` (regenerable: `npm install`, `npm run build`).

Evidence: `docs/recovery/t-405-live-verification.md` inside the hub zip; the registries (task/problem/change-log/next-task) are all updated; new knowledge recorded (AGENTS.md §15.44 — the postgres GREATEST-NULL trap; DATA-020 registered).

To restore the backend: the migration chain in `elimtiyaz-desktop/supabase/migrations/` (0111 = the T-405 SQL mirror; `scripts/apply_0111_live.sh` = the live-apply pattern; `scripts/verify_t-405.sql` = the re-runnable 29-check live matrix).

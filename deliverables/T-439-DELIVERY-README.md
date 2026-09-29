# T-439 Delivery — The Comprehensive Audit of the 38 Commits Since 5bd8ad3 (T-434..T-438) + the Six Regression Fixes

**Built:** 2026-09-29 (the 118th session) · **Hub commit:** the T-439 closeout on `main` · **Chain head:** migration **0132** (128 migration files, append-only verified).

## What this delivery contains

| Archive | Contents |
|---|---|
| `AgentGithubUplaod-T439.zip` | The hub repository (the desktop app + the canonical backend + the full documentation system) at the T-439 closeout — the audit, the six fixes, migration 0132, and the complete registries. |
| `elimtiyaz-website-T439.zip` | The website repository (unchanged by T-439 — the audit found no website-side defect in the five tasks; shipped for the all-systems convention). |
| `elimtiyaz-all-systems-T439.zip` | Both trees under `all-systems-T439/`. |

## The six confirmed, reproducible regressions FIXED (each RED-proven first)

1. **CALC-003** — the year-history engine counted bounced/refunded/cancelled payments as PAID (the canonical three-state split now).
2. **DATA-055 + DATA-057** — the desktop import path was YEAR-BLIND against migration 0129's identity (the PGRST116 find, the INV-18b year overwrite, and the preflight that would have silently dropped every continuing student's NEW-YEAR tranches at the next academic-year transition) + the mock's invisible re-enrollment billing.
3. **UI-320** — the ReEnrollModal's devis was priced at hardcoded « 1ère année primaire » (the confirmed grade now, with the devis-vs-wires parity pin).
4. **SEC-115 (CRITICAL)** — the four 0130 ER-PMAE RPCs had NO caller-tenant guard → **migration 0132** (verbatim-diff-verified recreations with the 0128 guard).
5. **IDENT-103** — the ER import bindings leaked ACROSS FILES (+ operators/desktops) through unqualified row ids, and the flag-off path kept a stale matcher (run-scoped bindings + source-qualified ids + the honest matcher lifecycle now).
6. **UI-321** — date-only facts rendered one day early on every UTC-negative machine (UTC rendering now; the RED reproduces the audit's exact 3 failures under `TZ=America/New_York`).

**Full evidence:** `docs/recovery/t-439-audit-report.md` (problem / evidence / root cause / impact / reproduction / verification / fix / regression coverage for each, plus the five documented-OPEN families with fix orders and the verified-as-correct clearance of the five tasks' headline work).

## Gates

tsc exit 0 · eslint 0 errors on every changed file · `check:migrations` append-only OK (128 files) · the T-439 suites **36 new tests** GREEN with RED proofs · **FULL vitest 4,425 passed / 18 failed — BASELINE-MATCHED** (the count = the documented 4,389 baseline + the 36 new; the failing SET byte-identical to `scripts/test-baseline.json`'s 9 documented environment-class files, machine-compared).

## ⚠️ The ONE blocked item — apply migration 0132 LIVE

The provided `SUPABASE_ACCESS_TOKEN` returns **401 Unauthorized on every Management-API endpoint** (verified against `GET /v1/projects`; the `sb_secret` key IS valid on the data gateway — the token class is dead, not the network). The migration is fully prepared and verified at the migration level (sqlglot parse + the line-by-line verbatim diff vs 0130/0131):

```bash
export SUPABASE_ACCESS_TOKEN="<a FRESH valid token>"
cd elimtiyaz-desktop && ./scripts/apply_0132_live.sh
# then verify (expect C1..C9b GREEN, everything rolled back):
supabase db query --linked < scripts/verify_t-439.sql
# or paste the migration into the Supabase dashboard SQL editor.
```

Until applied, the ER experimental flag stays **OFF** on every desktop (the interim mitigation — the unguarded RPCs are reachable only through the gated review flow).

## Next in order (the standing recommendation)

1. A fresh token → apply 0132 + verify (above).
2. The owner's FI ruling (**UNKNOWN-029** — per-student or per-family frais d'inscription at re-enrollment; BUSINESS-110's fixes are staged behind it).
3. **IDENT-104 M5** — the Supabase-mode backup captures EMPTY ER sections (fix BEFORE the first real ER exercise).
4. The deferred families in their registry fix order: IDENT-104 M2/M1 → DATA-056 M5 → M2/M1/M3 → UI-322.

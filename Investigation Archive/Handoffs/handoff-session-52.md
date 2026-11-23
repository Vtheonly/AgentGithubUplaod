# HANDOFF — Session 53 (from Session 52, 2026-11-24)

## Where things stand
- **The baseline is FULLY GREEN at HEAD (`0bec60d6` + this closeout):** features 916/916 · infrastructure 1,518/1,518 · domain/core/cross-platform 2,608/2,608 · the remaining directories green in the same window. tsc 0. The five stragglers (t-171/t-405/t-442/t-475/t-517) are REPAIRED (T-620).
- **The census: 51 task cards solved since G0; 76 open; 127 registered.**
- All four Session-52 commits are PUSHED to main.

## The queue head for Session 53
1. **T-583 — startup acceleration** (React.lazy routes + dynamic exceljs/pdf-lib + the splash ≤1s + E1.8 autofill gating) — per EXECUTION-PLAN §4.
2. **T-584 — automation runner.**
3. **T-586 increment 2** — the stats-tips glossary sweep (96 entries × 3 locales = 288 blocks: move the (INV-4)/(ADR-023)/PARITY-001 refs from the VISIBLE strings to code comments — FR first, then EN/AR), the 5-worst-text rewrites (the refund LIFO paragraph, the tranche-edit toasts, the anomaly-explainer wall, the cash-flow-radar parentheticals), the Prix/Prix justifié/Couverture standardization, the percentage clamps. BUG-057's named formatter sites are DONE (increment 1, `42ae5ccf`).
4. T-585 (AI hardening) → T-588 (settings 8-store).

## Files to inspect first
- `elimtiyaz-desktop/src/domain/calc/payment/payment-coverage.ts` — the NEW canonical builder (the T-330 chain + the every-detail view model). If any new surface needs payment coverage, CALL IT — never re-implement the chain.
- `elimtiyaz-desktop/src/infrastructure/supabase/supabase-client.ts` + `electron/backend-profile-contract.cts` — the T-619 quarantine (DEAD_SUPABASE_PROJECT_REFS). A new project death gets VERIFIED first (probe the endpoints), then appended to the list.
- `elimtiyaz-desktop/src/i18n/stats-tips.ts` — the T-586 increment-2 target (1,972 lines; the jargon lives in the calc/vars/status strings of the FR/EN/AR dictionaries).

## Owner-facing notes
- **The login fix (T-619/BUG-055):** a packaged build from CURRENT main carries it. An installed PRE-CUTOVER build cannot self-heal — it needs the update; a machine with a STALE PROFILE self-heals on the updated build's next launch (the validator rejects the dead-project profile and the live factory default governs). Wrong passwords now say "E-mail ou mot de passe incorrect." — not "server error"; a dead target says the quota message with the Réglages → Configuration hint.
- The OLD project (vebfehrpzajhstyhinnw) is permanently 402 quota-dead — verified by probe. The NEW project (gvuvibcsfjhwcjikgxql) is healthy with all 5 admin accounts confirmed.

## Verification discipline (the session's hard-won specifics)
- The full vitest battery exceeds the 10-minute window — run it in DIRECTORY CHUNKS: `src/tests/domain src/tests/core src/tests/cross-platform` (~96 s) → `src/tests/infrastructure` (~324 s) → `src/tests/features` (~327 s) → the rest (~229 s).
- Background `nohup` processes do NOT survive between tool calls — never park verification in the background.
- PDF text assertions: static French literals draw RAW (accented, WinAnsi-safe); dynamic values go through sanitizePdfText (accents stripped) — assert accordingly (see the t-368 T-579 block for both conventions).
- Radix TooltipHint in tests: `fireEvent.focus(el)` + `getAllByRole("tooltip")` — but NOT under fake timers (the delayed surface never mounts; pin at the source seam instead — the t-517 pattern).

## Uncertainties / open items
- T-586's remaining scope is large but mechanical; the glossary sweep needs FR-first discipline (FR is the reference; EN/AR follow).
- T-583/T-584 were not started — read their EXECUTION-PLAN §4 cards fresh.
- Owner-gated items unchanged: the 6 flagged workbook rows, UNKNOWN-031, the Vercel redeploy (§15.111c).

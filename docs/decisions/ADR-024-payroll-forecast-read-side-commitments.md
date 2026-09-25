# ADR-024 — Payroll obligations surface as READ-SIDE forecast commitments; `salary_payments` stays out of `ledger_entries`

- **ID:** ADR-024
- **Status:** ACCEPTED (2026-09-25, T-412 / 96th session — resolves the FA-08 / DUP-006 "payroll-in-treasury" owner option in the read-side direction)
- **Deciders:** owner mandate (T-412) + agent architecture decision within the T-411-established semantics
- **Context:** The 2026-09-23 finance UI audit (FA-08) found the treasury radar's "Flux Net Opérationnel" silently excludes payroll (`salary_payments` never enters `ledger_entries`) and left the fix to an owner decision: either payroll joins the treasury BASIS (a ledger-write semantics change) or the exclusion is labeled. T-411 shipped the honest label ("hors masse salariale"). T-412's mandate (personnel payroll cash-flow forecasting + pre-payroll funding requirements integrated into Finance and Statistics) forces the decision.
- **Decision:**
  1. Upcoming payroll obligations surface as a **read-side forecast commitment projection** — a pure derivation (`src/domain/calc/payroll/payroll-forecast.ts`) over the canonical `personnel` + `salary_payments` streams. It is a CONSUMER-grade analytical layer in the §15.53a sense: no new tables, no new writers, no ledger semantics change.
  2. **`salary_payments` stays OUT of `ledger_entries`.** The historical "Flux Net Opérationnel (hors masse salariale)" basis and its label are UNCHANGED (T-411 semantics preserved). Moving payroll into the ledger basis remains a separate owner decision requiring its own migration + cross-platform equivalence run — NOT part of T-412.
  3. **ONE canonical calculation** (the payroll forecast engine) is shared by Personnel (operational view), Finance (cash-management view) and Statistics (planning view). Page-local forecast math is forbidden; a parity suite pins the three surfaces to identical values from identical inputs.
  4. **Semantic vocabulary (binding, FR labels included):**
     - *Vague de paie / payroll wave* — one monthly payroll period `YYYY-MM` with its payment obligations.
     - *Masse salariale attendue / expected payroll* — Σ current base salaries of eligible staff for the period (eligibility: `status = "active"` AND hired on/before the period's end AND not terminated before the period's start AND `salary > 0` — the PayrollManagement `activeStaff` basis, reused).
     - *Date de paiement canonique / canonical payment date* — the LAST CALENDAR DAY of the period month (deterministic forecast convention; actual disbursements may land any day via `record_salary_disbursement`, and actuals override the convention for historical waves).
     - *Fonds requis / required cash* — the expected payroll that must be available before the payment date (full amount for future waves).
     - *Fonds sécurisés / secured-reserved amount* — Σ `net_paid` of the period's `paid` + `pending` disbursement rows (committed funds).
     - *Besoin de financement restant / remaining funding requirement* — `max(0, expected − secured)`.
     - *Trésorerie impact* — the 30-day-window payroll funding requirement set against the T-411 `expectedInflow30d` (a coverage ratio, clearly labeled; the inflow number itself is NOT modified).
- **Consequences:**
  - Finance gains the pre-payroll funding view without any backend migration; the feature works identically in mock and Supabase modes (both expose the two streams).
  - Future one-off bonuses/deductions are unknowable before they are recorded — the forecast honestly projects CURRENT base salaries only (a documented limitation rendered on the surfaces, §15.49a honesty).
  - If the owner later decides payroll joins the ledger basis, that change supersedes clause 2 and must ship as a new ADR + migration + equivalence run; the forecast engine's inputs would then read the ledger instead of `salary_payments` directly.
- **Related:** ADR-010 (display conventions), ADR-023 (collection semantics), T-369 (payroll persistence), T-411 (treasury semantics), T-412 (this feature), WORKFORCE-504.

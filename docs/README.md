# El-Imtiyaz Documentation

> Centralized documentation for the **El-Imtiyaz Educational & Operational Management Platform** — a private-school management system serving Sarl Elimtiyaz in Boumerdès, Algeria.

This folder consolidates every Markdown fragment that was previously scattered across the repository root and the `elimtiyaz-desktop/` subdirectory. It is organized into four sections:

---

## Documentation Structure

```
docs/
├── README.md                          ← You are here
│
├── project-specification/             The authoritative product blueprint
│   ├── 01-conflict-resolutions.md         Surviving rules where drafts disagreed
│   ├── 02-architecture-and-platforms.md   Topology, RBAC, feature matrix
│   ├── 03-ui-and-ux-design.md             Color tokens, typography, layout
│   ├── 04-parent-and-student-crm.md       Family data model, batch registration
│   ├── 05-academic-structure.md           Scolarite vs clubs, levels, subjects
│   ├── 06-grading-and-progression.md      Assessment formulas, GPA, promotion
│   ├── 07-financial-engine.md             Payments, installments, debt, receipts
│   ├── 08-expense-workflow.md             Two-tier approval + proof of purchase
│   ├── 09-attendance-and-hr.md            Roll call, statuses, personnel, Relevé
│   ├── 10-workflow-automation.md          Edge Functions, DAG editor, triggers
│   ├── 11-ai-integration.md               Groq, OpenRouter, BYOK, use cases
│   ├── 12-security-and-audit.md           Traceability, schema, RLS, media vault
│   ├── 13-backup-and-recovery.md          24h cycle, AES-256, offsite vault
│   ├── 14-excel-data-bridge.md            Import/export pipeline (engine purged)
│   ├── 15-dashboard-and-analytics.md      Revenue, demographics, debt metrics
│   ├── 16-deprecations-and-removals.md    Fee templates, scholarships, Excel engine
│   ├── 17-comparisons.md                  Side-by-side decision tables
│   ├── 18-best-practices.md               Atomic transactions, audit hygiene, etc.
│   ├── 19-troubleshooting.md              Common failure modes and fixes
│   └── 20-references.md                   Glossary, French terms, status codes
│
├── pricing/
│   └── fee-schedule-2026-2027.md       Official 2026-2027 fee schedule
│
├── legacy-excel-workbook/              Documentation of the legacy Excel workbook
│   ├── README.md                           Entry point
│   ├── workbook-overview.md                4-layer architecture, data flow
│   ├── sheets-reference.md                 REF, ETAT, Devis, BON sheets
│   ├── etat-columns.md                     38-column breakdown
│   ├── codes-and-vocabulary.md             Level/class/town/option codes
│   ├── formulas.md                         Core formulas + audit trail
│   ├── workflows.md                        Operator procedures
│   ├── hidden-logic.md                     Named ranges, validations, formatting
│   ├── known-issues.md                     4 documented bugs + fixes
│   └── appendix.md                         Stats, REF content, AM comment samples
│
├── development/                        Engineering work logs and refactor state
│   ├── refactor-state.md                   Multi-session architectural refactor log
│   ├── shared-unification.md               Desktop + Android Supabase unification
│   └── financial-refactor.md               Multi-manager financial system refactor
│
└── desktop/
    └── README.md                       Desktop app quick-start and tech stack
```

---

## Where to Start

| If you want to… | Read this first |
| :--- | :--- |
| Understand the product as a whole | [`project-specification/01-conflict-resolutions.md`](./project-specification/01-conflict-resolutions.md) — the surviving rules that override everything else |
| See the platform topology and RBAC | [`project-specification/02-architecture-and-platforms.md`](./project-specification/02-architecture-and-platforms.md) |
| Look up tuition or transport prices | [`pricing/fee-schedule-2026-2027.md`](./pricing/fee-schedule-2026-2027.md) |
| Understand the legacy Excel workbook | [`legacy-excel-workbook/README.md`](./legacy-excel-workbook/README.md) |
| See what engineering work has been done | [`development/refactor-state.md`](./development/refactor-state.md) |
| Run the desktop app | [`desktop/README.md`](./desktop/README.md) |

---

## Reading Order for the Project Specification

The project specification is numbered 01–20 and is designed to be read in order. The conflict-resolutions note (01) is the override layer — every decision there propagates into the rest of the specification. If you only have time for three notes, read:

1. **01 — Conflict Resolutions** (which rules survived)
2. **02 — Architecture and Platforms** (the topology and RBAC matrix)
3. **07 — Financial Engine** (the money-flow module)

---

## Provenance

This documentation was consolidated from the following scattered Markdown files that previously lived across the repository:

| Original file | Disposition |
| :--- | :--- |
| `Entire_Project_Plan.md` | → `docs/project-specification/` (21 notes extracted and reorganized) |
| `Prices.md` | → `docs/pricing/fee-schedule-2026-2027.md` |
| `Clients_Sheet_Merged.md` | → `docs/legacy-excel-workbook/` (10 notes extracted and reorganized) |
| `elimtiyaz-desktop/REFACTOR_STATE.md` | → `docs/development/refactor-state.md` |
| `elimtiyaz-desktop/CHANGES_SUMMARY.md` + `SHARED_UNIFICATION_SUMMARY.md` + `WORKLOG.md` | → merged into `docs/development/shared-unification.md` |
| `worklog.md` | → `docs/development/financial-refactor.md` |
| `elimtiyaz-desktop/README.md` | → rewritten as `docs/desktop/README.md` |

All original scattered `.md` files were deleted after their content was verified to be fully captured in this centralized structure.

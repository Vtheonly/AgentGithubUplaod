# Semantic duplication & model analysis (DTO/type layer)

Source: custom **ts-morph 28.0.0** structural scanner (`tools/audit-dto-duplication.ts`, executed 2026-11-27). It parses every exported `interface`/`type` in `src/` + `electron/` (excluding tests), normalizes each to a structural signature (member name + type, whitespace/qualifiers normalized), and groups by (a) full structural equality and (b) identical member-name sets across files.

Raw: `raw/tsmorph-dto-duplication.json`. Totals: **1,074 exported types analyzed → 20 exact structural duplicate groups, 25 same-member-name groups (multi-file).**

## 1. Exact structural duplicates (identical shape, different names/places)

| Group | Members | Files | Action |
|---|---|---|---|
| `Result` pattern ×5 | `ok` + union payload | `electron/backend-profile-contract.cts:106`, `:138`, `electron/preload.cts:105`, `src/core/result.ts:10`, `supabase-shared-repositories.ts:560` (`SeedReadOutcome`) | **One canonical Result in `src/core/result.ts`** — the type is re-invented in every layer instead of imported (boundary copy-paste) |
| `ReconciliationSeverity` ≡ `AlertTone` | same string union | `src/domain/reconcile-types.ts:9`, `src/shared/ui/unified-modal/types.ts:21` | UI tone enum forked from domain severity — map, don't redeclare |
| `ToolArtifact` ≡ `CalendarEvent` ≡ `TextareaProps` ≡ `ConditionNode` ≡ `EntityMatchOutcome` | (degenerate `{id?, …}` shapes) | 5 files across core/domain/shared | empty-ish structural coincidence — **false positive for consolidation**, but the shared base ("id/name" mini-DTO) could be named |
| `StudentIdentityInput` ≡ `PersonNameParts` | identity parts | `src/core/format/id.ts:93`, `src/domain/model/person.ts:14` | domain model vs format-helper copy |
| `PromotionDecision` ≡ `ReEnrollmentFinalDecision` | decision outcome | `academic.ts:258`, `re-enrollment.ts:34` | two features model the same concept independently |
| `PurchaseRequestPriority` ≡ `AlertPriority` ≡ `TaskPriority` | priority union | `operations-workforce.ts:45`, `operations.ts:35`, `workforce.ts:165` | three priority unions across operations models |
| `Gender` ≡ `TestGender` | gender union | `domain/model/parent.ts:10`, `devtools/test-data/generators.ts:42` | test fixture redeclares domain union |
| `AcademicCycleLegacy` ≡ `AcademicLevel` | level union | `payment.ts:279`, `student.ts:24` | legacy payment type mirrors the student level |

(20 groups total in the raw file; the 8 above are the material ones.)

## 2. Same-member-name groups (same fields, drifted types — semantic near-duplicates)

Notable: `domain/model/ai.ts:164 AnomalySignal` ↔ `domain/calc/expense/anomaly-signals.ts:37 ExpenseAnomalySignal`; the `Person`/`Student`/`Parent` record trios whose member names coincide but whose date/id types have drifted (`string` vs `UUID` vs branded types). These are the quiet drift risks: the shape stays aligned, the types diverge, and a rename in one place does not rename the sibling.

## 3. Model-layer observations

1. **The DTO surface is thin; the model layer is fat.** 1,074 exported types for 216 K-LOC of production code is a healthy ratio, but the duplication is concentrated at **process boundaries** (electron contract, preload bridge, Supabase row types, mock fixtures) — exactly the places where copy-paste is least visible and most dangerous.
2. **`supabase/types.ts` ↔ website `lib/types/database.ts`** (jscpd cross-app, DUPLICATION.md §5): the DB row types are also forked between the two apps. A generated `Database` type from `supabase gen types` should be the single source, committed as codegen, not hand-forked.
3. **Three "priority" unions, two "decision" models, one `Result` ×5** — the classical taxonomy drift that pre-creation search (AGENTS.md rule 2) exists to prevent.

## 4. Recommended consolidation (owner: domain)

| Rank | Action | Saves |
|---|---|---|
| 1 | Import `Result` from `src/core/result.ts` everywhere; delete the 4 boundary copies | 4 type declarations + drift class |
| 2 | Single `Priority` union in `domain/model/shared`; map UI tones per layer | 2 unions |
| 3 | `ReEnrollmentFinalDecision` → reuse `PromotionDecision` (or extract shared `DecisionOutcome<T>`) | 1 model + drift |
| 4 | Regenerate both apps' DB types from one `supabase gen types` artifact | fork risk |
| 5 | Test fixtures import domain unions (`TestGender` → `Gender`) | 1 union |

Estimated net LOC: small (~250–400); the value is **drift elimination**, not line count.

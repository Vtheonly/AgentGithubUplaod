### Scope Note
The provided export (`_entire_project_core.txt`) contains **only the 30 TypeScript files under `elimtiyaz-desktop/src/core/`**. It does not include `src/domain/`, `src/infrastructure/`, `src/app/`, `src/ui/`, `index.css`, or Supabase SQL migrations / Edge Functions.

Accordingly:
- Every finding below about `src/core/` is directly verified from the source code provided.
- Items that depend on external layers (e.g., whether UI components or Edge Functions still consume a legacy export) are explicitly flagged as **external verification checkpoints** rather than assumed dead.

---

# Part 1: Five-Axis Context Audit

## 1. What Must Always Be Included (Non-Negotiable Core)

An AI modifying or extending the application cannot work safely without these authoritative contracts, invariants, and boundaries:

### A. Architectural & Domain Invariants (Cross-Cutting Rules)
1. **No parallel financial/academic calculation (`§15.5` / `§15.16`):**
   - Financial balances, overdue amounts, GPAs, and attendance rates must come from canonical domain engines (`computeParentSummary` + `buildOverdueDueDateMap`, `evaluateStudentTermPerformance`, `calculateAttendanceRate`) and repository streams (`repos.debt.observeSummary()`, `repos.dashboard.*`), never re-derived inline.
2. **Human-in-the-loop mutation boundary (`§15.5` / `§15.8`):**
   - AI tools in `src/core/ai/` **never mutate persistent state directly**. Mutating actions (`propose_account_adjustment`, `propose_payment_reminder`, `propose_batch_reminders`) emit an `ActionProposal` (`requiresApproval: true`) validated before surfacing. Writes happen only after explicit human approval in the UI provider.
3. **Canonical name & identity conventions:**
   - Parents and students must be rendered with `parentDisplayName()` and `studentDisplayName()` (supports `displayName`-only rows), never `firstName + lastName`.
   - Identity codes (`PAR-{year}-{6-hex}`, `ELV-{year}-{6-hex}`, `REC-...`, `EMP-...`) and `deterministicActivationCode()` (FNV-1a 6-digit) are cross-platform idempotency keys shared with Android and Supabase `upsert_*_from_import` RPCs.
4. **Wire-protocol constants:**
   - `AuditActions` (`audit-actions.ts`), `Role` enum string values (`roles.ts`), and `Permission` enum string values (`permissions.ts`) are wire/DB protocol keys — never rename without coordinated DB migration.

### B. Core Subsystem Contracts & Entry Points
1. **Error & Result handling (`result.ts`, `app-error.ts`, `logger.ts`):**
   - `Result<T, E = AppError>` (`Ok`, `Err`, `tryResult`, `isAppError`, `Errors.*`). `tryResult` preserves thrown `AppError` objects without converting them to `ERR_UNKNOWN`.
   - `logger` emits structured JSON with 6 levels and recursive key redaction.
2. **RBAC & Access Control (`core/rbac/`):**
   - `Session` (`tenantId: string | null` for global-admin tenant switching, `role: Role`, `permissions: ReadonlySet<Permission>`).
   - `FeatureRegistry` (`SIDEBAR_SECTIONS`), `evaluate()` in `feature-gate.ts`, and `routeRedirectFor()` in `route-access.ts` (`ROUTE_GUARD_REDIRECT = "/personnel"`).
   - `DEFAULT_ROLE_PERMISSIONS` baseline matrix across 11 roles (6 school + 5 workforce).
3. **AI Runtime, Tools & Artifacts (`core/ai/`):**
   - `AIAgentRuntime.runConversationStep`: multi-turn OpenAI-compatible SSE loop (`MAX_TOOL_STEPS = 8`), **all tool schemas always sent on the wire** (no intent-based tool slicing), intent-based model-tier selection + 429 fallback model retry.
   - `executeOpenAIStream`: SSE consumer with incremental `tool_calls` reassembly and retry/backoff (`STREAM_RETRY`: 3 attempts, 429/5xx, honors `Retry-After` and `AbortSignal`).
   - `SYSTEM_TOOLS_DEFINITIONS` + `executeSystemTool` (`tool-registry.ts`): single dispatch entry for 27 tools across 5 suites (Core, Analysis, Visualization, Document, Workflow).
   - `ToolArtifact` (`artifacts.ts`): validated render-gate schema for inline `chart`, `diagram`, and `document` artifacts (`MAX_EXPORT_ROWS = 500`, `MAX_CATEGORIES = 60`, `MAX_SERIES = 6`).
   - `statistics.ts` & `insights.ts`: pure descriptive math (`computeDescriptiveStats`, `computeTrend`, `movingAverage`, `bucketize`) and heuristic composite scoring (`detectPaymentAnomalies`, `detectAttendanceAnomalies`, `detectGradeAnomalies`, `compareClassPerformance`, `prioritizeDebtors`, `scoreInterventionRisk`, `buildPaymentPlan`).
4. **Formatting & Theming (`core/format/`, `core/theme/`):**
   - `formatDzd`, `formatDate` (handles UTC calendar rendering for `YYYY-MM-DD` date-only strings), `formatDateUtc`, `formatDueDateRange`.
   - `applyThemePaletteToDom`: must update `--surface-*`/`--brand-*`/`--status-*` hex tokens **and** their `-rgb` channel twins + Shadcn HSL tokens + `.dark`/`.light` class.

---

## 2. What Can Be Unified or Consolidated

Several features and utility patterns are scattered or implemented multiple times within `src/core/`:

| Area | Current Duplication / Scattering | Recommended Consolidation |
| :--- | :--- | :--- |
| **FNV-1a 32-bit hashing (`format/id.ts`)** | `deterministicActivationCode()` (lines 65–72) and `stableHash()` (lines 110–118) implement the exact same FNV-1a algorithm separately. | Make `deterministicActivationCode` reuse an internal 32-bit FNV-1a helper shared with `stableHash`. |
| **Tool registry routing (`ai/tools/tool-registry.ts`)** | Core tools dispatch by checking `CORE_TOOLS_DEFINITIONS`; extension tools run through a sequential loop that parses JSON output and checks `parsed.error.includes("inconnu :")`. Also, only `executeCoreTool` has a `try/catch` wrapper despite the docblock claiming all executors are total. | Build a single `Map<string, ToolExecutor>` (or per-suite definition lookup) and wrap the top-level `executeSystemTool` in one `try/catch` so every tool is genuinely total. |
| **Attendance rate formula (`insights.ts` vs domain)** | `insights.ts` re-implements `attendanceRateOf()` privately instead of calling canonical `calculateAttendanceRate()` from `domain/model/academic`. | Delete `attendanceRateOf()` and call `calculateAttendanceRate()` directly (or accept precomputed rates as the JSDoc claims). |
| **Date window & formatting helpers (`ai/tools/*` vs `format/date.ts`)** | `isoWindow` is defined independently in `analysis-tools.ts` and `workflow-tools.ts`, and inlined twice in `system-tools.ts`. Tool outputs use `.toLocaleString("fr-FR") + " DZD"` instead of `formatDzd`, and `.toISOString().slice(0, 10)` instead of `format/date.ts` helpers. | Extract one shared date-window helper for `ai/tools/` and standardize currency formatting via `formatDzd`. |
| **Repeated domain aggregation loops across AI tools** | Per-student GPA evaluation (`evaluateStudentTermPerformance`) and debtor filtering (`repos.debt.observeSummary().get().filter(...)`) are repeated across `system-tools.ts`, `analysis-tools.ts`, `document-tools.ts`, and `workflow-tools.ts`. | Consolidate shared read helpers (e.g., `getSortedDebtors(repos, minDays, limit)`, `evaluateClassStudents(repos, classId)`). |
| **Unknown-error conversion (`result.ts` vs `app-error.ts`)** | `result.ts` has private `toAppError()` while `app-error.ts` exports `Errors.unknown()` with better support for plain `{ message, details }` objects (e.g., Postgrest errors). | Unify on one error normalization helper (preserving `isAppError` pass-through + plain-object extraction). |
| **Tool description & prompt inventory (`agent-runtime.ts` vs `tool-registry.ts`)** | `SYSTEM_PROMPT` hardcodes `"CAPACITÉS (27 outils système)"` and manually enumerates capabilities already declared in `SYSTEM_TOOLS_DEFINITIONS`. | Remove hardcoded counts from `SYSTEM_PROMPT`; let `tool-registry.ts` own the authoritative tool inventory. |
| **Historical docblocks across AI & RBAC files** | Multi-paragraph session histories (`T-260`, `T-266`, `T-267`, `T-272`–`T-281`, `REG-005`, `REG-006`, `Iteration 7/8/9/11`, `6ce49b9`) account for ~30–40% of comment volume and repeatedly explain *what used to be broken*. | Replace changelog narratives in the AI context with concise current-state invariants. |

---

## 3. What Can Be Removed (Dead, Unused, or Redundant Items)

### Verified Dead Code / Unused Elements inside `src/core/`
1. **`core/rbac/feature-gate.ts` & `access-state.ts`:**
   - `FeatureFlagProvider`, `alwaysOnFlagProvider`, and the `flags` parameter in `evaluate(requirement, ctx)` are never read inside `evaluate()`.
   - `{ kind: "feature_flag_off"; flag: string }` in `DisableReason` can never be produced (`AccessRequirement` has no feature-flag variant).
2. **`core/rbac/feature-registry.ts`:**
   - `const t1 = "T1";` and `const t2 = "T2";` (lines 28–29) — completely unused.
   - `empty` and `permanent` imported from `./access-requirement` (lines 17–18) — unused in this file.
3. **`core/ai/agent-runtime.ts`:**
   - `activeOverride?: string` parameter in `private static selectModel(...)` (line 138) — never passed by its sole caller.
4. **`core/ai/analysis/insights.ts`:**
   - `parents` parameter and `const byId = new Map(...); ... void byId;` in `detectPaymentAnomalies()` (lines 48, 51, 108) — constructed and explicitly discarded.
5. **`core/format/id.ts`:**
   - In `deterministicStudentCode()` (line 169): `fallbackSeed` is practically unreachable because `[parentId ?? "", displayName ?? "", ...].join("|").trim()` yields `"|||"` (length 3 > 0) even when all fields are empty.
6. **`core/rbac/permissions.ts`:**
   - Duplicate `Permission.ViewPersonnel` entry inside `DEFAULT_ROLE_PERMISSIONS[Role.FinancialOfficer]` (lines 219 and 227).

### Candidates Requiring External Verification Before Removal
*(Must be checked in `src/ui/`, `src/app/`, `src/infrastructure/` before deleting)*:
- **`AgentContextSnapshot` (`agent-types.ts`)**: Unused in `core/ai/` (not accepted by `AgentRunOptions` or `AIAgentRuntime`).
- **`ActionProposal["type"]` values `"record_attendance"` and `"dispatch_task"` (`agent-types.ts`)**: No tool in `core/ai/tools/` emits them; verify if the UI `approveAction` handler implements them or if they are abandoned stubs.
- **`DiagramType = "flow"` and `DiagramNodeKind = "step"` (`artifacts.ts`)**: Defined and validated in `artifacts.ts`, but no tool produces `"flow"` diagrams.
- **`activationCode()` (`format/id.ts`)**: Random 6–7 digit generator (`100_000`–`9_099_999`), superseded by `deterministicActivationCode()` for imports/activations; verify if anything else still calls it.
- **`PERMANENTLY_DISABLED` (`feature-registry.ts`)**: Check if Settings UI still renders this card (`"Locked features"`). Even if the array stays for UI display, its current items and comment are stale (see Section 5).
- **`roleLabelFr(role)` (`roles.ts`)**: Thin alias for `ROLE_LABELS_FR[role]`.

---

## 4. What Is Already Covered Elsewhere

- **Role capability descriptions:** `roles.ts` (`ROLE_DESCRIPTIONS_FR`), `permissions.ts` (`DEFAULT_ROLE_PERMISSIONS`), and `feature-registry.ts` repeat what each role can access. For an AI context, **`DEFAULT_ROLE_PERMISSIONS` + `SIDEBAR_SECTIONS` + `PROTECTED_ROUTE_PREFIXES`** are the authoritative source; prose descriptions in `roles.ts` and `feature-registry.ts` comments are redundant UI strings/legacy notes.
- **Individual tool parameter schemas vs file headers:** `system-tools.ts`, `analysis-tools.ts`, `visualization-tools.ts`, `document-tools.ts`, and `workflow-tools.ts` each maintain long file-header summaries listing the exact tool names and descriptions that immediately follow in `*_TOOLS_DEFINITIONS`. Summarizing the suite once in a registry index avoids listing every tool 2–3 times.
- **Validation boundaries:** `artifacts.ts` enforces exact caps (`MAX_EXPORT_ROWS = 500`, `MAX_CATEGORIES = 60`, `MAX_SERIES = 6`) and `system-tools.ts`/`workflow-tools.ts` enforce `ADJUSTMENT_AMOUNT_CEILING_DZD = 5_000_000` and `MAX_BATCH_PARENTS = 10` in code; prose restating these limits in `agent-runtime.ts` or docblocks is redundant.
- **UI/Theme token list:** `theme-engine.ts` mirrors the fields of `ThemeColors` in `theme-types.ts` (note only the extra requirement that hex tokens generate `-rgb` twins + Shadcn HSL tokens, and `light.borderColor` stays aligned with `index.css`).

---

## 5. Contradictions, Outdated Statements, and Bugs Identified

These are the highest-risk items where the code or comments actively contradict each other and can mislead an AI into introducing bugs:

### 1. Monthly vs. Annual Revenue Bug (`system-tools.ts`, `get_collection_analytics`)
- **Contradiction:** Line 407 reads `const collected = kpis.monthlyRevenue;`, line 415 outputs it under the JSON key **`annual_revenue_collected: collected`**, and line 423's `guidance` text explains `"Taux de recouvrement = encaissé mensuel / (encaissé mensuel + créances)"`.
- **Impact:** An AI or downstream consumer reading `annual_revenue_collected` receives **monthly** revenue mislabeled as annual revenue.
- **Authoritative source:** `kpis.monthlyRevenue` (monthly revenue); the JSON key `annual_revenue_collected` is wrong and should be renamed or accompanied by the real annual figure.

### 2. Contradictory AI Wire Architecture (`agent-runtime.ts` vs `tool-registry.ts`)
- **Contradiction:** `agent-runtime.ts` and `provider-registry.ts` post directly from the client to `api.groq.com` / `openrouter.ai` / `customBaseUrl` using BYOK keys stored in `AIProviderConfig`. Meanwhile, `tool-registry.ts` (line 22) warns: *"the ai-proxy Edge Function caps the wire `tools` array (raised to 40 in T-277 — live-verified)"*.
- **Impact:** Unclear whether production traffic routes through a Supabase `ai-proxy` Edge Function (e.g., via `src/infrastructure/ai/llm-adapter.ts` or `customBaseUrl`) or direct client fetch.
- **Resolution needed:** Verify `src/infrastructure/ai/llm-adapter.ts` and `supabase/functions/ai-proxy` so the context states clearly which path routes through `ai-proxy` and which goes direct.

### 3. Broken Cross-Platform Student Identity Code (`format/id.ts`)
- **Contradiction:** `deterministicParentCode` was explicitly patched (*"CANONICAL (cross-platform equivalence fix): filter out BOTH null and EMPTY identity fields"*) so Desktop and Android match `upsert_parent_from_import`. The sibling function `deterministicStudentCode` immediately below it was **not updated**: it still joins empty `""` fields (`[parentId ?? "", displayName ?? "", ...].join("|").trim()`), producing `"|||..."` instead of skipping empty values and making `fallbackSeed` dead code.
- **Authoritative rule:** The `.map(f => f.trim()).filter(f => f.length > 0).join("|")` normalization from `deterministicParentCode` must apply to `deterministicStudentCode` as well.

### 4. Fake / Contradicted Attendance Engine Reference (`insights.ts` vs `analysis-tools.ts`)
- **Contradiction:** `insights.ts` JSDoc above `detectAttendanceAnomalies` states: *"The rate itself comes from the CANONICAL `calculateAttendanceRate` (applied by the tool layer before calling)"*. In reality, `analysis-tools.ts` passes raw `AttendanceRecord[]`, and `insights.ts` runs its own private duplicate function `attendanceRateOf(records)` instead of importing `calculateAttendanceRate`.
- **Authoritative implementation:** `calculateAttendanceRate` from `domain/model/academic`.

### 5. Unsorted Debt Slice Before Prioritization (`workflow-tools.ts` vs `system-tools.ts` / `document-tools.ts`)
- **Contradiction:** `get_overdue_accounts` (`system-tools.ts`) and `generate_debt_report` (`document-tools.ts`) sort debtors by `outstandingAmount` descending **before** `.slice(0, limit)`. `plan_collection_campaign` (`workflow-tools.ts` line 101) applies `.filter(...).slice(0, limit)` **without sorting first**, then scores only that arbitrary subset.
- **Impact:** A collection campaign with `limit = 15` can silently omit the highest-value debtors depending on repository insertion order.

### 6. `PERMANENTLY_DISABLED` Claims Backend Is Not Built (`feature-registry.ts`)
- **Contradiction:** `feature-registry.ts` (lines 170–189) states that `supabase.realtime`, `supabase.edge_functions`, and `supabase.rls` are `"not_yet_available"` because *"they require a real backend"*. Across `audit-actions.ts`, `session.ts`, `format/id.ts`, and `tool-registry.ts`, live Supabase migrations (`0002`–`0157`), RLS/tenant scoping, RPCs, and Edge Functions (`create-user-account`, `delete-user-account`, `update-server-secret`, `ai-proxy`) are active.
- **Authoritative reality:** Supabase backend/RLS/Edge Functions are live; `PERMANENTLY_DISABLED` is stale legacy metadata from Iteration 7.

### 7. Incomplete `FeatureRegistry` vs `permissions.ts` (`feature-registry.ts`)
- **Contradiction:** `permissions.ts` defines 22 Iteration 8 workforce permissions (`ViewDepartments`, `ManageTasks`, `UseChat`, `ManagePurchaseRequests`, `ManageDeliveries`, `ManageInventory`, `ManageOnboarding`, `ViewWorkforceReports`, etc.), while `Personnel.children` in `feature-registry.ts` still only lists 4 legacy nodes (`pers.directory`, `pers.releve`, `pers.audit_log`, `pers.workflows`, with `pers.workflows` duplicating `section.workflow_automation`).

### 8. `SuperAdmin` Bypass Asymmetry (`session.ts` vs `feature-gate.ts` / `route-access.ts`)
- **Contradiction:** `session.ts` header claims *"Gate functions therefore bypass on that ONE value"*, and `hasRole`, `hasAnyRole`, `evaluate`, and `routeRedirectFor` all explicitly check `isSuperAdmin(session)`. However, `can(session, permission)` in `session.ts` does **not** bypass on `isSuperAdmin(session)` — it relies strictly on `session.permissions.has(permission)`.
- **Risk:** Any persisted/stale SuperAdmin session loaded before a new `Permission` enum entry was deployed will pass route/feature gates (`evaluate`) while failing granular `can()` checks.

### 9. Tool Schema / Implementation Mismatches (`core/ai/tools/`)
- **`compute_statistics` (`analysis-tools.ts`):** Runtime supports `args.parent_id` for `dataset: "payment_amounts"`, but `parent_id` is missing from the tool's JSON schema `properties`.
- **`propose_payment_reminder` (`system-tools.ts`):** Runtime rejects empty `parent_id`, but the JSON schema omits `required: ["parent_id"]`.
- **`draw_relationship_diagram` (`visualization-tools.ts`):** Description advertises *"un flux de processus métier"*, but `scope` enum and implementation only support `"family"` and `"class"`.
- **`analyze_revenue_trends` (`analysis-tools.ts`):** `statistics.ts` `movingAverage()` returns `null` for the initial `window - 1` months (*"honest leading gaps — never back-filled"*), then `analysis-tools.ts` replaces those `null`s with `0` (`v ?? 0`) to satisfy `ChartArtifact`'s numeric-only constraint, rendering an artificial ramp from `0` on the chart.
- **`detect_anomalies` (`scope: "payments"`, `analysis-tools.ts` / `insights.ts`):** `insights.ts` accepts `parents` (`void byId;`) and documents resolving names in the tool layer, yet neither layer attaches `parent_name` to payment anomaly output.
- **`insights.ts` name & GPA nuances:** `insights.ts` hand-rolls `student.displayName ?? firstName + lastName` instead of `studentDisplayName()` (violating `DATA-005`), and `detectGradeAnomalies` uses an unweighted average across subjects (heuristic check, unlike canonical weighted `evaluateStudentTermPerformance`).

### 10. Minor Gaps & Mismatches
- **`logger.ts`:** `SENSITIVE_KEYS` redacts `"apikey"`, `"token"`, `"secret"`, `"password"`, etc., via exact lowercase key match — it does **not** redact `"groqapikey"`, `"openrouterapikey"`, or `"customapikey"` if an `AIProviderConfig` object is logged.
- **`date.ts`:** `toIsoDay()` uses local time (`date-fns`), whereas AI tools compute dates with `new Date().toISOString().slice(0, 10)` (UTC); `currentAcademicYear()` computes the school year mathematically from September rather than reading `repos.academicYears` (used by `visualization-tools.ts`).
- **`agent-runtime.ts`:** `FAST_SEARCH` and `MODERATE_INSPECTION` map to the exact same model (`fastModel || defaultModel`), differing only in `temperature` (`0.2` vs `config.temperature`), and `runConversationStep` duplicates `resolveEndpoint`'s `custom_openai` check.

---

# Part 2: Consolidated Authoritative Context for `src/core/`

Below is the **restructured, pruned, contradiction-free reference context** for `elimtiyaz-desktop/src/core/`. It preserves every contract, dependency, invariant, and wire-protocol constraint an AI needs to maintain or extend `src/core/` safely, while stripping historical patch commentary and redundant definitions.

```markdown
# elimtiyaz-desktop / src/core — Authoritative Architecture & Contracts

Scope: Shared application foundation (error/result primitives, logging, audit constants, formatting, RBAC, theming, and the agentic AI runtime).
External layers consumed by `src/core/`:
- `src/domain/model/*` (entities + `parentDisplayName`, `studentDisplayName`, `calculateAttendanceRate`, label maps)
- `src/domain/calc/*` (canonical `computeParentSummary`, `buildOverdueDueDateMap`, `evaluateStudentTermPerformance`, `currentTermWindow`)
- `src/app/providers/repository-provider` (`Repositories` interface)

---

## 1. Primitives, Logging & Wire Constants

- **Result & Errors (`result.ts`, `app-error.ts`)**
  - All fallible repo/use-case operations return `Result<T, AppError>` (`Ok(v)` / `Err(e)`), built via `Errors.{network, timeout, notFound, validation, unauthorized, forbidden, conflict, server, offline, unknown}`.
  - `tryResult(fn, toError?)` captures thrown errors; `isAppError()` ensures deliberate `AppError`-shaped throws pass through unmasked.
  - *Debt:* `result.ts` has a private `toAppError` duplicating `Errors.unknown`; consolidate on `Errors.unknown`.

- **Logger (`logger.ts`)**
  - `logger.{trace, debug, info, warn, error, critical}(msg, ctx?, err?)`. Min level: `trace` in Vite `DEV`, `info` otherwise.
  - Recursively masks keys in `SENSITIVE_KEYS` (`password`, `token`, `accesstoken`, `refreshtoken`, `secret`, `apikey`, `authorization`, `cookie`). *Caution:* `*ApiKey` variants (`groqApiKey`, etc.) are not currently matched.

- **Audit Actions (`audit-actions.ts`)**
  - `AuditActions` defines stable `audit_log` wire-protocol strings across Auth, System, CRM, Academic, SchoolYear, Clubs, Psychology, Orthophonie, Financial, Expense, Personnel, Settings/RBAC/Secrets/Backups/Workflows, AI, and Excel Imports. **Never rename values without a backend migration.**

---

## 2. Formatting & Identity (`core/format/`)

- **Currency (`currency.ts`):** `formatDzd(amount, { compact? })`, `formatDzdPlain(amount)`, `parseDzd(input)`. (UI and AI responses should use `formatDzd` rather than ad-hoc `toLocaleString`.)
- **Dates (`date.ts`):**
  - `formatDate(val, pattern?)` renders `YYYY-MM-DD` date-only strings in UTC (`formatUtcParts`) to prevent local-timezone off-by-one shifts; `formatDateUtc` forces UTC for ISO timestamps representing calendar dates.
  - `formatDueDateRange(min, max)` displays a single date when equal or `min → max` when spread.
  - `toIsoDate` (UTC ISO), `toIsoDay` (local `yyyy-MM-dd`), `currentAcademicYear` (Sept cutoff heuristic — prefer `repos.academicYears` for active DB year).
- **Codes & Deterministic IDs (`id.ts`):**
  - Formatters: `parentCode` (`PAR-YYYY-XXXX`), `studentCode` (`ELV-YYYY-000000`), `receiptCode` (`REC-YYYY-000000`), `personnelCode` (`EMP-YYYY-000`), `backupFileName` (`backup-YYYY-MM-DD-HHMMSS[-ms].db`).
  - Deterministic cross-platform FNV-1a generators (must match Android + Supabase `upsert_*_from_import` RPCs):
    - `deterministicActivationCode(parentCode, tenantId)` → 6-digit `[100000..999999]`. (`activationCode()` is a random legacy generator; verify callers before removing.)
    - `deterministicParentCode(year, input, fallbackSeed?)` → `PAR-{year}-{6-hex}` using trimmed non-empty `(phone, displayName, firstName, lastName)`.
    - `deterministicStudentCode(year, parentId, input, fallbackSeed?)` → `ELV-{year}-{6-hex}`. *Known bug:* currently joins empty `""` fields and never hits `fallbackSeed`; align normalization with `deterministicParentCode`.

---

## 3. RBAC & Routing (`core/rbac/`)

- **Roles (`roles.ts`):**
  - 6 school roles: `SuperAdmin`, `FinancialOfficer`, `Teacher`, `SupportStaff`, `Parent`, `Student`.
  - 5 workforce roles: `Manager`, `Buyer`, `Driver`, `WarehouseWorker`, `Worker`.
  - `STAFF_ROLES` = all except `Parent` and `Student` (who are redirected to web portal).
  - *Note:* `Tournées` / driver-mode (`AccessDriverMode` + `/routing`) was removed; `Role.Driver` and deliveries remain.
- **Permissions (`permissions.ts`):**
  - `Permission` enum + `PERMISSION_LABELS_FR` + `DEFAULT_ROLE_PERMISSIONS` (runtime matrix configurable in Settings).
  - Key role boundaries: `Teacher` intentionally lacks `ViewRoster` and `ViewAcademics` (works inside `/personnel`, not CRM/Pédagogie); `SupportStaff` holds `ViewFinancials`, `ManageClasses`, `PromoteStudent`, `EnrollClubMembers`.
- **Session (`session.ts`):**
  - Immutable `Session` (`tenantId: string | null` — `null` only for unassigned global admins).
  - `isSuperAdmin(session)` checks exact `session?.role === Role.SuperAdmin`.
  - `hasRole`, `hasAnyRole`, `evaluate`, and `routeRedirectFor` explicitly bypass on `isSuperAdmin(session)`. `can(session, perm)` checks `session.permissions.has(perm)` directly (relies on producers granting all permissions to SuperAdmin).
- **Feature & Route Gating (`access-requirement.ts`, `access-state.ts`, `feature-gate.ts`, `feature-registry.ts`, `route-access.ts`):**
  - `AccessRequirement`: `empty | permanent | permission | anyOfPermission | allOfPermission | role`.
  - `evaluate(req, { session, flags })` → `enabled | disabled(reason) | hidden`. (*Dead code:* `flags` / `FeatureFlagProvider` / `feature_flag_off` are currently ignored.)
  - `SIDEBAR_SECTIONS` in `feature-registry.ts`: `Dashboard` (role-restricted to `SuperAdmin`, `FinancialOfficer`, `SupportStaff`, `Manager`), `Crm`, `Academics`, `Financials`, `Personnel`, `WorkflowAutomation`, `Settings`.
  - `PROTECTED_ROUTE_PREFIXES`: `/`, `/crm`, `/academics`, `/financials`, `/workflow`, `/settings` → unauthorized access redirects to `ROUTE_GUARD_REDIRECT = "/personnel"`.
  - *Stale metadata:* `feature-registry.ts` still contains `PERMANENTLY_DISABLED` claiming Supabase Realtime/Edge Functions/RLS are `"not_yet_available"`, and `Personnel.children` does not reflect workforce sub-modules.

---

## 4. Theme Engine (`core/theme/`)

- **Presets & Persistence (`theme-types.ts`, `theme-engine.ts`):**
  - 5 built-in palettes (`dark` default, `light`, `emerald`, `amethyst`, `slate_amber`) + custom palettes in `localStorage` (`el-imtiyaz:custom-themes`).
  - `applyThemePaletteToDom(palette)` sets `.dark`/`.light` on `<html>`, `data-theme`, inline `backgroundColor`/`color`, `meta[name="theme-color"]`, hex CSS vars (`--surface-*`, `--brand-*`, `--status-*`), `-rgb` channel twins for Tailwind alpha utilities, and Shadcn HSL vars.
  - Keep `PRESET_THEMES["light"].colors.borderColor` (`#94a3b8`) synchronized with `index.css` `.light`.

---

## 5. Agentic AI Copilot (`core/ai/`)

### 5.1 Runtime, Providers & Streaming
- **Endpoints (`provider-registry.ts`):** OpenAI-compatible wire protocol for `groq`, `openrouter`, and `custom_openai` (default `http://localhost:11434/v1`). `queryLiveProviderModels()` populates model choices dynamically.
  - *Verify externally:* `tool-registry.ts` notes an `ai-proxy` Supabase Edge Function capping `tools` at 40, while `AIAgentRuntime` currently posts directly using BYOK keys (`config.*ApiKey`).
- **Stream Client (`streaming/stream-client.ts`):**
  - `executeOpenAIStream()` parses SSE text deltas and reassembles fragmented `tool_calls` by index.
  - Retries initial POST on HTTP `429`, `500`, `502`, `503`, `504` up to `STREAM_RETRY.maxAttempts` (3), honoring `Retry-After` and `AbortSignal`.
- **Agent Loop (`agent-runtime.ts`):**
  - `AIAgentRuntime.runConversationStep()`: sends `SYSTEM_PROMPT` + history + **all 27 `SYSTEM_TOOLS_DEFINITIONS`** (`tool_choice: "auto"`), max `MAX_TOOL_STEPS = 8` rounds.
  - `analyzeIntent()` selects model tier ONLY (`HEAVY_REASONING` → `reasoningModel`; `FAST_SEARCH`/`MODERATE_INSPECTION` → `fastModel`, with `temperature = 0.2` on `FAST_SEARCH`). Never slices tool availability.
  - On exhausted 429, retries once with `config.fallbackModel`, then throws a French quota-guidance error.

### 5.2 Tool System (`core/ai/tools/tool-registry.ts` + 5 Suites)
Every tool executes against `Repositories` + canonical `src/domain/calc/` engines and returns a JSON string (errors as `{ error, hint? }`).
- **Core (12 — `system-tools.ts`):** `search_entities`, `get_financial_ledger_summary` (`computeParentSummary` + `buildOverdueDueDateMap`), `get_overdue_accounts`, `get_collection_analytics`, `get_payment_history` (strict `status === "paid"` sum), `get_student_academic_profile`, `get_student_attendance` (`calculateAttendanceRate`), `get_class_performance`, `get_school_kpi_overview`, `propose_account_adjustment` (validated: existing parent, `0 < |amount| ≤ 5_000_000`, `reason.length ≥ 3`), `propose_payment_reminder` (verifies real debtor), `request_user_clarification`.
- **Analysis (5 — `analysis-tools.ts`):** `analyze_revenue_trends`, `compute_statistics`, `detect_anomalies` (`payments` | `attendance` | `grades`), `compare_classes`, `get_enrollment_demographics`. All emit `ChartArtifact` (when non-empty).
- **Visualization (2 — `visualization-tools.ts`):** `render_chart` (validates model-composed `ChartArtifact`), `draw_relationship_diagram` (`family` | `class` from real repos + current-year timetable).
- **Documents (4 — `document-tools.ts`):** PDF refetch artifacts (`generate_parent_statement`, `generate_class_report`, `generate_debt_report`) and embedded tabular exports (`export_data` in `xlsx` | `csv`, capped at `MAX_EXPORT_ROWS = 500`).
- **Workflows (4 — `workflow-tools.ts`):** `plan_collection_campaign` (advisory P1/P2/P3 scoring), `propose_batch_reminders` (1–10 verified debtors → `ActionProposal` type `batch_reminders`), `propose_payment_plan` (1–12 months over canonical balance → advisory PDF `payment_plan` artifact), `recommend_interventions` (max 3 classes, composite risk score).

### 5.3 Action Proposals & Rich Artifacts (`agent-types.ts`, `artifacts.ts`)
- **Action Proposals:** Mutating tools emit `ActionProposal` (`type`: `account_adjustment` | `send_reminder` | `batch_reminders` actively produced; `record_attendance` | `dispatch_task` defined in type union only). `requiresApproval: true` is invariant.
- **Artifacts (`artifacts.ts`):** Tools attach one validated artifact under JSON key `"artifact"` via `withArtifact(data, artifact)`. `parseToolArtifact()` gates rendering in the UI (`chart`: ≤60 categories, ≤6 series, finite numbers, non-negative for pie/donut/stacked; `diagram`: ≤40 nodes, ≤80 valid edges; `document`: valid filename, refetch `params`, ≤500 embedded rows for `xlsx`/`csv`).

### 5.4 Statistics & Heuristic Insights (`core/ai/analysis/`)
- **`statistics.ts`:** Pure total functions (no `NaN`/throws): `computeDescriptiveStats` (mean, median, quartiles, IQR, Tukey 1.5×IQR outliers), `computeTrend` (OLS slope, direction at ±5% band, R²), `movingAverage` (leading `null`s), `periodGrowthPercent`, `bucketize` (`DZD_AMOUNT_BUCKETS`, `GPA_BUCKETS`).
- **`insights.ts`:** Heuristic decision enrichment (never replaces canonical rules): `detectPaymentAnomalies` (Tukey + same-day multi-payment), `detectAttendanceAnomalies` (`>1.5σ` below cohort or `<85%` with `≥2` unexcused), `detectGradeAnomalies` (`≥4` pts below student's unweighted baseline), `compareClassPerformance`, `prioritizeDebtors` (`amount_first` 70/30, `aging_first` 30/70, `balanced` 50/50), `scoreInterventionRisk` (academic 45 + attendance 35 + missing data 20), `buildPaymentPlan` (remainder-adjusted equal installments).

### 5.5 Known Code Defects to Fix During Maintenance
1. `system-tools.ts`: `get_collection_analytics` assigns `kpis.monthlyRevenue` to `annual_revenue_collected`; `propose_payment_reminder` schema lacks `required: ["parent_id"]`.
2. `workflow-tools.ts`: `plan_collection_campaign` slices debtors before sorting by amount/aging.
3. `insights.ts`: replaces canonical `calculateAttendanceRate` with private `attendanceRateOf`, bypasses `studentDisplayName()`, and builds/discards `byId` in `detectPaymentAnomalies`.
4. `analysis-tools.ts`: `compute_statistics` reads `args.parent_id` without declaring it in schema; `analyze_revenue_trends` converts moving-average `null` gaps to `0`.
5. `tool-registry.ts`: extension suites rely on `"inconnu :"` string matching and lack top-level `try/catch`.
6. `format/id.ts`: `deterministicStudentCode` lacks the empty-field filter fix present in `deterministicParentCode`.
```

---

## Summary of Reduction & Impact
- **Token/Volume Reduction:** The raw export of `src/core/` is ~2,600 lines across 30 files, heavily padded with historical ticket post-mortems (`T-260`–`T-546`), repeated tool descriptions, and duplicate helpers. Consolidating it into the authoritative specification above cuts context size by **~70–75%** while adding missing cross-file warnings (such as the `monthlyRevenue` → `annual_revenue_collected` mismatch and the `deterministicStudentCode` bug).
- **Recommended Next Step:** Run the same audit on `src/domain/`, `src/infrastructure/`, and `src/app/` so that the external verification checkpoints (`ai-proxy` vs direct BYOK, `PERMANENTLY_DISABLED`, `AgentContextSnapshot`, and `record_attendance`/`dispatch_task`) can be resolved against the full codebase.
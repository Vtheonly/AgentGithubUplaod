# Verification Report — 'Optimizing AI Context for Development — Core.md'

**Investigator:** Agent CR (Task RPT-1) · **Scope:** `elimtiyaz-desktop/src/core` (all 30 files read) + cross-checks in `src/app`, `src/shared`, `src/features`, `src/infrastructure`, `src/domain`, `src/index.css`, `supabase/` · **Mode:** read-only.

**Meta-finding (applies to every row below):** the report's *content* claims are overwhelmingly accurate, but its **line numbers are systematically stale** (actual code sits ~10–160 lines lower than cited, varying per file) and its size claim is badly outdated: `src/core` is **6,927 lines across 30 files** (`wc -l`), not "~2,600 lines". The report was evidently built from an older/truncated snapshot. File-count (30) is correct.

## 1. Report summary (what the report claims)

- `src/core` = 30 TS files, ~2,600 lines; scope excludes domain/app/ui/Supabase, so external-consumption items are "verification checkpoints".
- Core primitives: `Result<T, AppError>` with `Ok/Err/tryResult/isAppError/Errors.*`; `tryResult` preserves thrown `AppError`s; logger = 6 levels, JSON, recursive redaction; `AuditActions`/`Role`/`Permission` are wire protocol.
- RBAC: `Session` (nullable `tenantId`, `ReadonlySet<Permission>`); `evaluate()`, `routeRedirectFor()`, `ROUTE_GUARD_REDIRECT="/personnel"`; `DEFAULT_ROLE_PERMISSIONS` across 11 roles; `PROTECTED_ROUTE_PREFIXES` = `/`, `/crm`, `/academics`, `/financials`, `/workflow`, `/settings`.
- AI runtime: `MAX_TOOL_STEPS=8`, all 27 tool schemas always on the wire, intent selects model tier only, 429 → one fallback-model retry → French quota error; `executeOpenAIStream` reassembles fragmented `tool_calls`, retries 429/5xx ×3 with `Retry-After`/`AbortSignal`.
- Artifacts: render-gate validation with `MAX_EXPORT_ROWS=500`, `MAX_CATEGORIES=60`, `MAX_SERIES=6`.
- Duplication findings: double FNV-1a in `id.ts`; string-matching tool dispatch (`"inconnu :"`) with try/catch only on the core suite; private `attendanceRateOf` vs canonical `calculateAttendanceRate`; repeated `isoWindow`/`.toLocaleString("fr-FR")`/`.toISOString().slice(0,10)` instead of `core/format`; repeated GPA/debtor loops across 4 tool files; `toAppError` vs `Errors.unknown`; hardcoded "27 outils" count in `SYSTEM_PROMPT`; ~30–40% comment volume is ticket history.
- Dead code (in-core): flag-provider params ignored by `evaluate`; `feature_flag_off` unproducible; `t1/t2`, unused `empty/permanent` imports, unused `activeOverride`, discarded `parents`/`byId`, unreachable `fallbackSeed` in `deterministicStudentCode`, duplicate `ViewPersonnel`.
- External-verification candidates: `AgentContextSnapshot`, `record_attendance`/`dispatch_task`, `"flow"`/`"step"` diagram kinds, `activationCode()`, `PERMANENTLY_DISABLED`, `roleLabelFr`.
- Bugs: `annual_revenue_collected` actually carries `kpis.monthlyRevenue`; `deterministicStudentCode` lacks the parent-code empty-field filter; `plan_collection_campaign` slices before sorting; `PERMANENTLY_DISABLED` claims Supabase isn't built (it is); `Personnel.children` misses 22 workforce permissions; `can()` lacks the SuperAdmin bypass the other gates have; schema/impl mismatches (`compute_statistics` `parent_id`, `propose_payment_reminder` `required`, `draw_relationship_diagram` description, moving-average null→0); logger misses `*ApiKey` keys; `toIsoDay` local vs AI-UTC; `FAST_SEARCH`/`MODERATE_INSPECTION` same model.

## 2. Claim-by-claim verification table

| # | Claim | Classification | Evidence (file paths + lines) | Notes |
|---|-------|----------------|-------------------------------|-------|
| 1 | `src/core` contains 30 TS files | VERIFIED | `find src/core -name "*.ts" \| wc -l` → 30 | — |
| 2 | Raw export ≈ 2,600 lines | REJECTED | `wc -l` over `src/core/**/*.ts` → **6,927** | Code grew ~2.7× since the report's snapshot; all its line cites are stale |
| 3 | `Result<T, E=AppError>`; `Ok/Err/tryResult/isAppError/Errors.*`; `tryResult` preserves thrown `AppError` (no `ERR_UNKNOWN` laundering) | VERIFIED | `src/core/result.ts:10-45, 68-104` (`if (isAppError(err)) return err;` L75); `src/core/app-error.ts:11-79` | Also true: `mapResult` used (import-engine `repository-adapter.ts:902,974`); `flatMapResult`/`unwrapOr`/`isAppError` have no external consumers |
| 4 | Logger: 6 levels, structured JSON, recursive redaction, min `trace` in DEV / `info` otherwise | VERIFIED | `src/core/logger.ts:12, 18-25, 38-50, 65, 99` | — |
| 5 | `Session` has `tenantId: string \| null`, `role`, `permissions: ReadonlySet<Permission>` | VERIFIED | `src/core/rbac/session.ts:24-47` | Also carries `homeTenantId`, tokens, `locale` |
| 6 | `evaluate()` / `routeRedirectFor()` / `ROUTE_GUARD_REDIRECT="/personnel"` / prefixes `/`, `/crm`, `/academics`, `/financials`, `/workflow`, `/settings` | VERIFIED | `src/core/rbac/feature-gate.ts:17-74`; `route-access.ts:17, 24-32, 45-57` | Note: `/personnel` is intentionally NOT protected (it is the redirect target) |
| 7 | `DEFAULT_ROLE_PERMISSIONS` covers 11 roles (6 school + 5 workforce) | VERIFIED | `permissions.ts:238-427`; `roles.ts:17-32` | Consumed by `features/settings/rbac-matrix-editor.tsx:31,48` |
| 8 | `runConversationStep`: `MAX_TOOL_STEPS=8`, ALL tools always sent, `tool_choice:"auto"`, intent→model tier only, 429→fallback retry→French quota error | VERIFIED | `agent-runtime.ts:93, 240-245, 261-316`; intent usage `:210, 240` | — |
| 9 | `executeOpenAIStream`: SSE `tool_calls` reassembly by index; `STREAM_RETRY` 3 attempts; 429/500/502/503/504; honors `Retry-After` + `AbortSignal` | VERIFIED | `stream-client.ts:64-76, 79-112, 136-157, 195-211` | — |
| 10 | 27 tools: Core 12 / Analysis 5 / Visualization 2 / Document 4 / Workflow 4; single dispatch via `executeSystemTool` | VERIFIED | `tool-registry.ts:49-55, 76-103`; definitions counted in each `*-tools.ts` | — |
| 11 | `ToolArtifact` render gate: 500 rows / 60 categories / 6 series; `parseToolArtifact` gates UI rendering | VERIFIED | `artifacts.ts:138-141, 177-346`; consumer `features/ai/copilot-drawer.tsx:38, 78-80` | — |
| 12 | statistics/insights inventory (Tukey fences, OLS ±5% band + R², leading-null moving average, 70/30–30/70–50/50 debtor weights, 45/35/20 risk score, remainder-adjusted plan) | VERIFIED | `statistics.ts:74-247`; `insights.ts:342-382, 410-488, 516-550` | — |
| 13 | `formatDzd`; `formatDate` renders date-only strings in UTC; `formatDateUtc`; `formatDueDateRange` | VERIFIED | `currency.ts:20-31`; `date.ts:34-45 (41-43), 54-57, 84-97` | — |
| 14 | `applyThemePaletteToDom` sets `.dark/.light`, hex tokens + `-rgb` twins + Shadcn HSL + meta theme-color | VERIFIED | `theme-engine.ts:32-42, 78-150` | — |
| 15 | FNV-1a implemented twice in `id.ts` (`deterministicActivationCode` vs `stableHash`) | VERIFIED | `id.ts:64-71` vs `id.ts:108-114` | Report's lines 65–72/110–118 ≈ correct modulo drift |
| 16 | Tool dispatch: core via definition scan; extensions via sequential loop checking `parsed.error.includes("inconnu :")`; only `executeCoreTool` has try/catch despite docblock claiming totality | VERIFIED | `tool-registry.ts:83-102 (96)`; `system-tools.ts:372, 810-812`; no try/catch in `analysis-tools.ts:236-635`, `visualization-tools.ts:98-311`, `document-tools.ts:122-388`, `workflow-tools.ts:142-492` | Consequence confirmed: a throwing extension tool escapes `executeSystemTool` and aborts the whole turn — caught only by `ai-copilot-provider.tsx:530-575` as "Erreur IA" |
| 17 | `insights.ts` re-implements `attendanceRateOf` instead of canonical `calculateAttendanceRate`; JSDoc claims the tool layer pre-applies the canonical rate | VERIFIED | `insights.ts:160-163, 167, 199-203` vs `domain/model/academic.ts:384-392`; tool layer passes raw records `analysis-tools.ts:467-471` | Extra nuance missed by report: duplicate rounds to 3 decimals vs canonical 2 (`toFixed(3)` vs `toFixed(2)`), so outputs can differ in the 3rd decimal |
| 18 | `isoWindow` duplicated (analysis + workflow, inlined twice in system-tools); tools use `.toLocaleString("fr-FR")+" DZD"` and `.toISOString().slice(0,10)` instead of `core/format` | VERIFIED | `analysis-tools.ts:226-230`; `workflow-tools.ts:498-505`; inlined `system-tools.ts:583-587, 619-622`; 11+ `toLocaleString` sites; `formatDzd` imported **nowhere** in `core/ai`; 12× `toISOString().slice(0,10)` | The two `isoWindow`s even have different signatures (days→{from,to} vs no-arg→from-string) |
| 19 | Per-student GPA evaluation + debtor filtering repeated across the 4 tool files | VERIFIED | `system-tools.ts:669-678`; `analysis-tools.ts:200-208, 335-341`; `document-tools.ts:390-395`; `workflow-tools.ts:159-172, 423-438` | — |
| 20 | `result.ts` private `toAppError` duplicates `Errors.unknown` (which handles plain `{message,details}` better) | VERIFIED | `result.ts:68-89`; `app-error.ts:49-78` | — |
| 21 | `SYSTEM_PROMPT` hardcodes "CAPACITÉS (27 outils système)" | VERIFIED | `agent-runtime.ts:71` | It enumerates capability *categories*, not all 27 tools — consolidation advice still valid |
| 22 | Historical docblocks ≈ 30–40% of comment volume | CORRECTED | Measured comment-line ratios: `agent-runtime.ts` 20%, `system-tools.ts` 15%, `session.ts` 41%, `permissions.ts` 23% | Ticket narratives (`T-2xx…T-5xx`, REG-005, 6ce49b9) are pervasive everywhere, but 30–40% overstates the two largest AI files |
| 23 | `FeatureFlagProvider`/`alwaysOnFlagProvider`/`flags` never read inside `evaluate()` | VERIFIED | `feature-gate.ts:17-73` — `ctx.flags` never referenced; `alwaysOnFlagProvider` only passed as a dummy (`route-access.ts:54`, `gated-content.tsx:24`) | — |
| 24 | `{kind:"feature_flag_off"}` can never be produced | VERIFIED | `access-state.ts:20`; only produced nowhere — sole reference is a dead switch case `gated-content.tsx:75` | — |
| 25 | `t1`/`t2` unused; `empty`/`permanent` imported unused in `feature-registry.ts` | VERIFIED | `feature-registry.ts:31-32` and import block `:16-22` (unused in body) | — |
| 26 | `selectModel`'s `activeOverride` never passed by its sole caller | VERIFIED | `agent-runtime.ts:157` vs sole call `:211` (`this.selectModel(complexity, config)`) | — |
| 27 | `detectPaymentAnomalies`: `parents` param + `byId` built and discarded | VERIFIED | `insights.ts:58, 61, 126` (`void byId;`) | — |
| 28 | `deterministicStudentCode`'s `fallbackSeed` unreachable (`"|||"` always length>0); lacks parent-code's empty-field filter | VERIFIED | `id.ts:166-175` vs fixed parent version `:131-151` | `t-018-identity-codes.test.ts:45-46` only pins determinism, not fallback reachability — bug stands |
| 29 | Duplicate `Permission.ViewPersonnel` in `FinancialOfficer` (report: lines 219/227) | VERIFIED (stale lines) | Actual: `permissions.ts:260` and `:269` | — |
| 30 | `AgentContextSnapshot` unused in core (external checkpoint) | VERIFIED — and stronger | Only occurrence repo-wide is its definition `agent-types.ts:65` — **zero consumers, tests included** | Confirmed dead |
| 31 | `record_attendance`/`dispatch_task` emitted by no tool (checkpoint: does UI implement them?) | VERIFIED — resolved | Type union `agent-types.ts:56`; `approveAction` implements only `account_adjustment`/`send_reminder`/`batch_reminders` and deliberately no-ops the rest with "Type non exécutable" toast (`ai-copilot-provider.tsx:195-269`, comment `:260-267`) | Abandoned stubs, honestly handled |
| 32 | `DiagramType="flow"` / `DiagramNodeKind="step"` validated but produced by no tool | VERIFIED | `artifacts.ts:70, 72, 165-166`; only `"hierarchy"` ever produced (`visualization-tools.ts:207, 293`) | — |
| 33 | `activationCode()` random 6–7 digit, superseded by deterministic version | VERIFIED — and dead | `id.ts:43-45` (`100_000 + Math.random()*9_000_000`); zero consumers repo-wide; `deterministicActivationCode` used by `supabase-shared-repositories.ts:88,1314` + `sync/default-push-handler.ts:144` | — |
| 34 | `PERMANENTLY_DISABLED` claims realtime/edge_functions/rls "not_yet_available" but backend is live | VERIFIED | `feature-registry.ts:171-186` vs `supabase/migrations/` (0001–0157, 152 files) and 13 Edge Functions incl. `ai-proxy`, `create-user-account`, `delete-user-account`, `update-server-secret` | Rendered by `features/settings/locked-features-tab.tsx:13,27` — content stale, export alive |
| 35 | `roleLabelFr` thin alias (checkpoint) | VERIFIED — and dead | `roles.ts:97-99`; zero consumers repo-wide | — |
| 36 | **Bug:** `annual_revenue_collected` = `kpis.monthlyRevenue` (report: lines 407/415/423) | VERIFIED (stale lines) | Actual: `system-tools.ts:516` (`const collected = kpis.monthlyRevenue;`), `:523` (`annual_revenue_collected: collected`), `:531` (guidance "encaissé mensuel") | Real mislabel, exactly as described |
| 37 | Contradictory wire architecture: runtime posts direct BYOK vs tool-registry's ai-proxy tools-cap note | VERIFIED + RESOLVED | Direct BYOK: `agent-runtime.ts:184-203` (+ `PROVIDER_ENDPOINTS` `provider-registry.ts:26-47`); note at `tool-registry.ts:20-23`; `supabase/functions/ai-proxy/index.ts:109-150` does have an agent-stream mode with `tools ≤ 40` | Resolution: **agent/copilot traffic goes direct BYOK; only single-shot features (narrative/drafting/anomaly) route edge→BYOK→mock** via `infrastructure/ai/llm-adapter.ts:219-281, 450-460`. The EF's agent mode is not invoked by any desktop code — the capacity note is anticipatory/stale |
| 38 | `plan_collection_campaign` slices before sorting (report: line 101) | VERIFIED (stale lines) | Actual: `workflow-tools.ts:159-163` (`.filter().slice()` no sort) vs sorted siblings `system-tools.ts:475-480`, `document-tools.ts:214-219` | — |
| 39 | `Personnel.children` lists only 4 legacy nodes while 22 workforce permissions exist; `pers.workflows` duplicates `section.workflow_automation` | VERIFIED | `feature-registry.ts:115-120` vs `permissions.ts:112-154` (22 workforce entries); `WorkflowAutomation` section `:131-139` | — |
| 40 | SuperAdmin bypass asymmetry: `hasRole/hasAnyRole/evaluate/routeRedirectFor` bypass, `can()` does not | VERIFIED | `session.ts:58-67` (no bypass) vs `:69-86`, `feature-gate.ts:34-36`, `route-access.ts:49` | Risk window is real: persisted session is restored **unstamped** (`auth-provider.tsx:76-79`) until `refreshSession` re-stamps (`:64-71, 102-107`); note the in-file comment `session.ts:51` wrongly lists `can` as a bypass site |
| 41 | `compute_statistics` runtime reads `args.parent_id` but schema omits it | VERIFIED | `analysis-tools.ts:315-316` vs schema `:83-98` | — |
| 42 | `propose_payment_reminder` schema omits `required:["parent_id"]` though runtime rejects empty | VERIFIED | Schema `system-tools.ts:322-331` (no `required`) vs runtime `:752-758` | — |
| 43 | `draw_relationship_diagram` description advertises "un flux de processus métier"; scope only `family\|class` | VERIFIED | `visualization-tools.ts:76` vs `:83` and implementation `:141-305` | — |
| 44 | `analyze_revenue_trends` converts moving-average leading `null`s to `0`, fabricating a ramp | VERIFIED | `analysis-tools.ts:270` (`ma.map((v) => v ?? 0)`) vs honest nulls `statistics.ts:191-207` | — |
| 45 | Payments anomaly output lacks `parent_name` despite the "names resolve in the tool layer" comment | VERIFIED | `insights.ts:97-99` vs `analysis-tools.ts:439-448` (only `parent_id`) | — |
| 46 | `insights.ts` hand-rolls `displayName ?? firstName+lastName` (DATA-005) and uses an unweighted grade baseline | VERIFIED | `insights.ts:184-185, 470-471, 238` vs canonical `studentDisplayName` `domain/model/student.ts:447-452` | Extra nuance: `??` doesn't catch empty-string `displayName` (returns `""`), unlike the canonical trim-and-fallthrough |
| 47 | Logger redaction misses `groqApiKey`/`openRouterApiKey`/`customApiKey` | VERIFIED | `logger.ts:27-36` (exact lowercase set) + `:43` (`k.toLowerCase()` exact match — "groqapikey" not in set) | No current call site logs an `AIProviderConfig`, so it's latent, not active |
| 48 | `toIsoDay` local-time vs AI tools UTC; `currentAcademicYear` is a September heuristic while `visualization-tools` reads `repos.academicYears` | VERIFIED | `date.ts:103-114`; `visualization-tools.ts:232-235` | See §3 for the bigger duplication this exposes |
| 49 | `FAST_SEARCH`/`MODERATE_INSPECTION` map to the same model (temperature differs); `runConversationStep` duplicates `resolveEndpoint`'s custom_openai check | VERIFIED | `agent-runtime.ts:163-166, 240, 199-202` vs `provider-registry.ts:60-74` | — |
| 50 | Proposal validation: existing parent, `0 < \|amount\| ≤ 5_000_000`, `reason ≥ 3` chars; `MAX_BATCH_PARENTS = 10`; payment plan 1–12 months; interventions max 3 classes | VERIFIED | `system-tools.ts:76, 94-136`; `workflow-tools.ts:48, 249-254, 352-357, 400-405` | — |
| 51 | Core consumes `domain/model/*`, `domain/calc/*`, `app/providers/repository-provider` | VERIFIED | e.g. `system-tools.ts:52-63`, `agent-runtime.ts:41-46`; `Repositories` interface `app/providers/repository-provider.tsx:90` | Reverse edge is type-only (domain/repository imports `Result`/`Session` types) — no runtime cycle |
| 52 | 5 preset palettes + custom themes in `localStorage` (`el-imtiyaz:custom-themes`); keep `light.borderColor #94a3b8` aligned with `index.css .light` | CORRECTED | Presets/storage: `theme-types.ts:78-204`, `theme-engine.ts:11` ✓. But `src/index.css:189-190` sets `--border: 215 20% 62%` while `#94a3b8` = hsl(215 20% **65%**) — the two "aligned" values differ by 3 lightness points (≈`#8b9bb2` vs `#94a3b8`) | The "one source, two homes, keep aligned" invariant is already slightly broken |
| 53 | Teacher intentionally lacks `ViewRoster`/`ViewAcademics`; SupportStaff holds `ViewFinancials`/`ManageClasses`/`PromoteStudent`/`EnrollClubMembers` | VERIFIED | `permissions.ts:283-310` (removal comment `:284-291`), `:329-331, 341` | — |

## 3. Missed discoveries in the Core area

1. **`SIDEBAR_SECTIONS` is a dead export and the sidebar order is duplicated.** `feature-registry.ts:157-165` exports it as "Top-level navigation — order matters (sidebar order)", but it has **zero consumers repo-wide**. The real sidebar builds its own `ITEMS` array (`shared/layout/sidebar.tsx:45-53`) by importing the individual nodes — the canonical order and the rendered order can silently drift.
2. **`GatedContent` is used in exactly one JSX site** (`shared/layout/sidebar.tsx`), and the `useAccessState` hook (`shared/layout/gated-content.tsx:83-86`) has zero consumers. Feature pages gate imperatively via `can()` (24 call sites in `app/providers/auth-provider.tsx`, `shared/search-index.ts`, `features/academics/*`). The codebase therefore runs **two parallel gating idioms** (declarative `FeatureNode`+`evaluate` vs imperative `can()`), contra `feature-registry.ts`'s "gating rules defined in ONE file" header (lines 1-12).
3. **A cluster of dead RBAC exports the report didn't list:** `hasRole`/`hasAnyRole` (`session.ts:69-86` — test-only consumers), `isStaff` (`roles.ts:93-95` — zero consumers anywhere), `ADMINISTRATIVE_ROLES`/`SUPERVISORY_ROLES`/`OPERATIONAL_ROLES` (`roles.ts:105-124` — the onboarding wizard uses `STAFF_ROLES` instead, `features/personnel/onboarding/steps/roles-step.tsx:6`), `ROLE_LABELS_AR` (`roles.ts:48-60` — no i18n consumer; `src/i18n` references nothing from `core/rbac`), `isEnabled`/`isDisabled`/`isHidden` (`access-state.ts:36-46`), `requiresAllOf` + the whole `allOfPermission` variant and `empty`/`permanent` requirement kinds (`access-requirement.ts:26-28, 40-43` — never used by any FeatureNode).
4. **`Errors.offline` is never called** (`app-error.ts:46-48`; zero consumers incl. tests), yet `isNetworkError` (`:81-83`) checks for its `ERR_OFFLINE` code — that branch is unreachable for locally-built errors.
5. **Personnel code convention is internally contradictory.** `id.ts:22-24` documents/formats `EMP-{year}-{3-digit}` (dead export, zero consumers), while the live Supabase repository mints `PER-{year}-{6-hex}` via `stableHash` (`infrastructure/supabase/repositories/supabase-personnel-repository.ts:505`). `parentCode` and `receiptCode` formatters (`id.ts:10-20`) are also dead.
6. **`currentAcademicYear` is duplicated and the core copy is dead.** `core/format/date.ts:111-114` has zero non-test consumers; `supabase-dashboard-repository.ts:66-70` re-implements the identical September heuristic privately.
7. **`toIsoDate` dead in core, with two infrastructure clones.** `date.ts:99-101` (Date-only signature) is unused; `registration-billing-wires.ts:320-322` and `supabase-shared-repositories.ts:272` each hand-roll a `toIsoDate(string|Date|null|undefined)` because core's signature is too narrow — the comment at `registration-billing-wires.ts:320` documents the workaround.
8. **`visualization-tools.ts` hand-composes teacher names** — `` `${t.firstName} ${t.lastName}` `` at `:262` — the same DATA-005 class of violation the report attributed only to `insights.ts`. (No `teacherDisplayName` helper exists in `domain/model/teacher.ts`, so either the rule or the code needs alignment.)
9. **`index.css` light-border "alignment" is off** (see claim 52): `src/index.css:189-190` (hsl 215 20% 62% ≈ `#8b9bb2`) vs `theme-types.ts:125` (`#94a3b8` = 65% lightness). The pre-JS flash fallback and the JS-applied palette render slightly different borders.
10. **`AgentRunOptions` and `onToolCallDelta` are dead surface:** the options interface (`agent-runtime.ts:48-57`) is exported but the sole caller passes an untyped literal (`ai-copilot-provider.tsx:531`); the `onToolCallDelta` stream callback (`stream-client.ts:31`) is never passed by any caller.
11. **`quantile` / `EMPTY_STATS` / `hexToHsl` / `AuditAction` are exported but internal-only:** `statistics.ts:61, 43`, `theme-types.ts:40`, `audit-actions.ts:164` — no external consumers.
12. **`Logger.setLevel` is dead** (`logger.ts:67-69`, zero consumers) — the documented "Min level: trace in DEV" is the only control. (Minor: `infrastructure/excel/import-engine/utils/logger.ts:14` declares its own 4-value `LogLevel` that shadows core's 6-value type — a documented facade, but a naming collision.)

## 4. Dead/unused symbol census for `src/core` (non-test consumers; dynamic refs checked via import-graph greps — no string/registry access exists for these symbols)

| Symbol | File | Non-test consumers | Verdict |
|---|---|---|---|
| `mapResult` | result.ts:50 | `infrastructure/excel/import-engine/storage/repository-adapter.ts:902,974` | Alive |
| `flatMapResult` | result.ts:57 | none | **Dead** |
| `unwrapOr` | result.ts:64 | none | **Dead** |
| `tryResult` | result.ts:36 | `infrastructure/backup/backup-service.ts`, `backup-checkpoint.ts` | Alive (narrow) |
| `isAppError` | result.ts:96 | none (internal use only) | Dead export |
| `Errors.offline` | app-error.ts:46 | none | **Dead** |
| `Errors.timeout` | app-error.ts:15 | 1 site | Alive |
| `isNetworkError` | app-error.ts:81 | `shared/layout/state-views.tsx:25`, `app/providers/auth-provider.tsx:122` | Alive |
| `logger` | logger.ts:103 | 18+ files (infra, app, features) | Alive |
| `Logger.setLevel` | logger.ts:67 | none | **Dead** |
| `AuditActions` | audit-actions.ts:9 | 25 files (features + infrastructure) | Alive |
| `AuditAction` (type) | audit-actions.ts:164 | none | Dead export |
| `ROLE_LABELS_FR` | roles.ts:34 | `roles-step.tsx` | Alive |
| `ROLE_LABELS_AR` | roles.ts:48 | none (i18n doesn't touch it) | **Dead** |
| `ROLE_DESCRIPTIONS_FR` | roles.ts:63 | `roles-step.tsx:52` | Alive |
| `STAFF_ROLES` | roles.ts:81 | `roles-step.tsx` | Alive |
| `isStaff` | roles.ts:93 | none | **Dead** |
| `roleLabelFr` | roles.ts:97 | none | **Dead** |
| `ADMINISTRATIVE_ROLES`/`SUPERVISORY_ROLES`/`OPERATIONAL_ROLES` | roles.ts:105/111/117 | none | **Dead** (all three) |
| `Session`/`isSuperAdmin`/`can`/`isExpired` | session.ts:24/54/58/88 | auth-provider, search-index, academics features, danger-zone-card, infra auth repos, domain/repository (type) | Alive |
| `hasRole`/`hasAnyRole` | session.ts:69/79 | tests only | Dead in production |
| `empty`/`permanent` (requirements) | access-requirement.ts:26/28 | none (unused import in feature-registry) | **Dead** |
| `requiresAllOf` | access-requirement.ts:40 | none | **Dead** |
| `isEnabled`/`isDisabled`/`isHidden` | access-state.ts:36-46 | none | **Dead** |
| `FeatureFlagProvider` | feature-gate.ts:9 | only self-references | Dead abstraction |
| `alwaysOnFlagProvider` | feature-gate.ts:13 | passed as ignored dummy (route-access.ts:54, gated-content.tsx:24) | Alive but semantically dead |
| `evaluate` | feature-gate.ts:17 | gated-content.tsx:24,85; route-access.ts:52 | Alive |
| Section nodes (Dashboard…Settings) | feature-registry.ts:48-154 | `sidebar.tsx:27-35`, `route-access.ts:8-15` | Alive |
| `SIDEBAR_SECTIONS` | feature-registry.ts:157 | none | **Dead** |
| `PERMANENTLY_DISABLED` | feature-registry.ts:181 | `locked-features-tab.tsx:27` | Alive (stale content) |
| `routeGateFor` / `PROTECTED_ROUTE_PREFIXES` (export) | route-access.ts:34/24 | internal + tests only | Internal-only exports |
| `routeRedirectFor` / `ROUTE_GUARD_REDIRECT` | route-access.ts:45/17 | `app/app-shell.tsx:24` | Alive |
| `parentCode`/`receiptCode`/`personnelCode` | id.ts:10/18/22 | none | **Dead** (live personnel code is `PER-…-6hex`, see §3.5) |
| `studentCode` | id.ts:14 | `infrastructure/mock/repositories/student-repository.ts:17` | Alive |
| `backupFileName` | id.ts:33 | `infrastructure/backup/backup-service.ts:41` | Alive |
| `activationCode` | id.ts:43 | none | **Dead** |
| `deterministicActivationCode`/`stableHash`/`deterministicParentCode`/`deterministicStudentCode` | id.ts:61/107/126/160 | supabase-shared-repositories (88,138-139,1306,2059), sync/default-push-handler (144), mock parent-repository (17), supabase-personnel-repository (505) | Alive |
| `formatDzd`/`formatDzdPlain`/`parseDzd` | currency.ts:20/28/33 | 37 feature/infra/shared files | Alive |
| `formatDate`/`formatDateUtc`/`formatDateTime`/`formatRelative`/`formatDueDateRange` | date.ts:34/54/59/63/84 | features/financials, dashboard, shared/topbar, infra receipt-pdf/excel | Alive (`formatDateUtc` external use is via `formatDueDateRange` + tests) |
| `toIsoDate` | date.ts:99 | none (2 infra local clones exist) | **Dead** |
| `toIsoDay` | date.ts:103 | `features/personnel/releve-tab.tsx:44,63,86` | Alive |
| `currentAcademicYear` | date.ts:111 | none (private clone in supabase-dashboard-repository.ts:66) | **Dead** in core |
| `hexToHsl` | theme-types.ts:40 | internal (via hexToHslString) only | Dead export |
| `hexToHslString`/`PRESET_THEMES` | theme-types.ts:72/78 | theme-engine; theme-editor-modal, general-tab | Alive |
| theme-engine fns (load/save/find/apply) | theme-engine.ts:44-78 | `app/providers/user-preferences-provider.tsx:17-21,89-132` | Alive |
| `AgentContextSnapshot` | agent-types.ts:65 | none | **Dead** |
| `AgentRunOptions` | agent-runtime.ts:48 | none (untyped literal caller) | Dead export |
| `AIAgentRuntime` | agent-runtime.ts:87 | `ai-copilot-provider.tsx:531` | Alive |
| provider-registry fns | provider-registry.ts:26-112 | agent-runtime, llm-adapter, ai-config-tab | Alive |
| `executeOpenAIStream` | stream-client.ts:123 | agent-runtime, llm-adapter, ai-config-tab | Alive |
| `STREAM_RETRY` | stream-client.ts:64 | tests only (deliberate mutation seam, documented :54-56) | Test seam — keep |
| `onToolCallDelta` | stream-client.ts:31 | never passed | Dead callback |
| tool-registry exports | tool-registry.ts:49,76 | agent-runtime (+tests) | Alive |
| artifacts exports | artifacts.ts | tool suites + copilot-drawer/chart-svg/diagram-svg/artifact-renderer | Alive |
| statistics exports | statistics.ts | analysis-tools, workflow-tools | Alive except `quantile`/`EMPTY_STATS` (internal-only) |
| insights exports | insights.ts | analysis-tools, workflow-tools | Alive (incl. discarded-`parents` param smell) |

## 5. Independent architectural summary of `src/core` + `src/app`

**Dependency direction (runtime):** `core/ai` → `domain/model` + `domain/calc` + `app/providers/repository-provider` (type-only) ; `domain/repository` → `core/result` + `core/rbac/session` (type-only). No runtime cycle, but the "core is the bottom layer" mental model is inverted for the AI subsystem — `core/ai` sits *above* domain engines and the app's `Repositories` contract. Everything else in core (`rbac`, `format`, `theme`, `logger`, `result`, `audit-actions`) depends only on `date-fns`/DOM.

- **`core/result.ts` + `core/app-error.ts`** — the widest-used module (86 non-test files import `core/result`; `Ok/Err` in 73 files). Consumed by domain repositories (types), infrastructure (Supabase/mock/backup/excel), features, app providers. Condition: healthy; 3 dead combinators; duplicated unknown-error normalization.
- **`core/logger.ts`** — 18+ consumers across infrastructure (backup, excel import engine, mock stores), app providers, features. Condition: healthy; `setLevel` dead; `*ApiKey` redaction gap (latent).
- **`core/audit-actions.ts`** — wire-protocol constants; 25 consumer files (features/financials, settings, personnel + infrastructure). Healthy.
- **`core/rbac/*`** — split into pure data (roles/permissions/access-requirement/access-state), evaluation (feature-gate), declaration (feature-registry), and routing (route-access). Consumers: `app/providers/auth-provider` (Session construction, SuperAdmin stamping), `app/app-shell` (route guard), `shared/layout/sidebar` + `gated-content` (declarative gating), `shared/search-index` + `features/academics/*` (imperative `can()`), `features/settings` (RBAC matrix editor, locked-features tab), `features/personnel/onboarding`, `infrastructure/*-auth-repository` (Session type). Condition: functionally sound; large dead surface (§3.3, §4); stale registry metadata (`PERMANENTLY_DISABLED`, `Personnel.children`); dual gating idioms.
- **`core/format/*`** — currency/date consumed heavily by `features/financials`, `features/dashboard`, `shared/ui/money-input`, `shared/layout/topbar`, `infrastructure/receipt-pdf`, `infrastructure/excel`; id.ts consumed by backup service, sync push handler, Supabase shared repositories (deterministic cross-platform codes), mock repos. Condition: healthy core; three dead code formatters whose documented shapes contradict live data (`EMP-` vs live `PER-`); two infra-local `toIsoDate` clones; dead+ duplicated `currentAcademicYear`.
- **`core/theme/*`** — consumed only by `app/providers/user-preferences-provider` (persistence + DOM application) and `features/settings` (editor + presets). Clean, self-contained; minor `hexToHsl` dead export and the light-border misalignment.
- **`core/ai/*`** — runtime layer driven exclusively by `app/providers/ai-copilot-provider` (which also owns the human-in-the-loop `approveAction` write legs and conversation persistence); tool layer executes against `Repositories` + canonical domain engines; artifacts consumed additionally by `features/ai` renderers (copilot-drawer, chart-svg, diagram-svg, artifact-renderer); `provider-registry` + `stream-client` are shared with `infrastructure/ai/llm-adapter` (single-shot edge→BYOK→mock router) and `features/settings/ai-config-tab` (model discovery + latency probe). Condition: working and well-guarded on the read side; known defects as in §2 rows 16-18, 36-46; transport story now clear (copilot = direct BYOK; single-shot = ai-proxy-first).
- **`src/app`** — thin composition root: `app.tsx`/`app-shell.tsx` (routing + route guard), `splash-gate.tsx`, and 7 providers (repository, auth, toast, modal, user-preferences, sync, ai-copilot). `repository-provider.tsx` wires infrastructure implementations behind the `Repositories` interface (line 90); `auth-provider` is the sole Session producer (with the unstamped-restore window noted in §2 row 40). No feature logic leaks into app/; condition good.

## 6. Unresolved questions for later sessions

1. **ai-proxy agent mode:** `supabase/functions/ai-proxy/index.ts:109-150` implements a streaming agent path (tools ≤ 40) that no desktop code invokes — is the copilot meant to migrate to server-held keys (making `tool-registry.ts:20-23`'s cap a live constraint), or should the EF agent mode and the capacity note be retired?
2. **Cross-platform student-code semantics:** does Android's `deterministicStudentCode` mirror join-empty-fields (current desktop behavior) or filter-empties (the parent-code fix)? The equivalence tests pin determinism but not the empty-field semantics (claim 28).
3. **Dead RBAC/i18n surface:** are `ROLE_LABELS_AR`, `isStaff`, `ADMINISTRATIVE/SUPERVISORY/OPERATIONAL_ROLES`, `hasRole/hasAnyRole` reserved for planned onboarding/i18n work, or removable?
4. **`/personnel` route protection:** confirm with product spec that leaving `/personnel` out of `PROTECTED_ROUTE_PREFIXES` (it is the redirect *target*) is the intended "safe workspace" design for restricted roles.
5. **Light-border drift:** is the 62%-vs-65% lightness difference between `src/index.css:190` and `theme-types.ts:125` intentional or should one be corrected to truly match?
6. **Teacher naming rule:** should a `teacherDisplayName` helper be added (DATA-005 parity for `visualization-tools.ts:262`), or are teachers exempt because they lack `displayName` fields?
7. **Unmeasured report metrics:** the "~30–40% comment volume" and "~70–75% context reduction" figures remain estimates; a precise measurement could not confirm either.
8. **`attendanceRateOf` rounding divergence** (3 vs 2 decimals, §2 row 17): if consolidated onto `calculateAttendanceRate`, cohort-σ anomaly thresholds could shift marginally — verify no test pins the 3-decimal output.

**Bottom line:** the Core report is a high-quality, mostly accurate map — 41 of its significant claims verified outright, with two corrected on specifics (comment-volume %, light-border alignment) and one rejected (line-count/size). Its two most valuable bug reports (`annual_revenue_collected` mislabel, `deterministicStudentCode` normalization gap) are confirmed real. Its blind spot was the dead-export surface: my census found **~25 dead or internal-only exports** in `src/core` it did not enumerate, plus the `SIDEBAR_SECTIONS`/sidebar-ordering split and the dual gating idioms.

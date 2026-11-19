# Deep Sweep 12 — BUG-044 origin pinned (the copilot silent-failure chain + the update-depth loop family) & the DS/11 [S-A]/[S-B] re-verification

**Session:** 16 · **Date:** 2026-11-20 · **Charter:** handoff-session-16 Lane B — the two remaining open depth items, both read-only: (a) **BUG-044's loop origin** (the last open runtime item, standing since handoff-13) and (b) the **DS/11 §8 [S-A]/[S-B] subagent-only claims** flagged for personal re-verification before the executor runs T-569/T-570. Plus the per-run gate check (infra + Issue #32) and register upkeep. **No application source, configuration, schema, or dependency was touched; only `Investigation Archive/` and `Refactoring Unified/` were written.**

**Repo HEAD at start:** `3e6ad7b9` (main, clean; all 14 prior session branches merged into main — verified `git merge-base --is-ancestor` per branch).

---

## §0 Gate check results (this run)

1. **Repo sync:** clean clone-equivalent state; `git fetch --all --prune` no-ops; working tree clean on `main` at `3e6ad7b9`; branch `investigation/session-16` cut from it.
2. **Issue #32:** open, **0 comments**, `updated_at 2026-11-19T00:06:59Z` — **no owner activity** (unchanged since S15). No D-1..D-16 answers; G0 read-only regime stays ACTIVE; the ⏵ defaults govern.
3. **Infra probes (GET-only, keyless script `scripts/infra_test_s16.sh` outside the repo; keys via environment from the chmod-600 credentials file outside the repo):** P1 401 key-type gate (publishable recognized) · P2/P3/P4/P5/P5b **402 `exceed_egress_quota`** (cap still down — **OPS-011 now 14-run-stable**) · P7 management token **401 invalid** · P8 Firebase 400 CONFIGURATION_NOT_FOUND (format-accepted) · P9 poolers :6543/:5432 **OPEN** · **P9c direct db host `db.vebfehrpzajhstyhinnw.supabase.co` NOW RESOLVES from the sandbox** (S15 recorded it unresolvable — a sandbox-side DNS change, not a project change; login still untested per charter: the password is a placeholder) · P10 GitHub PAT **200** (push verified by this session's branch push) · P11 Vercel PAT **200 VALID**. Full detail recorded in `01-INFRASTRUCTURE-STATUS.md` (S16 run section).
4. **No new Excel workbooks** in repo/workspace since S14 (`Excel/` still carries only the two financial workbooks + the S8 inspection artifacts; the pedagogy workbook stays archived in `Excel_Inspection/source/`). The filled-workbook recipe (handoff-16 Lane B item 3) stays staged — nothing to run it against yet.

---

## §1 BUG-044 — the origin is now PINNED (both halves, source-verified)

BUG-044 has stood as "the last open runtime item" since handoff-13 with two unresolved questions: (a) why the unconfigured send fails **fully silently** (S10: transient toast; S12: clean console + ZERO network requests), and (b) the origin of the **once-observed `Maximum update depth exceeded`** on the first send after conversation restore (S10 §6.3; not reproduced in S12). Both are now traced end-to-end at source.

### 1.1 Half 1 — the deterministic silent failure (the full code chain, every link read this session)

The unconfigured send walks exactly this path — every property S10/S12 observed falls out of it:

1. **The user turn commits BEFORE the provider call.** `askAgent` builds `nextConversation = [...messages, userMsg]` and calls `setMessages(nextConversation)` at `ai-copilot-provider.tsx:496-497` — *before* `AIAgentRuntime.runConversationStep` is invoked at :531. The failure therefore cannot roll the turn back (there is no rollback anywhere in the function).
2. **`loadConfig()` never returns null.** `ai-config-storage.ts:114-116` returns `{ ...DEFAULT_AI_PROVIDER_CONFIG }` when nothing is stored — so `currentConfig` (:488) is always a non-null config with `defaultProvider: "groq"` and `groqApiKey: null` (`domain/model/ai.ts:217-237`). There is no "unconfigured" branch to take; the send proceeds as if configured.
3. **The runtime throws BEFORE any network call.** `agent-runtime.ts:184-193`: `apiKey = config.groqApiKey` (null) → `if (!apiKey && config.defaultProvider !== "custom_openai") throw new Error("Clé API manquante pour le fournisseur configuré.")`. The throw precedes `executeOpenAIStream` (:250) — **this is why S12 measured ZERO network requests**: no `fetch` is ever reached, so there is nothing for the network census to see and nothing for the console to log.
4. **The only failure surface is a 4.5-second toast.** The catch at `ai-copilot-provider.tsx:573-575` does exactly one thing: `toast.showError("Erreur IA", err.message)`. `toast-provider.tsx:45` auto-dismisses at `durationMs = 4500`. Nothing is appended to the conversation, no error state is set in the drawer, and nothing is logged — **the console stays clean by construction** (S12's observation), and the toast is gone before an inattentive user looks up (the "fully silent failure variant").
5. **The T-268 persistence effect then persists the failed turn.** `ai-copilot-provider.tsx:155-171` writes `{messages, proposals}` to localStorage on every `messages` change — the unanswered user turn survives restart (S10/S12: "two unanswered user messages after reload").
6. **The drawer actively disguises the unconfigured state.** `copilot-drawer.tsx:115` renders the header badge as `config?.defaultModel || "Groq"` — with the default config this shows the live-looking model id `openai/gpt-oss-120b` (exactly what S12's screenshot recorded). There is NO unconfigured empty state, NO disabled input, NO "configure your key" hint — the drawer looks fully operational while it is not.
7. **The test suite PINS the defective behavior.** `src/tests/ai/copilot-drawer.test.tsx:204-246` ("T-261 — askAgent error path (missing API key)") asserts the "Erreur IA" toast fires, streaming doesn't stick — and then `expect(screen.getByText("Question de test")).toBeTruthy();` (:245) **asserts the failed turn stays in the thread**. The blind spot is not an untested path; the current behavior is test-enshrined. Any fix must update this test.

**Verdict:** the "non-deterministic silent failure" is a fully deterministic UX defect with a 7-link source chain. Verification level upgraded: **V (source-complete)** — runtime observations (S10 §6.3, S12 §7) now fully explained.

### 1.2 Half 2 — the once-observed update-depth loop = the BUG-042 toast-churn family, triggered THROUGH the copilot's own showError

The loop cannot originate inside the copilot send alone — the drawer/provider subtree contains no setState-during-render (MarkdownView `markdown-view.tsx:22-34` is pure; the scroll effect `copilot-drawer.tsx:85-89` has stable deps; `repos` is a module constant, `repository-provider.tsx:196-219`). The mechanism that CAN loop is the one S10 already proved as BUG-042, and the copilot send plugs straight into it:

1. **The toast context value churns on every show/dismiss.** `toast-provider.tsx:57-69`: the `useMemo` deps include `toasts`, so every toast add/remove gives **all 108 `useToast()` consumers** a new context value with new `showError`/`showSuccess` identities (108 = this session's `grep -rl "useToast()" src` count).
2. **The copilot provider is one of those consumers, unstably.** `askAgent`'s `useCallback` deps include the whole `toast` value (`ai-copilot-provider.tsx:582`) — every toast anywhere in the app recreates `askAgent` and `answerClarification` (:585-594).
3. **The loop needs a second participant: a mounted effect keyed on a toast-derived function that fails and toasts again.** The proven instance is BUG-042: `configuration-tab.tsx:73-85` — `loadSettings` `useCallback` keyed on `[systemConfigService, showError]` (:81), then `useEffect(() => { loadSettings(); }, [loadSettings])` (:85). showError identity churn → effect refires → `listAll()` fails (today's 402) → `showError` again → churn → … S10 measured exactly this at 7,148 requests / 154 duplicated banners.
4. **The S10 confluence is reconstructable from the walkthrough ledger.** DS/06 §4's ledger order: the walk visited `#/settings` (15 tabs mounted; "Configuration tab = BUG-042 detonation"; the console census records "the async re-fetch cycle continued") and the **very next row** is "Topbar — Assistant IA" — the copilot drawer opens as an overlay ON THE STILL-MOUNTED SETTINGS PAGE (the topbar trigger does not navigate). The first send's `toast.showError("Erreur IA", …)` therefore churned the toast context **while the toast-keyed Settings effect was live** → the cascade re-rendered the full 108-consumer graph inside one synchronous window → React's 50-update guard fired the `Maximum update depth exceeded` ×N.
5. **Why "once", why non-deterministic, why S12 couldn't reproduce.** The trip needs the timing confluence (a toast append landing while a toast-keyed failing effect is mid-cycle, inside the same render window). After the guard fires, React unmounts the root — **the app has ZERO error boundaries** (this session's grep: no `componentDidCatch`/`getDerivedStateFromError`/`ErrorBoundary` anywhere in `src/`) — which is exactly S10's "drawer subsequently unmounted". On recovery the second send produced only a single toast append with no concurrent refire → "0 loop warnings" (S10) and S12's fully clean variant. The non-determinism is the confluence timing, not an unknown mechanism.
6. **The root fix is already staged and unchanged:** T-559 (split the toast context — stable `show*` identities in a separate memo) kills the entire family including the copilot trigger vector; T-560 adds the per-site loop breakers. See §2 for the scope correction.

**Verdict:** loop origin **PINNED to the BUG-042 toast-identity-churn family** (verification: source-complete for the mechanism; the S10 one-shot remains runtime-observed-once by nature — the family explanation is the only setState-cascading path connected to the send, and every observed property matches: ×N warnings, drawer unmount, non-reproducibility, clean-console variant). BUG-044's loop sub-item closes as EXPLAINED-BY-BUG-042-FAMILY; BUG-044's silent-failure sub-item remains its own UX defect (fix shape below).

### 1.3 The BUG-044 fix shape (for the execution queue — read-only this session)

Fold as **T-572** (the copilot failure-UX fix; depends on nothing, pairs with T-559):

1. **Commit-on-success or paired-error:** either (a) do not `setMessages(nextConversation)` until `runConversationStep` resolves (the turn is not part of the conversation until the provider accepted it), or (b) keep the optimistic turn but append a visible `role: "assistant"` error message (e.g. "Échec — clé API manquante. Configurez Réglages → IA.") to the thread so the persisted history is self-explanatory. Option (b) is smaller and keeps the user's words on screen.
2. **The unconfigured empty state:** when the effective config has no key for the default provider, render the drawer's empty state as a configuration call-to-action (explanation + a link/button to `#/settings` AI tab — `reloadConfig` is already wired and called by `ai-config-tab.tsx:258`, so the drawer will pick the key up live). The input can stay enabled (the error path is then honest), but the header badge must stop showing a live-looking model id when unconfigured (show "Non configuré" instead).
3. **Diagnosability:** `logger.warn` the failed send (the provider + the error class) — the silent-console property made this bug take three sessions to pin.
4. **Test updates:** `copilot-drawer.test.tsx:204-246` — replace the "user message stays in the thread" assertion with the chosen semantics (b: assert the paired error message appears and is persisted); add the unconfigured-empty-state render test.

---

## §2 The toast-churn family census — T-560's scope correction (5 loop-capable sites, not 1)

While tracing Half 2, this session ran the complete census of the pattern that makes the family dangerous: **a `useCallback` keyed on a toast-derived function (or the whole `toast` value), consumed by a `useEffect` that can fail and toast again.** Grep: `\}, \[.*(showError|showSuccess|showWarning|showInfo|toast)` over `src/` (test files excluded), then each hit read in context:

| # | Site | The unstable dep | The effect that refires | Loop-capable? |
|---|---|---|---|---|
| 1 | `features/settings/configuration-tab.tsx:73-85` | `showError` (:81) | `useEffect(() => { loadSettings(); }, [loadSettings])` (:85) | **YES — BUG-042, runtime-proven (S10: 7,148 requests)** |
| 2 | `features/settings/accounts-tab.tsx:60-80` | `showError` (:73) | `useEffect(…, [session?.role, refreshAccounts])` (:76-80) | **YES** — `listAccounts()` failure → showError → churn → refire (detonates when the Accounts tab is mounted in live mode) |
| 3 | `features/settings/pricing/pricing-year-config-bar.tsx:58-63` | `toast` (the WHOLE value, :62) | `useEffect(() => { void refresh(); }, [refresh])` (:63) | **YES** — `listConfigs()` failure path (:61) |
| 4 | `features/academics/promotion-cycles/promotion-cycle-detail.tsx:69-78` | `toast` (:74) | `useEffect(() => { void refresh(); }, [refresh])` (:76-78) | **YES** — `getCycleClasses()` failure path (:73) |
| 5 | `features/academics/promotion-cycles/promotion-cycles-tab.tsx:53-62` | `toast` (:58) | `useEffect(…, [refresh])` (:60-62) | **YES** — `listCycles()` failure path (:57) |
| 6 | `features/academics/hooks/use-class-placement-studio.ts:547-556` | `toast` (:555) | — (user-action callback, no effect) | No (identity-unstable only) |

**Consequence for the staged fixes (no scope change to T-559; T-560 scope ×5):**

- **T-559** (split the toast context; stable `show*` identities) remains the ONE-line root fix for the whole family — after it lands, none of the six sites can loop, because the deps go referentially stable.
- **T-560** (defense-in-depth loop breakers) is currently scoped to `configuration-tab.tsx` only (DS/06 §3.2). **Corrected scope: all five loop-capable sites** — same mechanical fix per site (gate the effect on a load-generation ref: load-on-mount + explicit refresh only; and/or dedupe identical consecutive error toasts). Until T-559 lands, any of the four newly-censused sites can detonate the same unbounded refetch storm the moment its tab is mounted with a failing backend (today's 402 makes ALL of them live-ticklish: listAccounts/listConfigs/getCycleClasses/listCycles all hit Supabase in live mode).
- The family census also sharpens the **OPS-015 sequencing constraint** (already registered: the cap lift must not precede T-559/T-560 + the BUG-058 fix): with the cap lifted and these four sites unfixed, a single failing tab visit re-burns egress through four additional request loops, not one.

Registered as a **BUG-042 family extension** (refinement row; no new BUG id — same root cause, same fix): the four additional sites + the 108-consumer context-churn number + the zero-error-boundaries datum.

---

## §3 The DS/11 §8 [S-A]/[S-B] re-verification — complete table (executor's T-569/T-570 flags cleared)

Every subagent-only claim DS/11 §8 flagged was personally read at HEAD `3e6ad7b9` this session. **All 20 claims verified; 3 corrections to the record (2 paths, 1 count); 1 new defect discovered (BUG-065, §3.1).**

| # | Claim (DS/11 citation) | Verdict at HEAD | Note |
|---|---|---|---|
| 1 | `deriveTeacher` hardcodes `maxWeeklyHours: 18`, `qualifiedSubjectIds: []` [S-A] (supabase-teacher-repository.ts:639-655) | **VERIFIED** :638-656 | Exact — the phantom-field projection confirmed |
| 2 | Mock cascade delete removes assignments + timetable entries [S-A] (mock teacher-repository :189-196) | **VERIFIED** :186-198 | Comment "Cascade: remove assignments + timetable entries" |
| 3 | `observeByAcademicYear` returns every active teaching member for ANY year [S-A] (:126-138) | **VERIFIED** :126-142 | Ignores the year argument except as a stamped label |
| 4 | Assignment reads derived from `class_subjects` (distinct pairs, `isPrimary: true`) [S-A] (:532-565) | **VERIFIED** :530-560 | "Distinct (teacher, subject) pairs per year" + `isPrimary: true` |
| 5 | Account creation maps `Role.Teacher` [S-A] (create-account-modal.tsx:94,107) | **VERIFIED** with **PATH FIX** | File is `src/features/settings/create-account-modal.tsx` (NOT features/personnel/); `Role.Teacher` in STAFF_ROLE_OPTIONS + ALL_ROLE_OPTIONS (:94-107) |
| 6 | Payslip renders `STAFF_CATEGORY_LABELS_FR` [S-A] | **VERIFIED** | payslip.ts:68 `drawKeyValue(… STAFF_CATEGORY_LABELS_FR[personnel.staffCategory] …)` |
| 7 | Mock appendAudit reuses Class actions for teacher entities [S-A] | **VERIFIED** :132-137,171-176 | `AuditActions.ClassCreate` with `entityType: "teacher"` + the source's own "reuse — no dedicated teacher audit action yet" comment; delete uses the `"teacher.delete"` string literal (:201-205) |
| 8 | `CATEGORY_TO_DB`/`CATEGORY_FROM_DB` lossy bridges [S-A] (supabase-personnel-repository.ts:110-129) | **VERIFIED** :110-129 — **and extended: see BUG-065** | maintenance/driver/buyer/warehouse/worker → 'support' confirmed; PLUS the unrecorded `medical → "support"` read-side asymmetry (§3.1) |
| 9 | Six UI surfaces filter on the dual `staffCategory === "teacher" \|\| roleId === "teacher"` condition [S-A] | **CORRECTED: EIGHT sites, 2 path fixes** | teachers-tab.tsx:79 (at `features/academics/`, not personnel/) · class-subjects-tab.tsx:75 · academics-page.tsx:141 · grade-levels-class-view.tsx:543 · create-section-dialog.tsx:72 (at `features/academics/placement/`) · academic-year-detail-drawer.tsx:670 — **PLUS the two S15 misses: class-detail-page.tsx:205 and academic-year-detail-drawer.tsx:248** (repo-wide grep, single pattern, this session) |
| 10 | `parents.relationship` per-parent column [S-B] (0005:31) | **VERIFIED** | CHECK ('father','mother','guardian','other') on the parents row |
| 11 | Finance DDL carries `parent_id` throughout [S-B] (0007) | **VERIFIED** | 19 `parent_id` occurrences in 0007_financial.sql (filename correction: `0007_financial.sql`, DS/11 cited "0007 DDL" — same file) |
| 12 | Homework notification fan-out students→parents→profiles [S-B] (0078:80-94) | **VERIFIED** | 0078_homework_parent_notifications.sql :80-94 joins exactly that chain |
| 13 | `Student.parentId` NOT NULL FK [S-B] (student.ts:304); `Parent` has no relationship/student fields [S-B] (parent.ts:135-179); no Guardian/Tuteur type [S-B] | **VERIFIED** ×3 | parentId :304 ("NOT NULL FK — plan §04.01"); Parent interface :135+ carries none of the relationship fields; `type Guardian\|interface Guardian\|type Tuteur` → 0 hits |
| 14 | `observeParentProfile` → `computeParentSummary` with the `parentName: ""` gap [S-B] (supabase-shared-repositories.ts:4901-5028; :4968) | **VERIFIED** exactly | observeParentProfile at :4901; `const parentName = ""; // Looked up separately if needed by UI.` at **:4968 verbatim** |
| 15 | `vw_student_roster` denormalized projection [S-B] (0021:161-185) | **VERIFIED** :161+ | view DDL confirmed |
| 16 | `students.grade_level_code` dual representation [S-B] (0028:84-93) | **VERIFIED** | "without needing a join" rationale comment at :80-83, column add at :84-93 |
| 17 | `student_academic_histories` = the live PAST-years store [S-B] (0029:117-133) | **VERIFIED** | incl. the live decision vocabulary ('promoted','repeated','graduated','transferred') — the contrast that exposes DEAD-022's divergent vocabulary |
| 18 | `re_enrollments` = the FUTURE-year state machine [S-B] (0128:590-619) | **VERIFIED** | full DDL incl. the INV-21b unique (tenant, student, target year) |
| 19 | `service_enrollments` portal-only; desktop writes ledger+installments directly [S-B] (0007:18-42; 0102:219/290; 0080:30) | **VERIFIED** ×3 | 0007_financial.sql:18-42 DDL; 0102_register_family_batch.sql INSERTs into ledger_entries (:219) + installments (:290); 0080:30 documents the website's useServiceEnrollments (T-211) in the migration's own comment |
| 20 | Enrollment-status 6-vs-5 vocabulary split [S-B] (0005:67 vs student.ts:23); `academic_history` pinned by the t-402 guard [S-B] (:334) | **VERIFIED** ×2 | DB CHECK 6 values (inquiry/quoted/enrolled/active/withdrawn/graduated) at 0005:67; `StudentStatus` 5 values (active/graduated/transferred/suspended/withdrawn) at student.ts:23 — the two sets are not even a subset relation; t-402-academic-history-embedding.test.ts:334 asserts `not.toContain('from("academic_history")')` |

**Net effect on DS/11:** every load-bearing claim stands. The M-U2 unification scope (T-561) grows from 6 to **8** dual-condition call sites (the two misses are the same mechanical rewires); the delete manifest's pre-deletion reference censuses are unaffected (the two extra sites reference `personnel`, not the phantom Teacher entity).

### 3.1 NEW — BUG-065: the medical staff category silently reads back as 'support' (asymmetric bridge)

Found while verifying claim 8. `supabase-personnel-repository.ts`:

- `CATEGORY_TO_DB` (:110-121) maps the domain's `medical` → DB `'medical'` (correct — and commented "VAULT §09.07 — Médical / Thérapie maps to its own DB category"; the DB CHECK has carried `'medical'` since 0009:26).
- `CATEGORY_FROM_DB` (:123-129) maps DB `'medical'` → domain **`'support'`** — with no comment, no rationale, and no test pinning it (this session's greps: no test touches the round-trip).

**Consequence:** a personnel member created/edited with category Médical (selectable in `employee-form-modal.tsx:36,54`) is persisted correctly as `'medical'` but **reads back as `'support'` in the domain** — the employee form shows "Support" after reload (the data appears to change itself), the payslip category label (`payslip.ts:68`) renders the wrong label, and any future medical-scoped logic (the therapy features at S10's runtime walk) would silently miss every medical staff member. No UI filter currently keys on `staffCategory === "medical"` (verified by grep — which is why nothing has visibly broken yet), so the defect is display-integrity today and a latent trap tomorrow.

**Fix shape (small, folds into the T-561 vocabulary work):** make `CATEGORY_FROM_DB` map `medical → "medical"` (the domain type already has the member, personnel.ts:34), add the round-trip parity test, and — per M-U2's end-state — the whole bridge deletes anyway when the vocabulary collapses onto the 4 DB values. Registered as **BUG-065** (V, source-verified) in the S16 addendum; next free BUG id becomes **BUG-066**.

---

## §4 Register deltas (this session)

| Item | Delta |
|---|---|
| **BUG-044** | **Origin pinned (V, source-complete).** Half 1 — the silent failure is a deterministic 7-link UX chain (§1.1): turn commits before the call (:496-497); loadConfig never null (:114-116); the runtime throws pre-network (agent-runtime.ts:184-193 — the zero-request explanation); the ONLY surface is the 4.5 s toast (ai-copilot-provider.tsx:573-575 + toast-provider.tsx:45); T-268 persists the failed turn (:155-171); the drawer disguises the state (copilot-drawer.tsx:115); the test suite PINS the behavior (copilot-drawer.test.tsx:245). Fix staged as **T-572** (§1.3). Half 2 — the once-observed update-depth loop is **the BUG-042 toast-churn family triggered through the copilot's showError** (§1.2): value useMemo churn ×108 consumers × the mounted toast-keyed Settings effect; zero error boundaries app-wide explains the "drawer unmounted". Loop sub-item closes as explained-by-family. |
| **BUG-042** | **Family census extension (refinement):** five loop-capable sites, not one (§2) — configuration-tab (:81) + accounts-tab (:73) + pricing-year-config-bar (:62) + promotion-cycle-detail (:74) + promotion-cycles-tab (:58); plus the 108-consumer context-churn figure and the zero-error-boundaries datum. **T-560 scope corrected to all five sites**; T-559 unchanged as the root fix. OPS-015's cap-lift sequencing now covers four additional live-mode request loops. |
| **BUG-065 (NEW)** | The medical→support asymmetric read-back (§3.1). V. Fix folds into T-561/M-U2 (+ the round-trip parity test). |
| **ARCH-044 / M-U2 (T-561)** | Scope corrections from §3: the dual-condition filter census is **8 sites** (add class-detail-page.tsx:205, academic-year-detail-drawer.tsx:248); 2 path corrections (teachers-tab at features/academics/; create-section-dialog at features/academics/placement/); create-account-modal is at features/settings/. The [S-A]/[S-B] verification flags on T-569/T-570 are **cleared** (all 20 claims re-read; table §3). |
| **OPS-011** | 14-run-stable (cap down; both keys recognized; mgmt token 401; Vercel VALID; GitHub 200+push). P9c datum: the direct db host now resolves from the sandbox (S15: unresolvable) — sandbox DNS change, no project-side significance; login still untested per charter. |
| **EXECUTION-PLAN** | v1.2 (this session): §11 folds the previously handoff-scattered standing queue **T-555..T-560** into the plan of record (T-555 was never assigned — reserved), corrects T-560's scope to the five-site family, and registers **T-572** (the copilot failure-UX fix, §1.3) beside it. |

No other register rows change. The correction ledger stays at C-22 (none needed this session — the §3 path/count fixes are recorded in the S16 addendum table and in EXECUTION-PLAN §11's scope notes, per the "corrections join the register" convention; no prior conclusion is invalidated).

---

## §5 What the executor does with this (dependency-ordered, G0-gated)

1. **T-559** (unchanged, root fix): split the toast context — stable `show*` identities. Kills the BUG-042 family (all 5 sites) + the BUG-044 loop vector in one change. **Remains the top CRITICAL with T-560; OPS-015 sequencing unchanged.**
2. **T-560** (scope corrected ×5): the load-generation-ref loop breakers on configuration-tab + accounts-tab + pricing-year-config-bar + promotion-cycle-detail + promotion-cycles-tab. Defense-in-depth after T-559; REQUIRED before any cap lift if T-559 is deferred.
3. **T-572** (new, small): the copilot failure UX (§1.3) — paired-error message or commit-on-success, the unconfigured empty state + honest header badge, `logger.warn` diagnosability, the test update. Independent of T-559/T-560 (no ordering constraint); BUG-056's follow-ups (fetch timeout, hardcoded model, i18n) queue behind it as before.
4. **T-561 (M-U2 sub-item)**: the vocabulary collapse now rewires **8** dual-condition sites and must include the BUG-065 medical mapping fix + the round-trip parity test before the bridge deletes.
5. **T-569/T-570**: the [S-A]/[S-B] re-verification obligation from DS/11 §8 is **discharged** by §3 — the executor inherits a fully personal-read evidence base for the pedagogy lane.

---

## §6 Verification status of this sweep

**Personally read at HEAD `3e6ad7b9` this session:** ai-copilot-provider.tsx (full: the askAgent chain :484-583, the persistence effect :155-171, fetchConfig :128-131, the restore effect :135-152); agent-runtime.ts (full: the key gate :184-193, the 429 ladder, the tool loop); provider-registry.ts (full); ai-config-storage.ts (full: loadConfig :114-156); domain/model/ai.ts (:217-237 DEFAULT_AI_PROVIDER_CONFIG); copilot-drawer.tsx (full: no empty state, the badge :115); toast-provider.tsx (full: the :45 default, the :57-69 churn); markdown-view.tsx (:22-34 purity); repository-provider.tsx (:160-219 — repos identity stable); app-shell.tsx (full — the drawer's two mounts, no boundaries); main.tsx (:56-63 — createRoot + StrictMode, no boundary); configuration-tab.tsx (:60-130); accounts-tab.tsx (:60-80); pricing-year-config-bar.tsx (:50-70); promotion-cycle-detail.tsx (:60-82); promotion-cycles-tab.tsx (:45-64); use-class-placement-studio.ts (:545-560); copilot-drawer.test.tsx (:204-246); supabase-teacher-repository.ts (:120-142, :530-570, :630-660); mock teacher-repository.ts (:130-205); create-account-modal.tsx (:88-110); payslip.ts (:68 + imports); supabase-personnel-repository.ts (:95-130); the 8 dual-condition sites (sed per site); 0005_crm.sql (:28-34, :62-70, :89-98); 0007_financial.sql (:18-42 + the parent_id count); 0021_views.sql (:161-168); 0028 (:80-93); 0029 (:117-133); 0128 (:590-619); 0078 (:78-96); 0019 (:400-407); 0120/0121 (:351-356/:291-296); 0080 (:19,:30); t-402 test (:330-340); student.ts (:20-26, :304); parent.ts (:130-180); personnel.ts (:20-50); supabase-shared-repositories.ts (:4898-4972); student.ts/parent.ts/personnel.ts greps. **Greps run this session:** `useToast()` consumers (108 files); the toast-keyed dep-array family (6 hits, all read); `staffCategory === "teacher" || roleId === "teacher"` (8 sites); error boundaries (0); `type Guardian|interface Guardian|type Tuteur` (0); `medical` consumers; `parentName = ""` (:4968); `reloadConfig` wiring. **Infra:** the §0 probe set. **Issue #32:** 0 comments. **Read-only regime maintained; only `Investigation Archive/` and `Refactoring Unified/` touched.**

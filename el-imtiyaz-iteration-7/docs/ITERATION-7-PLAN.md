# Iteration 7 — PLAN

**Date:** 2026-07-28
**Scope:** Final unification of the modal system (eliminate the Cmd+K exception), modernize tab navigation (sliding indicators + density + keyboard nav), complete remaining P3 work (workflow monitor, AES-256 backup, DAG editor, AI scaffold, Arabic RTL, search index), comprehensive testing across all methodologies.

## Headline

Iteration 7 closes out the project's P3 roadmap. The single documented modal exception (Cmd+K command palette) is eliminated by extending `UnifiedModal` with a `variant="command-palette"` mode. The tab navigation is modernized with sliding ink-bar / sliding pill indicators, a density prop, and explicit keyboard activation. All remaining P3 features ship as production-quality surfaces backed by mock/Web-Crypto/local-storage adapters (no real Supabase backend yet, per plan §02.02 — that remains the iteration-8+ scope).

---

## 1. Unified Modal System — final unification

### Goal
Zero raw `<Dialog>` call sites in production code. The Cmd+K command palette migrates to `UnifiedModal`.

### Approach
Extend `UnifiedModal` with:

```ts
type ModalVariant = "dialog" | "drawer" | "command-palette";

// New optional props:
header?: React.ReactNode;        // Custom header slot (replaces icon+title+description)
hideHeader?: boolean;            // Suppress the default header entirely
hideCloseButton?: boolean;       // Suppress the absolute-positioned X
```

New render branch for `command-palette`:
- Positioned `top-[15vh]` (command palettes conventionally sit near the top, not vertically centered)
- `p-0 gap-0` layout
- No default header, no default close button
- Same overlay + `zoom-in-95` animation as `dialog` variant
- Caller passes `header={<SearchInput/>}` and `bodyClassName="p-0"`

### Migration
`src/shared/components/topbar.tsx` — replace the raw `<Dialog>` block (lines 268–330) with a `<UnifiedModal variant="command-palette">` call.

### Tests
- New test file additions to `src/test/component/unified-modal.test.tsx`:
  - `variant="command-palette"` renders without default header
  - `header` slot renders correctly
  - `hideCloseButton` suppresses the X
  - ESC closes the palette
  - Backdrop click closes the palette
  - Custom body className is respected

### Acceptance
- 0 raw `<Dialog>` call sites in production code
- 0 raw `<Drawer>` call sites in production code
- 100% Unified Modal System

---

## 2. Tab Navigation — modernization

### Goal
"Modern, polished, professional" tab navigation with animated active indicators, density variants, and explicit keyboard navigation.

### Approach

#### 2.1 Sliding ink-bar on `underline` variant
Single absolutely-positioned `<span data-ink-bar>` that animates `left`/`width` via `useLayoutEffect` measuring the active trigger's `offsetLeft`/`offsetWidth`. Spring or `cubic-bezier(0.4, 0, 0.2, 1)` transition on `transform`/`width`.

Removes the per-tab `after:` pseudo-element fade (less premium) in favor of a single shared sliding indicator (the gold standard — Material/MUI/Ant/shadcn-style).

#### 2.2 Sliding pill on `elevated` variant
A shared "thumb" element that slides between tabs (Apple/Tailwind-UI segmented control pattern). Active trigger loses its own `bg-popover` and the thumb takes over.

#### 2.3 Density / size prop
```ts
type PageTabsSize = "sm" | "md" | "lg";  // default "md"
```
- `sm`: `h-7 text-xs` (dense toolbars, sub-tabs in small modals)
- `md`: `h-8 text-[13px]` (current default — preserved)
- `lg`: `h-10 text-sm` (primary navigation, large screens)

#### 2.4 Keyboard activation
```ts
keyboardActivation?: "automatic" | "manual";  // default "automatic"
```
Explicitly threaded through to `TabsPrimitive.Root`. Documented + tested with `fireEvent.keyDown(ArrowRight)` / `ArrowLeft`.

#### 2.5 Polish
- `iconPosition?: "leading" | "trailing"` (default `leading`)
- `focus-visible` ring on active tab is stronger than inactive
- `description` now renders on all variants (was elevated-only) — JSDoc updated
- `PageTabsBar` is exercised (used by the new Workflow Monitor page) OR removed if no caller materializes — TBD during implementation
- Dead API surface (`fullWidth`, `dot`) — exercise or remove

### Tests
- New tests in `src/test/component/page-tabs.test.tsx`:
  - Sliding ink-bar position matches active trigger's `offsetLeft`/`offsetWidth`
  - Sliding pill position matches active trigger's `offsetLeft`/`offsetWidth`
  - `size="sm"` produces `h-7` tabs; `size="lg"` produces `h-10` tabs
  - `keyboardActivation="automatic"` — ArrowRight moves to next tab
  - `keyboardActivation="manual"` — ArrowRight focuses but doesn't activate; Enter/Space activates
  - `iconPosition="trailing"` renders icon after label
  - `description` renders on all variants
  - Focus-visible ring renders correctly

### Acceptance
- All 9 production tab call sites still pass their existing tests
- Tab navigation feels visually premium (animated indicators, smooth motion)
- Density is configurable per call site
- Keyboard navigation is explicit and tested

---

## 3. P3-R — Search index improvements

### Goal
Extend Cmd+K to payments, expenses, audit, personnel. Persist recent searches (max 8).

### Approach
`src/shared/components/topbar.tsx` — extend the `useSearch` hook to query 5 indexes:
1. Parents (existing)
2. Students (existing)
3. Payments — by receipt number, parent name
4. Expenses — by request code, vendor, submitter
5. Audit entries — by entity ID, action type, actor name
6. Personnel — by name, role

Recent searches persisted to `localStorage["el-imtiyaz:recent-searches"]` (max 8 items, FIFO eviction, JSON array of `{ type, id, label, at }`).

### Tests
- Each index returns relevant matches for a query
- Recent searches persist across reloads
- Recent searches cap at 8 items
- Clicking a recent search navigates correctly
- Empty query shows recent searches (when available) + "Type to search" prompt

---

## 4. P3-O — Arabic RTL polish

### Goal
Verify all screens render correctly in RTL, add language switcher, mirror layouts.

### Approach

#### 4.1 Language switcher
`src/shared/components/topbar.tsx` — new dropdown menu with FR / AR / EN options. Persists to `localStorage["el-imtiyaz:locale"]`. Triggers `i18n.changeLanguage(locale)` + sets `document.documentElement.dir = "rtl" | "ltr"` and `lang` attribute.

#### 4.2 RTL-aware CSS
Audit `src/index.css` and Tailwind config — replace physical properties (`left-*`, `right-*`, `ml-*`, `mr-*`) with logical properties (`start-*`, `end-*`, `ms-*`, `me-*`) where Tailwind supports them. For custom CSS, use `inset-inline-start` / `inset-inline-end` etc.

#### 4.3 Component mirroring
- `Sidebar`: `flex-row` → `flex-row-reverse` in RTL; collapse toggle icon mirrors
- `Drawer` variant of `UnifiedModal`: slides from left in RTL
- `Modal` close button: positioned `end-4` instead of `right-4`
- `Topbar` profile menu: opens from `end` instead of `right`
- Icons with directional semantics (ChevronRight, ArrowLeft) — flip in RTL

#### 4.4 Arabic font loading
`Noto Sans Arabic` is already in the Tailwind font stack. Add `font-feature-settings: "kern"` and ensure `line-height` is adequate for Arabic script (1.6+).

#### 4.5 Translation audit
Verify `src/i18n/ar.ts` has translations for every key used in `src/i18n/fr.ts`. Add missing keys.

### Tests
- Language switcher changes `document.dir` and `document.lang`
- Sidebar renders on the right in RTL
- Drawer slides from left in RTL
- All FR keys have AR equivalents
- Smoke test: render every page in RTL mode without crashes

---

## 5. P3-N — Personnel Workflow Monitor

### Goal
Read-only list of Edge Function / DAG runs with detail drawer.

### Approach

#### 5.1 New page
`src/features/personnel/workflow-monitor-tab.tsx` — replaces the existing ComingSoonCard in the Personnel page's 4th tab. List of workflow runs:
- Workflow name
- Trigger type (Manual / Automatic / Scheduled)
- Status (Running / Succeeded / Failed / Timeout)
- Started at + duration
- Actor (who triggered it)
- Click → opens detail drawer

#### 5.2 Detail drawer
`UnifiedModal variant="drawer"` showing:
- Workflow definition (nodes + edges summary)
- Step-by-step execution timeline (each node's start/end/duration/status)
- Output / error logs
- "Relancer" button (manual triggers only, RBAC-gated)

#### 5.3 Mock data
`src/infrastructure/mock/workflow-run-seed.ts` — 15 mock workflow runs across 5 workflows (Overdue Payment Reminder, Batch Year-End Promotion, Lock Delinquent Accounts, etc.) with mixed statuses.

#### 5.4 Repository contract
Extend `WorkflowRepository` with `observeRuns()`, `getRun(id)`, `retryRun(id, actor)` — all returning `Observable<T>` / `Promise<Result<T>>`.

### Tests
- List renders 15 mock runs
- Filter by status works
- Filter by workflow works
- Click opens detail drawer
- "Relancer" button is RBAC-gated (only SuperAdmin + FinancialOfficer)
- Failed runs show error log
- Running runs show "in progress" indicator

---

## 6. P3-M — AES-256 Backup system

### Goal
24h cycle, AES-256-GCM encryption (Web Crypto API), local vault (IndexedDB), 365-day retention, point-in-time restore UI.

### Approach

#### 6.1 Domain model
`src/domain/model/backup.ts` — `BackupArchive` entity: `{ id, createdAt, size, checksum, vaultLocation, status, retentionExpiresAt }`.

#### 6.2 Encryption service
`src/infrastructure/backup/aes-256.ts` — uses Web Crypto API:
- `generateKey()` — AES-256-GCM key, stored separately (mock: in `localStorage` with a derived passphrase; production: separate secrets manager)
- `encrypt(plaintext: Uint8Array, key)` → `{ ciphertext, iv }`
- `decrypt(ciphertext, iv, key)` → `Uint8Array`

#### 6.3 Vault
`src/infrastructure/backup/indexed-db-vault.ts` — IndexedDB-backed vault:
- `store(archive)` — stores encrypted backup blob + metadata
- `list()` — returns metadata of all archives
- `get(id)` — returns encrypted blob
- `delete(id)` — purges archive
- `purgeExpired()` — removes archives older than 365 days

#### 6.4 Backup service
`src/infrastructure/backup/backup-service.ts`:
- `runBackup()` — serializes current mock state (parents, students, payments, ledger entries, etc.) → compresses (gzip via `CompressionStream`) → encrypts → stores in vault → writes audit log
- `listArchives()` — returns metadata
- `restore(archiveId)` — decrypts → decompresses → validates checksum → restores mock state (in production: restores to Supabase)
- `purgeExpired()` — runs daily

#### 6.5 UI
`src/features/settings/backup-tab.tsx` — replaces the existing Backup stub:
- "Dernière sauvegarde" card (last backup timestamp, size, status)
- "Sauvegarder maintenant" button (manual trigger)
- Archives list (365-day rolling window) — date, size, status, "Restaurer" + "Supprimer" actions
- "Restaurer" opens a confirmation `ConfirmModal` (destructive variant)
- "Purge automatique" status (next run, retention policy)
- RBAC: SuperAdmin only

#### 6.6 Schedule
Mock the 24h cycle via a `setInterval` in the dev environment (24h scaled to 60s for demo purposes). Document that production will use cron on the desktop terminal.

### Tests
- AES-256-GCM round-trip (encrypt → decrypt = original)
- Vault store → list → get → delete round-trip
- `purgeExpired()` removes archives older than 365 days
- `runBackup()` produces a valid archive with correct checksum
- `restore()` correctly restores state
- Backup service writes audit log entry
- UI: SuperAdmin can backup, non-SuperAdmin sees lock notice
- "Restaurer" requires confirmation

---

## 7. P3-L — Workflow DAG editor

### Goal
Visual SVG canvas, node library, Kahn's algorithm cycle detection, save validation, deploy stub.

### Approach

#### 7.1 Domain model
`src/domain/model/workflow.ts` — `Workflow` entity: `{ id, name, nodes: WorkflowNode[], edges: WorkflowEdge[], triggerType, lastDeployedAt, status }`. `WorkflowNode`: `{ id, type: "trigger"|"condition"|"action"|"delay"|"transform", subtype, label, position: {x, y}, config }`. `WorkflowEdge`: `{ id, from, to }`.

#### 7.2 Kahn's algorithm
`src/domain/workflow/kahn.ts` — pure function `detectCycle(nodes, edges): { hasCycle: boolean, cycleEdges: WorkflowEdge[] }`. Tested with 6+ cases (acyclic, simple cycle, self-loop, disconnected, multi-component cycle).

#### 7.3 Canvas
`src/features/workflow/dag-canvas.tsx` — SVG-based canvas:
- Nodes rendered as draggable rectangles with type-specific color/icon
- Edges rendered as bezier curves with arrowheads
- Click node → select; drag node → move; click empty → deselect
- Click+drag from node output port → another node's input port → create edge
- Right-click node → context menu (delete, configure)
- "Save" button validates via Kahn's algorithm; on cycle, highlights cycle edges in red
- "Déployer" button shows confirm modal → on confirm, calls `WorkflowRepository.deploy(id)` (mock returns success after 1.5s)

#### 7.4 Node library sidebar
Drag-from-palette pattern. 5 sections:
- Triggers (Payment Overdue, Student Enrolled, Payment Recorded, Schedule, Absence Limit, Manual Run)
- Conditions (Debt > Threshold, Payment Method Match, Student Status Match)
- Actions (Send Email, Apply Discount, Create Invoice, Push Notification, Audit Log)
- Delays (Wait Duration)
- Transforms (Database Query, Extract Field)

#### 7.5 Workflow list page
`src/features/workflow/workflow-page.tsx` — new sidebar item "Automatisations" (between Personnel and Settings):
- List of workflows with status (Draft / Deployed / Disabled)
- "Nouveau workflow" button → opens empty canvas
- Click workflow → opens canvas
- "Exécuter" button on manual-trigger workflows (2-click confirmation per plan §10.06)

#### 7.6 Mock repository
`src/infrastructure/mock/workflow-run-seed.ts` (already created in P3-N) + `src/infrastructure/mock/workflow-seed.ts` — 3 seeded workflows:
1. "Relance impayés" (deployed)
2. "Promotion fin d'année" (draft)
3. "Verrouillage comptes délinquants" (deployed, disabled)

### Tests
- Kahn's algorithm: 6+ cycle-detection cases
- Canvas: node drag, edge creation, edge deletion, node deletion
- Save with cycle → cycle edges highlighted, save blocked
- Save without cycle → persists + audit log
- Deploy → confirmation modal → success
- 2-click confirmation on manual triggers
- RBAC: only SuperAdmin can deploy

---

## 8. P3-K — AI integration scaffold

### Goal
Groq + OpenRouter + BYOK config, 3 AI features (Report Card Narrative Generator, Administrative Drafting Assistant, Expense Anomaly Detector), PII masking, mock LLM adapter.

### Approach

#### 8.1 Domain model
`src/domain/model/ai.ts` — `AIProviderConfig` (groq apiKey, openRouter apiKey, defaultModel, fallbackModel), `AIRequest`, `AIResponse`, `PIIMaskConfig`.

#### 8.2 PII masking
`src/domain/ai/pii-mask.ts` — pure functions that redact:
- Phone numbers (`+213 555 123 456` → `[PHONE]`)
- Email addresses (`john@doe.com` → `[EMAIL]`)
- IBAN / bank account numbers
- National ID numbers (Algerian NN format)
- Parent names (configurable — replace with `[PARENT_1]`, `[PARENT_2]`, etc.)
- Student names (same pattern)

Round-trip: mask before sending to LLM, unmask by replacement dictionary after response.

#### 8.3 LLM adapter (mock)
`src/infrastructure/ai/mock-llm-adapter.ts` — returns canned responses with 800ms delay to simulate network. In production, this is replaced by `groq-adapter.ts` + `openrouter-adapter.ts` (Edge Function proxied per plan §11.02).

#### 8.4 BYOK config
`src/features/settings/ai-config-tab.tsx` — replaces the existing AI Config BYOK form (currently disabled). Form with:
- Groq API key input (password type, "Test" button)
- OpenRouter API key input (password type, "Test" button)
- Default model dropdown
- Fallback model dropdown
- "Enregistrer" button → encrypts keys (AES-256-GCM via Web Crypto, key derived from admin passphrase) → stores in `localStorage`

#### 8.5 Report Card Narrative Generator
`src/features/academics/narrative-generator-modal.tsx` — opens from class detail Grades tab:
- Select student → AI synthesizes grades + attendance + teacher notes into narrative
- "Régénérer" button
- "Approuver" button (teacher review mandatory per plan §11.05)
- "Rejeter" button
- Approved narratives saved to student record

#### 8.6 Administrative Drafting Assistant
`src/features/dashboard/drafting-assistant-modal.tsx` — opens from Dashboard:
- Draft type dropdown (Convocation / Parent Alert / Policy Notice)
- Key points textarea (bullet per line)
- "Générer" button → AI drafts formal text
- Editable textarea for human review
- "Copier" + "Télécharger PDF" + "Envoyer" (mock) buttons

#### 8.7 Expense Anomaly Detector
Already partially implemented in `expense-detail-drawer.tsx` (banner). Extend:
- New `src/features/financials/anomaly-explainer-modal.tsx` — opens when user clicks the anomaly badge
- Shows AI-generated explanation: "Cette dépense présente 3 signaux: (1) montant identique soumis par un autre staff il y a 2 heures, (2) nouveau fournisseur sans historique, (3) montant dépasse 3x la moyenne mensuelle."
- "Demander une justification" button → opens comment field
- Signal, not verdict (plan §11.07) — UI makes this explicit

### Tests
- PII masking: each pattern type (phone, email, IBAN, NN, parent name, student name)
- PII unmasking: round-trip preserves original
- BYOK config: keys encrypted at rest, decrypted on read
- Narrative generator: mock LLM returns narrative, approve/reject flow
- Drafting assistant: each draft type produces different template
- Anomaly explainer: 3-signal explanation rendered correctly
- RBAC: only SuperAdmin + FinancialOfficer + Teacher (for narratives) can access

---

## 9. Comprehensive testing

### 9.1 New unit tests
- `src/test/unit/kahn.test.ts` — 8+ cases
- `src/test/unit/pii-mask.test.ts` — 12+ cases (each pattern type + round-trip)
- `src/test/unit/aes-256.test.ts` — 6+ cases (round-trip, wrong key fails, key derivation, etc.)
- `src/test/unit/backup-service.test.ts` — 8+ cases
- `src/test/unit/workflow-repository.test.ts` — 6+ cases

### 9.2 New component tests
- `src/test/component/dag-canvas.test.tsx` — node drag, edge creation, cycle detection visual feedback
- `src/test/component/command-palette.test.tsx` — search indexes, recent searches, navigation
- `src/test/component/language-switcher.test.tsx` — locale change, dir change, persistence
- `src/test/component/backup-tab.test.tsx` — backup list, restore confirmation, RBAC

### 9.3 New integration tests
- `src/test/integration/iteration-7.test.ts` — end-to-end smoke tests for every new feature
- `src/test/integration/rtl.test.tsx` — render every page in RTL mode

### 9.4 Regression tests
- `src/test/regression/iteration-6-regression.test.ts` — re-run iteration-6 tests to ensure no regression

### 9.5 E2E tests (Playwright)
- `e2e/login.spec.ts` — login flow with each of 4 demo accounts
- `e2e/batch-register.spec.ts` — CRM batch registration wizard
- `e2e/counter-payment.spec.ts` — Financials counter payment
- `e2e/roll-call.spec.ts` — Academics roll call
- `e2e/grade-entry.spec.ts` — Academics grade entry
- `e2e/expense-workflow.spec.ts` — Financials expense submit → approve → disburse → settle
- `e2e/cmdk-search.spec.ts` — Cmd+K search across all indexes
- `e2e/language-switch.spec.ts` — language switcher changes dir
- `e2e/backup-restore.spec.ts` — backup → restore round-trip
- `e2e/dag-editor.spec.ts` — create workflow → save → deploy

### 9.6 Performance tests
- Backup of 100k ledger entries completes in < 5s
- DAG canvas with 50 nodes renders at 60fps
- Search across 10k records returns in < 100ms

### 9.7 Edge case + error recovery tests
- Backup with empty state produces valid empty archive
- Restore with wrong key fails gracefully (no partial restore)
- DAG with self-loop is rejected
- AI call with all PII masked produces sensible response
- Cmd+K with empty index shows "no results" message

### 9.8 Security / permission tests
- Non-SuperAdmin cannot access Backup tab
- Non-SuperAdmin cannot deploy workflows
- Non-teacher cannot access Narrative Generator
- BYOK keys are encrypted at rest (verify with `localStorage.getItem` returns ciphertext)
- No-self-approval regression test (already exists, re-verify)

---

## 10. Build verification

- `tsc --noEmit` clean
- `vitest run` — all tests passing (target: 330 → 450+)
- `vite build` — clean build, no errors
- Playwright E2E — all specs passing
- Screenshots: 30+ screenshots covering all major UI states including RTL, DAG canvas, backup tab, AI modals, workflow monitor

---

## 11. Files changed summary (planned)

### New files (~30)
- `src/domain/model/backup.ts`
- `src/domain/model/workflow.ts`
- `src/domain/model/ai.ts`
- `src/domain/workflow/kahn.ts`
- `src/domain/ai/pii-mask.ts`
- `src/infrastructure/backup/aes-256.ts`
- `src/infrastructure/backup/indexed-db-vault.ts`
- `src/infrastructure/backup/backup-service.ts`
- `src/infrastructure/ai/mock-llm-adapter.ts`
- `src/infrastructure/ai/llm-adapter.ts` (interface)
- `src/infrastructure/mock/workflow-seed.ts`
- `src/infrastructure/mock/workflow-run-seed.ts`
- `src/infrastructure/mock/ai-config-seed.ts`
- `src/features/workflow/workflow-page.tsx`
- `src/features/workflow/dag-canvas.tsx`
- `src/features/workflow/node-palette.tsx`
- `src/features/workflow/workflow-detail-drawer.tsx`
- `src/features/settings/backup-tab.tsx`
- `src/features/settings/ai-config-tab.tsx`
- `src/features/personnel/workflow-monitor-tab.tsx`
- `src/features/personnel/workflow-run-detail-drawer.tsx`
- `src/features/academics/narrative-generator-modal.tsx`
- `src/features/dashboard/drafting-assistant-modal.tsx`
- `src/features/financials/anomaly-explainer-modal.tsx`
- `src/shared/components/language-switcher.tsx`
- `src/test/unit/kahn.test.ts`
- `src/test/unit/pii-mask.test.ts`
- `src/test/unit/aes-256.test.ts`
- `src/test/unit/backup-service.test.ts`
- `src/test/integration/iteration-7.test.ts`
- `src/test/integration/rtl.test.tsx`
- `e2e/*.spec.ts` (10 files)

### Significantly rewritten (~8)
- `src/shared/components/unified-modal.tsx` — add command-palette variant + header slot + hideHeader/hideCloseButton
- `src/shared/components/page-tabs.tsx` — sliding ink-bar, sliding pill, size prop, keyboardActivation, iconPosition
- `src/shared/components/topbar.tsx` — migrate Cmd+K to UnifiedModal, add language switcher, extend search indexes
- `src/shared/components/sidebar.tsx` — RTL support
- `src/features/settings/settings-page.tsx` — add Backup tab + AI Config tab as real surfaces
- `src/features/personnel/personnel-page.tsx` — replace ComingSoonCard on Workflows tab
- `src/i18n/ar.ts` — complete missing keys
- `src/i18n/fr.ts` — add new keys for new features

### Modified (~10)
- `src/app/app-shell.tsx` — add Automatisations sidebar item
- `src/index.css` — RTL logical properties
- `src/domain/repository/repository.ts` — add WorkflowRepository + BackupRepository + AIRepository contracts
- `src/infrastructure/mock/mock-repositories.ts` — implement new repositories
- `src/infrastructure/repository-provider.tsx` — wire new repositories
- `src/core/rbac/feature-registry.ts` — unlock AI / Backup / DAG / Workflow Monitor features
- `src/core/rbac/permissions.ts` — add new permissions (ManageWorkflows, ManageBackups, UseAI, ViewWorkflowRuns)
- `tailwind.config.cjs` — add `start-*`/`end-*` logical property utilities if not already present
- `package.json` — add Playwright dev dependency
- `playwright.config.ts` — new

---

## 12. Out of scope (iteration 8+)

- **Supabase adapter (P3-Q)** — requires a real Supabase project; mock layer remains canonical for now. The repository contracts added in this iteration prepare the surface for the swap.
- **Mobile parity verification (P3-T)** — out of scope; this is about the Android app, not the desktop.
- **Real AI API calls** — mock LLM adapter only. Production requires Edge Function proxy per plan §11.02.
- **Real Supabase Edge Function deploy** — DAG deploy is a mock that returns success after 1.5s. Production requires `supabase functions deploy`.
- **Real offsite vault** — IndexedDB vault only. Production requires separate physical location per plan §13.03.

---

## 13. Acceptance criteria

- [ ] 0 raw `<Dialog>` call sites in production code
- [ ] All 9 tab call sites use the modernized PageTabs with sliding indicators
- [ ] Cmd+K searches 6 indexes (parents, students, payments, expenses, audit, personnel)
- [ ] Language switcher changes dir + lang + persists
- [ ] All pages render correctly in RTL
- [ ] Workflow Monitor shows 15 mock runs with detail drawer
- [ ] Backup system: AES-256-GCM round-trip works; 365-day retention enforced; restore works
- [ ] DAG editor: nodes draggable, edges creatable, cycle detection works, deploy mocks success
- [ ] AI: BYOK config saves encrypted keys; 3 AI features work with mock LLM; PII masking round-trips
- [ ] All iteration-6 tests still pass (no regression)
- [ ] 120+ new tests added (target: 330 → 450+)
- [ ] Playwright E2E covers 10 critical workflows
- [ ] tsc clean, vite build clean
- [ ] 30+ screenshots captured

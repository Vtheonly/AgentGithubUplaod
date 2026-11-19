# Deep Sweep 05 — the per-consumer UnifiedModal/ConfirmModal census (Session 9, 2026-11-19)

**Trigger:** the S7/S8 handoff's last open Lane-B item — *per-consumer class-string extraction for the remaining UnifiedModal consumers* (handoff-session-08 §"remaining depth"; handoff-session-09 Lane B). The top shells (ModalShell, EntityDetailDrawer, Wizard, AutoFormModal) already have complete side-by-sides in `UI Component Audit/02-modals-dialogs.md`; the feature consumers had only the importer list + coarse censuses, never per-consumer prop/class tables. This document closes that lane: every consumer file read at JSX-usage granularity, every prop tabulated against the contract, every class string extracted verbatim.

**Repo HEAD:** `5af33c9403588c688575965a0f43c142c3fedd15` (main, clean tree). **Charter:** read-only — no application source/config touched; the three new census files under `Deep Sweep/censuses/` are the only repo writes. **Extraction scripts live outside the repo** (`/home/z/my-project/scripts/s9-modal-consumer-extract.py`), re-runnable at any HEAD.

---

## 1. Method and scope reconciliation (correction C-19)

**Two-shape counting discipline** (the C-13/C-14 lesson, applied again — and it paid off twice, see §1.1/§1.2):

- **Shape A — importers:** files whose source matches `from "[^"]*unified-modal"` (the S7 strict pattern) plus, separately, the subpath shape `from "[^"]*unified-modal/..."`. Family-internal files (`src/shared/ui/unified-modal.tsx` itself + the `unified-modal/` directory incl. the ConfirmModal preset) are excluded from the consumer set — they are the family, not consumers.
- **Shape B — usage sites:** after a string-aware comment strip, every real JSX opening of `<UnifiedModal` / `<ConfirmModal` is parsed by a depth/quote-aware tokenizer; the regex match count must equal the parsed usage count in every file (**parse drift must be ZERO**), and every extracted prop name is checked against the contract.

### 1.1 Consumer-file counts (correction C-19 to the C-17 scope note)

| Shape | Count | Composition |
|---|---|---|
| Strict root-barrel importers (`from "…unified-modal"`) | **67** external | the S7 count of 68 minus the family's own `confirm-modal.tsx` (which consumes the barrel and is family-internal) |
| Subpath-only importers (`from "…unified-modal/confirm-modal"`) | **3** external | `financials-page.tsx:70`, `installment-schedule-tab.tsx:104`, `payment-detail-drawer.tsx:18` — all import `ConfirmModal` directly from the submodule, bypassing the barrel re-export (unified-modal.tsx:32) |
| **Total external consumer files** | **70** | complete per-file list in §3 (also `censuses/agg-modal-consumers.txt`) |

C-17 ("68 importers exactly") is hereby **scope-corrected (C-19)**: 68 counted root-barrel imports only, including the family-internal preset. The external-consumer total is **70 files** (67 barrel + 3 subpath). The three subpath imports are a consistency nit, not a defect — the barrel re-exports the identical symbol — but any future "count the modal consumers" grep must use the loose pattern `from "[^"]*unified-modal` (72 matches at this HEAD = 70 external + 2 family-internal files: `unified-modal.tsx` and `unified-modal/confirm-modal.tsx`).

### 1.2 Usage-site totals

| Tag | Real JSX openings | Comment-only mentions excluded |
|---|---|---|
| `<UnifiedModal` | **77** | e.g. `crm/excel-import-modal.tsx:23`, `personnel/workflow-monitor-tab.tsx:5` are prose comments |
| `<ConfirmModal` | **37** | — |
| **Total** | **114** | across 70 files: 46 files ×1, 9 ×2, 11 ×3, 3 ×4, 1 ×5 (`settings/backup-tab.tsx`) |

### 1.3 The tokenizer's two failure modes (recorded because they generalize)

The extraction engine went through three versions; both failures are **JSX/JS-lexer lessons** any future census should inherit (they are exactly the class of loose-pattern artifact the counting discipline guards against):

1. **The JSX-text apostrophe (v1):** French prose in JSX text nodes (`description={<>…journal d'audit…</>}`) contains `'` characters that are literal text, not string delimiters. A quote-blind tokenizer opens a string state on them and swallows the tag. Fix: a quote opens a string only after a token-boundary character (`(=,{[:?&|!+-*/%<>~^`), with a 500-char bounded abort.
2. **The nested-template brace (v3):** template literals with interpolations containing nested templates (`description={\`${a} ${b ? \`…\` : ""}\`}`) need a **per-frame brace depth** — the `}` of a `${…}` interpolation must pop back to template-text mode, not decrement the enclosing expression's counter. v3's single shared counter returned early on `backup-tab.tsx:1267`'s description and under-parsed 5 files; v4's frame stack parses all 70 files with **zero drift**.

Final v4 verdict: **regex count == parsed count in all 70 files; exactly one unknown prop across all 114 usages** (BUG-041, §6).

---

## 2. The contract being measured

`UnifiedModalProps` (`src/shared/ui/unified-modal/types.ts:29-64`): 34 props — required `open`/`onOpenChange`/`title`; optional `variant` (dialog | drawer | command-palette), `size` (sm/md/lg/xl/2xl/full → `DIALOG_SIZE_CLASS`/`DRAWER_SIZE_CLASS`/`COMMAND_PALETTE_SIZE_CLASS`), `description`, `icon`, `iconTone` (5 tones), `badge`, `header` slot, `hideHeader`, `hideCloseButton`, `children`, `alert` + `onDismissAlert`, `submitLabel`, `cancelLabel` (default **"Annuler"**), `onSubmit`, `submitVariant` (default | destructive | success), `submitIcon`, `submitDisabled`, `submitLoading`, `hideSubmit`, `hideCancel`, `hideFooter`, `footer` slot, `footerLeading`, `closeOnBackdropClick` (default true), `closeOnEscape` (default true), `locked`, and **4 class-string injection points**: `bodyClassName`, `headerClassName`, `footerClassName`, `contentClassName`.

`ConfirmModalProps` (`unified-modal/confirm-modal.tsx:12-21`): 8 props (`open`, `onOpenChange`, `title`, `description`, `confirmLabel` default "Confirmer", `cancelLabel` default "Annuler", `destructive`, `onConfirm`) → presets `size="sm"`, dialog variant, icon `AlertTriangle`/`CheckCircle2`, tone danger/primary, auto-close on confirm.

**Key structural fact for everything below:** `UnifiedModal` destructures its 34 known props and forwards nothing else (`unified-modal.tsx:36-71`) — there is **no rest-prop spread** onto `ModalShell`/`DialogPrimitive.Content`. Unknown consumer props are silently dropped.

---

## 3. The per-consumer table (all 70 files, 114 usages)

Legend: UM = `<UnifiedModal` openings, CM = `<ConfirmModal` openings. "Notable" lists props beyond the per-tag baseline (UM baseline: open/onOpenChange/title ± the common description/icon/size/variant/submit family; CM baseline: the 8-prop contract) — i.e. anything a consolidation pass must look at twice. `submitVariant` appears in the notable column when passed as an **expression** (conditional variant) or literal `"destructive"`.

| Consumer file | UM | CM | Notable per-usage props |
|---|---|---|---|
| `f/academics/academic-year-detail-drawer.tsx` | 3 | 0 | — |
| `f/academics/class-detail-page.tsx` | 3 | 0 | — |
| `f/academics/class-subjects-tab.tsx` | 1 | 0 | — |
| `f/academics/clubs/club-detail-drawer.tsx` | 3 | 0 | — |
| `f/academics/clubs/clubs-tab.tsx` | 0 | 2 | — |
| `f/academics/exam-scheduling-modal.tsx` | 1 | 0 | — |
| `f/academics/exams-tab.tsx` | 0 | 1 | — |
| `f/academics/grade-levels-class-view.tsx` | 1 | 0 | — |
| `f/academics/homework-push-modal.tsx` | 1 | 0 | — |
| `f/academics/narrative-generator-modal.tsx` | 2 | 0 | submitVariant="destructive" |
| `f/academics/placement/class-placement-studio-modal.tsx` | 1 | 0 | — |
| `f/academics/placement/create-section-dialog.tsx` | 1 | 0 | — |
| `f/academics/promotion-cycles/promotion-class-review-modal.tsx` | 1 | 0 | — |
| `f/academics/school-years-tab.tsx` | 0 | 1 | — |
| `f/academics/subjects-directory-tab.tsx` | 0 | 1 | — |
| `f/academics/teachers-tab.tsx` | 2 | 0 | — |
| `f/academics/therapy/ortho-followup-detail-drawer.tsx` | 4 | 0 | submitVariant="destructive" |
| `f/academics/therapy/orthophonie-tab.tsx` | 1 | 0 | — |
| `f/academics/therapy/psych-followup-detail-drawer.tsx` | 4 | 0 | submitVariant="destructive" |
| `f/academics/therapy/psychology-tab.tsx` | 1 | 0 | — |
| `f/academics/timetable/timetable-entry-dialog.tsx` | 0 | 1 | — |
| `f/academics/timetable/timetable-tab.tsx` | 0 | 2 | — |
| `f/crm/activation-code-modal.tsx` | 1 | 0 | — |
| `f/crm/crm-page.tsx` | 0 | 2 | — |
| `f/crm/edit-parent-modal.tsx` | 1 | 0 | — |
| `f/crm/edit-student-modal.tsx` | 1 | 0 | — |
| `f/crm/excel-import-modal.tsx` | 1 | 0 | — |
| `f/crm/parent-detail-drawer.tsx` | 1 | 0 | — |
| `f/crm/re-enrollment/re-enrollment-tab.tsx` | 0 | 2 | — |
| `f/dashboard/alert-detail-modal.tsx` | 1 | 0 | — |
| `f/dashboard/components/analytics/data-inspector-core.tsx` | 1 | 0 | — |
| `f/dashboard/components/analytics/operational-query-console.tsx` | 1 | 0 | — |
| `f/dashboard/components/recovery-funnel-card.tsx` | 2 | 1 | — |
| `f/dashboard/dashboard-calendar.tsx` | 0 | 1 | — |
| `f/dashboard/see-details-modal.tsx` | 1 | 0 | — |
| `f/financials/anomaly-explainer-modal.tsx` | 2 | 0 | — |
| `f/financials/expense-detail-drawer.tsx` | 1 | 2 | — |
| `f/financials/expense-submit-modal.tsx` | 1 | 0 | — |
| `f/financials/financials-page.tsx` | 0 | 3 | subpath-only importer (C-19) |
| `f/financials/installment-schedule-tab.tsx` | 0 | 1 | subpath-only importer (C-19) |
| `f/financials/manual-debt-modal.tsx` | 1 | 0 | — |
| `f/financials/payment-detail-drawer.tsx` | 0 | 3 | subpath-only importer (C-19) |
| `f/financials/tranche-amount-edit-modal.tsx` | 1 | 0 | — |
| `f/financials/unified-payment-modal.tsx` | 1 | 0 | — |
| `f/personnel/dashboards/teacher-dashboard.tsx` | 1 | 0 | — |
| `f/personnel/management/chat-panel.tsx` | 1 | 1 | — |
| `f/personnel/management/department-management.tsx` | 1 | 2 | — |
| `f/personnel/management/payroll-management.tsx` | 3 | 0 | — |
| `f/personnel/management/requests-management.tsx` | 3 | 0 | — |
| `f/personnel/management/staff-attendance-center.tsx` | 4 | 0 | submitVariant={expression} (:728) |
| `f/personnel/management/task-detail-drawer.tsx` | 2 | 1 | submitVariant={reviewApproved ? "default" : "destructive"} (:331) |
| `f/settings/accounts-tab.tsx` | 0 | 1 | — |
| `f/settings/approvals-tab.tsx` | 1 | 0 | submitVariant |
| `f/settings/audit-log-tab.tsx` | 1 | 0 | — |
| `f/settings/backup-tab.tsx` | 2 | 3 | largest consumer (5 usages); nested-template descriptions |
| `f/settings/conflict-resolver-modal.tsx` | 1 | 0 | — |
| `f/settings/contextual-thresholds-config.tsx` | 1 | 0 | bodyClassName="space-y-3" (:444) |
| `f/settings/create-account-modal.tsx` | 1 | 0 | — |
| `f/settings/danger-zone-card.tsx` | 0 | 1 | — |
| `f/settings/export-dialog.tsx` | 1 | 0 | **data-testid (BUG-041)** |
| `f/settings/pricing-tab.tsx` | 0 | 1 | — |
| `f/settings/pricing/pricing-year-config-bar.tsx` | 0 | 1 | — |
| `f/settings/sync-tab.tsx` | 0 | 2 | — |
| `f/settings/theme-editor-modal.tsx` | 1 | 0 | — |
| `f/workflow/dag-canvas.tsx` | 0 | 1 | — |
| `f/workflow/node-inspector-drawer.tsx` | 1 | 0 | — |
| `f/workflow/test-studio-drawer.tsx` | 1 | 0 | — |
| `f/workflow/workflow-page.tsx` | 1 | 0 | — |
| `f/workflow/workflow-run-detail-drawer.tsx` | 1 | 0 | — |
| `shared/layout/topbar.tsx` | 1 | 0 | command-palette variant; bodyClassName="p-0" (:428); header slot |

Area distribution of the 70 files: academics 22, settings 13, financials 9, personnel 7, dashboard 6, workflow 5, crm 6, shared/layout 1, plus the analytics/dashboard deep components counted inside dashboard. (Row-for-row evidence: `censuses/agg-modal-consumers.txt`.)

---

## 4. THE CLASS-STRING INVENTORY (the lane's headline result)

Across **114 real usages** in 70 files, the four class-string injection points carry:

| Injection point | Sites | Distinct strings | The complete inventory |
|---|---|---|---|
| `bodyClassName` | **2** | 2 | `space-y-3` @ `settings/contextual-thresholds-config.tsx:444` (vertical rhythm for a checkbox-threshold form); `p-0` @ `shared/layout/topbar.tsx:428` (command palette — strips default body padding because the header slot renders the search input edge-to-edge) |
| `headerClassName` | **0** | 0 | — |
| `footerClassName` | **0** | 0 | — |
| `contentClassName` | **0** | 0 | — |

**Verdict:** the consumer layer of the modal family is effectively **fully conformant**. There is no per-consumer CSS divergence to consolidate — the unification work for modals is NOT a class-string cleanup but exactly what the S2 plan already targets: the four top shells (UI-U1/U2/U3) and the token layer (E6). The two `bodyClassName` injections are **legitimate layout variations to preserve** (the owner's charter: cohesive, not pixel-identical; do not drop capability).

Corroborating conformity signals:

- **Slot usage is rare and intentional:** `footer` slot 7 usages (club-detail-drawer, orthophonie-tab, psychology-tab, excel-import-modal, alert-detail-modal, unified-payment-modal, node-inspector-drawer — multi-action footers the standard submit/cancel pair cannot express); `header` slot 3 (academic-year-detail-drawer badge row, class-placement-studio, topbar command palette); `badge` 2.
- **Override flags are rare:** `hideFooter` 12+1, `hideSubmit` 7, `hideCancel` 3, `hideCloseButton` 1, `closeOnBackdropClick={false}` **1**, `closeOnEscape` **0**, `locked` **0** — two contract capabilities (`closeOnEscape`, `locked`) are currently exercised by ZERO consumers (dead-contract surface, worth knowing before any contract "simplification": they are forward-declared capabilities, not dead code).
- **`alert` + `onDismissAlert`:** 17 files pass `alert`, 14 wire `onDismissAlert` — 3 alert users render non-dismissible alerts (exam-scheduling-modal:134, ortho-followup:661, psych-followup:611 group) — legitimate for hard errors; noted so the unified pipeline's alert contract review (D-8 lane) knows the current norm.

---

## 5. Vocabulary distributions (over string-literal usages)

| Prop | Distribution (literal usages) |
|---|---|
| `variant` | dialog **39** · drawer **9** · command-palette **1** (49 explicit; 28 of the 77 UM usages default to dialog implicitly) |
| `size` | md **39** · lg **17** · sm **9** · xl **6** · 2xl **3** · full **1** (75 explicit; +2 ConfirmModal presets are sm) — wide-form tier (xl/2xl/full) = 10 usages, exactly the T-219 wide-form population |
| `iconTone` | primary **52** · warning **4** · danger **1** · success **1** |
| `submitVariant` | destructive **3** literal + **3 expression** (staff-attendance-center:728, task-detail-drawer:331, approvals-tab) — conditional destructive submits exist and must survive any contract tightening |
| `cancelLabel` | Fermer **6** · Annuler **5** · Retour **1** — the 5 explicit "Annuler" literally duplicate the prop's default value (cosmetic redundancy, §7) |
| `confirmLabel` | 30 usages, 20 distinct (Supprimer ×9 dominant; the long tail is one-off French action verbs — expected, not duplication) |
| `submitLabel` | 39 usages, 30 distinct (Enregistrer ×6, Clôturer ×2, Ouvrir le suivi ×2, Créer ×2, Fermer ×2 — rest one-off) |

The label vocabularies confirm the S2 observation at full precision: label text is per-feature by design (French domain verbs), so any future i18n pass (T-388 legacy) would sweep ~50 one-off literals — a content task, not a unification task.

---

## 6. Findings registered by this census

### BUG-041 — `data-testid` silently dropped by UnifiedModal (no rest-prop forwarding)

`settings/export-dialog.tsx:187` passes `data-testid="export-dialog"` to `<UnifiedModal>`. The component destructures its 34 known props and forwards nothing else (`unified-modal.tsx:36-71` — no `...rest`), so the attribute never reaches `DialogPrimitive.Content` and no DOM node carries it. Verified: **no test currently queries `[data-testid="export-dialog"]`** (the two importer tests `t-382-export-workflow` / `t-505-export-warmup` import the component but never query the testid), so nothing is red today — but the hook is a trap for future test authors and a contract-ergonomics defect: the family's only extension point for test hooks is the className injections (via `contentClassName`), which is undocumented. All other `data-testid` usage in the app sits on elements that DO receive them (e.g. `export-dialog.tsx:192,202,273` — plain divs/buttons).

**Recommendation (plan-only, for the executor):** either (a) document `contentClassName` as the sanctioned escape hatch and move the testid there, or (b) add an explicit `data-testid` prop to the contract at the next contract touch (UI-U family execution). XS, 1-2 files. Do NOT hot-fix outside an execution lane.

### C-19 — importer-count scope correction (to C-17)

The S7 "68 importers exactly" counts **root-barrel imports only, including the family-internal ConfirmModal preset**. External consumer files: **70** (67 barrel + 3 subpath-only: financials-page, installment-schedule-tab, payment-detail-drawer). No prior conclusion changes — the S2 keep/consolidate dispositions are untouched — but every future consumer grep must use the loose shape `from "[^"]*unified-modal` and subtract family-internal files.

### Non-findings (recorded to close the questions this census opened)

1. **No hidden hand-rolled modal layer exists.** All 114 usages go through the family; the 30 "-modal"-named files + 3 "-dialog"-named files all resolve to UnifiedModal/ConfirmModal consumers (S2 §1.2, now per-usage verified). The one native `confirm()` (DUP-034) remains the only bypass, unchanged.
2. **No consumer passes HTML-ish class soup through the injection points** — the 2 strings found are single Tailwind utilities, not re-styling.
3. **Parser artifacts:** none remaining (v4 zero-drift; the one flagged unknown prop is real and cited above).

---

## 7. Consolidation plan (PLAN ONLY — no implementation in this session)

Feeds the UI-U family stages in `Refactoring Unified/EXECUTION-PLAN.md` (gates unchanged — owner green-light + D-answers still pending):

1. **Nothing to clean in the consumer class layer** — the E6/U1-U3 modal work proceeds on the shells and tokens as planned; the 114 call sites need NO class edits. This census is the executor's per-site map: at UI-U2/U3 time, the 7 footer-slot users and 3 header-slot users are the visual-review population for footer/header render changes; the 12 `hideFooter` users are the regression population for the T-219 height-cap behavior (body `flex-1` binding).
2. **Cosmetic normalizations (bundle into the first modal-touching execution pass, zero behavior):** (a) drop the 5 redundant `cancelLabel="Annuler"` literals (equal the default); (b) normalize the 3 subpath `ConfirmModal` imports to the barrel (one symbol, one import path); (c) BUG-041 disposition (§6).
3. **Contract notes for the executor:** keep `closeOnEscape` and `locked` in the contract (0 consumers today but they are load-bearing capabilities for the restore/locked-modal flows designed in the unified pipeline, D-8 lane); keep `submitVariant` expression-capable (3 conditional usages rely on it); the `iconTone` vocabulary is stable (4 of 5 tones in use; `neutral` unused — keep, it is the natural tone for info-only headers).
4. **Census maintenance:** re-run `/home/z/my-project/scripts/s9-modal-consumer-extract.py` at any future HEAD; drift must stay ZERO before trusting a count (§1.3 lessons are encoded in the script).

## 8. Evidence files (this folder)

| File | Contents |
|---|---|
| `censuses/ui-modal-consumer-extraction.txt` | Complete per-usage dump: 114 usages × file:line + every prop with its value (class strings verbatim, expressions ≤90 chars) |
| `censuses/agg-modal-consumers.txt` | Per-file aggregation: 70 rows, usage counts, tags, class-string injections |
| `censuses/vocab-modal-props.txt` | Per-prop value distributions: variant/size/iconTone/submitVariant/cancelLabel/confirmLabel/submitLabel + the 4 class-injection inventories + unknown-prop list |

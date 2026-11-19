# Session 9 Report — the per-consumer UnifiedModal/ConfirmModal census (Lane-B closure)

**Date:** 2026-11-19 · **Trigger:** routine 6-hourly sweep (Job 537451) · **Start HEAD:** `5af33c9` (main, clean tree after clone) · **Branch:** `investigation/session-09` → merged to `main`.

## Gate check (per handoff-session-09)

1. Repo synced (fresh clone — the sandbox was recycled; local directory was empty); `git status` clean.
2. README → SESSION_LOG → handoff-session-09 → Deep Sweep README re-read; the import authority (Deep Sweep/04) left untouched — no import-engine question arose this session.
3. Issue #32 checked: **state open, 0 comments, no new owner activity** (also verified via the repo event stream: no pushes/creates since the S6-era branch events). Owner remains silent on D-1..D-12 → defaults govern; the execution gates stay CLOSED; the read-only regime held.
4. Infra probed (GET-only): **OPS-011 7-run-stable** — REST root + students table + JWKS + auth-health all `402 exceed_egress_quota`; management token still `401 Invalid access token`; GitHub API `200` + this session's push verifies the write path. The cap was NOT lifted → the live re-verification ceremony (harness Group A vs the Supabase repositories) was NOT due. Details appended to `01-INFRASTRUCTURE-STATUS.md`.

## What Session 9 did

The S7/S8 handoffs left exactly ONE open Lane-B item: *per-consumer class-string extraction for the remaining UnifiedModal consumers* (the top shells' side-by-sides were complete; the ~58 feature consumers had only the importer list + coarse censuses). This session built that layer and closed the lane.

### Method (counting discipline, applied to a JSX lexer problem)

- **Shape A (importers):** strict pattern `from "[^"]*unified-modal"` → 67 external files (+ the family-internal `confirm-modal.tsx` = the S7 68); loose pattern adds 3 **subpath-only** importers (`unified-modal/confirm-modal` direct: financials-page:70, installment-schedule-tab:104, payment-detail-drawer:18) → **70 external consumer files**. This is correction **C-19** (scope refinement of C-17; no disposition changes).
- **Shape B (usage sites):** string-aware comment stripping, then a depth/quote-aware tokenizer over every `<UnifiedModal`/`<ConfirmModal` opening; per-file **regex-count == parsed-count (drift ZERO)** required before any verdict. Every prop checked against the 34-prop (`types.ts:29-64`) / 8-prop (`confirm-modal.tsx:12-21`) contracts; class strings recorded verbatim.
- **Two lexer lessons banked** (the extraction engine went through 4 versions; both failure modes were real and are now encoded in the re-runnable script):
  1. *JSX-text apostrophes:* French prose in JSX text (`description={<>…journal d'audit…</>}`) is not a string — quotes open only at token boundaries, with a 500-char bounded abort.
  2. *Nested-template braces:* `\`${a} ${b ? \`…\` : ""}\`` needs **per-frame brace depth** — a single shared counter mis-parses (the `}` of a `${…}` interpolation must pop back to template-text mode; a closing backtick after `)` must re-open template state).

### Results (deliverable: `Deep Sweep/05-DEEP-UNIFIEDMODAL-CONSUMER-CENSUS-2026-11-19.md`)

- **114 real JSX usages** (77 UnifiedModal + 37 ConfirmModal) across 70 files (46×1, 9×2, 11×3, 3×4, backup-tab ×5).
- **THE headline: the consumer class layer is fully conformant.** All four class-string injection points across 114 usages carry exactly **2 strings**: `bodyClassName="space-y-3"` (contextual-thresholds-config:444) and `bodyClassName="p-0"` (topbar command palette:428). `headerClassName`/`footerClassName`/`contentClassName`: **0 usage**. There is no per-consumer CSS divergence to consolidate — the modal unification work is exactly the shell/token work already planned (UI-U1..U3, E6), now with a per-site map for the executor.
- **Vocabularies:** variant dialog 39 / drawer 9 / command-palette 1; size md 39 / lg 17 / sm 9 / xl 6 / 2xl 3 / full 1 (wide-form = 10, the T-219 population); iconTone primary 52 / warning 4 / danger 1 / success 1; submitVariant destructive 3 literal + 3 conditional expressions; cancelLabel Fermer 6 / Annuler 5 / Retour 1 (the 5 explicit "Annuler" duplicate the default); confirmLabel 30 usages / 20 distinct; submitLabel 39 / 30 distinct (per-domain French verbs — content, not duplication).
- **Behavior flags:** hideFooter 13, hideSubmit 7, hideCancel 3, hideCloseButton 1, closeOnBackdropClick=false 1, `closeOnEscape` **0**, `locked` **0** (two contract capabilities with zero consumers — keep them, they are designed-for capabilities, not dead code); alert 17 files / onDismissAlert 14; footer slot 7; header slot 3; badge 2.
- **Findings:** **BUG-041** — `data-testid="export-dialog"` passed at export-dialog.tsx:187 is silently dropped (UnifiedModal destructures without rest-prop forwarding, unified-modal.tsx:36-71); no test queries the testid today (t-382/t-505 verified), so nothing is red — registered as a contract-ergonomics trap with a plan-only disposition. **C-19** — importer-count scope (above).
- **Non-findings (questions closed):** no hidden hand-rolled modal layer (all 114 usages go through the family); no class soup through the injection points; parser artifacts: none remaining.

### Read-only compliance

Zero application source/config/schema/dependency edits. Writes: `Deep Sweep/05…md` + 3 census files + register updates (FINDINGS_INDEX, SESSION_LOG, README ×2, 01-INFRASTRUCTURE-STATUS) + this report + the handoff. Scripts live outside the repo (`/home/z/my-project/scripts/s9-modal-consumer-extract.py`).

## Verification ladder

| Claim | Method | Result |
|---|---|---|
| 70 consumer files / 67 strict / 3 subpath | two rg shapes + script | exact match (C-19) |
| 114 usages (77/37) | regex vs tokenizer count per file | drift ZERO in all 70 files |
| 2 class injections only | verbatim extraction + vocab file | exact; spot-read at topbar.tsx:428 and contextual-thresholds-config.tsx:444 |
| BUG-041 | source read + test grep | attribute present; no rest spread; no test consumer |
| submitVariant expressions ×3 | source read (staff-attendance-center:728, task-detail-drawer:331, narrative-generator:461) | verified |
| Infra verdicts | GET-only probes | OPS-011 7-run-stable; mgmt 401; GitHub 200+push |

## Carry-forward

All in `Handoffs/handoff-session-10.md`: gates unchanged (owner green-light + D-1..D-12 + spend-cap lift); the executor's cosmetic queue (5 redundant "Annuler" literals, 3 subpath imports, BUG-041 disposition) rides the first modal-touching execution pass; no open Lane-B items remain — future depth work is opportunity-only (runtime UI inspection via mock-mode dev server remains the one never-run lane).

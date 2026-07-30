# Iteration 11 — Engine Reintegration (Excel Import + Particle Animation)

This iteration fully reintegrates two standalone engines that were sitting
outside the main `src/` tree as separate Node.js packages:

1. **Excel Import Engine** (`excel-import-engine/`) — a CommonJS package
   using `better-sqlite3` + `exceljs` to import the school's `Suivis
   clients` workbook with idempotent upserts, per-run audit trail, and
   JSON + Excel report generation.
2. **Particle Animation Engine** (`import-engine-particle/`) — a TypeScript
   package using `sharp` (native libvips) for image-based particle
   generation, with physics simulation, color interpolation, and an IPC
   bridge for Electron main-process integration.

Both engines have been ported to TypeScript ESM, refactored to match the
project's architecture (clean layers, `Result<T,E>`, repository pattern,
existing audit log + export engine), and integrated as first-class
modules under `src/`. The standalone directories have been removed.

**Final state**: 980 tests passing (up from 836 baseline — 144 new tests),
0 typecheck errors, production build clean.

---

## Methodology

1. Cloned the GitHub repository to access the standalone engines + the
   `Entire_Project_Plan.txt` + iteration docs.
2. Read every file in both standalone engines via parallel Explore
   subagents — produced comprehensive technical maps covering APIs,
   dependencies, business logic, and integration risks.
3. Read the existing project's excel infrastructure (`dynamic-import.ts`,
   `client-schema.ts`, `import-pipeline.ts`, `export-engine.ts`), audit
   system (`audit-actions.ts`, `AuditRepository`), Electron setup
   (`main.ts`, `preload.ts`, `ipc-handlers.ts`), and the existing particle
   implementation (`particle-engine.ts`, `particle-logo.tsx`,
   `splash-screen.tsx`).
4. Identified the integration strategy:
   - **Excel**: Port to TypeScript in the renderer (no native deps) —
     use the existing `repos.audit.log()` for audit trail, the existing
     `export-engine.ts` for report styling, and a new `InMemoryAdapter`
     for in-session record + run history storage.
   - **Particle**: Port to TypeScript in the renderer — replace `sharp`
     with `HTMLImageElement` + `<canvas>` + `getImageData`, replace
     Node's `EventEmitter` with a tiny typed listener bag, drop the
     `JobQueue` + `IPCHandler` (not needed for splash screen).
5. Ported files in batches, fixing TypeScript strictness issues as they
   surfaced. Delegated mechanical 1:1 porting of the 6 validator rules
   to a subagent (with precise instructions + typecheck verification).
6. Wrote comprehensive tests for every new module — physics, color,
   pipeline, schemas, validators, engine lifecycle, end-to-end import.
7. Updated the `ExcelImportModal` + `SplashScreen` + `LoginScreen` to
   use the new engines.
8. Deleted obsolete files + standalone directories.
9. Verified: typecheck clean, 980 tests passing, production build succeeds.

---

## Particle Animation Engine — integration details

### Files created (12)

```
src/shared/particle-engine/
├── types.ts                          # Buffer → Uint8Array, dropped IPC/Job types
├── errors.ts                         # ParticleEngineError + 4 subclasses
├── physics/
│   ├── particle.ts                   # createParticle, updateParticle, toFrameData
│   └── morphing.ts                   # updateTargets (logo / circular / linear modes)
├── color/
│   └── interpolator.ts               # exciteColor, relaxColor, waveColorShift, luminance
├── pipeline/
│   ├── image-loader.ts               # HTMLImageElement + <canvas> + getImageData (replaces sharp)
│   ├── sampler.ts                    # dark-pixel extraction (Uint8Array | Uint8ClampedArray)
│   ├── projector.ts                  # aspect-preserving canvas-space projection
│   ├── fallback.ts                   # Canvas 2D "EI" monogram (replaces sharp SVG rasteriser)
│   └── pipeline.ts                   # load → sample → project orchestrator
├── engine.ts                         # ParticleEngine class (rAF-driven, no JobQueue/IPC)
└── index.ts                          # barrel export
```

### Files created (UI)

- `src/shared/components/particle-canvas.tsx` — reusable React wrapper
  around `ParticleEngine` (mounts `<canvas>`, runs rAF loop, forwards
  pointer events). Used by the login side-panel.

### Files modified

- `src/features/auth/splash-screen.tsx` — **rewritten** to use
  `ParticleEngine` directly. Mode sequence: logo → circular → logo
  (showcases morphing). Mouse-reactive repulsion + color excitation.
  Degrades gracefully when canvas context is unavailable (jsdom tests).
- `src/features/auth/login-screen.tsx` — replaced the deleted
  `ParticleLogoMini` (which used the old `ParticleLogo`) with the new
  `ParticleCanvas` component.

### Files deleted

- `src/shared/components/particle-engine.ts` (legacy 60-particle ring approximation)
- `src/shared/components/particle-logo.tsx` (legacy React wrapper)
- `import-engine-particle/` (entire standalone directory — 17 files, ~2400 LOC)

### Key architectural decisions

1. **No `sharp` dependency**: The standalone engine used `sharp` (native
   libvips) to decode images + rasterise SVG fallbacks. The renderer port
   uses `HTMLImageElement` + `<canvas>` + `getImageData()` — zero native
   deps, works in the browser sandbox, and produces identical `LoadedImage`
   shapes so the downstream pipeline is unchanged.

2. **No `EventEmitter` from `events`**: Node's `EventEmitter` isn't
   available in the sandboxed renderer. Replaced with a tiny typed
   listener bag (`Map<EventName, Set<Listener>>`) — 30 LOC, no deps.

3. **No `JobQueue` / `IPCHandler`**: The standalone engine tracked import
   jobs with retries + concurrency limits and bridged to Electron's
   `ipcMain`. For a splash screen (single-shot import, renderer-only),
   this machinery is unnecessary overhead. Dropped entirely.

4. **`requestAnimationFrame` instead of `setInterval`**: The engine
   exposes a public `step()` method so React hosts can drive it from
   their own rAF loop (finer control over rendering lifecycle). An
   optional `startSimulation()` method is available for non-React hosts.

5. **Brand palette alignment**: `DEFAULT_PALETTE` uses the exact RGB
   values from `src/index.css` CSS variables (`--brand-blue`, `--brand-blue-deep`,
   `--brand-gold`) so particles match the design system.

### Tests added (76)

- `src/test/unit/particle-engine/physics.test.ts` (27 tests) —
  createParticle, updateParticle (spring, damping, Euler, repulsion,
  excitation, relaxation), toFrameData, updateTargets (logo, circular,
  linear, edge cases).
- `src/test/unit/particle-engine/color.test.ts` (14 tests) —
  exciteColor, relaxColor, waveColorShift, roundColor, luminance.
- `src/test/unit/particle-engine/pipeline.test.ts` (21 tests) —
  samplePixels (density, threshold, edge cases), projectPoints (scaling,
  centering, aspect ratio, errors).
- `src/test/unit/particle-engine/engine.test.ts` (14 tests) —
  error hierarchy, config validation, destroy semantics, event listeners,
  DEFAULT_PALETTE brand alignment.

---

## Excel Import Engine — integration details

### Files created (24)

```
src/infrastructure/excel/import-engine/
├── types.ts                          # ImportSchema, FieldSpec, ImportIssue, RunStats, etc.
├── errors.ts                         # 9-class error hierarchy with stable codes
├── import-context.ts                 # per-run state tracker (stats, errors, warnings)
├── schemas/
│   ├── index.ts                      # SCHEMAS registry + lookup helpers
│   ├── etat-schema.ts                # ETAT 20262027 — main client/student roster
│   ├── bon-schema.ts                 # BON — receipts / client situations
│   ├── devis-schema.ts               # Devis — client quotes (form-style layout)
│   └── ref-schema.ts                 # REF — teachers/classes/localities (multi-table fan-out)
├── parsers/
│   ├── excel-parser.ts               # ExcelJS wrapper (File/ArrayBuffer input)
│   └── sheet-detector.ts             # two-tier detection (name regex + header signature)
├── validators/
│   ├── row-validator.ts              # per-row orchestration + monthlyArray aggregation
│   ├── field-coercer.ts              # type dispatch (string/phone/number/enum/date/...)
│   └── rules/
│       ├── types.ts                  # RuleIssue interface
│       ├── required.ts
│       ├── phone.ts                  # Algerian mobile regex, multi-value support
│       ├── email.ts
│       ├── enum.ts
│       ├── positive-number.ts        # French-locale parsing (comma → dot, DA/€/$ stripping)
│       └── min-length.ts
├── dedupe/
│   └── upsert-matcher.ts             # identity extraction (header → field.key translation)
├── storage/
│   ├── storage-adapter.ts            # abstract interface
│   └── in-memory-adapter.ts          # renderer-compatible mock (replaces SqliteAdapter)
├── reporters/
│   ├── json-reporter.ts              # machine-readable JSON report (Blob download)
│   └── excel-reporter.ts             # 3-sheet XLSX (Résumé, Lignes rejetées, Avertissements)
├── utils/
│   ├── id.ts                         # generateRunId, uuid (Web Crypto API)
│   ├── checksum.ts                   # SHA-256 file + object checksums
│   └── logger.ts                     # facade over project's structured logger
├── import-engine.ts                  # main orchestrator (EventEmitter + Promise)
└── index.ts                          # barrel export
```

### Files modified

- `src/core/audit/audit-actions.ts` — added 6 new audit actions:
  `ImportRunStarted`, `ImportRunCompleted`, `ImportRowInserted`,
  `ImportRowUpdated`, `ImportRowSkipped`, `ImportRowRejected`.
- `src/features/crm/excel-import-modal.tsx` — **rewritten** to use the
  new `ImportEngine`:
  - Stage 1 (select): file picker with drag-and-drop.
  - Stage 2 (preview): dry-run import showing per-sheet stats (rows read,
    inserted, updated, skipped, rejected) + error list + run metadata
    (run ID, checksum, size, duration).
  - Stage 3 (commit): atomic import with progress indicator.
  - Stage 4 (done): success summary + report download links (JSON + Excel)
    + audit log confirmation.
  - Audit sink wired to `repos.audit.log()` — every run emits
    `import.run_started` + `import.run_completed`.
- `src/infrastructure/excel/export-engine.ts` — updated doc comment to
  reference the new engine (was pointing at the deleted `import-pipeline.ts`).

### Files deleted

- `src/infrastructure/excel/dynamic-import.ts` (replaced by import-engine)
- `src/infrastructure/excel/import-pipeline.ts` (legacy, replaced)
- `src/infrastructure/excel/client-schema.ts` (replaced by schemas/etat-schema.ts)
- `src/test/unit/dynamic-import.test.ts` (22 tests — replaced by 90 new tests)
- `excel-import-engine/` (entire standalone directory — 31 files, ~3000 LOC)

### Key architectural decisions

1. **No `better-sqlite3` dependency**: The standalone engine used
   `better-sqlite3` (native, requires `electron-rebuild`) for persistent
   storage + audit trail. The renderer port uses a new `InMemoryAdapter`
   that keeps records + run history in memory for the session. This
   matches the project's existing mock-first architecture — a future
   Supabase adapter can drop in by implementing the same `StorageAdapter`
   interface.

2. **Audit integration via `repos.audit.log()`**: Instead of writing to
   a separate `import_runs` SQLite table, the engine emits audit
   actions through an injectable `AuditSink` callback. The modal wires
   this to the project's existing `repos.audit.log()` — so import
   activity appears in the same Settings → Audit log as every other
   state-changing operation, with the same `AuditEntry` shape.

3. **Report generation via existing `export-engine.ts`**: The
   `ExcelReporter` uses the project's existing `exportToXlsx()` helper
   (which already wraps ExcelJS with brand-coloured headers, zebra
   striping, and auto-filter) rather than calling ExcelJS directly. This
   keeps a single styling seam and matches the rest of the app's export
   UX.

4. **Checksums via Web Crypto API**: Replaced Node's `crypto` module
   with `crypto.subtle.digest` (SHA-256). Works in both the Electron
   renderer and modern Node.js. The 16-char truncation for
   `objectChecksum` is preserved (change-detection digest, not
   cryptographic).

5. **All 4 schemas ported**: ETAT (clients), BON (receipts), Devis
   (quotes), REF (reference data with multi-table fan-out). The
   standalone engine's known limitations (per-field `headerRow` not
   honored by the parser for Devis/BON) are documented in the schema
   files for future fix.

6. **Idempotent upsert preserved**: Re-importing the same file produces
   `skip` actions (not duplicates) when the per-record checksum matches.
   Verified by the "skips unchanged records on re-import" test.

7. **Dry-run preview**: The modal runs `importFile({ dryRun: true })` for
   the preview stage, then `importFile({ dryRun: false })` for the commit.
   This gives accurate stats + error counts before the user commits,
   and the same validation pipeline runs in both stages.

### Tests added (90)

- `src/test/unit/excel-import-engine/schemas.test.ts` (20 tests) —
  all 4 schemas' matchers, identity, requiredHeaders, fields, extractAs;
  registry lookup helpers.
- `src/test/unit/excel-import-engine/validators.test.ts` (49 tests) —
  all 6 rules (required, phone, email, enum, positiveNumber, minLength);
  FieldCoercer type dispatch (string, number, numberOrRef, enum, required,
  default, excelError); RowValidator with ETAT + REF schemas; UpsertMatcher
  identity extraction + sameIdentity.
- `src/test/unit/excel-import-engine/engine.test.ts` (21 tests) —
  InMemoryAdapter (upsert insert/skip/update, insertRecord dedup,
  listRecords, saveAuditRun round-trip); ImportEngine lifecycle (audit
  events, invalid row rejection, idempotent re-import, dryRun, event
  ordering, REF fan-out, preview, unknown sheet handling, error event).

---

## Verification

```bash
# Type-check the entire codebase
npm run typecheck
# → clean (0 errors)

# Run the full test suite (980 tests)
npm test
# → 44 test files, 980 tests passing (up from 836 baseline; +144 new tests)

# Production build (Vite renderer)
npx vite build
# → succeeds, 14.28s, all chunks under 1 MB
```

All three verification commands pass with zero errors.

---

## Plan compliance summary

| Plan section | Status | Notes |
|---|---|---|
| §02.03 Desktop Terminal | ✅ | Electron + React + shadcn/ui — unchanged |
| §14 Data Bridge & Excel | ✅ + multi-schema engine + audit trail + reports (iteration 11) | 4 schemas (ETAT/BON/Devis/REF), idempotent upsert, JSON+Excel reports |
| §03.04 Particle Intro | ✅ + image-pipeline particle engine (iteration 11) | Replaces legacy 60-particle ring with image-sampled EI monogram |

The desktop application now has both engines integrated as first-class
modules — they feel like they were originally designed as part of the
application, not added later as standalone packages.

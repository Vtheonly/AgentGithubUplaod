# PERFORMANCE — bundle, query, render and runtime analysis

All measurements executed 2026-11-27 (TOOLING.md). React Scan runtime profiling could not run in this sandbox (headless, login-gated journeys — exact reason in TOOLING.md); the designated fallbacks (static complexity data + Playwright boot smoke + bundle composition) were executed.

## 1. Production bundle (vite build + rollup-plugin-visualizer, measured)

- **73 JS chunks, 5.91 MB minified total** (`raw/bundle-stats.html` treemap)
- Top chunks by raw size:

| Chunk | Size (raw / gzip) | Content | Action |
|---|---|---|---|
| `index-*.js` | **1.41 MB / 388 KB** | app-core + i18n + domain + katex | over the 1 MB warning; split i18n locale loading + lazy KaTeX |
| `vendor-excel` | 940 KB / 271 KB | exceljs | already isolated; ensure it stays behind the import feature's lazy import |
| `app-shell` | 639 KB / 183 KB | shell + nav + topbar | audit composition (likely bundle carries providers + shared UI) |
| `vendor-charts` | 443 KB / 117 KB | recharts | fine (lazy dashboards) |
| `vendor-pdf` | 436 KB / 180 KB | pdf-lib | fine (lazy receipts) |
| feature pages (7) | 171–269 KB each | route-level | **Already resolved** (T-583 route-lazy, −71% boot JS) |

- Startup path: mock-mode boot smoke (Playwright, built bundle): shell mounts, **0 console errors, 0 page errors** — no render-crash regressions in the current tree.

## 2. Static complexity on the render path (Fallow health, executed)

The heaviest render-path components: `unified-payment-modal.tsx` (1,198 LOC, cognitive 144), `parent-detail-drawer.tsx` (2,184 LOC), `timetable-tab.tsx` (1,853), `approvals-tab.tsx` (1,544), `dag-canvas.tsx` (1,412). These are the components whose re-render cost compounds with complexity — the exact set React Scan should profile first once an interactive session is possible (§6).

## 3. Database round-trip patterns (ts-morph census, executed)

- 414 `.from()` call sites / 73 tables; hot tables `installments` ×30, `parents` ×24, `students` ×21 (OPERATION-DUPLICATION §4).
- **308 unbounded `select()` chains** — every one is a full-table materialization candidate. Classification: Confirmed by census; today harmless (max table 5,956 rows / 4.1 MB); the risk is growth + mobile (Android shares the same API surface).
- The realtime/cache layer (`infrastructure/supabase/{delta-cache,cache-freshness,financial-realtime}.ts`) shows the app already does delta caching — the unbounded reads bypass it.
- 68 unindexed FK columns (DATABASE-AUDIT §5) will surface as slow joins as data grows.

## 4. Build & type health

- `tsc --noEmit` clean; `vite build` 38 s; chunk-size warning only on `index`.
- npm tree: 603 packages installed; 8 unused runtime deps (UNUSED-CODE §4) — removing them shrinks install weight but not the bundle (none are imported, hence none bundled); `pg` (~5 MB unpacked) is the heaviest dead weight.

## 5. Electron main-process health

- `electron/` is 6 files / 1,296 LOC with a thin IPC surface (25 channels, 24 used) — no startup bloat; the `.cts/.cjs` module system was deliberately fixed at BUG-054.
- Main-process heavy work: none observed beyond window/menu/dialog/config — the renderer owns all domain work by design (mock or Supabase), so main-process startup is not a concern.

## 6. OpenTelemetry instrumentation proposal (per charter; proposal only — nothing deployed)

1. **Renderer spans**: `@opentelemetry/sdk-trace-web` + `zone.js`-free context propagation; auto-instr. fetch (`supabase-js` goes through fetch). Export OTLP to a local collector sidecar (`localhost:4318`) so no SaaS dependency is added.
2. **Custom spans** around the three hot paths: repository call (`repo.<name>.<method>`), Supabase query (`sb.<table>.<op>` including row counts), workflow engine ticks.
3. **Electron main**: NodeSDK with the same OTLP endpoint; auto-instr. `ipcMain.handle` wrapper — one span per channel, the 25-channel surface makes this a ~30-line wrapper.
4. **First dashboards**: p95 per `sb.*` span (catches unbounded-read growth), p95 per route chunk fetch, workflow tick duration.
5. Gate behind `VITE_TELEMETRY=1` + strict sampling (default off — this is a privacy-sensitive school platform).

## 7. React-Scan / profiler checklist (when an interactive session exists)

Profile, in order: (1) `unified-payment-modal` open/close + installment table typing, (2) `dashboard` KPI refresh after payment, (3) `timetable-tab` drag interactions, (4) `parent-detail-drawer` with 3+ payments loaded. Expected hotspots per §2: wide re-renders from `repository-provider` context (fan-in 81 file consumes it), unbounded installs list in financial tabs.

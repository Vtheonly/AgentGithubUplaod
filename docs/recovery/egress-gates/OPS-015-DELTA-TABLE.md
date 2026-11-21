# T-595 — the OPS-015 four-class egress delta table

**Task:** T-595 (E7A-5 / ROADMAP 6.7) · **Generated:** 2026-11-21 (Session 36) · **Measurement commit:** `e1ba23bd` (branch `execution/session-36-t595-t577-e2-head`)

**The measurement boundary:** the Supabase seam — every `client.rpc(...)` and every `client.from(...)` chain the repositories issue (in supabase-backed mode each is ONE PostgREST round trip). The run is **mock-seam only** (a recording fake client; ZERO network I/O) — the OPS-015/G2 live locks stand.

**Scope honesty:** the CALL-COUNT gates are world-size-independent (they hold at any scale). The byte/row figures are world-proportional and measured on the harness's deterministic small world (12 payments · 14 installments · 8 ledger · 6 parents · 10 students); the one-time live window refreshes them at live scale.

**Re-run:** `cd elimtiyaz-desktop && node scripts/run-egress-harness.mjs --external <name>=<path> …` (regenerates `egress-after.json` + `external-census.json`; the gates re-assert on every `npx vitest run src/tests/infrastructure/t-595-egress-gates.test.ts`).

## The delta table

| OPS-015 class | BEFORE (the archived live evidence) | AFTER (measured at the seam, this run) | LIVE window | Verdict |
|---|---|---|---|---|
| **1 — the 30 s/focus re-seed volley**: every tick re-downloaded the cached repositories' full collections ≈**13,000+ rows per cycle** at live scale (installments 5,963 · ledger 3,342 · payments 2,198 · students 1,137 · parents 741) | **DEAD** — killed by T-592 (the `(updated_at, id)` composite cursor). Measured: boot = **5** cold-walk RPCs (one per table; the full read happens ONCE at cold start); each warm tick = **5** `pull_*_for_sync` RPCs returning **0 rows / ~2 bytes each**; **zero `from()` re-seeds** | PENDING (owner's one-time G2 window) | **VERIFIED DEAD** (t-595 GATE 1, 9/9 green) |
| **2 — ARCH-040's per-filter-change collection downloads ×2**: the dashboard's triple data path (uncached parallel full-collection downloads + the prev-year second-tick duplicate + the third observable path) | **COLLAPSED** — killed by T-590 (migration 0002 aggregation RPCs + the page's triple-path collapse). Measured: one dashboard load = **4 aggregation RPCs + 2 bounded windowed keyset reads** (6 calls; 33 rows / ~14.4 KB on the harness world — vs the full tenant collections); the ×2 filter-change shape = 12 compact calls; **zero full-collection downloads**, every read windowed (`gte`+`lt`) + keyset (`order id`+`gt`) + `limit`-bounded | PENDING | **VERIFIED COLLAPSED** (t-595 GATE 2) |
| **3 — BUG-042's amplification: 7,148 requests** (suppressed live only because the 402 state tripped the offline detector — returns the moment the cap lifts) | **DEAD** — killed by T-559 (the toast context split: the actions identity memoized, the list in a second context) + T-560 (the five load-generation-ref gates). Measured: the seam ceiling is **LINEAR — exactly 1 attempt per tick per table** (3 failing ticks = 3 calls, no re-fire storm, no retry storm); the source pins re-verified at HEAD (`ToastListContext` + `useMemo` in toast-provider; `load-generation-ref` in all five sites) | PENDING | **VERIFIED DEAD** (t-595 GATE 3) |
| **4 — BUG-058's ~240/h health-probe drip + the sync push pipeline's 3-4 requests/entry** (the T-171 "1 170-badge" live-burn record) | **COLLAPSED** — killed by T-594 (the runtime-config-gated probe: ZERO probes in mock/offline mode) + T-593 (`sync_apply_batch`). Measured: a **1,000-entry batch = EXACTLY 20 round trips** (ceil(1000/50), 50 mutations per call, ~292 KB total requests on the harness world) with **zero per-item pushes**; the drain integration: 120 enqueued entries ride ONE `pushBatch` → 3 round trips, every queue row bulk-marked synced | PENDING | **VERIFIED COLLAPSED** (t-595 GATE 4) |

## Provenance (the BEFORE numbers)

- **Class 1:** `Investigation Archive/Findings and Hypotheses/FINDINGS_INDEX.md` OPS-015 (1); `cache-freshness.ts:32-66` (the T-034 freshness-for-wire-cost trade); the live census embedded in the T-592 card (`Refactoring Unified/EXECUTION-PLAN.md` §4 E7A-3).
- **Class 2:** FINDINGS_INDEX ARCH-040; the T-590 card (the `dashboard-page.tsx:181-201 / :251-270 / :271-276` triple data path).
- **Class 3:** FINDINGS_INDEX OPS-015 (3) / BUG-042; Deep Sweep/09 §3.1 (the 7,148-request live burn).
- **Class 4:** FINDINGS_INDEX OPS-015 (4) / BUG-058; the T-171 "1 170-badge" live-burn record; the S3 pipeline inventory (default-push-handler 3-4 req/entry; the 30 s poll).

## The live-window protocol (the PENDING columns)

Per OPS-015's sequencing constraint the live columns fill in the owner's ONE-TIME window — the same window as the cap lift and the three staged ceremonies (§4 E7A-12 / T-598 + the local seed ceremony E7B-10): re-run the harness with the live client (the recording seam swaps for the real transport), record `egress-live.json`, and close the table. Until then the live locks stand: zero live traffic, zero deploys, zero cap lifts, zero packaged builds.

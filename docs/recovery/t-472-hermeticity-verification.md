# T-472 — The TEST-503 systemic hermeticity fix: verification evidence

**Task:** T-472 (branch `fix/t472-test503-hermeticity`, 138th session, 2026-10-04)
**Problem:** TEST-503 — the test environment is NOT hermetic since f39eb17
**Status:** RESOLVED-TESTED (the seam + the escape hatch + the source-scan guard; the full unified battery GREEN with the registered baseline move)

---

## 1. What was wrong

Since the owner's commit `f39eb17` (2026-09-17, "normalize Supabase runtime URL in dev and Electron"), `src/infrastructure/supabase/supabase-client.ts` resolved its configuration through a fallback chain ending at the canonical production coordinates:

```
supabaseUrl   = localConfig.url  ?? envSupabaseUrl  ?? CANONICAL_PRODUCTION_SUPABASE_URL
supabaseAnonKey = localConfig.anonKey ?? envPublicKey(  ?? CANONICAL_PRODUCTION_PUBLIC_KEY)
useSupabase   = localConfig.useSupabase ?? (readEnv("VITE_USE_SUPABASE") !== "false")
```

Inside the Vitest environment (no localStorage config, and T-314's `envPrefix: ["VITE_TEST_"]` contract exposing NO `VITE_*` env), every term resolved to the canonical fallback: **`isSupabaseConfigured()` was TRUE and `useSupabase` was TRUE for the whole test environment.** Consequences already observed in production evidence (TEST-502 class (c)): the vault-compliance §02.06 pair was uploading to the REAL production `homework-attachments` bucket for two weeks (dying on its allowed-mime gate; a MIME that PASSED would have written a production row from a test). The repository provider's module-scope `selectDefaultRepositories()` was building the REAL supabase repositories over a production-pointing client for every suite that did not explicitly inject mocks — the baseline run's stderr carried the tell (`GoTrueClient … Multiple GoTrueClient instances detected`).

## 2. Root cause

The packaged-app guarantee (a build without env still connects) and the hermetic-suite guarantee (no env ⇒ NOT configured) were both implemented through the SAME symbols. The f39eb17 fallback silently repealed T-314's hermetic contract.

### The discovery this round adds (§15.84b amendment)

**`import.meta.env.VITEST` does not exist in this project's Vitest runs.** Empirically probed (vitest 2.1.9): `Object.keys(import.meta.env)` = `["BASE_URL","DEV","MODE","PROD","SSR"]` — the project's own `envPrefix: ["VITE_TEST_"]` contract (T-314) filters the `VITEST` key OUT of `import.meta.env`. The reliable carrier is **`process.env.VITEST === "true"`** (set by the Vitest runner itself in every environment it creates, jsdom included). The Electron renderer runs with `nodeIntegration: false` — `process` does not exist there at all — so the detection cannot false-positive in the packaged app. A future agent reaching for `import.meta.env.VITEST` will read `undefined` and wrongly conclude the seam is dead.

## 3. What changed

### 3.1 The seam (`src/infrastructure/supabase/supabase-client.ts`)

A module-scope `isVitestRun` detection with THREE layered signals, each independently sufficient and none reachable in the packaged app:

1. `typeof process !== "undefined" && process.env?.VITEST === "true"` (the runner's own flag — the reliable carrier per the discovery above);
2. `import.meta.vitest != null` (defined only when the Vitest plugin transformed the module);
3. `import.meta.env.VITEST === true | "true"` (the documented flag — present whenever a future envPrefix allows it; can only make a test run MORE hermetic).

Inside a Vitest run:

- the `?? CANONICAL_PRODUCTION_SUPABASE_URL` and `?? CANONICAL_PRODUCTION_PUBLIC_KEY` fallbacks are **disabled** (env-only configuration);
- the default `useSupabase` is **`false`** (mock mode) when neither localStorage nor an explicit `VITE_USE_SUPABASE` env value is present — which also keeps the module-load throw inert (a not-configured + `useSupabase=true` combination would throw at import time for every suite).

**Preserved byte-identically:** the `isProductionDesktopBuild` branch (the packaged-app guarantee — the seam's whole point is that it does NOT touch it), the dev/browser default (a local dev server without env still resolves the canonical project exactly as f39eb17 intended), and the localStorage override precedence.

### 3.2 The pin test + the source-scan guard (`src/tests/infrastructure/t-472-hermeticity.test.ts`, 5 tests)

1. **The default contract:** in the hermetic default, `supabaseUrl === undefined`, `supabaseAnonKey === undefined`, `useSupabase === false`, `isSupabaseConfigured() === false`, `getSupabaseClient()` THROWS (refuses to construct), `describeSupabaseConnection()` reports `configured: false, keyFormat: "missing"` — T-314's contract pinned at the module itself.
2. **The import stays inert** (mock mode is legal — no module-load throw).
3. **The escape hatch:** the localStorage `el-imtiyaz.local-config` pin + `vi.resetModules()` + dynamic import yields a configured module with the PINNED values (the pinned fake host, never the canonical production host — the TEST-503 leak cannot recur through this path).
4. **The provider's default selection is the mock composite** in the hermetic default.
5. **The source-scan guard:** every test file under `src/tests/` that reaches a configured-path seam — a DIRECT VALUE import from `@supabase/supabase-js` (an `import type` is erased at runtime and harmless) or a `getSupabaseClient(` call — must carry a pin marker: a `vi.mock("…supabase-client")` pin, the `el-imtiyaz.local-config` localStorage pin, or the env-gated `describe.skipIf` + `process.env.SUPABASE_*` LIVE pattern (t-094). **Scan result: ZERO violations** — every existing configured-path suite already pins its mode.

### 3.3 The one blast-radius suite (`src/tests/features/t-393-supabase-diagnostics.test.tsx`)

The blast-radius census (below) found exactly ONE suite depending on the configured default: the diagnostics suite's A-section asserts the config probe's canonical host/keyFormat detail and the healthy 18-PASS matrix, which flow from `describeSupabaseConnection()`. It is now pinned to the configured-mode pattern (the vault-suite inheritance): `useSupabase: true`, `isSupabaseConfigured: () => true`, a `describeSupabaseConnection()` returning ONLY the canonical PUBLIC coordinates (host + key FORMAT — the SAFETY test still asserts no key material appears anywhere), and a `getSupabaseClient` that THROWS (the suite's clients are its own mocks — the real client is never constructed). 12/12 green after the pin.

### 3.4 The registered baseline move (`scripts/test-baseline.json`, same commit per §15.84c)

270 files (269 passed / 1 skipped) · 4,685 tests (4,680 passed / 0 failed / 5 skipped) — net +5 (the t-472 suite); the failing-file set remains EMPTY.

## 4. What was verified (the commands and their results)

| Check | Command | Result |
|---|---|---|
| BEFORE battery (clean main, pre-change) | `npx vitest run` | **4 675 passed / 0 failed / 5 skipped** (269 files) — byte-identical to the registered baseline |
| The seam alone (blast-radius census) | `npx vitest run` (after the seam, before the pin) | **1 failed suite** (`t-393-supabase-diagnostics`, 7 tests) — exactly the predicted configured-describe dependency; no other suite moved |
| The t-393 pin | `npx vitest run src/tests/features/t-393-supabase-diagnostics.test.tsx` | **12/12** |
| AFTER battery | `npx vitest run` | **4 680 passed / 0 failed / 5 skipped** (270 files) |
| The unified runner (all gating layers) | `npm test` | Layer 0 tsc **0 errors** · Layer 1 **BASELINE-MATCHED** (0 documented failures) · Layer 2 desktop runner **810/0/10** · mirror runner **774/0/10/36** · tier-4 **784/820 equivalent, 0 rows** · sanity **820/820, canonical 319/319, discrepancies 0** · **Verdict: GREEN** |
| Lint | `npx eslint . --ext ts,tsx` | **0 errors** (893 pre-existing warnings, unchanged) |
| Migrations | `bash scripts/check-migrations-append-only.sh` | **OK** (133 files, +0 new) |

## 5. What remains unresolved

- The **source-scan guard's regex scope**: it pins the three documented pin markers and the two documented reach patterns. A NEW kind of reach (e.g. a helper module under `src/tests/_helpers/` that value-imports supabase-js on behalf of test files) would not be flagged by the per-file scan — the guard is a tripwire, not a proof. The t-408-style source-scan family remains the technique for new seam kinds.
- **Layer 3's environment-gated runners** (the real Kotlin runner, the backend runner, the live-E2E family) remain environment-gated in this session (no JDK/gradle/PostgreSQL provisioned here); the hermeticity change does not touch them, but a future environment that runs them should re-verify against this document's Layer-2 numbers.
- The **Android side** has its own environment seam (the §8.1 token/env discipline + `scripts/setup-env.sh`); the TEST-503 class has not been audited on the Kotlin side — registered as a divergence note, not a defect.

## 6. The hermetic contract going forward (the §15.84b amendment)

1. The default test environment is **UNCONFIGURED MOCK MODE** — `isSupabaseConfigured() === false` — enforced at the module itself (`supabase-client.ts`), not by convention.
2. A suite that needs a configured path **pins it explicitly** (localStorage `el-imtiyaz.local-config` + `vi.resetModules()` + dynamic import, or a partial `vi.mock` of supabase-client) — and the pinned values are FAKE coordinates, never the canonical production host.
3. A test dying on a MIME/ACL/401/RLS error it should never see is still the tell that it is talking to production — but with the seam in place, it now requires an explicit pin to get there, so the reach is visible in the diff and in the source-scan guard.

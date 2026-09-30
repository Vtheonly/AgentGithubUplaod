# T-447 Live Verification — the Statistics/Finance parity chain on the REAL corpus

> **Task:** T-447 (124th session, 2026-09-30) — the owner's Statistics-vs-Finance parity + all-categories + bilingual-tooltips + metric-audit mandate.
> **Probe:** `elimtiyaz-desktop/scripts/t-447-live-verify.mjs` (read-only, the §11.1 data-gateway convention — GET requests only, zero residue by construction; the `sb_secret` key read from the environment, never written into the repo).
> **Run:** `SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/t-447-live-verify.mjs` → **25/25 PASS** (2026-09-30, live project `vebfehrpzajhstyhinnw`).

## The corpus

5,956 installments (the whole tenant — the wave analysis' basis): **4,819 wave rows** (tranche 1..3) + **1,137 non-wave rows** (ALL of them FI / tranche 0 — the registration fee) — the partition check proves every row is counted exactly once.

## The checks (all PASS)

### 1. The canonical pool === the RAW stored sums (per wave, to the dinar)

| Wave | Σ raw amount_due | Σ raw amount_paid | Σ raw amount_pending | engine pool |
|---|---|---|---|---|
| T1 | 123,748,300 | 95,279,400 | 0 | **identical** |
| T2 | 102,269,000 | 21,378,200 | 0 | **identical** |
| T3 | 101,868,500 | 18,129,200 | 0 | **identical** |

The engine reads the live rows and produces the raw sums verbatim — the "Source Data → Domain Engine" half of the mandate's chain.

### 2. The reconciliation identity (per wave, exact)

- T1: **123,748,300 + 0 = 95,279,400 + 0 + 28,468,900** ✓
- T2: **102,269,000 + 0 = 21,378,200 + 0 + 80,890,800** ✓
- T3: **101,868,500 + 0 = 18,129,200 + 0 + 83,739,300** ✓

`overCoverageTotal` is 0 on the live corpus (no row carries funds beyond its due — the import-era waterfall never over-covers), so the identity is the mandate's plain form everywhere today; the over-coverage leg exists and is pinned by the offline suite's synthetic fixture.

### 3. The Statistics view-model layer over the LIVE rows

Every per-(category × wave) view model equals the canonical stats on the real corpus — e.g. T1/tuition: view 111,758,300 / 83,600,400 / 28,157,900 === canonical 111,758,300 / 83,600,400 / 28,157,900 (due/paid/remaining). (The Finance `.tsx` view-model parity is pinned OFFLINE by `t-447-pooled-waves.test.ts` + `t-447-rendering-engine-parity.test.tsx` — the feature file carries the UI import chain and is not loadable in bare node; its derivation consumes the SAME canonical pool by construction since Phase 1.)

### 4. The family-count SET UNIONS (the double-count trap, live)

| Wave | pooled (union) | Σ per-category counts |
|---|---|---|
| T1 | 741 | 1,054 |
| T2 | 741 | 1,056 |
| T3 | 739 | 1,053 |

The live corpus has 741 families owing in BOTH tuition and transport T1 — summing the per-category counts would have double-counted 313 of them. The union semantics are load-bearing on real data.

### 5. The all-categories coverage

The live wave rows carry 2 categories (tuition + transport — the school's actual tranche-bearing categories today); both appear in the pooled breakdown — **no silent exclusion**. The service categories (canteen/uniform/…) and FI live in the non-wave section / the payments-derived cards — covered by the same partition check.

### 6. The FI visibility + the every-dinar accounting

- The 1,137 FI (tranche 0) rows surface in their own non-wave group — **the registration fee is visible, not silently dropped**.
- Σ (waves + non-wave) remaining = 193,099,000 + 1,131,700 = **194,230,700 DZD === the raw per-row INV-4 outstanding** — every dinar accounted for exactly once.

## The offline chain (the "Engine → Frontend" half)

`t-447-rendering-engine-parity.test.tsx` (6/6): the RENDERED DOM of both surfaces carries the engine's exact numbers; `t-447-pooled-waves.test.ts` (16/16): the Finance view model === the canonical pool (fixtures); `t-447-statistics-tooltips.test.tsx` (12/12): the bilingual glossary; `t-447-audit-remediation.test.tsx` (4/4): the audit fixes. The unified runner: **BASELINE-MATCHED, NO new regressions** (4,567 passed / 17 documented).

## Verdict

The complete chain — **Source Data → Domain Engine → Frontend** — is verified on the real corpus and in the deterministic suites: the canonical pooled derivation produces the raw stored sums exactly; the two surfaces consume ONE derivation; the mandate's identity holds to the dinar; no category is silently excluded; the FI is visible; the tooltips are bilingual and wired. **STATS-401 / UI-325 / STATS-402: RESOLVED-TESTED + LIVE-VERIFIED (read-only).**

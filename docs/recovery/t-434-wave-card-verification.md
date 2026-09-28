# T-434 — The owner's two wave-card questions: the live verification + the échéance visibility fix

**Task ID:** T-434 (the 113th session, 2026-09-28) · **Problems:** DATA-050 (the surface-swapped DATA-049 example values), UI-316 (the wave cards' missing due-date display)
**Status:** DONE — VERIFIED (read-only against the live DB; zero data changes; the live DB remains the T-433 oracle-verified state: 741/1,137/5,956/2,198/3,342, Encaissé 162,713,000 DZD, chain head 0126).

---

## 1. The owner's questions (verbatim)

> Why is Finance showing **75% for the first tranche**, while Statistics is showing **77% for the first tranche**?
> And why is the **first tranche showing red**? Is that correct, even though the tranche is **not due yet**? I think there is still time before the due date, no?
> I am not sure whether this is actually part of the system's intended behavior or whether it is working correctly. I may simply have the wrong idea, so please verify it against the actual business logic and implementation.

## 2. The method (read-only, the app's own code over the live rows)

`elimtiyaz-desktop/scripts/t-434-wave-reconciliation-probe.ts` — the REAL Statistics derivation (`executive-statistics.ts`'s `deriveTrancheWaves`, the WaveVelocityCard's input) and the REAL Finance derivation (`installment-schedule-tab.tsx`'s `deriveTrancheWaves`, the strip's input), both run over the REAL live collection (the service-role REST client, keyset-paginated, the t-425 probe convention; the headless window/localStorage shims follow the t-433 driver convention). Plus two SQL censuses through the Management-API SQL endpoint (AGENTS.md §11.1): the per-(category, tranche) census and the settled/overdue census, and the verify_t-432.sql C6 reconciliation query re-run.

## 3. Q1 — the 75/77 pair

**The verdict: both surfaces are CORRECT on their documented bases, and the app's two numbers are the OPPOSITE assignment of the owner's report.**

| Surface | Basis | The live T1 number | The math |
|---|---|---|---|
| **Statistics — Vélocité par Vague** | scolarité isolée (tuition only) | **75 %** | 83,600,400 / 111,758,300 |
| **Finance — Tranches strip** | toutes catégories (tuition + transport) | **77 %** | 95,279,400 / 123,748,300 |
| The bridge | the strip's "dont scolarité : 75 %" line | **= the Statistics number** | character-identical formulas (T-432) |

Why they differ: **transport T1 is 97 % collected** (11,679,000/11,990,000) — pooling it with tuition T1 (75 %) pulls the pooled rate UP to 77 %. The two surfaces intentionally measure different things (the T-424 one-canonical-math unification: one derivation, two presentation scopes); the T-427 basis labels + the T-432 reconciliation line make the pair legible at a glance.

**The DATA-050 discovery (the documentation defect):** the T-432 session's docs — and the owner's original console report — pinned the pair as "Statistics (scolarité) = 77 % / Finance strip (pooled) = 75 %". That attribution is **surface-swapped** vs the live rows:

- The T-425 census table (recorded 2026-09-27, BEFORE T-432 ran): tuition T1 Σpaid = **83,600,400** → 75 %. The T-433 re-import reproduced the identical value (the same workbook, the same engine).
- The C6 census (verify_t-432.sql, run live by T-433): wave-1 **tuition=75 % pooled=77 %** (rows=1,606, families=741).
- The count-based clearance rate (tuition T1 = 30 % soldée, 340/1,134) rules out the dossier-count basis as the "77"'s source.

The pair has been 75 (scolarité) / 77 (pooled) continuously since the T-425 re-import. The owner's report almost certainly transposed the two numbers between the surfaces (two numbers, two surfaces — an easy transposition), and the T-432 session relayed the reported attribution into its docs without re-deriving it (its C6 script was authored but owner-gated — never run that session; the never-run-layer class again). **What the owner's app shows TODAY (current build + live data): Finance T1 = 77 %, Statistics T1 = 75 %** — if the owner sees Finance 75 / Statistics 77, the app is a stale build or a pre-T-433 cached view (the standing "packaged-app pass" gate: pull main + rebuild).

**Corrected in this session:** the `tuitionPct` code comment (installment-schedule-tab.tsx — now cites the verified pair), this registry/change-log record, and the correction note at t-432-live-verification.md's header. The historical T-432 sections in change-log/current-state/next-task are left as-written (append-only history; DATA-050 is the authoritative correction).

## 4. Q2 — the red "En retard" on Tranche 1

**The verdict: the red is CORRECT behavior. The first tranche's due date is September 15, 2026 — 13 days past at the report date — and 548 families still owe on it.**

The live due dates (the t-434 probe, every wave):

| Wave | Due date | Phase (live) | Unpaid rows | Owing families | Remaining |
|---|---|---|---|---|---|
| tuition T1 | **2026-09-15** | **overdue** | 794 | **548** / 739 | 28,157,900 DZD |
| tuition T2 | 2026-12-15 | not_due | 915 | 0 "en retard" (519 "à échoir") | 75,807,800 DZD |
| tuition T3 | 2027-03-15 | not_due | 937 | 0 | 79,522,300 DZD |
| transport T1 | **2026-09-15** | **overdue** | 22 | 19 / 315 | 311,000 DZD |
| FI (tranche 0) | 2026-09-15 | (a fee — not a wave; renders in the échéancier only) | 58 | 45 | 1,131,700 DZD |

The phase rule (T-424/T-427, the canonical `deriveTrancheWaveStats`): a wave is **overdue** when ANY unpaid, still-owing row's due date is strictly past `now` — true for T1 (Sept 15 < Sept 28). T2/T3 correctly render "En cours" (blue) with "Familles à échoir" — the system does NOT paint future waves red.

The owner's "there is still time before the due date" belief: the **old pre-T-425 schedule** put the first versement in December (the deleted BON receipt template's "2ème TRANCHE" labeling — §15.65a). The owner confirmed the official schedule in T-425: **FI + V1 (Sept 15) + 2V (Dec 15) + v3 (Mar 15)**. Under the official model there is NO "still time" for T1 — it was due 13 days ago.

**The UI-316 gap this exposed (the fix):** the Statistics wave card showed the red "En retard" verdict with NO visible due date (the subtitle carried only "Rentrée & Inscription (Sept)"; the Finance strip's "échéance 15 sep" was a hover-only tooltip). A verdict without its visible cause generates exactly this kind of owner report even when the verdict is correct. **Fixed (presentation-only):**

- Every Statistics tuition wave card now renders its échéance line: "Échéance : 15 sept. 2026 — 13 j de retard" (red, overdue + uncollected) / "Échéance : 15 déc. 2026 — dans 78 j" (muted, future waves) / the bare date on closed waves (a closed wave never claims lateness).
- The auxiliary transport waves carry "échéance <date> · en retard" when past due.
- The Finance strip's échéance hint is now VISIBLE text on every card (the tooltip kept).
- The days use the canonical `daysBetweenFloor` (T-284/T-285: a wave due TODAY is 0 days late, never 1).

## 5. The invariants (the probe's fail-loud gates — ALL GREEN)

- **I1** — the reconciliation: the strip's `tuitionPct` == the Statistics `collectedPct` for every wave (character-identical).
- **I2** — the two T1 numbers are the two different bases over the same canonical rows: Finance (pooled) = 77 %, Statistics (scolarité) = 75 %.
- **I3** — the phases match the live due dates: T1 overdue (due 2026-09-15 < now), T2/T3 not_due; a T1 due date in the future would FAIL the probe (the guard against a wrong red).

## 6. The gates

- The t-434 probe: **ALL INVARIANTS GREEN** (live, read-only).
- The t-434 suite: **7/7** (`src/tests/ui/t-434-wave-due-date-visibility.test.tsx`).
- tsc --noEmit: **0 errors**. eslint on every changed file: **0 errors** (4 pre-existing warnings, none on changed lines).
- The t-427 / t-424 / ai-review suites: unchanged (the ai-review 3 failures = the documented baseline set).
- FULL vitest: **4,240 passed / 18 failed / 5 skipped** — the count is the 4,233-baseline + the 7 new tests; the failing-SET deviation (t-390 passed, t-415 file-level failed) is the environment-flaky swap, **proven identical on the clean tree** (git stash → same result → pop): NOT caused by this change.
- Zero data changes, zero migrations (the chain head remains 0126; the live DB untouched).

## 7. What remains / the owner-facing note

- The owner's **packaged-app pass** (pull main + rebuild) now lands THREE legibility improvements together: the "dont scolarité" reconciliation line (T-432), the échéance lines on every wave card + the strip (T-434), and the corrected expectations (Finance T1 = 77 % pooled / Statistics T1 = 75 % scolarité — the OPPOSITE assignment of the original report).
- The standing queue is unchanged (SPREAD-100, the 6 override families, ACAD-511, migration 0122, the T-429 cross-platform ports, the 18-failure environment-class baseline).

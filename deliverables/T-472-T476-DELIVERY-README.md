# T-472..T-476 DELIVERY — the 138th session (2026-10-04)

**The mandate (the owner's session request):** T-472 (the TEST-503 systemic hermeticity fix) · the PARITY-010 owner ruling ('unpaid' vs 'pending') · the device smoke of the four new surfaces · the Android mirrors · the standing queue — plus two UI mandates (the class-roster student multi-select · the Inspection-button consistency sweep) — with push-and-merge after each commit and conflict care against the concurrent agent.

## The five tasks delivered (each branch-per-task, merged --no-ff, pushed per ADR-028)

| Task | What | The evidence |
|---|---|---|
| **T-472** | The TEST-503 systemic fix: the Vitest seam disables the f39eb17 canonical-production fallback in `supabase-client.ts` — the default test environment is UNCONFIGURED MOCK MODE (T-314's contract, enforced at the module); the pin-per-suite escape hatch documented; the NEW source-scan guard (zero violations at delivery) | Before 4 675/0/5 → the blast-radius census (exactly ONE suite — t-393, pinned) → after **4 680/0/5** + the unified runner GREEN; the baseline moved in the same commit; `docs/recovery/t-472-hermeticity-verification.md` |
| **T-473** | The PARITY-010 owner ruling: **ADR-033 settles 'unpaid'** (the TS engines were the drift; the SQL RPC was already correct — no migration, no live-apply) + the corpus re-pins + financial-rules.md §8 | The five re-pinned suites 86/86; the battery byte-identical 4 680/0/5; **the tier-4 mirror equivalence held at 784/820 with 0 rows** (both engines changed in lockstep) |
| **T-474** | The owner's class-roster mandate: the student multi-select on the class creation AND edit surfaces — the ONE shared `ClassStudentMultiSelect` (search + grade eligibility + the permissive toggle + the current-class badges) wired to the EXISTING `updateStudent(classId/null)` seam with strict per-student error collection | The suite 10/10 (the eligibility contract · the create wire · the edit two-direction diff with the STORE round-trip · the partial-failure honesty · the source guard); the battery 4 690/0/5 |
| **T-475** | The owner's Inspection-button mandate: ONE canonical trigger design app-wide (the compat twin DELEGATES to the core — one styling implementation; h-7 / text-xs / the nowrap+truncate guards / the full interaction-state set; the dashboard cards normalized; the backup tab aligned) — UI-only, zero behaviour change | The suite 9/9; the inspector's existing suites 17/17; the battery 4 699/0/5 |
| **T-476** | The ADR-033 port to the REAL Android Kotlin engine (the registered cross-repo follow-up) — `reevaluateInstallmentStatus`'s future-due branch → 'unpaid'; the two Kotlin pins re-pinned | The provisioned JDK 21 + SDK 35 toolchain; BEFORE 9/9 + 11/11; AFTER both GREEN with the re-pinned assertions; the equivalence corpus 1/1; **the FULL Android suite 709/0/1 — byte-identical to the documented baseline** |

**The four-surface device-smoke evidence** (the standing-queue item): `docs/recovery/t-466-t469-device-smoke-evidence-138th-session.md` — the automated half 48/48 (t-466 · t-467 · t-468 · t-469); the eyeball half documented for the owner's five-minute pass (what to look at, including this session's T-474/T-475 additions).

## The final state

- **The hub battery:** 4 699 passed / 0 failed / 5 skipped (272 files) — three registered baseline moves, each in the same commit as its change (§15.84c).
- **The Android suite:** 709/0/1.
- **The tier-4 mirror equivalence:** held at every step (0 rows).
- **PARITY-010 closed on all four implementations** (the SQL RPC · the desktop TS engine · the TS Kotlin mirror · the REAL Kotlin engine).
- **TEST-503 closed** (the test env can no longer reach production by default — and any explicit pin is visible in the diff and the source-scan guard).
- **Concurrent-agent safety:** every merge ran after a fresh `--prune` fetch with a zero-behind check; five separate small branches (new files wherever possible; minimal hunks in shared files; nothing rebased).

## What is left (the next session's queue)

- The standing queue: SPREAD-100 · the 6 override families · ACAD-511 · migration 0122 (reserved) · the TECHDEBT-100 family.
- The remaining Android-mirror divergence notes (manual-debt creation, the amount band, the inspector modes, the t-470 clock discipline) — each its own session.
- The owner's five-minute eyeball pass (the documented gate).

## The zips

- `AgentGithubUplaod-T472-T476.zip` — the hub tree at the session's tip (the docs, the desktop source, the migrations; node_modules as the documented empty placeholder).
- `elimtiyaz-android-T476.zip` — the Android tree at `75377c7` (the ADR-033 port included; no build outputs, no local.properties).

Restore: unzip, `cd elimtiyaz-desktop && npm ci && npm test` (expect Layer 0 tsc 0 · Layer 1 4 699/0/5 BASELINE-MATCHED · Layer 2 GREEN · verdict GREEN). For the Android tree: provision JDK 21 + the Android SDK (platform 35), `./gradlew test` (expect 709/0/1).

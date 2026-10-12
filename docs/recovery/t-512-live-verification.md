# T-512 Live Verification — the issue #27 root-cause forensics (UI-341)

> **Task:** T-512 (the 160th session, 2026-10-13; renumbered from the drafted T-510 per §15.43 — the concurrent issue-#31 session owns T-510, the issue-#30 session owns T-511)
> **Problem:** UI-341 — [Pedagogy] Student Registration Count Is Always One Less Than Expected (GitHub issue #27)
> **Method:** READ-ONLY live forensics against the owner's Supabase (`vebfehrpzajhstyhinnw`, eu-west-1) through the data gateway (PostgREST, service-role key from the environment — §15.77: data-gateway-first, never the management token). Zero mutations. Two probe scripts committed: `scripts/t512-issue27-live-probe.py` (the histogram census) and `scripts/t512-issue27-audit-trail-probe.py` (the audit-trail reconstruction).
> **Run:** 2026-10-13 (UTC) — the probes are re-runnable read-only.

---

## A. The investigation order (the issue's own mandate)

The issue asked to "trace the complete frontend-to-persistence registration workflow" and identify whether the missing student is "omitted before submission, rejected during processing, or saved but not reflected in the UI". The verification followed that order:

1. **The persistence loop** — proven COMPLETE in jsdom E2E through the real component tree (the `t-512-issue27-multi-student-count` suite): N clicks → exactly N `updateStudent` wire calls → exactly N store rows, for N = 1, 2, 4, 8. Nothing in the loop, the repository, or the RPC drops a student.
2. **The read/display side** — proven CLEAN by the live histogram census (§B below): the per-class displayed counts (`enrolledCount`) match the persisted rows at the current scale; the roster list derives from the keyset-paginated students cache (the T-423 repair).
3. **The selection** — THE defect, caught by the live audit-trail reconstruction (§C): the missing student was never IN the submit-time selection. The click raced the in-flight batch.

## B. The live histogram census (`scripts/t512-issue27-live-probe.py`)

| Probe | Live result |
|---|---|
| students rows (all, incl. soft-deleted) | 1,137 |
| students rows (`deleted_at IS NULL`) | 1,137 (no soft-deleted rows) |
| students with `class_id` set | 10 |
| rows visible to the repository's UNPAGINATED histogram query (first 1,000) | 10 — **no PostgREST 1,000-row cap bite** (the §15.62/§15.63 class does not fire at the current 10-row scale) |
| soft-deleted students still carrying `class_id` | 0 — **no overcount either** |
| per-class counts (capped histogram vs. true full keyset walk) | identical for every class (`+0` delta across the board) |

**Conclusion:** the read path displays the truth. The `SupabaseClassRepository.refresh()` histogram remains unpaginated and unfiltered by `deleted_at` — a LATENT drift risk registered below (§E), not the issue #27 cause.

## C. The audit-trail reconstruction (`scripts/t512-issue27-audit-trail-probe.py`) — the smoking gun

The owner's own 2026-10-12 **10:32–10:35** session survives in `audit_logs` (the students-table UPDATE trigger writes one row per write, with full before/after JSON). Reconstructed in order:

| Time (UTC) | Class created | Student writes observed | Currently in class | The one-less reading |
|---|---|---|---|---|
| 10:32:52 | « Benali » (prescolaire_1, test-labelled code `…DOSSIERDETEST45…`) | **0** | 0 | 1 selected → **0 registered** |
| 10:33:53 | « Khelifi » (prescolaire_2, `…TÂCHEDETEST75…`) | **3** (HIRECHE, IZLI, KACIMI — ~0.3–0.7s apart) | 3 | 4 selected → **3 registered** |
| 10:34:22 | « Bouzid » (prescolaire_2, `…ÉPREUVEDETEST71…`) | **4** (AIT, AKHAL, ARZKI, AITHAMOUDA) | 0 (moved on) | 5 selected → **4 registered** — **ELV-2026-D0AE2E (ALAA ATMANI) never received a write** |
| 10:35:26 | « Préscolaire 02 - Section A » (prescolaire_2) | **5** (the same four + ATMANI, alphabetical order) | 5 | 5 selected → **5 registered** — the clean retry (the operator waited for the modal to close) |

**Three consecutive one-less reproductions, then a clean run** — the signature of a race, not a counting bug. The per-write timestamps (~0.7s apart) are the sequential `updateStudent` HTTP round trips; the write ORDER equals the selection Set's insertion order (the operator's check order — Bouzid's order AIT, AKHAL, ARZKI, AITHAMOUDA shows they went back for a missed row, exactly the interaction that opens the race window).

**The mechanism (proven against the code):** the modal's submit handler iterates the CLICK-TIME closure selection while the loop runs; the `UnifiedModal`'s `internalLoading` disables the submit button and blocks closing — but the CHECKBOXES stayed interactive. A check during the in-flight window updates the badge (visual acknowledgment) but never joins the running loop; the modal-close selection reset wipes it. In the create modal the window was WIDER: `setSubmitting(false)` ran right after `createClass`, before the student loop.

## D. The fix and its verification

**The fix (commit `aac46bb5`, rebased to `75d5f7f4`/`36fc8744` chain):** the picker is DISABLED while the batch runs (`ClassStudentMultiSelect.disabled` — checkboxes, select-all, grade filter, search); the create modal's `submitting` spans the WHOLE batch (try/finally) and drives the disabled prop; the edit modal's roster diff is snapshotted before the first await and its picker disabled via `submittingClassEdit`. The persistence seam (`updateStudent(classId)`) is untouched — §6's reuse rule.

**Verified:** (a) `t-512-root-cause-race.test.tsx` — after submit the checkboxes are disabled; the batch writes exactly the click-time selection; the idle experience is unchanged; (b) `t-512-issue27-multi-student-count.test.tsx` — 1/2/4/8 register exactly; the members+additions diff; the create flow; the count-vs-records invariant; (c) t-474 10/10 and t-370 15/15 unchanged; (d) the FULL unified battery **5,093/0/5 BASELINE-MATCHED** (306 files — the TRUE combined count with the concurrent T-510/T-511 sessions, CONFIRMED by the post-rebase run); Layer 2 all equivalence layers matched; (e) this live forensics (read-only, re-runnable).

**The VERIFIED gate (open):** the owner's eyeball pass — create a class with 4+ students selected (the picker freezes while the batch runs; the toast reports the full count), edit a roster mid-year (the same freeze), reload, and confirm the roster list and the class card count agree with the persisted rows.

## E. New discoveries registered (the persistence obligation)

1. **The in-flight interactive-modal race class (→ AGENTS.md §15.96):** a modal whose submit runs a multi-step async batch must disable EVERY state-changing control for the batch's duration — not just the submit button. The badge-acknowledged-then-discarded click is the silentest data-loss shape: no write, no error, no toast.
2. **The audit trail as the reproduction environment:** when a UI race is reported, the per-write audit timestamps + entity order reconstruct the operator's exact session (including the selection order) and separate "the loop dropped it" from "the selection never contained it". The live DB IS the reproduction environment for races that jsdom cannot time.
3. **The jsdom limitation:** `fireEvent` on a disabled control still fires React's onChange in jsdom (disabled semantics are a real-browser activation behavior) — pin the disable contract via the `disabled` attribute, never via a no-event assertion.
4. **The test-isolation guard for sequential-async-write suites:** poll the shared mock store for quiescence in afterEach AND wait for the modal to close (the batch's completion signal) before the next test — a test that ends when the last wire call merely STARTED leaks the remaining in-flight writes into the next test.
5. **The latent histogram drift (registered, NOT the issue #27 cause):** `SupabaseClassRepository.refresh()`'s enrolled-count histogram is unpaginated (the §15.62 1,000-row cap class) and unfiltered by `deleted_at`. At the current live scale (10 class-bearing students) it is exact; the day the roster grows past 1,000 class-bearing rows (or soft-deleted rows carry stale `class_id`s), `enrolledCount` will drift. The fix is the T-423 keyset pattern + the `deleted_at IS NULL` filter — a one-place repair when the scale demands it.
6. **The concurrent-session renumber chain:** this session drafted T-510 BEFORE fetching; the concurrent issue-#31 session had already registered T-510 (and the issue-#30 session T-511) on the remote. The §15.43 renumber rule (coordinate, don't duplicate) resolved it to T-512 — but the lesson is to FETCH AND READ THE TASK REGISTRY BEFORE DRAFTING THE TASK ID, not after.

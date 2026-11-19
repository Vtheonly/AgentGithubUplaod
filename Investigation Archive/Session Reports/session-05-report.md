# Session Report — Session 5 (2026-11-19)

**Branch:** `investigation/session-05` (branched from `main` @ `d082ad84`, clean tree; incremental commits pushed after every unit; merged to `main` at close). **Mode:** read-only — zero application source, configuration, schema, or dependency changes. **Trigger:** the recurring full-codebase audit sweep (Job 537451), continuing per `Handoffs/handoff-session-05.md`.

## Gate check at start

- Repo synced with `origin/main` (`git fetch --all --prune`; clean tree; HEAD = the Session 4 merge).
- **Issue #32 re-checked for owner activity: zero comments, no timeline events, body unchanged since 00:06Z.** The owner has NOT answered D-1..D-12 → per the packet's own rule and the handoff, the ⏵ proposed defaults govern from Session 5 onward, and Lane A remains preparatory (no code sessions without an explicit green-light). This session therefore executed Lane B (unblocked verification), Lane C (infra re-test), Lane D (register upkeep), and the Lane A/B2 staging items.

## Work performed (in order)

### 1. Infrastructure re-test (Lane C; the sweep charter's STEP 5) — commit `c2613d1f`

Ten-probe GET-only set mirroring S4 §3.2 (tokens in-memory only; masked output; probe script outside the repo). Results: **OPS-011 persists exactly** — REST root + `students` probe with the secret key → 402 `exceed_egress_quota`; publishable key → 401 key-type gate; JWKS → 402; auth-health → 402 with BOTH keys; management token → 401 invalid; Firebase GCIP → 400 `CONFIGURATION_NOT_FOUND` (format-valid, functionally unverified); pooler TCP :6543/:5432 open; GitHub PAT → 200 with push. Vercel PAT not re-tested (out of session scope; S4 verdict carries). Deliverable: the standing **`01-INFRASTRUCTURE-STATUS.md`** the sweep charter mandates (per-run verdict table + masked probe detail + cumulative credential scorecard).

### 2. Full vitest census + the t-502 verdict (Lane B1; open question 3 RESOLVED) — commit `4e2c1708`

- Method discovery: background processes do NOT survive tool-call boundaries in this sandbox (a first background attempt died silently); the suite was completed as **ten foreground `--shard=i/10` runs** (~10.5 min wall on 2 cores), aggregated from the ten JSON reports.
- **Result: 321 test files — 320 passed, 1 failed — 5,270 passed / 1 failed / 5 skipped.** Baseline deviation ledger: +1 file (`t-546-clair-epure-tooltips-latex.test.tsx`, commit `eba7f4c5`), +29 tests; the failing set deviates by exactly ONE entry, the known t-502.
- **t-502 root-caused at source (BUG-038):** `deriveTrancheWaves` (`src/features/financials/installment-schedule-tab.tsx:228-231`) has no clock parameter and hard-codes `Date.now()` at `:246`, while the parity test pins `NOW = 2026-10-11` and injects it into the other two surfaces (pooled; Statistics — verified accepting `nowEpochMs`). The test compares different instants: green by accident through 2026-10-15, **deterministically red from 2026-10-16 onward** (onset arithmetic recorded). Failure reproduced this session (1 failed / 7 passed) before the root-cause read.
- Session 1's interpretation ("corroborates the DUP-016/BUG-012 parallel-predicate family") **withdrawn (C-9)** — the surfaces agree at a common instant; the defect is clock-injection asymmetry (hermeticity), not predicate divergence. Fix path registered (optional `nowEpochMs`, T-549 draft); execution scope, not this session.
- Deliverable: **`Testing and Runtime Evidence/S5-VITEST-CENSUS-2026-11-19.md`** + RUNTIME-EVIDENCE Session 5 addendum.

### 3. LF-0 prep censuses (Lane B2 items 1-2) — commit `536752b9`

A quote/comment/dollar-quote-aware SQL tokenizer (single-quote `''` escapes; `$tag$` AND `$$` bodies; `--`/`/* */`) was written and run over all 152 migrations:

- **The untouched-27 re-derived EXACTLY** (C-1 re-verified): 100 static non-temp chain tables, 73 `.from()`-touched, untouched = the S4 list incl. `receipts`. Census-method footnote: a strings-stripped regex admitting `CREATE TEMP TABLE` finds 28 (`_t105_corpus`/`_t105_map` are in-migration-0063 temp tables, not live chain).
- **NEW: the per-table writer map** — for each of the 27: policy files, migration SQL-writer files, `CREATE TRIGGER ON` files, edge-function references; grouped into five writer classes (RPC-body / trigger-maintained / edge-function (service-role, server-origin) / seed-config / platform-origin) and distilled into **the RPC-read checklist** the LF-2 extraction script consumes (which tables are pure SELECT, which need trigger-derived-column verification, which are server-origin and must NOT be desktop-extracted).
- **`auth.uid()` at exact precision (correction C-8):** ARCH-035's "89" was a comment-stripper artifact; the exact tokenizer gives **69 executable refs** (41 static policy expressions + 28 function bodies; 0 dynamic-SQL policy refs — all 324 policies are static code) plus 21 non-executable (18 comments + 3 `COMMENT ON FUNCTION` literals). **Shape census:** zero policies read JWT beyond uid; the `service_role` branch points (`auth.jwt() ->> 'role'`) and the `request.jwt.claims` direct email readers (0120:537, 0121:486) live in 17 function-body files. **The GUC-shim requirement list** written directly from this evidence (shim must own `auth.uid()`/`auth.jwt()`; claims must carry `sub`/`role`/`email`; queued ops must record their claims snapshot).
- Deliverable: **`Local-First Architecture/LF0-PREP-CENSUS-2026-11-19.md`**.

### 4. ADR-002/004 supersession drafts (Lane B2 item 3) — commit `22d025b1`

Both drafts written in the repository's exact ADR format (Status/Context/Problem/Decision/Alternatives/Consequences/Affected Components/Related/Verification), staged in `Local-First Architecture/` for LF-0 **verbatim adoption** (adoption procedure spelled out: next free number, real date, pointer-lines). ADR-002S: the canonical financial engine's location inverts to the local PGlite transaction, bodies byte-identical, TS engine stays the reference mirror, RLS re-homed not dropped (324 policies + GUC shim). ADR-004S: locally-authoritative sequential receipts, `receipt_sequences` counter, relay block-sequencing for multi-installation (D-1-gated), provisional references finalized at replay (generalizing ADR-004's own Android note), migration watermark seed. Mutually consistent by construction; both cite the graduated BLUEPRINT/ROADMAP rows.

### 5. T-number registration drafts (Lane A prep) — commit `27332e4c`

**T-549..T-554** drafted in the repository's `## T-NNN` registry format (next free after T-548), staged so the execution session can register verbatim: T-549 (BUG-038 fix lane — executable independently of the green-light), T-550..T-553 (LF-0: ports as interfaces + `satisfies` proof → hard-lock removal → route the 16 bypass files → ADR adoption), T-554 (LF-1 spike scoping: Windows packaging, t-368-scale perf corpus, 324/324 policy-parse harness). Each with problem refs, scope, verification commands, and the AGENTS §14 five-question commit discipline. `docs/recovery/task-registry.md` itself was NOT touched (read-only regime).

### 6. Register upkeep (Lane D) — commit `f3d9d705`

FINDINGS_INDEX: header → Sessions 1-5; **+BUG-038** (V, High); **+corrections C-8** (ARCH-035's 89→69 executable) and **C-9** (S1 interpretation withdrawn); **+C-1 re-verification row**. SESSION_LOG: row 5; open question 3 struck through RESOLVED with the verdict. README: structure table +5 rows; current-state paragraph rewritten (S5 lane closed; owner-gated items now led by "the execution green-light").

## Verification of this session's own claims

- Every count in this report was produced by a command run this session (probe script output; vitest JSON aggregation; the tokenizer census) — no number is carried from memory.
- The root-cause chain was read at source in BOTH directions: test line 159 (no clock passed) ↔ adapter line 246 (`Date.now()` hard-coded) ↔ domain signature (clock param exists) ↔ Statistics signature (clock param exists).
- The 27-table list was compared name-by-name against the S4 C-1 record.
- `git status` after every commit contained only `Investigation Archive/` paths (verified again at close).

## What this session did NOT do (and why)

- No code changes (the recurring sweep's charter + the owner's silence on D-1..D-12 keep the read-only regime; Lane A stays preparatory).
- No live-DB census (OPS-011 — the cap has never been lifted; 3-run-stable).
- No Layer-2 equivalence runs (`npm test` unified runner exceeds the per-command budget; noted in the census doc).
- No Android parity work (sibling repo absent — Lane C2 unchanged).

## Session 5 verdict

The unblocked-verification program from handoff-session-05 is now **fully discharged**: Lane B1 (vitest census + t-502) done; Lane B2 (the two censuses + ADR drafts) done; Lane C (infra re-test) done; Lane D (registers) done; Lane A staging (T-number drafts) done. Every remaining work item is **owner-gated** (execution green-light, D-answers, cap lift, credential rotations) or **environment-gated** (Android repo) — see `Handoffs/handoff-session-06.md`.

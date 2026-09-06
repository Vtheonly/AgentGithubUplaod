# AGENTS.md — El-Imtiyaz System Operating Manual for AI Coding Agents

> This is the **primary persistent operating manual** for every AI coding agent (Claude, Codex, Copilot, or human) working on any part of the El-Imtiyaz system. Read this file before touching any repository. It is the entry point into the project's documentation and control system, which lives in `docs/` in this repository.

---

## 1. What this project is

El-Imtiyaz is a school-management platform for a private school (El-Imtiyaz, Boumerdès, Algeria), replacing a legacy Excel workbook (`Suivis clients 2026_2027.xlsx`, at the root of this repository). The product domain covers:

- **CRM**: parents (clients) and students, with identity codes (`PAR-…`, `ELV-…`) and activation codes for parent portal access.
- **Financials**: installments (tranches), payments, waterfall allocation, balances, discounts, refunds, receipts, debt tracking, reconciliation — amounts in DZD.
- **Academics**: classes, subjects, assessments, grades, bulletins (report cards), attendance, homework, year-end promotion.
- **Workforce/operations**: personnel, departments, chat, schedules, expenses, suppliers, workflows (partially implemented — see the problem registry).

The system is **multi-platform**: three repositories form ONE application. They share a single Supabase backend (PostgreSQL + RLS + SQL RPCs + Edge Functions + Realtime).

## 2. Repositories that belong to the system

| Repository | Role | Contents |
|---|---|---|
| `Vtheonly/AgentGithubUplaod` (**this repo**, the hub) | Desktop staff application **and the canonical backend** | `elimtiyaz-desktop/` (Electron + React + Vite app), `elimtiyaz-desktop/supabase/` (**the canonical migration chain 0001–0057 and the canonical Edge Functions**), `elimtiyaz-desktop/financial-tests/` (cross-platform equivalence suites — INSIDE the desktop module, not at the repo root; corrected 2026-08-29 during T-081 after the Android equivalence harness documented the wrong path), legacy Excel workbook, and **this documentation system** |
| `Vtheonly/elimtiyaz-android` | Android staff application (offline-first) | Kotlin + Jetpack Compose app (`app/`), Room database (primary local store), sync queue. (Its stale partial `supabase/` copy was REMOVED in T-048, 2026-08-31 — this repo owns the only chain.) |
| `Vtheonly/elimtiyaz-website` | Parent web portal (Next.js) | `src/` (Next.js 16 app), `supabase/functions/` (2 Edge Functions — drifted partials, see T-028/T-036). (Its 4 portal-patch migrations were REMOVED in T-048, 2026-08-31 — this repo owns the only chain.) |

Each client repository has its own `AGENTS.md` describing that codebase. This `AGENTS.md` is the **system-level** manual.

## 3. How the repositories relate

- **One backend, three clients.** All clients talk to the same Supabase project. The desktop repo owns the backend schema: its `elimtiyaz-desktop/supabase/migrations/` chain (0001–0057) is the only complete, canonical chain (ADR-001). The website and Android repos no longer carry migration copies at all (removed in T-048, 2026-08-31 — see their AGENTS.md pointers).
- **Canonical business logic lives server-side** in SQL RPCs (`collect_and_allocate_payment`, `revert_payment_allocation`, `mark_payment_cleared`, …) created by migrations 0034–0043. The desktop TypeScript engine (`src/domain/calc/`) is the reference client implementation; the Android Kotlin engine (`core/LedgerEngine.kt` etc.) is a mirror that must stay equivalent (ADR-002).
- **CURRENT reality (important):** the three platforms do NOT yet write through one path. The desktop calls SQL RPCs directly (with a dangerous silent fallback — see `BUSINESS-002`); Android writes to Room first and pushes via non-canonical `upsert_*_from_import` RPCs; the website is read-mostly. This divergence is catalogued in `docs/recovery/problem-registry.md` and must be understood before any change to financial write paths.

## 4. Architectural boundaries (summary)

Full detail: `docs/architecture/boundaries.md`. Source-of-truth registry: `docs/architecture/source-of-truth.md`.

- **Backend (Supabase: DB schema, RPCs, Edge Functions, RLS)** — authoritative business logic, validation, domain operations, tenant isolation, audit trail. Clients must not re-implement authoritative rules that the backend enforces.
- **Desktop** — staff operations client (financials, CRM, academics, workforce). Presentation + API consumption; must call canonical RPCs, never bypass them.
- **Android** — offline-first staff client. Local Room store is a working cache; server remains the system of record. TARGET: write through canonical RPCs when online (ADR-005 — proposed, not yet implemented).
- **Website** — parent portal. Read-mostly presentation layer; may submit absence justifications and activation codes. No financial writes.
- **Do not** move business logic into clients, weaken RLS to make a client work, or create a second implementation of anything the backend already owns.

## 5. Where agents must look before modifying code (in this order)

1. `docs/recovery/task-registry.md` — find your task and its dependencies; confirm nothing blocks it.
2. `docs/recovery/problem-registry.md` — read every problem ID your task references (full evidence and constraints).
3. `docs/audits/` — the raw audit reports behind your problem IDs (read-only archival evidence; full end-to-end traces and git forensics live here — see `docs/audits/README.md` for the ID mapping rules).
4. `docs/architecture/source-of-truth.md` — identify the canonical implementation for the concept you are touching.
5. `docs/architecture/system-map.md` and `docs/architecture/boundaries.md` — confirm the layer that owns the behaviour.
6. `docs/domain/financial-rules.md` / `docs/domain/academic-rules.md` — the canonical business rules (deterministic codes, waterfall, overdue, refund, reconciliation, attendance rate, …).
7. `docs/recovery/unknowns.md` — if your change depends on an open question, STOP; do not guess.
8. `docs/decisions/` — ADRs that constrain the design.
9. The code itself: search for existing implementations (see §6).

## 6. How to find existing implementations (Existing-Implementation-First rule)

Before writing any new function, endpoint, component, or SQL, search:

- Desktop: `rg "symbolName" elimtiyaz-desktop/src` — repositories live in `src/infrastructure/{supabase,mock}/repositories/`, domain rules in `src/domain/`, UI in `src/features/`.
- Backend: `rg "rpc_name" elimtiyaz-desktop/supabase/migrations` and `elimtiyaz-desktop/supabase/functions/`.
- Android: `rg "symbolName" app/src/main/java/com/example` — repositories in `infrastructure/local/`, engines in `core/`.
- Website: `rg "symbolName" src` — queries in `src/lib/hooks/portal-queries.ts`, canonical port in `src/lib/canonical/`.

Decide: **does this already exist?** If yes → reuse or extend it. Only create a new implementation with a documented architectural reason (and an ADR if it is significant). Most of this project's damage came from parallel implementations — see `DUP-001…005` in the problem registry.

## 7. How to check dependencies and consumers

- For any SQL function: `rg "function_name" elimtiyaz-desktop/supabase` (migrations may drop/recreate it later in the chain — check ALL migrations, not just where it was created).
- For any repository method: grep its call sites across all three repos before changing its contract.
- For any schema change: check all three clients' typed schemas (`src/infrastructure/supabase/types.ts` desktop, `src/lib/types/database.ts` website, Room entities + `SharedDtos.kt` Android).
- For any shared behaviour: check the other platforms (cross-platform rule — §10).

## 8. How to identify the source of truth

`docs/architecture/source-of-truth.md` is the authoritative registry. Rule of thumb: the **server-side SQL implementation** (migration-created RPC) is canonical for financial mutations; the **desktop TS engine** is the reference for read-side computations; **`homework`, `student_academic_histories`, `attendance_records`** (migration 0029/0041) are the canonical academic tables (not the legacy `homework_assignments` / `academic_history`). When the registry says `UNKNOWN`, the question is open — see `docs/recovery/unknowns.md`.

## 9. How to avoid duplicate implementations

- Never add a second implementation of a rule that exists (check §6 first).
- Never fork a file "temporarily" — the repo contains the fossils of at least four such forks (kotlin-mirror engine ×2, bind-activation-code EF ×2, four equivalence frameworks).
- If you port desktop logic to another platform, port it **verbatim** and record the source commit in the file header; divergent hand-copies are how `DRIFT-011` (five receipt algorithms) happened.

## 10. How to handle cross-platform changes

Before modifying behaviour that exists on more than one platform:

1. Identify which layer owns the behaviour (boundaries doc).
2. Identify the authoritative implementation (source-of-truth doc).
3. List every client that consumes it (all three repos).
4. Check API contract effects (RPC signatures, EF body keys, realtime filters) and DB effects (triggers, RLS, unique indexes).
5. Check whether equivalent tests exist on each platform (see `docs/testing/cross-platform.md`).
6. A change shipped to one platform only is a divergence — either ship to all, or record the divergence as a problem-registry entry.

## 11. How to run verification

| Repo | Type-check / lint | Unit & integration tests | Notes |
|---|---|---|---|
| Desktop (this repo) | `cd elimtiyaz-desktop && npm run typecheck && npm run lint` | `npm test` (vitest; includes cross-platform suites under `src/test/cross-platform/`) | Do not run `npm start` headlessly; it launches Electron |
| Android | `./gradlew lint` | `./gradlew test` (Robolectric + unit) | Equivalence test requires the desktop repo checked out as a sibling (`financial-tests/equivalence/scenarios`). **Toolchain in the container (20th session):** the system java is a JRE (no javac) — provision Temurin JDK 21 at `/home/z/my-project/jdk`; SDK 35 at `/home/z/my-project/android-sdk`; full recipe in `/home/z/my-project/scripts/android-env.sh` (re-runnable). **cmdline-tools URL quirk (22nd session):** bare `commandlinetools-linux-<V>.zip` URLs 404 from this container's network — use the `_latest` suffix variant (`commandlinetools-linux-11076708_latest.zip` → 200; current build readable from `dl.google.com/android/repository/repository2-3.xml`). **Secrets-plugin `.env` quirk: EMPTY values (`KEY=` with nothing after) — in `.env` OR in the `.env.example` defaults — are injected as BLANK Java literals (`SUPABASE_ANON_KEY = ;`) and FAIL compilation. Every key must be non-empty: fill `SUPABASE_ANON_KEY` with the publishable key (public identifier, ADR-009 dual acceptance). Never place service_role/sb_secret/sbp_ tokens in `.env`.** **ROOT-location subtlety (25th session, T-159 — android AGENTS.md §8.1):** the plugin 2.0.1 resolves BOTH files against the ROOT project — `app/.env` is NEVER read; the local `.env` goes to the repo ROOT next to `gradle.properties` (the committed root `.env.example`'s EMPTY key defaults are the blank-literal source). |
| Website | `cd elimtiyaz-website && npm run lint` | `bun run test` / `npm run test` (vitest) | `npm run build` must stay green |

Cross-platform financial equivalence: see `docs/testing/cross-platform.md`. Any change to financial or academic rules MUST run the equivalence suites and record the result in `docs/recovery/change-log.md`.

### 11.1 Live-Supabase verification (when credentials are available)

For backend / SQL / Edge-Function tasks, **live verification is required** to claim VERIFIED status (per §13 status flow). Since 2026-08-30 (seventh session), the live Supabase environment is wired up:

- The CLI binary is at `/home/z/my-project/bin/supabase` (v2.116.0). Add to `PATH` or invoke directly. (The container resets wipe it — re-download from the GitHub release if missing.)
- Link the project: `cd elimtiyaz-desktop && SUPABASE_ACCESS_TOKEN=<token> /home/z/my-project/bin/supabase link --project-ref hkvkefubghbbotgnteir`.
- Push migrations: `supabase db push --linked --include-all` (note: this command can take 2-5 minutes; use a generous timeout).
- Deploy an Edge Function: `supabase functions deploy <name> --project-ref hkvkefubghbbotgnteir --no-verify-jwt`.
- Run SQL queries against the live DB: `supabase db query --linked "<SQL>"` or `supabase db query --linked < scripts/verify_<task>.sql` (for multi-statement scripts). The **Management API SQL endpoint** (`POST https://api.supabase.com/v1/projects/<ref>/database/query` with the access token) is the curl-only alternative used by the `apply_XXXX_live.sh` scripts.
- Set a secret: `supabase secrets set <NAME>=<value> --project-ref hkvkefubghbbotgnteir` (note: this command can take 1-3 minutes; the secret IS set even if the command times out — verify via `supabase secrets list --project-ref hkvkefubghbbotgnteir`).

**Management-API SQL-endpoint quirks (live evidence, 19th session 2026-09-02):**

1. **`COMMENT ON` statements are silently DROPPED** — the endpoint returns success but
   `obj_description()` stays NULL (tested alone, inside `BEGIN;…COMMIT;`, and inside
   multi-statement payloads). DDL/DML in the same payload persists normally. Consequence:
   migration files' COMMENT statements never land on the live catalog when applied via
   this endpoint — they apply on fresh CLI deployments only. Do not "fix" this by
   re-running; treat catalog NULL comments as the documented live state (0065 is the
   first migration to record this explicitly).
2. **Single big queries can return empty** — fetch large result sets in small batches
   (names first, then per-batch definitions) and retry on empty responses.
3. **Multi-statement payloads run in ONE session** — temp tables + `BEGIN;…ROLLBACK;`
   wrappers work as expected (this is what the verify-script convention relies on).
4. **`/v1/projects/<ref>/users` does not exist as a REST path** (returns
   `{"message":"Cannot GET …"}` — 20th session, 2026-09-02). The auth-user
   census must go through the SQL endpoint:
   `SELECT email, … FROM auth.users` (see `scripts/verify_t-122_mig_tokens.sh`
   for the working pattern). Do not "fix" a census script by retrying the REST
   path — it is simply not part of the Management API.

**Management-API SECRETS endpoints (30th session, 2026-09-05 — live evidence):**

5. **`PATCH /v1/projects/<ref>/secrets` and `PUT` both 404** ("Cannot
   PATCH/PUT …") — the direct secrets-write endpoints are gone. Write Edge-
   Function secrets with the **Supabase CLI** (`supabase secrets set
   NAME=value --project-ref <ref>`), which still works; the call can take
   1–3 min and may TIME OUT with the secret already set — verify with a
   live behavior probe (e.g. the CORS preflight for ALLOWED_ORIGINS), never
   trust the CLI's exit code alone.
6. **`GET /v1/projects/<ref>/secrets` returns MASKED DIGESTS** — the
   `value` field for secret-type entries is a 64-hex digest, NOT the stored
   value (only non-secret `type: string` entries come back in clear). Never
   build merge logic on the GET response — probe the live behavior instead
   (`elimtiyaz-desktop/scripts/update_allowed_origins.sh` now models this
   pattern: probe → merge-only → CLI write → re-probe).
7. **`storage.buckets` cannot be mutated via SQL** — `delete from
   storage.buckets` raises "Direct deletion from storage tables is not
   allowed. Use the Storage API instead." (the `storage.protect_delete()`
   trigger). Remove buckets via `DELETE /storage/v1/bucket/<id>` with the
   service key (see `scripts/apply_0079_live.sh`).
8. **Admin-API user creation can be rate-limited transiently** — repeated
   create/delete cycles of test users return error payloads (KeyError-class
   in scripts) while a fresh email succeeds seconds later. Round-trip
   harnesses must wait ~20–30 s between runs and clean profiles BY EMAIL
   (the 0002 auth trigger auto-creates `user_profiles` rows on
   `POST /auth/v1/admin/users` — inserting parallel profiles breaks
   `current_user_profile_id()` resolution; UPDATE the auto-created rows
   instead).

**Live verification script convention** (since the seventh session):

For each backend migration (T-061, T-031, T-029, T-071, T-079), a
`scripts/verify_t-XXX.sql` file was added under `elimtiyaz-desktop/scripts/`.
These scripts:

1. Are wrapped in `BEGIN; … ROLLBACK;` so they can be re-run any time
   without mutating the live DB.
2. Store results in a temp table (`t061_results`, `t031_results`, …)
   so the results can be SELECTed at the end (Supabase CLI doesn't
   surface `RAISE NOTICE` output).
3. Cover BOTH the happy path (the fix works) AND the regression-paths
   (the original broken behavior is still rejected / preserved).

Any future backend task touching SQL / triggers / RPCs / RLS MUST
add a `scripts/verify_t-XXX.sql` following the same pattern. The
evidence goes into `docs/recovery/change-log.md` AND a per-task
`docs/recovery/t-XXX-live-verification.md` for the high-stakes
migrations / EFs.

**Live Edge-Function curl matrix** (for T-004-style tasks):

For tasks touching Edge Functions, run a curl matrix:

```bash
# For each EF, test:
# 1. NO Authorization header → expect 401
# 2. INVALID Bearer → expect 401
# 3. ANON key as Bearer → expect 401
# 4. Valid CRON_SECRET / service_role / user JWT → expect 200

curl -s -o /tmp/body -w "%{http_code}" -X POST "$BASE/$EF" ...
```

Record the full matrix in `docs/recovery/t-XXX-live-verification.md`.

## 12. How to update project documentation

- The problem you fix → update its entry in `docs/recovery/problem-registry.md` (status + evidence).
- The task you complete → update `docs/recovery/task-registry.md` and append to `docs/recovery/change-log.md`.
- Architectural decision → new ADR in `docs/decisions/` (next free number).
- New business rule or change to a canonical rule → update `docs/domain/*.md`.
- System shape changed → update `docs/architecture/system-map.md` (keep CURRENT vs TARGET separated).
- Documentation lives ONLY in this repo's `docs/` tree (plus per-repo `AGENTS.md`). Do not scatter `.md` files elsewhere; do not create a second task list, README, or status file anywhere.

## 13. How to update task status and find the next task

- The **authoritative todo list** for all remaining work is `docs/recovery/task-registry.md`. There is no other task list. Do not create TODO/DONE/PROGRESS files.
- To choose your next task safely: follow `docs/recovery/next-task.md`.
- Status flow: `OPEN → READY → IN_PROGRESS → IMPLEMENTED → TESTED → VERIFIED`. Never skip statuses; never claim a status without evidence (`docs/recovery/definition-of-done.md`).
- When you start a task: set it `IN_PROGRESS` in the task registry and identify it in `docs/recovery/next-task.md`.
- When you finish: update the task registry, the problem registry, and the change log, then commit.

## 14. How to create commits — the mandatory commit-content rule

Follow `docs/agents/git-workflow.md`. Conventional-commit subjects (`fix(financial): …`, `refactor(android): …`, `test(financial): …`, `docs(architecture): …`, `chore(recovery): …`), small and focused, one task per commit. The repo's history already contains 87 near-useless commit messages ("kay", "mid", "gg") — do not add to that.

**Every commit body MUST answer five questions — no exceptions, for every agent, on every repository:**

1. **Task completed** — which task ID (from `docs/recovery/task-registry.md`) this commit completes or advances, and the status it reached.
2. **What is left** — what remains of the task (sub-steps not yet done, follow-ups it spawns), or an explicit `nothing — task complete`.
3. **What was changed** — the concrete change (files/behaviour), and what was deliberately **preserved** (unchanged).
4. **What was verified** — the checks you ACTUALLY ran and their results (commands, test suites, equivalence runs). Never claim verification you did not perform; never mark `TESTED`/`VERIFIED` without recorded evidence.
5. **Next task** — the task ID the next agent should pick up (with a one-line reason), so the project never loses its place.

The exact template (with `Task:` / `Problem:` / `Root Cause:` / `Change:` / `Left:` / `Verified:` / `Preserved:` / `Next:` / `Related:` fields) and model answers are in `docs/agents/git-workflow.md` §2–3. A commit without these five answers is incomplete — amend it (only if local-only and unpushed) before pushing.

The commit is the last step of the workflow (`docs/agents/workflow.md`): it records progress for the NEXT agent, not just the change for git.

## 15. What agents are FORBIDDEN from doing

1. **Never** force-push, rewrite history, squash old commits, or delete branches. Git history is forensic evidence.
2. **Never** change business behaviour without first establishing the expected behaviour (domain docs / business confirmation). If unknown → record an unknown, do not guess.
3. **Never** delete code without checking reachability, git history, and cross-repo consumers (see `docs/recovery/recovery-rules.md`).
4. **Never** weaken RLS, add `SECURITY DEFINER`, or bypass canonical RPCs to "make it work".
5. **Never** implement a financial/academic rule client-side when a canonical server implementation exists.
6. **Never** disable tests, type-checking, or linting to get a build green (`ignoreBuildErrors` is a defect — `ARCH-005` — not a pattern).
7. **Never** mark anything `TESTED`/`VERIFIED` without recorded evidence.
8. **Never** fix multiple unrelated problems in one task/commit.
9. **Never** edit the canonical migration files that have already been applied; schema changes are NEW migrations (next free number).
10. **Never** apply SQL to the live database without committing the migration file AND its `schema_migrations` registration in the SAME change (ARCH-011 lesson, 2026-08-31: 0053/0054 were applied live by a previous actor and never committed — a fresh deployment would have silently missed the tenant-RBAC and auth-trigger hardening). Direct Management-API applications MUST follow the T-091/MIG-TOKENS pattern: file + `BEGIN; <sql> + registration; COMMIT;` in one atomic call.
11. **Always** open a backend session by diffing `supabase_migrations.schema_migrations` (live) against the local `supabase/migrations/` chain BEFORE picking work — drift compounds silently (ARCH-009 → ARCH-011 in two sessions).
12. **Never** commit secrets or credentials (the repo already shipped 9 staff passwords — problem `SEC-100` — do not repeat this class of error).
13. **Never** create parallel documentation, task lists, or "status" files outside this documentation system.
14. **Never** accept an unregistered patch (no task ID, junk commit messages, no registry entry) as a baseline — the 26th session (REG-003, 2026-09-05) found one carrying 8 red tests, a silently weakened CSP (`frame-ancestors` deleted) and financial logic in a React component. The session-opening FULL-suite run + lint + typecheck is the detection net: a red suite at open means the tree is NOT pristine — attribute the failures to a commit range (baseline worktree) BEFORE building on top of it. (Clarification, 29th session: T-186/SEC-114 later removed `frame-ancestors` from the meta CSP as a REGISTERED, sanctioned change — the CSP spec ignores that directive in a `<meta>` policy (Chromium warns on every launch; it enforced nothing), and the inverted `csp-policy.test.ts` guard prevents its return. The REG-003 event and the T-186 removal differ exactly by registration + the guard flip.)
15. **Never** render a financial aggregate a repository contract promises but does not deliver. If a profile/summary contract declares a field (`ParentFinancialProfile.installments`), verify the Supabase implementation actually populates it from the table — DATA-013 (2026-09-05) shipped a hardcoded `[]` for a year while the DB held 1 276 rows, and a downstream component then "fixed" the symptom by re-deriving the data in the UI (the exact §6/§9 violation). Mock-vs-Supabase parity is the tell: run BOTH modes against the same fixture when touching a repository contract.
16. **Never** synthesize financial data client-side when REAL rows exist — read the canonical stream first (`repos.installments.observeByParent`). The display-only 40/30/30 synthesis in `domain/calc/payment/billing-breakdown.ts` is the sanctioned LAST-resort fallback (flagged `isSynthetic`), never the primary source; the website port deliberately contains NO synthesis (ADR-002).
17. **Never** compute cross-platform display ratios with integer division in a mirror. The TS reference rounds (`Math.round((amount/total)*100)` — 90 000/700 000 → 13); Kotlin `amount * 100L / total` truncates (→ 12) while every monetary amount still matches — the silentest parity break possible (PARITY-001, 2026-09-05). Any mirrored percentage/share joins the shared parity corpus (the 81/13/6 Σ=100 vector pins it on all three platforms).
18. **Never** re-derive adjustment provenance or the account reconciliation in a component. The three provenance classes (Documenté / Contrepassation / Non documenté) and the full equation (gross − remises + majorations = net; net − cleared − pending = reste; explicit bridge → server balance) come from `classifyAdjustmentHistory`/`classifyAdjustmentRows` and `computeParentBillingBreakdown`'s `reconciliation` — one derivation per platform, pinned by the shared corpus (T-168). When the bridge is non-trivial (|bridge| > 1 DZD) the surface MUST show it; hiding the gap between a local derivation and the server balance is a DATA-015-class mystery-number defect.
19. **Never** let a browser-based client call an Edge Function whose origin is missing from the live `ALLOWED_ORIGINS` secret (ACT-203, 2026-09-05: the deployed value carried only the dev origin, so every production preflight failed the CORS access-control check while the EF code was correct). The EFs echo the request Origin only when allowlisted (`_shared/cors.ts`); the canonical set lives in `docs/operations/credentials.md` §2.2, and the ONLY sanctioned update path is `elimtiyaz-desktop/scripts/update_allowed_origins.sh` (idempotent, merge-only, self-verifying). When the production domain changes, update `site_url` + `uri_allow_list` (AUTH-200 runbook) AND `ALLOWED_ORIGINS` (this script) in the same change — a domain change that skips the allowlist silently kills every EF call from the new origin.
20. **Never** rebuild an auth session by re-invoking a credential grant (AUTH-301, 2026-09-05: `refreshSession` "rebuilt" via `signIn(email, "")` — an empty-password grant that 400'd on EVERY refresh and got the valid, just-refreshed session cleared; the user was logged out at every session expiry). The session the auth SDK returns from a refresh IS the session — rebuild the domain object from it via the shared `buildSession(user, authSession)`, and add a spy test asserting the credential-grant function is never reached on the refresh path.
21. **Never** ship a responsive CSS grid without a base `grid-cols-*` token (UI-300, 2026-09-06: a bare `grid gap-*` that only gains columns at a breakpoint leaves an implicit `minmax(auto, auto)` track below it — the track sizes to the item's MAX-CONTENT, `.truncate` does NOT constrain a grid track, and the page scrolls horizontally by up to ~900px on mobile). `grid-cols-1` = `repeat(1, minmax(0, 1fr))` is the mandatory base. Source-scan guards exist on the website (t-199) and the desktop (t-205) — a new violation fails the suite.
22. **Never** render Intl-formatted currency in a width-constrained box without a break safety net (UI-301, 2026-09-06: fr-XX `Intl.NumberFormat` groups digits with U+202F NARROW NO-BREAK SPACE and the pre-currency separator is U+00A0 — "175 000,00 DA" is one unbreakable token that pokes out of half-width mobile KPI cards). Add `break-words` + a mobile size step at the DISPLAY layer; the formatters themselves are parity-pinned (corpus + format tests) and must never be changed for display reasons — the website t-200 test enforces this.

## 16. How to handle uncertainty

If evidence is insufficient — which implementation is correct, what a business rule means, whether a divergence is intentional — do **not** silently decide. Either (a) find the evidence in the repositories and cite it, or (b) record the question in `docs/recovery/unknowns.md` and pick a task that is not blocked by it. An AI agent turning an unknown into an assumption is how this codebase accumulated much of its drift.

## 17. Documentation map (the whole system)

| Path | Purpose |
|---|---|
| `AGENTS.md` (this file) | System-wide agent operating manual |
| `elimtiyaz-android/AGENTS.md` (in the Android repo) | Android repo manual |
| `AGENTS.md` (in the website repo) | Website repo manual |
| `docs/architecture/system-map.md` | CURRENT (and TARGET) architecture of the whole system |
| `docs/architecture/source-of-truth.md` | Canonical implementation per domain concept |
| `docs/architecture/boundaries.md` | What each layer/platform is (and is NOT) responsible for |
| `docs/domain/financial-rules.md` | Canonical financial invariants and rules |
| `docs/domain/academic-rules.md` | Canonical academic/attendance rules |
| `docs/decisions/ADR-0*.md` | Architecture Decision Records (ADR-008 = chat is committed, staff-initiated) |
| `docs/recovery/current-state.md` | "What is the state of the project right now?" |
| `docs/recovery/problem-registry.md` | **The** consolidated problem registry (145 problems) |
| `docs/recovery/task-registry.md` | **The** authoritative task list / todo list |
| `docs/recovery/next-task.md` | How to pick the next task safely + current recommendation |
| `docs/recovery/definition-of-done.md` | Completion requirements (evidence-based) |
| `docs/recovery/recovery-rules.md` | Rules of engagement for repairing this codebase |
| `docs/recovery/unknowns.md` | Open questions that block decisions |
| `docs/recovery/change-log.md` | Chronological record of completed recovery changes |
| `docs/audits/README.md` | Index to the archival audit reports + ID-mapping rules |
| `docs/audits/first-pass-audit.md` | First-pass audit — 86 findings (read-only archival evidence) |
| `docs/audits/second-pass-audit.md` | Second-pass audit — 99 findings (read-only archival evidence) |
| `docs/operations/credentials.md` | Credential & token consistency sheet (all platforms) |
| `docs/operations/portal-google-oauth.md` | AUTH-200 owner runbook — enabling the Google OAuth provider (incl. the Management API `uri_allow_list` string quirk) |
| `docs/testing/strategy.md` | Testing strategy per platform and layer |
| `docs/testing/cross-platform.md` | Canonical cross-platform equivalence verification |
| `docs/agents/workflow.md` | The mandatory agent workflow (DISCOVER → … → UPDATE TASK STATUS) |
| `docs/agents/git-workflow.md` | Git commit standard |

---

*This manual, the registries, and the ADRs were established on 2026-08-29 by consolidating two full audit passes (185 raw findings → 145 consolidated problems; the raw reports are archived verbatim in `docs/audits/`). They are the permanent memory of the project: keep them current, and a future agent weeks from now will understand what exists, what is authoritative, what is broken, and what to do next.*


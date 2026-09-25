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
- Link the project: `cd elimtiyaz-desktop && SUPABASE_ACCESS_TOKEN=<token> /home/z/my-project/bin/supabase link --project-ref vebfehrpzajhstyhinnw` (the CURRENT live project since the 2026-09-17 switch, PR #8 — `hkvkefubghbbotgnteir` is the OLD project; scripts/ references to the old ref are the intentional both-project verification convention).
- Push migrations: `supabase db push --linked --include-all` (note: this command can take 2-5 minutes; use a generous timeout).
- Deploy an Edge Function: `supabase functions deploy <name> --project-ref vebfehrpzajhstyhinnw --no-verify-jwt`.
- Run SQL queries against the live DB: `supabase db query --linked "<SQL>"` or `supabase db query --linked < scripts/verify_<task>.sql` (for multi-statement scripts). The **Management API SQL endpoint** (`POST https://api.supabase.com/v1/projects/<ref>/database/query` with the access token) is the curl-only alternative used by the `apply_XXXX_live.sh` scripts.
- Set a secret: `supabase secrets set <NAME>=<value> --project-ref vebfehrpzajhstyhinnw` (note: this command can take 1-3 minutes; the secret IS set even if the command times out — verify via `supabase secrets list --project-ref hkvkefubghbbotgnteir`).

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

**Management-API SQL-endpoint quirk #9 (32nd session, 2026-09-07 — live evidence):**

9. **Doubled single quotes (`''`) in LIKE patterns corrupt SIBLING literals
   in the same SELECT** — a four-condition check
   (`lower(qual) LIKE '%…''…%' AND … LIKE '%auth_user_id = auth.uid()'`)
   returned false for BOTH the `''`-containing pattern AND a plain
   quote-free sibling, while the identical expressions re-tested alone
   returned true (three probe rounds, verify_t-214 C2 development).
   Dollar-quoted `DO $$ … $$` blocks are immune (the T-190/T-148 round-trip
   scripts always used them); plain strings without `''` escapes are immune.
   **Rule: never put `''` escapes in top-level SQL sent to this endpoint —
   use `position(… in …) > 0` with quote-free substrings, or move the logic
   into a DO block.** (Also: send payloads from a FILE via curl
   `--data @file`; a default python-urllib User-Agent gets Cloudflare
   error-1010 403s.)

**Groq / AI-provider live evidence (41st session, 2026-09-10):**

10. **The agent sandbox CANNOT reach Groq directly** (Hong Kong egress →
   geo-block → 403 Forbidden on every endpoint) — but the **ai-proxy Edge
   Function CAN** (Supabase eu-west-1 egress is not blocked). To verify a
   Groq key from the sandbox: set it as the `GROQ_API_KEY` function secret
   (`supabase secrets set` — the CLI call may TIME OUT with the secret
   already set, quirk #5; verify via `secrets list` digest + a live
   behavior probe), then POST an agent-stream request to the EF with a
   staff JWT (the t269-live-matrix.sh script is the reusable pattern).
   NEVER conclude a key is invalid from a sandbox 403.
11. **The 2026 Groq catalog (owner's key, probed live 2026-09-10):** every
   `llama-*` and `qwen-*` model id returns 404 model_not_found (removed
   from the catalog for this account). Reachable: `openai/gpt-oss-120b`
   (reasoning flagship), `openai/gpt-oss-20b` (fast), `groq/compound`.
   All default model ids (desktop DEFAULT_AI_PROVIDER_CONFIG, the EF's
   DEFAULT_MODELS, settings placeholders) are pinned to the reachable
   ids — a default that 404s is a production bug (fresh installs fail on
   every call). Catalog drift is fixed by SELECTION via the settings
   tab's live model discovery (`queryLiveProviderModels`), never by
   editing code blind.
12. **gpt-oss models stream a hidden reasoning channel:** `delta.reasoning`
   + `channel:"analysis"` fragments arrive BEFORE the content, and
   reasoning tokens are spent from the SAME `max_tokens` budget (a small
   budget can finish `reason=length` with ZERO content — see the P6
   discovery in t-269-live-verification.md). The desktop's
   `executeOpenAIStream` correctly accumulates only `delta.content`;
   keep it that way. Budgets must leave room after reasoning (default
   2048 is safe).

**Management-API API-key endpoints (72nd session, 2026-09-16 — live evidence):**

13. **A MINTED `sb_secret_` key is NOT a gateway probe path.** `POST /v1/projects/<ref>/api-keys` with `{"type":"secret","name":"…"}` DOES create a new secret key and returns the raw value exactly ONCE (the name must be `^[a-z_][a-z0-9_]*$` — camelCase/dashes are rejected). But the data/function gateways then REJECT that key with `{"message":"Invalid API key"}` — on REST **and** Functions — even 2+ minutes after creation, and `GET /v1/projects/<ref>/api-keys` (or `/api-keys/{id}` — there is NO `/reveal` route) permanently masks EVERY secret-type key (`sb_secret_ls_Xa·······`). Consequences: (a) an EF that compares `Bearer` against the platform-injected `SUPABASE_SERVICE_ROLE_KEY` (the `send-push-notification` pattern) can only be positively probed with the project's DEFAULT sb_secret, which is revealable ONLY in the dashboard UI (Settings → API Keys) by an operator holding the dashboard login; (b) minting a fresh key to "get in" does not work — delete any experimental key immediately to restore the key-set census (the fresh-clone parity check compares the key SET, and a stray probe key is a divergence).

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
23. **Never** rotate, re-set, or "repair" the OWNER-PINNED admin credential (OPS-310, 2026-09-10: the T-079/T-241 "re-set if the documented password fails" pattern silently overwrote the owner's password and locked the owner out of their own production account — the exact anti-pattern). The canonical credential is `admin@elimtiyaz.dz` / `elimtiyaz@admin2026` (owner directive, recorded in `docs/operations/credentials.md` §1; the probe scripts carry it as `ADMIN_PW`). A sign-in that fails `invalid_credentials` on this value means STOP AND ASK THE OWNER — never a GoTrue admin-API re-set, never a new "documented value". Usernames and passwords belong to the owner, not to the repair process.
24. **Never diagnose source corruption from a terminal display — verify the BYTES first** (T-313 / REG-006, 2026-09-12: the 51st session registered "two corrupted lines in teacher-dashboard.tsx that tsc accepts but V8 rejects" — a FALSE diagnosis). The sandbox's Bash tool output layer EATS bracket-letter sequences (`[h`, `[m`, …) from DISPLAYED text: `sed`/`cat -A`/git-diff/Python-repr displays of `const [homeworkOpen…` and `[myClasses],` showed them as `const omeworkOpen…` / `yClasses],` — looking exactly like missing-token corruption. Byte-level checks (`line.startswith(b'  const [homeworkOpen')`, `.hex()` dumps) proved both lines INTACT; the Read/Edit tools (direct file access, no terminal pipeline) show the true bytes. **Rule: when a terminal display shows "corrupted" source, re-verify with a `startswith`/hex probe (or the Read tool) before registering a corruption claim — a diagnosis made from display output alone is evidence of nothing.** (Corollary: this artifact is why `grep` output can also mislead — hex-encode anything suspicious.)
26. **Never DELETE from `audit_logs` in a cleanup script — the table is APPEND-ONLY by design** (T-332, 2026-09-13: the `enforce_audit_log_append_only` trigger raises `P0001: audit_logs is append-only (plan §12). UPDATE and DELETE are forbidden. Use a new entry with supersedes_id for corrections.`). Live-test cleanup keeps the business data zero-residue but KEEPS the audit rows as the honest record (the 31st-session convention; scripts/t-332-approval-e2e.py models the pattern). Also two HTTP-status quirks for live-probe scripts: the Management API SQL endpoint returns **201** on success (a `== 200` check fails spuriously) and GoTrue `POST /auth/v1/admin/users` returns **200** (not 201).
28. **Never upload to Supabase Storage without the TENANT path prefix (UPLOAD-101/102/103, 2026-09-14)**: every `storage.objects` policy in the chain (0018/0043/0092) requires `(storage.foldername(name))[1] = current_tenant_id()` — a path headed by anything else (an entity id, a student id, the literal "mock") is RLS-rejected on EVERY upload with "new row violates row-level security policy". The canonical object path is `<tenant_id>/<entity_id>/<filename>` (desktop `media-vault.ts`, website upload dialogs, Android `StorageBuckets.objectPath` — all now source-guard-pinned per platform). The write-side corollary of CROSS-200: a storage WRITE must never be wrapped in a catch-all that converts a server REJECTION into an offline-looking fallback (Android now reuses `SyncErrorClassifier` for exactly this split); and uploads are not reads — give them a real timeout (Android `UPLOAD_TIMEOUT_MS = 60 s`, not the 4 s read default). Live probe convention: `elimtiyaz-desktop/scripts/t-359-upload-e2e.py` (also records the two HTTP quirks: RLS denials surface as HTTP 400 with `statusCode: 403`, and GoTrue's admin user-delete takes the user ID in the PATH — the `?email=` form is silently ineffective). **The TABLE-write corollary (UPLOAD-104/T-367, 2026-09-14): a client-side INSERT into a tenant-keyed table must carry `tenant_id` EXPLICITLY** — `student_documents.tenant_id` has NO column default (0005) and every tenant-scoped WITH CHECK (0043) evaluates `tenant_id = current_tenant_id()`, so an omitted column lands as NULL, fails with SQLSTATE 42501, and PostgREST answers **HTTP 403 on `/rest/v1/<table>`** (the browser-console signature — a SELECT under RLS never 403s, it silently filters; a 403 on a table URL means a WRITE was RLS-rejected). The portal's `chat_messages` insert (`tenant_id: channel.tenant_id`) is the convention; the `student_documents` insert missed it and 403'd on every upload for two sessions while the STORAGE leg was green — always probe the FULL two-step flow (storage upload AND the row insert), which the t-359 e2e TABLE leg (checks L/M/M2/N) now does. Website source guard: `src/test/t-367-insert-tenant-guard.test.ts` (whole-src — every `.from("student_documents").insert(` payload carries a tenant_id key).

29. **Never draw locale-formatted money into a PDF, and never summarize the ledger with `charged − paid` (T-368 / REPT-500/505, 2026-09-14):** (a) `formatDzdPlain`/`toLocaleString("fr-FR")` emit U+202F (narrow no-break space) as the digit-group separator — pdf-lib's Helvetica `drawText` THROWS `WinAnsi cannot encode (0x202f)` on it, which killed every receipt/statement PDF on amounts >= 1000 DZD for the desktop while the website port (T-194) had already fixed its copy (the inverted DRIFT-011). Every PDF money string goes through `dzdPdf()` (WinAnsi-safe grouping) and every drawn string through `sanitizePdfText` — sanitize AT THE DRAW SEAM (`drawKeyValue`/`stampPageFooters`), not call-site by call-site. (b) The ledger sign convention: payments and refunds are NEGATIVE credits (`domain/calc/ledger/entries.ts` `amount: -input.amount`; the DB CHECK comment says the same) — a summary surface must display `Σ|payment|` for "encaissé" and compute the outstanding as the SIGNED SUM of all entries (the canonical `balance += e.amount` rule). `charged + adjusted − paid` on raw amounts silently INFLATES the outstanding by 2×|paid| (REPT-505 — the legacy data-export summary shipped this for a year). (c) **PostgREST returns at most 1000 rows per response** — `.limit(5000)` silently yields 1000; any whole-table export/census script must paginate with `.range()` (the t-368-live scripts encode the pattern). (d) **PDF text assertions without an external parser:** pdf-lib writes drawn text as hex strings (`<4D41524B…> Tj`) inside Flate-compressed content streams — inflate each page's streams with Node `zlib` and decode the hex/literal `Tj` operands (the t-368 suites' `extractPageText` helper) to assert rows/footnotes/page labels are actually DRAWN. A page-count assertion alone proves nothing about content.

30. **Never add a file whose name collides with an existing directory index (T-369 / WORKFORCE-500, 2026-09-14):** adding `src/infrastructure/mock/workforce.ts` when `src/infrastructure/mock/workforce/index.ts` already existed made TypeScript resolve EVERY pre-existing `import … from "./workforce"` to the NEW file — silently re-binding T-314's `workflow-side-effects.ts` to a dead store while the app kept reading the old one (the split-brain). The new file was also broken on three axes the reviewer never saw (a NEW SubjectBehavior per `observe()` call so mutations never notify; no `setWorkforceAuditSink` export so any importer crashed at boot; phantom seed ids). **Rule: before creating a file, check for a same-named sibling DIRECTORY with an index.* — either extend the existing implementation (§6/§9) or delete the old one in the same change; and never ship a mock whose observables are not the module-level singleton subjects.** Corollaries from the same session: (a) an append-only trigger blocks `ON DELETE CASCADE` — a personnel row with salary history can NEVER be hard-deleted (correct for payroll integrity; live probes use run-unique codes + archive-only cleanup — `scripts/t-369-payroll-e2e.py` models the pattern); (b) PostgREST returns **HTTP 200 with an EMPTY array** when an UPDATE matches zero rows under RLS — a live probe must assert the patched-row count or the row's unchanged state, never the HTTP status alone (a "200 OK" tamper attempt may have touched nothing).

31. **A shared storage bucket synchronizes NOTHING — the metadata store is the contract (SYNC-110/T-372, 2026-09-14):** the website and the desktop both uploaded binaries to the same `student-documents` bucket with the same `<tenant>/<student>/<file>` path (the UPLOAD-101..104 fixes were all green), yet each platform was blind to the other's documents — because the website listed documents from the canonical `student_documents` TABLE (0005/0019/0043) while the desktop read/wrote the `students.documents_json` JSONB column (0038, the personnel pattern cloned onto students). **Rule: whenever a second client gains a surface over a shared entity, the METADATA store must be ONE canonical table — never a per-client JSON column or a per-client derivation. Document metadata on every platform goes through `student_documents` (the desktop's granular `addStudentDocument`/`removeStudentDocument` repository contract; the full-array `documents` write is REMOVED from `UpdateStudentInput` so the clobber path cannot return at the type level).** Two corollaries: (a) a FULL-ARRAY replacement write (`updateStudent(id, { documents: [...] })`) on a shared multi-client store is a last-write-wins clobber — it deletes rows another client inserted concurrently; shared entities get GRANULAR per-row mutations (INSERT/DELETE one row), and deletes probe the matched-row count (§15.30b). (b) When unifying a split store, the legacy column's rows must be BACKFILLED idempotently (keyed on the natural identity — here the storage path) and the column retained as a forensic archive with no client reading it; the backfill maps legacy enum values to the canonical CHECK set (medical→medical_certificate, justification→justification_letter — migration 0098). Live probe convention: `elimtiyaz-desktop/scripts/t-372-doc-sync-e2e.py` (both directions through each platform's EXACT query shape).

32. **Never change an SQL function's signature via CREATE OR REPLACE without dropping the old overload, and never key a workforce assignment on the personnel id when the column holds account ids (T-371 / WORKFORCE-501, 2026-09-14):** (a) `create or replace function f(a int)` → `f(a int, b int default null)` creates a SECOND overload, it does NOT replace the first — with both sharing the same parameter NAMES, every named-notation call (`supabase.rpc("f", { a: … })` and every `p_x => …` in SQL) fails with `42725 function name is not unique`. The new trailing parameters with defaults keep the OLD call sites working, but the OLD signature must be DROPPED in the same migration (`drop function if exists public.f(<old arg types>)`) — see 0097 for the pattern. (b) `tasks.assignee_ids` is an array of **user_profiles.id** (the 0010 schema comment, the 0019 RLS `assignee_ids @> to_jsonb(current_user_profile_id()::text)`, and every dashboard read agree) — an assignment UI that stores the PERSONNEL id creates a task its assignee can never see under RLS (assignment is a silent no-op for the employee). The personnel → account mapping is `personnel.user_id` (bound at account creation by the 0097 RPC / the redesigned Settings → Comptes workflow); an employee WITHOUT a linked account is UNASSIGNABLE by design — surface the count in the UI, never fall back to storing the personnel id. (c) Live-quirk additions: `to_jsonb('…')` in a comparison needs the explicit `::text` cast (42804 polymorphic-type error otherwise); the create-user-account EF's audit payload lands in `audit_logs.after_json` (not `payload`); the Management SQL endpoint surfaces ONLY the last statement's result set — capture per-check details by trimming the trailing SELECT (verify_t-371.sql models the pattern).
27. **Every RLS-impersonation DO block in a live verify script must GRANT its temp table to `authenticated`** (T-332, 2026-09-13: `SET LOCAL ROLE authenticated` downgrades the session, and the INSERT into the results temp table then fails with `permission denied for table <temp>` — the t-214/t-332 convention is `GRANT INSERT, SELECT ON <temp_table> TO authenticated` immediately after CREATE TEMP TABLE).

25. **Never treat a green `vitest run` as a typecheck — they are SEPARATE gates, and the typecheck must re-run AFTER the last test-file edit, not before it** (T-313a / REG-007, 2026-09-12: the 51st session's closeout claimed "tsc 0 errors", but the three NEW T-313 test files shipped with 8 tsc errors — fixtures missing required domain fields (`level`, `gradeYear`, `notes`, `isActive`, `academicYearId`, …) and an invalid `as Record<string, unknown>` cast). Vitest transpiles TypeScript via esbuild **without typechecking**: a test whose fixtures drift from the domain contract still PASSES at runtime as long as the exercised code paths don't touch the missing fields. The typecheck had been run BEFORE the new tests were written and never re-run. **Rule: the verification ladder is `tsc --noEmit` + `eslint` + FULL `vitest run`, and EVERY rung re-runs after ANY file change, including test-only changes. A test file is production code for the contract it pins — fixtures must be typed against the domain input types (e.g. `const INPUT: Omit<Subject, "id" | "tenantId"> = {…}`) so drift fails at compile time, not silently at runtime.**

24. **Never** mirror a doc comment — mirror the CODE. The 61st session (STATS-400, 2026-09-14) caught the trap: the desktop `transport.ts` doc comment says the live transport-tier typo is `"BOUMRDS"` while its code, test fixtures, and generated corpus all use `"BOUMRDES"`; the first Android mirror followed the COMMENT and the corpus diff failed on exactly that entry. When a mirror disagrees with its source, byte-verify the SOURCE's executable lines (`ascii()`/`od`, not terminal display) before "fixing" anything — and when a comment contradicts the code, the code wins and the comment becomes a registered cosmetic follow-up.
25. **Never** emit timestamps from a Kotlin mirror with `Instant.toString()`. The desktop's `new Date(ms).toISOString()` ALWAYS carries 3-digit milliseconds (`2025-09-15T00:00:00.000Z`); Kotlin's `Instant.toString()` silently drops trailing zeros (`…T00:00:00Z`) — a string-compare parity break invisible to every numeric assertion. Any mirrored ISO instant goes through an explicit `DateTimeFormatter.ofPattern("uuuu-MM-dd'T'HH:mm:ss.SSS'Z'")` (the T-340 `formatIsoMillis` convention).
26. **Never** leave a vanity metric alive because it is "real data". Real-but-passive numbers are still noise when they displace decision triggers (STATS-400): the payment-amount histogram, weekday×month heatmap, and the smooth 12-month spline were all computed from genuine rows — and were all on the owner's kill list because they answered no operational question. The executive-statistics family (waves / erosion / triage / concentration / transport / services / dynamics / radar) is the sanctioned replacement surface; a NEW analytics chart must name the DECISION it triggers before it is built.

33. **Never** reconstruct a function or policy from a prose summary of the live database — reconstruct it from `pg_proc`/`pg_policies` and DIFF it (OPS-314 / T-376, 2026-09-15: the fresh empty clone `vebfehrpzajhstyhinnw` reported 95/95 migrations applied, 83/83 tables, 226/226 policies — structurally perfect — yet EVERY authenticated REST read returned `500 54001 stack depth limit exceeded`, so the owner saw a blank app and a wall of `401`s. Two transcription losses from the hand-written chain: `0003_rbac.sql` created the five RLS helpers (`current_user_profile_id`, `current_tenant_id`, `has_role`, `has_any_role`, `has_permission`) **without** `SECURITY DEFINER` **and without** `SET search_path = public`, and `0019_rls_policies.sql` created `user_profiles_select_own` **without** the leading `auth_user_id = auth.uid()` fast-path disjunct. Because RLS is **FORCEd** (`relforcerowsecurity=true`) on `user_profiles`/`role_assignments`/`roles`/`permissions`/`role_permissions`/`tenants` and only `postgres`/`service_role` hold `rolbypassrls`, a policy calling a non-`SECURITY DEFINER` helper re-enters its own policy forever until the 2048 kB stack limit. **Rules: (a) any attribute that affects policy evaluation — `prosecdef`, `proconfig` (`search_path`), `relforcerowsecurity`, `pg_roles.rolbypassrls`, policy `qual`/`with_check`/`roles`/`cmd` — is part of the structure and must be byte-diffed against live, never assumed; (b) "N/N tables, N/N policies, N/N migrations applied" is NOT a functional-parity proof — only a live authenticated request is; (c) an `anon` probe returning `[]` proves nothing about `authenticated`, because a recursion fault and a missing session token both surface in the console as a wall of `401`.
34. **Never** "fix" a fresh-provision divergence by WIDENING a grant to match a live default-ACL artefact (OPS-314 / T-376, invented 2026-09-15): `fn_finalize_class_placements(...)` carries `=X/postgres` (PUBLIC EXECUTE) on the live project, while `0096` deliberately `revoke all … from public` and grants EXECUTE only to `authenticated, service_role, anon`. Exact `pg_proc.proacl` parity would mean handing PUBLIC EXECUTE on a state-changing RPC to every caller. When a parity diff exposes a divergence whose live side is **broader**, keep the narrower (safer) side and REGISTER the divergence (`problem-registry` + `change-log`) — never relax a permission, RLS predicate, or `SECURITY DEFINER` boundary for textual/structural equality. AGENTS.md §15.4 governs: never weaken RLS to "make it work".
35. **Never** diagnose a fresh clone from the CLIENT console alone — prove the server side first (OPS-314, 2026-09-15: the owner re-signed-in twice on a valid session without a change, because the console showed only `401`s). The two-minute triage that ends this class of dead-end: (1) run `scripts/verify_t-376.sql` (`BEGIN`/`ROLLBACK`, `SET LOCAL ROLE authenticated` + `request.jwt.claims`, temp-results table GRANTed per rule 27) — it asserts helper `prosecdef`/`search_path`/owner-`BYPASSRLS`, the fast-path disjunct, and the recursion probe itself; (2) call every suspect endpoint with a real bearer token and record the STATUS CODE — `500 54001` means evaluate-the-chain-against-`pg_proc`, `401` means credential/session; (3) only then touch the client. The full verify convention is AGENTS.md §11.1.
36. **Never** soft-delete via a plain PostgREST `.update({ deleted_at })` on a table whose staff SELECT policies filter `deleted_at IS NULL` (RLS-500 / T-384, 2026-09-16): PostgreSQL folds the applicable SELECT-policy predicates into the UPDATE path (row visibility AND the effective WITH CHECK side), so the NEW row carrying a non-null `deleted_at` can never satisfy them — EVERY authenticated caller gets `42501 "new row violates row-level security policy"` (live-proven on both projects for `parents` AND `students`; the bisection: with `parents_update` alone the UPDATE passes, add `parents_select` back → 42501). This was dormant from 0019 until T-381/T-384 surfaced the removal buttons — `deleteStudent`/`deleteParent` had zero UI callers, so the broken path was never exercised (a suite-green repository method is NOT a working method: the t-381 tests mocked the client). **Rules: (a) a soft-delete (or ANY mutation a SELECT policy forbids on the result state) goes through a `SECURITY DEFINER` RPC with explicit gates (`soft_delete_parent`/`soft_delete_student`, migration 0100 — super_admin gate, tenant scope, guards, audited); (b) never "fix" it by removing `deleted_at IS NULL` from the SELECT policies — that resurrects soft-deleted rows in every staff list; (c) the SQL-impersonation probe (`SET LOCAL ROLE authenticated` + `request.jwt.claims`) needs the AUTH id as `sub` (NOT `user_profiles.id` — they differ) or role resolution silently returns nothing and every conclusion is wrong; and a `201 []` from a multi-statement payload means NOTHING (0 rows matched under RLS is also success-shaped — §15.30b) — always verify the changed row inside the same transaction.** Live probe convention: `elimtiyaz-desktop/scripts/t-384-parent-removal-e2e.py` (the RED evidence + the RPC round-trip, both projects).

37. **Never send a blank string (`""`) to a typed RPC parameter or a uuid column filter — `??` does NOT convert it to null** (SYNC-300 / T-387, 2026-09-17; the WRITE-path sibling of ACAD-501's read-path `?class_id=eq.`): PostgREST casts JSON RPC arguments to the function's declared parameter types AT THE GATEWAY — `""::uuid` raises `22P02`, `""::date`/`""::timestamptz` raise `22007`, and the call dies with HTTP 400 BEFORE the SECURITY DEFINER body runs, so the server-side `NULLIF(TRIM(…),'')` normalization can never save it (the whole queue entry then retries forever on backoff with a cryptic cast error that names neither the field nor the entity). **Rules: (a) every uuid-typed argument passes a `isUuid(v) ? v : null` guard (the exported `isUuid` — the supabase-shared-repositories line-1268 convention) and every date/timestamp-typed argument passes a blank→null guard (`blankToNull`, default-push-handler.ts) AT THE CLIENT SEAM; (b) guard ONLY optional (`DEFAULT NULL`) parameters — a blank in a REQUIRED uuid param (`p_student_id`, `p_subject_id`) is a data error that must fail loudly with the RPC's own validation, never be silently nulled; (c) when an import/sync 400 arrives, reproduce it with the EXACT payload shape before theorizing about infrastructure — the 2026-09-17 owner report blamed missing 0023 seed data while BOTH projects carried the full canonical census (the live census + the t-387 RED/GREEN probe is the reusable pattern, `scripts/t-387-rpc-blank-args-e2e.py`); (d) do NOT re-run `0023_seed.sql` on a fully-migrated DB — its trailing DO-assert block is calibrated to the 0023-era snapshot (`transport_destinations = 4`) and RAISES on the canonical post-0089 state (28 = 4 legacy zones + 24 real towns); (e) a `pg_proc` signature census counts IN + OUT argnames (18 + 3 = 21 for `upsert_student_from_import`) — do not confuse the two when diffing `types.ts` against live.

38. **Never exercise a destructive surface against REAL business rows — probe with run-unique rows, and never leave a real row in a deleted/refunded state after UI verification (OPS-319 / T-395, 2026-09-21: the 2026-09-16 manual walk of the new T-384 Supprimer buttons soft-deleted the REAL "Famille SIDI — 0554288142" family on production, and the same evening's test refunds half-executed on it (BUSINESS-105) — four days later the owner reported "a row that exists in the database but cannot be seen in the desktop" and a whole session went to rediscovering what the testing had silently done; the t-384/t-391 e2e harnesses already model the correct convention — run-unique probe codes + zero-residue cleanup). Two companions: (a) a soft-deleted row is invisible to EVERY client (RLS `deleted_at IS NULL` + the operational filter) and — until the OPS-319 restore surface exists — recoverable ONLY by a guarded data-repair migration (the 0101 pattern) or the dashboard SQL editor; if a row "mysteriously" disappeared, check `deleted_at` + the `audit_logs` trail FIRST (actions `parent.delete`/`student.delete`/`payment.refund` with their before/after snapshots) before suspecting RLS, auth, or the sync layer; (b) `revert_payment_allocation` (0034/0087) HALF-EXECUTES on payments whose ledger entry was written by the import/reconciliation path (`source_type='bulk_import'`): `payments.status` flips to 'refunded' while NO reversal entry is created and the LIFO waterfall is untouched — a refund of an import-corpus payment is NOT financially executed (BUSINESS-105, OPEN); treat any 'refunded' payment without a matching reversal entry as a half-refund and repair with the 0101-style guarded restore, never by re-running the refund.

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


39. **On a high-RTT route the ROUND-TRIP COUNT is the entire latency cost — collapse a client-orchestrated multi-call write composite into ONE server-side RPC that REUSES the canonical per-entity functions internally, and SUBSTITUTE the identity tokens server-side (PERF-501/502 / T-397/T-398, 2026-09-21)**: the owner's "10–20 seconds for a single insert" was never a slow server — the sandbox-measured RPC server cost was healthy (250–630 ms incl. network) while the interactive registration issued 21+ sequential round-trips (measured 6,984 ms at 264 ms median RTT; the Algeria→eu-west-1 band is 476–952 ms/RTT). T-397's bulk rewire (~11 calls, 3,189 ms) was still a ~5–10 s floor on the owner's route — the answer was `register_family_batch` (migrations 0102+0103): ONE SECURITY DEFINER transaction that CALLS `upsert_parent_from_import`/`upsert_student_from_import` (§6 — reuse, never reimplement the identity/fallback logic), fills ONLY what the client cannot know before the single call (the server uuids, the `deriveAccountId` string, the `source_id` identity tokens), writes the billing legs `ON CONFLICT DO NOTHING` (the IMPORT-107/110 wire semantics), and RETURNS the full rows (zero follow-up fetches) — live 368 ms, ≈0.6–1.2 s projected on the owner's route. Three hard-won sub-rules: **(a) THE IDENTITY-TOKEN TRAP** — a composite write whose idempotency keys embed server-generated ids (the ledger `source_uidx` on `(tenant, source_type, source_id)`) will DUPLICATE rows across paths if the single-call client sends its own token form (the deterministic codes) while the historical rows carry the uuid form: the client sends the codes and the RPC substitutes the resolved uuids before inserting (0103, live-proven by verify_t-398 C12 — a re-registration with a DIFFERENT student code converges via the upsert's name fallback AND the substituted source_ids, zero duplicates); **(b) MONEY STAYS CLIENT-DERIVED** — the canonical TS calc engine (discounts/splits) remains the ONLY derivation of amounts; the server-side function only fills ids and writes rows (never move financial logic into SQL to "complete" the composite); **(c) PLATFORM DEFAULT PRIVILEGES GRANT `anon` EXECUTE ON NEW FUNCTIONS** — revoking PUBLIC alone leaves the anon grant in place (dry-run-proven on 0102): a staff-only RPC needs the EXPLICIT `revoke … from anon` (§15.34 — keep the narrow side). The composite is idempotent end-to-end (deterministic codes + ON CONFLICT), so `rpcWithIdempotentRetry` wraps it — and ONE transaction also upgrades the semantics: any leg failing rolls back EVERYTHING (the partial-success "family created, billing missing" state stops being POSSIBLE, not just warned about).

40. **A DOM-driving test-data engine has THREE silent-failure contracts: React's act() deferral, Radix's synthetic-event gates, and the trigger's own data-state (T-399 / OPS-321, 2026-09-21)**: (a) THE ACT-DEFERRAL TRAP — an engine that dispatches synthetic events and then AWAITS portal mounts must run OUTSIDE an active `act()` scope: React captures every synthetic-event update inside the scope and defers the flush to the act boundary, so the Radix portals never mount during the engine's poll window and every select leg times out DESPITE a correct dance (in the real browser there is no act — the trap is test-only, and the fix is the test-side `IS_REACT_ACT_ENVIRONMENT=false` wrapper around the engine call, never a change to the engine); (b) THE RADIX SELECT SYNTHETIC-EVENT CONTRACT — opening gates on `pointerType === "mouse"` && `button === 0` && `!ctrlKey` on pointerdown, item selection fires on POINTERUP (a pointermove first records the pointer type — a bare `click()` selects NOTHING for a mouse-typed interaction), and the content-mount path calls `hasPointerCapture`/`releasePointerCapture`/`scrollIntoView`/`ResizeObserver` — APIs jsdom does not implement, and the missing `scrollIntoView` CRASHES `SelectContentImpl`'s mount effect and silently UNMOUNTS the whole React tree (the compat shim must patch ONLY what is missing; real browsers are untouched); (c) NEVER filter comboboxes by `[data-state="closed"]` — that attribute sits on the Radix TRIGGER of every closed select (a "closed portal" filter excludes every combobox before the fill dance starts; closed portals are UNMOUNTED by Presence, absent from the DOM by construction). Companion data rules: Arabic matching must be UNBOUNDED (`\b` never fires around Arabic letters — they are non-word chars for JS's ASCII boundary engine) and normalized through the SAME function as the rules (NFD decomposes hamza carriers: أ U+0623 → ا + U+0654, so a precomposed pattern can never match its own decomposed input); and a test-data generator is pinned against the REAL form validators by IMPORTING them (the exported PHONE_RE/EMAIL_RE), never by re-typing a copy.

41. **A handed-over report is a CLAIM, not evidence — and RLS has NO default-deny on DELETE for admins either (T-400, 2026-09-21):** (a) THE REPORT-vs-LIVE TRAP — the 84th session's §15.11 census falsified the previous report's central claim ("migration 0104 already applied to the live project — do not re-run"): the live `schema_migrations` head was 0103 and the RPC did not exist; the report had also implicitly claimed test coverage while 3 Personnel suites were red on the pristine branch tip. ALWAYS open a backend session with the live chain diff AND attribute any red suite to a commit range BEFORE building on a handed-over state. (b) THE NO-DELETE-POLICY CENSUS — `leave_requests`, `tasks`, `chat_messages`, `chat_channels`, `workforce_attendance_events`, `user_profiles`, `salary_payments` (and `personnel` beyond its append-only triggers) carry NO DELETE policy: RLS default-deny applies to EVERY authenticated role INCLUDING super_admin, and PostgREST answers **HTTP 200 with an EMPTY array** (the §15.30b shape) — a live probe's zero-residue cleanup therefore goes through the SERVICE ROLE **and asserts the returned row COUNTS** (`scripts/t-400-personnel-e2e.py` models the convention); never trust an admin-JWT DELETE's HTTP status. (c) GoTrue's admin user-delete requires the service key in BOTH headers (`apikey` AND `Authorization`) — the publishable key in `apikey` returns 403 even with a valid service bearer. (d) The `create-user-account` EF wraps its success payload in a `data` envelope — probe scripts read `body.data.auth_user_id`, not `body.auth_user_id`.
### 42. **Academic classification and batch promotion are system-wide contracts — never patch one form/page in isolation (T-401/T-402, 2026-09-21)**

The academic chain Niveau → Filière → Spécialité → Classe/Section and the batch promotion workflow must have one canonical model and one business-rule implementation. A field added to an insertion form is incomplete until its database representation, domain types, validation, repositories/RPCs, search, filters, statistics, class formation, promotion, student details, imports/exports, history, and all cross-platform consumers agree on the same contract.

**Rules:**
1. Before adding a filière/specialty field, audit every existing academic classification representation. Reuse or consolidate; do not create page-local enums, mapping tables, or validation copies.
2. Keep niveau, filière, spécialité, and physical classe/section as separate concepts with explicit compatibility rules.
3. Promotion is upstream of class formation. Promotion must publish the canonical next academic level/history state that class formation consumes; class formation must not recalculate promotion semantics.
4. Batch promotion must use students.grade_level_code + student_academic_histories and must not revive the legacy academic_history / promote_students path.
5. Any backend schema/RPC/RLS change requires the canonical migration chain, consumer census across Desktop/Android/Website, and live verification when credentials are available.
6. Duplicate forms are acceptable only as presentations of the same domain contract. Duplicated business logic is prohibited.
7. A task is not complete because one UI works: the end-to-end persistence, retrieval, filtering, statistics, placement, history, and cross-platform paths must be verified and documented.
 
### 43. **Batch promotion must use a human-in-the-loop Promotion Cycle (T-403, 2026-09-21)**

Batch promotion means processing a school-year cohort as one managed cycle, not blindly promoting the entire school with one click. The cycle is the scope; each class/group is reviewed and explicitly confirmed one at a time. Create a dedicated Batch Promotion Cycles area/table, normally focused on the next academic year. Remove scattered direct-promotion buttons; contextual pages may link to the cycle but must not implement independent promotion logic. The cycle UI must use the same canonical promotion domain/database contract as T-402, support per-student decisions, incomplete-notes warnings, class-level atomic confirmation, progress tracking, and final whole-cycle completion. A cycle cannot be marked complete merely because one class was processed.


### 44. **PostgreSQL `GREATEST()`/`LEAST()` IGNORE NULLs — "coalesce through greatest" silently collapses to the non-null operand and can invert a fallback's meaning (T-405 / migration 0111, 2026-09-22)**

`greatest(0, <nullable expression>)` returns **0** when the expression is NULL — NOT NULL, and not the "fallback" a reader expects from a `coalesce(a, b)` shape. Live evidence (T-405's first live apply): the never-paid inactivity was written as `coalesce(greatest(0, floor(extract(epoch from (p_as_of - last_payment_at))/86400))::int, <debt_age>)` — with `last_payment_at IS NULL`, the inner `greatest(0, NULL)` evaluated to **0**, so `coalesce` found a non-null 0 and the never-paid parent's inactivity became 0 days → status GREEN ("actively paying") for a family that had never paid a single dinar. The TS twin (`??`) and the SQL evaluated DIFFERENT semantics for the same intent. Rules: (a) a NULL-dependent fallback must be a `CASE WHEN x IS NULL THEN <fallback> ELSE <expr> END` — never greatest/least-wrapped coalesce; (b) when porting a TS `??`-chain to SQL, enumerate the null cases explicitly (the SYNC-300 blank-string lesson generalized to SQL); (c) pin the never/null branches in the verify script BEFORE trusting the happy path (verify_t-405's C6/C7 caught the inversion only because the never-paid archetypes were pinned at the boundary ages); (d) structure multi-factor SQL derivations as an intermediate `factors` CTE so the status CASE reads the named factors — the inline-expression variant is where the trap hid (migration 0111's `factors` CTE is the pattern).

### 45. **A composite RPC's parameter set must be RE-AUDITED whenever the inner canonical function gains params — and UI sentinels must be REAL option values (T-407 / ACAD-504, 2026-09-22; renumbered from the drafted 44 — the concurrent T-405 session's GREATEST rule owns 44)**

(a) THE COMPOSITE-PARAM-DRIFT TRAP — `register_family_batch` (0102) CALLS `upsert_student_from_import` verbatim by design (§6, reuse); when 0107 later added the trailing `p_filiere_code`/`p_specialite_code` params to the inner function, the composite's `jsonb_to_recordset` column list and its call site were NOT re-audited — the wizard's classification was silently dropped at the seam for EVERY batch registration while the single `createStudent` path persisted it fine (a wire-contract divergence inside the SAME repository file). RULE: any change to a canonical function's signature triggers a consumer census that includes COMPOSITE callers (functions that call the function, not just clients that RPC it) — `rg "function_name"` across the whole migration chain, and check every `jsonb_to_recordset`/wire mapping that feeds it. (b) THE SENTINEL-VALUE RULE — a Radix Select's state token must be a value some SelectItem actually carries: a foreign sentinel (e.g. `__general__` when the catalog item's code is `general`) renders a BLANK trigger for the default state AND leaks the literal when the real option is picked; use the catalog's own code as the sentinel and map it to the canonical storage form (NULL) at submit through the domain normalizer (`normalizeTrackCode`), never a hand-rolled conditional. (c) THE OVERRIDE-DESTINATION RULE — a reviewer override that changes a DECISION must recompute the DESTINATION fields from the final decision (a repeat→promu override previously sent the student's CURRENT grade as `next_grade_code`, so the promoted student never advanced); payload builders derive destinations from the entity's own progression, never from a pre-computed candidate field. (d) TEST-HARNESS RULES — the mock store is a shared SINGLETON across a test file: clone fixtures on inject and DRAIN the async mock writes in afterEach (a late-resolving repository write otherwise clobbers the NEXT test's same-id fixture — the delay(180) race); a shared `radix-mouse` helper (`src/tests/_helpers/radix-mouse.ts`) is the ONE implementation of the §15.40 dance — never re-derive it per file.


### 47. **Academic setup IDs and curriculum data must come from canonical contracts — never synthesize foreign keys or leave production creation on mocks (T-408 / ACAD-505, 2026-09-22; renumbered from the drafted 46 — the duplicate-number collision with the concurrent 89th session's registration-vs-application rule (§15.46) was repaired in the 90th session)**

Academic setup is an end-to-end persistence contract. Class creation must resolve academic_levels.id from grade_code; it must never manufacture identifiers such as al-1ap. A production Supabase creation path must never resolve to a mock repository that only mutates in-memory state. Subject identity belongs to subjects; contextual curriculum configuration belongs to subject_configurations; curriculum presets must be canonical, validated data rather than page-local arrays. Before seeding an “official” Algerian curriculum catalogue, independently validate the source and preserve cycle/grade/filière/spécialité applicability. Shared academic-contract changes require Desktop/Android/Website consumer census and live REST/RLS evidence.

T-408 also requires a complete cleanup of fake academic data: remove fabricated classes, fake teacher/subject/matière/module records, synthetic identifiers, hardcoded production academic arrays, demo fallbacks, and any mock/in-memory provider path reachable in production. Test fixtures are permitted only behind explicit test-only boundaries.

The terms module, subject, and matière must converge on ONE canonical subject concept. They may be translated or relabeled in the UI, but must not become separate identities, tables, IDs, repositories, seed lists, or business-rule implementations. subject_configurations is the contextual configuration layer for that canonical subject, not another subject/module identity. Audit and consolidate every existing representation across Desktop, Supabase, Android, Website, grades, timetable, class-subject assignment, imports/exports, reports, and curriculum provisioning.

This cleanup applies equally to fake IDs, fake classes, mock teachers, mock subjects/matières/modules, and placeholder academic data: production UI success must never depend on data that is not backed by the canonical persisted academic model.

T-408 / ACAD-505 is the registered repair task.

## Automatic Timetable rule — T-404

Automatic timetable generation is a system-wide domain feature, not a calendar widget. Agents implementing it MUST use the canonical academic model and a single TypeScript/Node.js timetable adapter. Do not create page-local scheduling algorithms, class/teacher/room-specific schedule stores, or solver-specific business logic.

The feature must support school-wide generation from curriculum hours, lesson durations, teachers, rooms, availability, hard/soft constraints, and class-specific free days. The Algerian school configuration must be represented as data/configuration, not scattered constants.

A packaged Electron build is mandatory. The bundled solver must not depend on the developer PATH, machine-specific paths, or an end-user-installed runtime. Development success alone is insufficient: the exact packaged application must be smoke-tested on a clean target environment, including the Windows x64 executable, with a known-good fixture and failure diagnostics.

Generated timetables must be versioned and reviewed before publication. The dedicated Timetable/Emploi du temps view is the canonical presentation surface; class, teacher, and room views consume the same schedule. See T-404 in docs/recovery/task-registry.md.

> IMPLEMENTED (T-404, 2026-09-22 — TESTED; ADR-020 is the architecture record,
> migrations 0109/0110 the canonical backend, `src/domain/model/timetable.ts` +
> `src/domain/calc/timetable/` the ONE model/constraint contract/solver adapter,
> the `timetable` repository slot the ONE persistence path, and
> docs/recovery/t-404-live-verification.md the evidence). The legacy mock
> timetable façade (teacher.ts TimetableEntry + the mock teacher-repository
> CRUD + the "Couverture EDT" KPI) is SUPERSEDED — do not extend it; its
> removal is a registered follow-up.
>
> PER-CLASS RULE (T-410 / SCHED-112, 2026-09-22 — TESTED; ADR-022): every
> generated timetable is validated and presented PER CLASS — N classes → N
> independent `ClassTimetableReport`s (the owner's nine-point checklist),
> derived from the ONE canonical validator (attribution layer, never a
> second engine), persisted in `statistics.perClass` (solver build v1.2.0+)
> and read back absence-tolerantly. Every projection (class/teacher/room)
> is entity-mandatory — the universal all-classes mixed grid ("Tout
> afficher") is REMOVED from the product surface; a null selection renders
> the honest empty state. Shared-resource clashes are attributed to EVERY
> participating class with the other class named.


## Cross-Year Debt Aging rule — T-405

Cross-year debt aging and payment-behavior status is a P0 critical financial domain feature. Agents MUST use the existing canonical financial/payment/allocation model and authoritative business rules. Do not create page-local debt calculations, arbitrary color thresholds, or a parallel debt ledger.

The system must distinguish old outstanding debt from prolonged non-payment by analyzing debt age together with payment activity across subsequent academic years, original due date, outstanding amount, last payment, and inactivity. Green/Yellow/Orange/Red are presentation of a canonical status calculation, not the business logic.

The dedicated Debt Aging / Suivi des Dettes view, financial pages, dashboards, search/filtering, reports, and all platform consumers must use the same canonical calculation. See T-405 in docs/recovery/task-registry.md.

### 48. **PostgREST embedded resources require a REAL FK constraint — a bare uuid column cannot be embedded, and mock twins cannot catch it (SCHED-103 / T-404, 2026-09-22; renumbered from the drafted 43 — the duplicate-number collision with the T-403 promotion-cycle rule (§15.43) was repaired in the 90th session)**

A PostgREST relational embed (`?select=…,other_table!hint(col)…`) resolves the relationship from an actual FOREIGN KEY CONSTRAINT in the schema — a bare `uuid` column (even with a comment promising a future FK) yields `PGRST200 "Could not find a relationship … in the schema cache"` → HTTP 400 on EVERY load, before RLS even runs. Live evidence: `class_subjects.teacher_id` had been a bare uuid since 0004 (its "FK to personnel(id), filled in 0009" comment was never honoured); the T-404 `loadProblem()` embed `personnel!left(first_name,last_name)` 400'd on the running production app while the mock-twin repository tests (9/9) and the SQL-level live matrix (27/27) were both green — the mock never parses PostgREST select strings and no SQL check exercises the REST layer. Rules: (a) before embedding a related table, prove the FK exists (`pg_constraint` / the migration that created it — comments are NOT constraints; migration 0112 closes the 0004 gap on `class_subjects.teacher_id` + `classes.homeroom_teacher_id`); (b) prefer resolving display names from a SEPARATE explicit fetch (the `personnel .in(teacher_ids)` pattern — schema-state-independent, one extra round-trip only when ids exist) unless the FK is proven; (c) any new embed query shape MUST be probed against the LIVE REST endpoint with a real JWT — `scripts/t404-postgrest-smoke.sh` models the convention (P5 sweeps EVERY embed the app sends; run it with `--expect-fk` after 0112 lands); (d) a 400 with `PGRST200` means MISSING RELATIONSHIP, `PGRST204` means missing column — read the response body, not just the status code, before touching client code.
### 46. **A migration REGISTRATION is not an APPLICATION — and a mock-era id must NEVER reach a uuid column (ACAD-506 + the 0112 false registration / T-408, 2026-09-22; renumbered from the drafted 45 — the concurrent T-407 session's composite-RPC rule owns 45)**

(a) THE FALSE-REGISTRATION TRAP — the live `schema_migrations` listed version '0112' while `pg_constraint` showed NEITHER of its FK constraints: the registration row had landed without the DDL (root cause unidentified; likely an interrupted/manual run). A version-table head is a CLAIM, not a state: before building on (or skipping) a migration, VERIFY the catalog (`pg_constraint`, `pg_policies`, `information_schema`) for the artifacts that migration was supposed to create — and when recovering, re-run the idempotent body with `INSERT … ON CONFLICT (version) DO NOTHING` on the registration (the `apply_0113_fk_0114_catalog_live.sh + apply_chain_reconciliation_0112_0114.sh` pattern). This generalizes §15.41(a): a handed-over CHAIN STATE is also a claim.

(b) THE MOCK-ID-INTO-UUID TRAP — the class-creation dialog built `academicLevelId: `al-${gradeCode}`` (a mock-era string) into the live uuid column `classes.academic_level_id` → `22P02 invalid input syntax for type uuid` → HTTP 400 on the POST-with-representation (whose console URL, `classes?select=…`, is indistinguishable from a failed GET — decode the METHOD before diagnosing). Rules: any payload field mapping to a uuid column resolves its value through a REPOSITORY (here the wired `academicLevels.getByGradeCode`) — never a locally-fabricated id; a repository class that exists but is NOT wired into a provider slot is DEAD CODE (SupabaseAcademicLevelRepository sat unwired since T-370 — writing it proved nothing); and every fresh UI↔Supabase flow gets one E2E probe against the LIVE REST endpoint with the exact payload shape (the t-408 live-verification §6 convention) because mock-mode tests cannot catch id-shape mismatches.

(c) THE PHANTOM-SCHEMA-FIELD TRAP — a zod schema field that NO rendered form field collects is an INVISIBLE validation block: the submit fails with no visible error and nothing reaches the server (ACAD-507's required `level`). Derivable fields (level-from-cycle) stay OUT of required schemas; a schema/fields drift is caught only by a submit-path test, not by a render test.

### 49. **A synthetic fallback pair is a fake-data layer — purge the WHOLE context, not just the flagged ID (T-408 / ACAD-509, 2026-09-22, 90th session)**

The 89th session closed ACAD-506 (the `al-<gradeCode>` uuid violation) but the YEAR context kept its own synthetic layer: `useCurrentAcademicYear` fabricated `id: "ay-2025-2026"` / `code: "2025-2026"` whenever no year was flagged current, and that fake id flowed into EVERY year-scoped creation payload (class, teacher, club, therapy, subject-config, timetable) plus the persisted `assessments.academic_year` string column. The lesson: **when a fake-ID defect is found, audit the ENTIRE identifier context around it — every sibling field, every fallback constant, every static default in the mappers — not only the ID the crash pointed at.** The ACAD-506 fix (resolve the level uuid through the repository) was correct and complete for its field, yet one layer up the same payload still fabricated the year.

The concrete rules:

(a) **No fallback constants for canonical context.** A hook that resolves canonical data (years, levels, tenants) returns the honest `null` when the source has no answer; every WRITE surface guards the null with a clean user-facing error BEFORE building a payload, and every READ surface renders its honest empty state. TypeScript surfaces the unsafe writers at compile time when the contract is `string | null` — let it.

(b) **Legacy denormalization on year-agnostic identity is fake scoping.** `subjects` has NO `academic_year_id` column (ADR-018: identity is year-agnostic; `subject_configurations` is the context). A mapper that "defaults" `subject.academicYearId` to a mock-era string fabricates a scoping that does not exist — and every `filter(s => s.academicYearId === year.id)` consumer then silently shows NOTHING in Supabase mode (the fake never equals a real uuid). Year-scoped subject lists derive from `subject_configurations`, never from a denormalized subject field.

(c) **A hardcoded selector list is fake academic data.** The dashboard's `AVAILABLE_ACADEMIC_YEARS` four-year array offered years the live `academic_years` table never contained (it holds exactly one). Selectors/dropdowns/defaults over academic records derive from the canonical repository; the default is the CURRENT year (the school's operating year), and a date-derived school-year window is the only acceptable last-resort default (a DATE computation, never a fabricated record).

(d) **Probe representation headers.** A bare urllib/curl POST to PostgREST returns 201 with an EMPTY body — the created representation comes only with `Prefer: return=representation` (supabase-js sets it automatically). Live E2E probes asserting the persisted FKs must send the header or they assert nothing (`scripts/t-409-live-year-payload-probe.py` models the convention).

### 50. **Live test data must be FAKE-marked, canonical-path, and purgeable — and a test dataset is a DELIVERABLE, not a residue (T-408's 91st session, 2026-09-22)**

When the owner authorizes test data in the LIVE project (the "clearly marked fake test data" mandate), three rules apply:

(a) **THE MARKER RULE.** Every seeded row carries the ASCII marker `FAKE` in a STABLE, QUERYABLE column — names/codes/labels for entities that have them; for tables with no name column (timetable_constraints), a JSONB tag inside `params` (`{"_fake": true}`). Derived tables (joins) purge through their parents. The marker must survive every read path the owner uses to inspect data (the class list, the teacher registry, the room picker, the version list).

(b) **THE CANONICAL-PATH RULE.** The seed harness drives the SAME repositories the app wires (`SupabasePersonnelRepository.createPersonnel` → `SupabaseTeacherRepository.createTeacher` → … → `SupabaseTimetableRepository.publishVersion`) — never raw SQL inserts. A seed that bypasses the repositories proves nothing about the app's real flows and can violate wire contracts silently (the ACAD-506 lesson at dataset scale). The harness signs in as the owner admin (never the service key — the service key is reserved for the PURGE, §15.41b's RLS-default-deny surfaces).

(c) **THE PURGE-TOOL RULE.** Every live test dataset ships with a purge script BEFORE the data lands (dry-run default, `--execute` gated behind the service key in env), FK-safe order, row-count asserts, post-check residue asserts, and PRESERVED-set asserts (the catalog, the owner's own rows — asserted, not assumed). Published-version cleanup goes through the documented unpublish semantics (status → draft, SCHED-109): the `timetable_entries_guard_immutable` trigger rejects DELETE/UPDATE on published/archived versions EVEN under the service role (triggers fire through the RLS bypass, and CASCADE fires them too). Audit rows ALWAYS stay (§15.26).

And the testing itself must REGISTER what it finds: the 91st session's FAKE-data E2E surfaced five genuine defects (SCHED-107/108/109/110 + ACAD-510) that a green-only run would have silently absorbed. A test harness that never fails on purpose is a fixture, not a test.

### 51. **A projection grid's visual cell key MUST carry the projection dimension — and long-running work MUST emit REAL work-unit progress, never a timer (T-409 / SCHED-111, 2026-09-22, 92nd session)**

(a) **THE VISUAL-KEY TRAP.** The timetable grid keyed its cells by `day + periodIndex` while the class view fed it EVERY class's entries: `(class A, monday, S3)` and `(class B, monday, S3)` collapsed into one visual position and a `Map` silently kept only the LAST entry — on the LIVE published version, 89 of 118 entries (75% of the timetable) were invisible. Rules: (1) a "select an entity" view NEVER treats a null/absent selection as "show everything" — it renders the honest empty state (§15.49a applied to projections); (2) a cell that can receive concurrent entities holds a LIST and stacks them — a single-slot `Map` value is an information-destroying overwrite waiting for the first collision; (3) the primary workflow's selector is MANDATORY (the class view always exposes the class selector; the "Tout afficher" option belongs to the secondary projections only).

(b) **THE FAKE-PROGRESS TRAP.** A boolean busy flag or a timer-advanced bar tells the operator nothing real. Long-running computation exposes progress through a WORK-UNIT contract (ADR-021): discrete algorithm steps with a FIXED denominator, emitted at the moment each unit completes, drained behind a yielding boundary (`solveAsync`) so the renderer can repaint — and the terminal 100% is emitted by the PERSISTENCE layer only after the result is actually saved (failure paths never emit it). `total === 0` means indeterminate — never render a fabricated percentage. Coverage of the RESULT (`placed/required`) is a SEPARATE metric from progress of the WORK; never conflate them.

### 52. **An aggregate verdict is not an entity verdict — per-entity reports must be DERIVED from the one canonical engine, and a shared-resource clash belongs to EVERY participating entity (T-410 / SCHED-112, 2026-09-22, 93rd session)**

(a) **THE AGGREGATE-VISIBILITY TRAP.** "112/118 périodes placées, couverture 97%" answered the SCHOOL's health while ONE class could be missing hours, an unscheduled subject, its teacher, or its room — with no per-class status anywhere in the product. When the owner's contract is about INDIVIDUAL entities ("each class's timetable must be internally complete and conflict-free"), validation visibility must be projected PER ENTITY, not only aggregated: a thin attribution/aggregation layer over the ONE canonical validator's output (never a second engine — the per-class checklist reuses the canonical requirement math and re-derives no rule), persisted alongside the aggregate (`statistics.perClass`) and read back ABSENCE-TOLERANTLY (pre-upgrade rows → `[]`, rendered as "no per-class data", never "all entities fine").

(b) **THE BOTH-SIDES-ATTRIBUTION RULE.** A shared-resource clash (teacher/room double-booking between classes A and B) is a defect of BOTH timetables: attribute it to every participating entity, and REWRITE each side's message to name the other ("…affecté en même temps à A et à B…") — a message that names neither side forces the operator to re-derive the conflict by hand. The same applies to teacher-scope aggregates (an overloaded teacher's verdict concerns every class that teacher serves).

(c) **THE UNIVERSAL-VIEW RETIREMENT.** T-409 kept "Tout afficher" on the secondary projections as "honest stacking"; the owner then rejected the mixed view outright ("I do NOT want one universal timetable for the entire school"). A hand-down that preserves an affordance the owner never asked for is not a fix — when the domain contract is "one entity, one timetable", EVERY projection is entity-mandatory and a null selection renders the honest empty state. Keep the LIST-cell stacking as ANOMALY TOLERANCE (a defect shows both entries, overwrites nothing) but remove the null→all-entries path from the product surface entirely.

(d) **GAPS ≠ INCONSISTENCIES.** Holes in an entity's day (free teaching periods strictly between its first and last lesson) are QUALITY warnings — reported with a count per entity, but they do not flip completeness; missing hours, unscheduled subjects, missing teacher/room assignments, and hard constraint violations do. Mirroring the canonical hard/soft scale instead of inventing a third severity keeps one semantics across every layer.

### 53. **An analytical UI layer is NOT exempt from the canonical engines — and an unregistered analytics commit must be AUDITED before it becomes baseline (the 94th session's Finance UI audit, 2026-09-23; DUP-006 / BUSINESS-106 / DATA-023; audit: `docs/audits/finance-ui-architecture-audit-2026-09-23.md`)**

The owner's `db5e159` "analytics overhaul" (2026-09-11 — no task ID, no registry entry, no ADR) shipped a complete Financial Query & Diagnostic engine whose derivations silently diverged from every canonical rule this project had already fixed: it grouped tranches by `label.includes("1")` — the EXACT substring hack DASH-404/T-354 had retired and documented; it re-derived parent credit from raw ledger rows without the reversal exclusion or the ADR-010 display convention; it computed per-service collection from `payments.category` instead of `payment_allocations`; and its "Encaisser" preset defaulted the collection category to "tuition" while the other consolidated entry points sent "other" — none of which can ever allocate a multi-category family balance (the canonical `p_category IS NULL` semantics existed the whole time). Three binding sub-rules:

(a) **THE ANALYTICAL-LAYER RULE.** A "diagnostic"/"analytics"/"intelligence" surface is a CONSUMER of the canonical engines, never a second implementation of them: balances/credits come from `computeParentSummary` + `displayParentCredit`; per-tranche remaining from `installmentRemaining` (INV-4); tranche waves from the canonical `tranche_number` grouping; per-service collection from `payment_allocations`; debt status from the §15 engine. An analytical layer may add CLASSIFICATIONS, THRESHOLDS and PROMPTS — but its thresholds must be documented in the domain rules (the INV-16c "no page-local thresholds" spirit), and its numbers must be the canonical numbers. If a needed derivation does not exist, REGISTER it as a canonical module first (the T-405 pattern), then consume it.

(b) **THE UNREGISTERED-ANALYTICS RULE (a §15.14 specialization).** An unregistered commit that introduces financial DERIVATION logic (not just UI) is not accepted as baseline by silence: the next session must audit it against the canonical rules BEFORE building on it, register what it broke, and register the unification task. The audit found db5e159's engine had been living unreviewed for 12 days across 20+ sessions while every subsequent task treated the Finance page as sound.

(c) **THE COLLECTION-CATEGORY RULE.** Any payment-collection entry point that means "the family's whole balance" must send the canonical cross-category semantics explicitly (NULL category or an ADR-approved multi-category contract) — a line item's decorative `category: "other"` (or a modal's silent `"tuition"` default) turns the canonical waterfall into a category-restricted allocation that books parent_credit instead of clearing tranches. When adding a collection entry point, state the intended allocation scope in the context contract.

### 54. **Five T-412 implementation discoveries — ID censuses, nullish defaults in test factories, Router-gated navigation children, hidden clocks in canonical engines, and hand-rolled chart legends (T-412 / WORKFORCE-504, 96th session, 2026-09-25)**

(a) **THE PROBLEM-ID CENSUS RULE (a §15.43 specialization).** The drafted WORKFORCE-501 collided with the concurrent 70th session's personnel-linkage umbrella — WORKFORCE-501/502/503 were all taken. Before registering ANY new problem ID, run a heading census (`rg -n "^### <FAMILY>-<NNN>" docs/recovery/problem-registry.md`) and take the NEXT FREE number; concurrent sessions register their own IDs without coordination, so the census must run at REGISTRATION time, not from memory. Same discipline applies to task IDs and ADR numbers.

(b) **THE NULLISH-DEFAULT FACTORY TRAP.** A test factory `salary: overrides.salary ?? 1_000_000` coerces an intentional `null` to the default — the "no salary" fixture silently becomes a 1M salary and eligibility tests mis-count. Pass explicit nulls through: `salary: overrides.salary !== undefined ? overrides.salary : 1_000_000`. This is the same class as §15.49's "audit the ENTIRE context" rule, specialized to factories: every optional field a test MEANS to falsify needs an undefined-check, never `??`.

(c) **`useNavigate` THROWS IN BARE MOUNTS — navigate from a Router-gated CHILD.** Several pinning suites render feature components WITHOUT a Router (the t-369 convention). `useNavigate()` throws at CALL time — guarding the call site's USAGE is not enough (`const navigate = useNavigate(); if (inRouter) navigate(...)` still throws). The working pattern: the parent checks `useInRouterContext()` (a plain context read, safe everywhere) and renders either a plain `<a href>` fallback or a CHILD component whose body calls `useNavigate` — the hook only runs when the child actually mounts inside a Router.

(d) **`computeTreasuryHealth` READS THE REAL CLOCK.** The T-411 treasury engine takes NO `now` parameter — `Date.now()` inside. Test fixtures with fixed dates race the sandbox clock (a "due in 10 days" installment must be built clock-relative: `new Date(Date.now() + 10 * 86_400_000)`). Contrast: `computePayrollForecast` (T-412) takes an explicit `now` — prefer that shape for every NEW canonical engine.

(e) **THE SHARED RECHARTS MOCKS PREDATE `<Legend>`.** The per-suite `vi.mock("recharts", …)` stubs (analytics-visuals, dashboard-3zone, ai-review-screens) enumerate exports by hand and have no `Legend` — a new chart importing it fails EVERY mocked test with "No 'Legend' export is defined". New chart components hand-roll their legend row (colored chips under the chart) instead of forcing every mock to grow; alternatively extend the mock in the SAME suite that needs it.

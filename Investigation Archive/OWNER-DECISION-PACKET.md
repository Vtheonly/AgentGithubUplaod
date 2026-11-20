# Owner Decision Packet — Session 4 (2026-11-19)

**What this is.** Every investigation thread that remains blocked on an owner decision, collected in one place, each with the options, the investigation's recommendation, and a proposed default. **You may answer nothing and the program still moves** — each decision below carries a proposed default (marked ⏵ DEFAULT) that the next sessions will follow unless you override it here (reply in the GitHub issue, in any order, e.g. "D-2: end, D-3: drop, rest defaults").

**Why now.** Sessions 1–4 completed the read-only investigation: the full duplication census, the UI unification plan, the Supabase coupling map (42 files / 26,684 lines; 56 RPCs; 324 RLS policies — verified this session), the data-pipeline inventory (3+ competing implementations in every category) with its unified design, and the local-first architecture blueprint. The live Supabase project is **still restricted** (`exceed_egress_quota`, re-verified 2026-11-19 — the app's live mode is broken today), which makes the local-first migration the recovery path, not an option. Two decisions (D-1, D-8) gate the start of the implementation phases; everything else can follow.

**Evidence base:** `Local-First Architecture/LOCAL-FIRST-BLUEPRINT.md` (§6, §10, §11), `Data Pipeline Unification/02-UNIFIED-PIPELINE-DESIGN.md` (§9), `Testing and Runtime Evidence/S4-CROSS-VERIFICATION-2026-11-19.md`, `Findings and Hypotheses/FINDINGS_INDEX.md` (ARCH-023/026/029, BUG-032/033/037, OPS-011/012).

---

## Part A — Local-first architecture (blocks LF-1+)

### D-1 · Sync topology — where does the relay run? ⏵ BLOCKING
| Options | Trade-off |
|---|---|
| (a) LAN relay on an always-on school PC | Zero internet exposure; sync only works on the school network; free |
| (b) Internet relay on a small VPS | Sync works from anywhere (owner's home, second site); ~a few €/month fixed cost; needs TLS + tokens |
| (c) Both (same software, two deployments) | Most flexible; double the ops attention |

**Recommendation:** (b) internet VPS, installed once by you (INV-6); LAN posture remains possible later with the same software. If the school has no reliable always-on PC, (a) is not viable anyway.
**⏵ DEFAULT: (b).** *Blocks: LF-4 (relay + cross-machine sync). LF-1..LF-3 do NOT wait on this.*

### D-2 · Android parents' cloud access — keep or end?
| Options | Trade-off |
|---|---|
| (a) Keep — relay exposes the Android pull/push surface | Parents keep the Android app; extra scope on the relay; the Android app keeps working with no Supabase |
| (b) End — desktop-only product | Android app is orphaned until it gets its own local-first story; smallest scope |

**Recommendation:** (a) keep, but only if parents actually use the Android app today; otherwise (b). The relay design (§6 of the blueprint) can expose the existing `pull_*_for_sync` keyset contract cheaply; the expensive part is Android-side QA, which is outside this repo.
**⏵ DEFAULT: (a) keep the surface, Android QA explicitly out of scope until the desktop migration is green.** *Blocks: relay API surface shape (LF-4). Note: the sibling Android repo was never provided — its cross-checks (student-code semantics, permission parity) remain open regardless.*

### D-3 · Push notifications (FCM) — pay the complexity or drop?
| Options | Trade-off |
|---|---|
| (a) Keep FCM via the relay (relay holds the Firebase credentials) | Parents get push on their phones; relay must be internet-facing; a soft Google dependency (non-fatal: push failing never blocks the app) |
| (b) Drop push; keep in-app notifications (they sync like any table) | Zero external dependencies; parents see messages when they next open the app |

**Recommendation:** (a) — the Firebase credentials already exist (`elimtiyaz-android` project), and the failure mode is graceful. If you want absolute zero external dependencies, (b) is honest and cheap.
**⏵ DEFAULT: (a).** *Blocks: LF-4 relay capability list. Note: the Firebase web API key you provided tests as processed/valid-format but could not be functionally verified with a non-mutating probe; the relay spike (LF-4) will verify FCM end-to-end.*

### D-4 · Hosting appetite — is ONE small self-hosted service acceptable?
This is the keystone question. INV-6 of the blueprint assumes you accept running one small service (the relay). The alternative is the zero-server CRDT fallback, which the blueprint scores clearly worse: it **forces the SQLite engine switch** (rejecting PGlite), which means rewriting the 56 SQL RPCs and 21 academic state machines in TypeScript — roughly doubling LF-1/LF-2 and moving the biggest correctness risk from "runs the proven SQL" to "re-derives the SQL".
**Recommendation:** accept the one service. It is optional to app function (the school runs fully offline; only cross-machine sync pauses if it dies), it is un-metered, and it reuses the app's own already-tested sync machinery.
**⏵ DEFAULT: accept (one service).** *Blocks: the entire LF-4 design; if you refuse any server, the engine decision (PGlite) must be re-litigated — say so explicitly and everything downstream changes.*

### D-5 · Timeline vs Supabase stopgap
Two separate things, often confused:
1. **The one-time export:** the final data extraction from Supabase into the local DB **requires the spend cap lifted exactly once** (a few hours, GET-heavy, while the LF-1 build runs the extraction script). Without it, the freshest seed is the last t-368 workbook / vault archive and whatever changed since is lost. This is unavoidable — no engineering path around it (blueprint §8).
2. **A paid Supabase plan as a temporary live-mode stopgap during LF-0..LF-3:** the blueprint recommends **against** — paying extends the coupling this migration exists to remove, and the school can run on local mode from LF-1 onward.

**⏵ DEFAULT: lift the cap once for the export (when told to — Session 5+ will give 24h notice in the issue); do not buy a stopgap plan.** *Blocks: the final migration weekend (after LF-1).*

### D-6 · Mock-slot features — persist or delete? ⏵ shared with question 5
Five features still write to in-memory mock stores even in live mode (ARCH-006): **clubs, psychology, orthophonie, aiConfig, performanceReviews**. Their data vanishes on app restart. LF-1 forces the choice: give them real local tables (they are small; the local DB creates all 100 tables anyway) or delete the features.
**Recommendation:** **persist** psychology/orthophonie (medical domain — therapy attachments are already a data-loss bug BUG-032, and medical data must not vanish), persist aiConfig (it is configuration, trivial), decide clubs/performanceReviews by whether anyone uses them.
**⏵ DEFAULT: persist all five (least destructive; deletion remains possible later).** *Blocks: LF-1 slot list; ROADMAP 3.7.*

### D-7 · Google OAuth + global sign-out — drop or keep via relay?
Google sign-in is a GoTrue feature; global sign-out ("sign out of all devices") needs a token revocation surface. Under local-first auth (scrypt + local sessions), both need relay support to survive.
**Recommendation:** **drop Google OAuth** (the desktop is a school-internal tool; username/password locally is simpler and removes an external identity dependency); keep global sign-out as a relay broadcast (cheap).
**⏵ DEFAULT: drop OAuth, keep global sign-out via relay.** *Blocks: LF-2 scope.*

---

## Part B — Data pipeline (blocks P-1+)

### D-8 · Live-restore semantics ⏵ BLOCKING
Today restore only swaps the in-memory mock store (ARCH-029/R-1 — verified). The unified design ships a RestoreService that replays archives into the real store through the one commit path. Question: once local-first lands (single-writer local DB), should restore-into-the-live-store be **enabled by default** (one-click, with automatic safety backup + preview + dry-run) or **stay operator-gated**?
**Recommendation:** enabled by default in local mode (the local DB is single-writer and the safety backup refusal rule already exists); relay/live multi-user replay stays gated.
**⏵ DEFAULT: enabled locally, gated for multi-user replay.** *Blocks: P-2.2, and the restore UX copy.*

### D-9 · Server metadata mirror (backup_archives rows) — keep or drop?
The backup vault is local-authoritative; the Supabase `backup_archives` table is a best-effort metadata mirror (ciphertext never leaves the vault). Under local-first the mirror is pointless unless the relay reuses the table for cross-machine backup discovery.
**Recommendation:** **drop** the mirror at LF-5 (with the reconciliation alarm H-9 as the interim); the vault is the system of record.
**⏵ DEFAULT: drop at LF-5.** *Blocks: P-3 retention wiring, H-9.*

### D-10 · Checkpoint honesty — relabel or build a workbook import schema?
The excel-zip/checkpoint advertises "recovery via Excel import", but the 13-sheet full-export layout has no import schema (the engine reads ETAT/BON/DEVIS/REF only — BUG-033). Options: (a) build a 13-sheet import schema (heavy, low value once the canonical archive exists), (b) relabel the checkpoint as a human-readable report with partial ETAT-family recovery.
**Recommendation:** (b). The canonical encrypted archive (v2) is THE recovery format; Excel is for humans.
**⏵ DEFAULT: (b) relabel.** *Blocks: P-3.4.*

### D-11 · `debtSummaries` — derived (recompute) or stored (14th stream)?
Debt summaries are computable from ledger+installments (the t-368 suite itself computes them). Storing them invites drift; excluding them means restore recomputes (a few seconds).
**Recommendation:** **derived** (excluded from the perimeter; recomputed on restore). If you need point-in-time debt snapshots for audit, say so and it becomes a 14th stream (one registry row).
**⏵ DEFAULT: derived.** *Blocks: P-2.3 perimeter finalization.*

### D-12 · DEAD-013 fail-closed choice
The import engine has unreachable abort modes (enum values no path produces). Choose: (a) make them reachable (defensive paths for future formats) or (b) remove the enum values (fail-closed, smaller surface).
**Recommendation:** (b) remove — the codebase's own discipline (t-415, fail-loud dispatch) prefers honest failure over speculative paths; ROADMAP 4.8 owns the change.
**⏵ DEFAULT: (b) remove.** *Blocks: ROADMAP 4.8; P-0 import-engine touch-ups.*

---

## Part C — Standing product decisions (SESSION_LOG question 5 — unchanged, non-blocking)

These predate the architecture work and remain owner-gated; none block LF/P phases: `/personnel` safe-harbor intent; Ctrl+O autofill in production; `deliverables/` retention; DepartmentManagement wiring; mock-slot feature staging (now folded into D-6).

## Part D — Owner actions outstanding (no decision needed — flagged for awareness)

1. **OPS-012:** a credential sheet inside the repo (`docs/operations/credentials.md`) carries a real admin password. Recommendation unchanged: rotate + redact; history-purge decision per OPS-001 precedent. This archive will not edit files outside its two folders.
2. **OPS-013 (new, Session 4):** the Vercel PAT you provided tests as invalid (revoked or mistyped). If Vercel matters to the website workflow, rotate it; the investigation does not need it.
3. **OPS-011:** the Supabase management access token tests as invalid, and the project remains restricted. When you are ready for the final export (D-5.1), lifting the spend cap is sufficient — the REST path works with the secret key once unrestricted; a fresh management token would additionally enable the census ceremony if desired.

---

## Part E — Session 15 addendum (2026-11-20): the pedagogy-unification lane decisions (D-13..D-16)

*Staged by the dedicated Pedagogy Unification, Relational Linking & Legacy Deletion mandate (Deep Sweep/11). None of the four blocks execution of the read-only investigation; all four gate their respective T-numbers in the folded lane (EXECUTION-PLAN v1.1, T-561..T-571).*

### D-13 · Curriculum & assessment coverage — the recipe A/B (carried from S14; gates T-566)
The school's real bulletin tracks 8 mark families (تقويم تشخيصي / الكراس / المشاركة / الواجبات / السلوك / استجوبات كتابية / شفاهية / غيابات) while the app models 4 components (D1/D2/EX/CC + attendance).
| Options | Trade-off |
|---|---|
| (a) Adopt the official-bulletin composite: the 8 families become recipe components (per-dimension averages per subject, then coefficient-GPA) — matches the workbook layout | The GradingRecipe engine (Σ mark×weight / Σ weight) already supports arbitrary components; B stays a configuration via weight presets |
| (b) Keep the current D1/D2/EX/CC recipe; treat the workbook's families as display groupings | Zero engine change; the bulletin PDFs understate the school's real dimensions (the current coverage gap ARCH-042 stays) |

**⏵ DEFAULT: (a)** — staged as new recipe components with per-`SubjectConfiguration` weight presets so (b) remains a configuration, not a fork. *Blocks: T-566 (P-U4); the P-U5/T-567 importer's mark-mapping table.*

### D-14 · `parent_student_links` — adopt the junction or drop it? (gates T-568)
The multi-guardian junction is fully designed (relationship + is_primary + uniqueness + RLS, 0005:89-98) but has ZERO application consumers (DEAD-020); every guardian/sibling fact squeezes through the single `students.parent_id`.
| Options | Trade-off |
|---|---|
| (a) Adopt as the canonical chain: backfill one is_primary link per live student from `students.parent_id`; `parents.relationship` migrates onto the link rows; guardians become first-class | One migration + the write-path invariant (trigger or service keeps parent_id = the primary link); zero data loss; multi-guardian families become operable |
| (b) Drop the table; stay single-parent | Simplest; permanently loses the multi-guardian capability the schema already paid for; `parents.relationship` stays mis-scoped (per parent, not per link) |

**⏵ DEFAULT: (a) adopt.** *Blocks: T-568 (M-U4); every parent-view surface that will render guardians.*
### D-15 · The teacher year-scoped profile fields — delete the phantom or persist it? (gates T-569)
`maxWeeklyHours`, `qualifiedSubjectIds`, teacher `code`, per-year `status` exist ONLY in the domain/mock layer — the Supabase repository rejects them ("have no personnel column"); teaching facts live on `class_subjects`/`homeroom`/`timetable_entries`/`homework` (all FK→personnel).
| Options | Trade-off |
|---|---|
| (a) Delete the phantom write-surface: Teacher collapses to a personnel read-model; qualification = the derived class_subjects pairs | 47 references/10 files to rewire (mechanical); zero feature loss TODAY (nothing persisted them); matches the "Teachers ARE Workers" mandate exactly |
| (b) Persist a minimal `teacher_profiles` table (year-scoped, FK personnel) and keep the fields | A real (small) migration + UI; preserves the option of per-year teaching contracts (hours ceilings for the timetable solver) at the cost of a second year-scoped entity the mandate is trying to eliminate |

**⏵ DEFAULT: (a) delete.** If the timetable solver later needs hours ceilings, re-introduce them deliberately as solver constraints (on personnel), not as a second teacher entity. *Blocks: T-569 (M-U1/M-U3).*
### D-16 · `service_enrollments` — portal seam or chain fold? (gates the T-570 documentation; non-blocking)
The billing-side enrollment table is consumed only by the website portal (`useServiceEnrollments`); the desktop writes ledger+installments directly.
| Options | Trade-off |
|---|---|
| (a) Keep as the PORTAL's documented billing seam | Zero migration; the divergence is documented + guarded; the portal keeps its contract |
| (b) Fold into the canonical enrollment chain at LF-0 | One fewer representation; a portal migration the desktop program would own |

**⏵ DEFAULT: (a) keep as the documented seam.** *Blocks: the T-570/M-U5 seam documentation only — a one-page note in the P-U8/M-U10 ADR batch.*

---

## Part F — Session 22 addendum (2026-11-20): the owner's LOCKED-IN architectural decisions (D-17..D-19)

*Issued in the final blueprint-consolidation mandate and applied across `Refactoring Unified/` v2.0 (BLUEPRINT.md, ROADMAP.md, EXECUTION-PLAN.md). These are **decisions, not defaults** — they supersede every conflicting ⏵ default and draft claim below them. Corrections register: C-23 onward (none used yet).*

### D-17 · Hybrid offline-first desktop + lightweight Supabase sync & web portal — **LOCKED IN** (supersedes D-1, D-4, and the LF-4/LF-5 designs)

**Supersedes:** D-1 (sync topology — no custom VPS relay is built); D-4 (one self-hosted service — no relay service at all); the LOCAL-FIRST-BLUEPRINT §6 relay design; ROADMAP 7.4 (LF-4 "sync relay") and 7.5 (LF-5 "Supabase demotion + teardown").

**The decided architecture:**
- **Do NOT drop Supabase.** Supabase remains the shared cloud layer purely for **multi-user / multi-device syncing** and **web-portal / client-portal viewing** (parents and clients see synced data on the web portal and mobile).
- **Desktop must work offline-first:** Windows users read, edit, add, and transact completely offline against the local primary store, then cleanly synchronize deltas to/from Supabase when online — never blocked by internet drops, never doing bloated cloud queries on UI navigation.
- **Stage A (immediate) — egress survival, query minimization & portable Supabase relocation:** fix the five-site toast-churn loop (T-559 + T-560 ×5) and the mock/offline 30 s health-probe drip (BUG-058 → T-594); fix all `max_rows = 1000` silent truncations (BUG-059..063 → T-590/T-591); execute the complete query-size/bandwidth minimization architecture (BLUEPRINT §14: T-590..T-593 + T-595); implement T-573 (BackendProfile main-process runtime config switcher — superseding T-551's hard-lock removal scope and E1.7's declaration deletion), T-574 (UUID-preserving auth export/import + email remap), T-575 (one-command target preflight), OPS-016 (packager unlock) and ARCH-046 (config.toml ↔ functions/ sync) so relocating off the quota-blocked project is effortless with zero data loss.
- **Stage B — local primary persistence syncing with Supabase (LF-1..LF-3 + unified pipeline P-0..P-4):** PGlite local DB in the main process behind `DataBackendPort` + `BackendProfile` so desktop reads/edits happen locally first with zero egress on UI navigation; deltas sync to/from Supabase via Stage A's minimal-size batch RPCs and the existing `0143` `(updated_at, id)` keyset delta pulls. **E3/ROADMAP Phase 2 is explicitly reconciled:** the EF/SQL fixes (run-overdue-scan, collect-payment, ai-proxy, workflow-execute) stay valid on Supabase for web/mobile parity while the desktop executes the same engines locally first — v1.x's "2.3/2.4 die at LF-3" deletion rule is REVERSED.

**Consequences for earlier defaults:** D-2 (Android cloud access) and D-3 (FCM push) dissolve as relay questions — the Android app and web portal keep consuming Supabase directly (no relay surface needed); FCM keeps flowing through the existing `update-server-secret` EF path. D-5's one-time cap lift for the final export remains standing (it seeds the local DBs), now preceded by the Stage A relocation lane (T-573..T-575) so the new project can be the export source. D-8/D-9's "at LF-5" anchors re-anchor to "at Stage B completion (T-602)"; D-6/D-10..D-12 are unaffected. The LF-0 lane (T-550..T-553) is unaffected and remains the seam foundation.

### D-18 · Google OAuth STAYS — **LOCKED IN** (supersedes D-7)

**Supersedes:** D-7's default ("drop OAuth, keep global sign-out via relay"). Google OAuth is kept for Supabase relocation and web-portal parity. The concrete task family (Deep Sweep/07 §D9–D10 → T-597):
- New **Settings → Account & OAuth** section to modify/switch the linked OAuth login account (`getUserIdentities`/`linkIdentity`/`unlinkIdentity`/`updateUser` wiring; the dead `signInWithGoogle` at `supabase-auth-repository.ts:240-252` becomes a live, Electron-callback-correct surface).
- Transactional **`replace-user-identity`** Edge Function (create-new → re-point `user_profiles.auth_user_id`, `parents.auth_user_id`, `students.auth_user_id`, `activation_codes.bound_to_auth_user_id` → delete-old last → audit) and decoupling of the plain portal-binding columns (no FK today — a missed swap silently revokes portal access).
- Replace the hardcoded `OWNER_PINNED_ADMIN_EMAIL="admin@elimtiyaz.dz"` literal (`delete-user-account/index.ts:69`) with a DB `is_owner_pinned` flag so swapping or removing a user's Gmail keeps their profile and 100% of historical data intact (payments/audit/personnel already reference the surrogate `user_profiles.id` — history survives by construction).

### D-19 · Entire app = white / light theme + dashboard overhaul + modal/copy simplification — **LOCKED IN** (overrides `05-unified-foundation-spec` §6)

**Overrides:** the old "keep dark-glass colors" rule (BLUEPRINT §12's dark-glass preservation, EXECUTION-PLAN E6's foundation-spec carry-through). The decided experience lane (T-576..T-596):
- **App-wide white/light theme** (Deep Sweep/07 §E11 → T-589): flip the default theme (`index.html:2`, `DEFAULTS.theme`, preset order, `electron/main.cts:19` `backgroundColor`, `index.html:6` meta theme-color), fix ARCH-036 (`--brand-blue-deep`/`--brand-blue-light` `-rgb` parity + static-hex tailwind maps), fix BUG-039 (`--radius-pill`), remove DEAD-017 (accordion keyframes), tokenize all hardcoded dark hexes (279 hex literals / 24 files; the timetable-grid pastels, the duplicated personnel token map → `resolveToken`, chart/diagram SVGs, workflow model, mock workforce).
- **Dashboard overhaul** (ARCH-040 + BUG-059 + D-U1..D-U5 → T-590/T-596): fast, minimalist, uncluttered, non-amateurish, self-explanatory for an average user; **one single calculation engine shared by Dashboard and Payments/Finance so the numbers can never diverge**.
- **Modal text & jargon purge** (Deep Sweep/07 §B6/E12 → T-586): cut bloated modal text, purge all 45+ internal jargon leaks (`INV-`, `T-`, `ADR-`, `§`, `DATA-`, `waterfall`) from user-facing strings, standardize Payment Details around **Prix / Prix justifié / Couverture**, and fix BUG-057 (unify the four formatters on `formatDzd*`, kill the raw `toLocaleString` NaNs, standardize the `DZD` suffix).




### The v2.0 reconciliation register (record-level corrections folded into the blueprint phase)

| # | The prior-draft conflict | The v2.0 resolution |
|---|---|---|
| R-1 | E1.7 / ROADMAP 0.7 ("align `vite-env.d.ts` — delete the phantom `Window.elImtiyaz` type members") vs T-573 (the real main-process config bridge) | **T-573 governs.** The `vite-env.d.ts` `window.elImtiyaz.config` declarations are KEPT (not deleted) and become TRUE — T-573 implements the real `electron/preload.cts` main-process config bridge they describe. E1.7's residue (the `app`/`fs` members T-573 does not build) is narrowed to a doc note. |
| R-2 | E2.4 / C-1 (devis service composing `school-price-matrix` constants) vs ARCH-037 (the matrix is stale and year-blind) | **ARCH-037 governs.** The canonical devis engine depends on and uses **per-year `yearPricingConfigs` + the updated `2027-2026.xlsx` pricing** — it must never cement `school-price-matrix.ts`'s stale, year-blind `REAL_TUITION_BY_GRADE` (2026-2027) fallback; T-587 regenerates/deletes that fallback matrix and threads per-year resolution. |
| R-3 | BLUEPRINT §1.2 #2's claim that the t-502 parity failure proves a "parallel overdue predicate" divergence | **Withdrawn.** The failure was BUG-038 (the finance adapter's hard-coded wall clock — a hermeticity defect, date-deterministic since 2026-10-16), fixed by T-549; the three surfaces share one predicate since T-502. §1.2 now attributes the defect correctly. |
| R-4 | T-561's M-U2 scope ("six dual-condition sites") | **Corrected to 8 sites** (class-detail-page.tsx:205 and academic-year-detail-drawer.tsx:248 added — DS/12 §3) + the BUG-065 medical-bridge parity test as a deletion precondition. |
| R-5 | Mixed counts across v1.x drafts (496 `.from()`; 89 `auth.uid()`; 39 table files; 90 title=; 165 useObservable; 68 modal importers; "~14/16" bypasses) | **The census-corrected counts govern everywhere:** 413 real `.from()` table queries (C-14) · 69 executable `auth.uid()` (C-8) · 40 hand-rolled `<table>` files (C-15) · 194 `title=` / 102 files (C-10) · 359 `useObservable` / 105 files (C-13) · 70 modal files / 114 usages (C-19) · 17 `supabase-client` bypass files (C-11). |

## Part G — Session 23 addendum (2026-11-20): the unified-Excel-engine lane (D-20 — the owner's mandate, staged with ⏵ defaults)

**The mandate core is LOCKED by the owner's own words** (Session 23, the unified-Excel mandate): ALL Excel processing engines unified; ALL supported formats resolve through ONE unified entity-resolution and financial-semantic model; the new distinct financial format (`CLIENT CRITIQ` — the family-level critical-debtor state) MUST remain supported as a separate input format; performance is a top priority without compromising 100% calculation accuracy or DB integrity. The architecture of record: DS/13 §5 (the X-lane, X-U1..X-U8) → ROADMAP Phase 9 / EXECUTION-PLAN §13 / BLUEPRINT C-X (T-603..T-611).

### D-20 · The unified-Excel-lane semantic choices — staged with ⏵ DEFAULTs (gate T-604/T-608/T-609)

| # | Question | ⏵ DEFAULT (executes unless the owner answers otherwise in Issue #32) | Evidence / consequence |
|---|---|---|---|
| 1 | **Multi-sheet historical workbooks — what imports by default?** | **Current-year sheets only.** Every other `^ETAT`-family sheet is listed excluded-with-reason (its own year identity available on explicit selection); the detection contract gains the reject gate (T-603) so nothing auto-adopts. | BUG-066/067 (the 188 corrupted balances; the EGV catastrophe); DS/13 §6.2–6.4 |
| 2 | **`CLIENT CRITIQ` mapping** | **Family-level debtor state:** Montant → the family's outstanding-charge snapshot (charge, `critiq:` deterministic sourceId); Garanti/Obs/markers → metadata; the roster panel resolves students through the unified resolver; `N ENFANT` vs panel length cross-checks → warnings, never silent drops. | DS/13 §5 X-U5; RUN D (23 families / 48 children / 31,584,600 DZD) |
| 3 | **`Etat General Versement` disposition** | **Its own adapter (the payments-ledger format)** — its column contract honored, never auto-detected as an ETAT roster; ground-truth oracle = its own owed/paid/remaining columns. | DS/13 §6.4 (the mis-mapping quantification); T-609 |
| 4 | **BON / Devis / REF sheets** | **Canonical targets OR explicit excluded-with-reason** — the tracked-only no-op ends (either receipts/quotes become importable documents, or the sheets are visibly classified out). ⏵ default: the explicit classification first (documents later, on request). | ARCH-048 |
| 5 | **ER-PMAE graduation mode** | **Definite-band auto-accept + probable/review proposals + legacy exact fallback** (INV-50 unchanged: nothing merges without confirmation outside the definite band; BUG-040's backfill lands with it). | DS/13 §3.3/§5 X-U3; the t-438/t-439 contracts |

*The lane's own gate discipline (DS/13 §8 G1–G7 — 100% of rows, 0 DZD delta, zero remote calls) precedes ANY live traffic; the standing OPS-011 cap-lift order is unchanged.*

*End of packet. Decisions can be answered piecemeal in GitHub Issue #32; unanswered items follow the ⏵ DEFAULTs above from Session 5 onward — EXCEPT where D-17/D-18/D-19 (locked in, Session 22) and the Session-23 mandate core (D-20's header) supersede them. No application source, configuration, schema, or dependency was modified in producing this packet or the v2.0 blueprint it governs.* No application source, configuration, schema, or dependency was modified in producing this packet or the v2.0 blueprint it governs.*

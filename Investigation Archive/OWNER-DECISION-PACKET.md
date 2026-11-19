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

*End of packet. Decisions can be answered piecemeal in GitHub Issue #32; unanswered items follow the ⏵ DEFAULTs above from Session 5 onward. No application source, configuration, schema, or dependency was modified in producing this packet.*

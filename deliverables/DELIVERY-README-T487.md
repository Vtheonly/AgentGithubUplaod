# DELIVERY — T-487 (the 143rd session, 2026-10-04)

## What this delivery is

The owner's purge/restore/import **safe-testing mandate**, delivered end-to-end:

> "I am not sure whether the Purge button is truly working correctly, and I want to test it thoroughly. However, I absolutely do not want to lose the current production data. […] verify that the three workflows work together correctly, for example: Backup → Purge → Excel Import → Verify Imported Data → Restore Backup → Verify Original Data."

**The verdict: all three systems work, the workflow composes, and the one real defect found is fixed.**

## The two zips

| Zip | Contents | Verified state |
|---|---|---|
| `AgentGithubUplaod-T487.zip` | The hub repository (desktop + backend + docs) at `f55f3d5` | The unified battery GREEN (typecheck 0 · vitest 4,779/0/5 BASELINE-MATCHED · the equivalence layers) · the live E2E 73/73 |
| `elimtiyaz-android-T487-session.zip` | The Android repository at `75377c7` | Unchanged this session (the T-476 ADR-033-aligned state); delivered per the "zip all the systems" mandate |

## What was verified (the live E2E — `elimtiyaz-desktop/scripts/t-487-workflow-e2e.ts`, 73/73 GREEN)

The full cycle executed in a **dedicated FAKE-marked test tenant on the live project** — the isolation boundary is the system's own RLS tenant-scoping, and the production data was re-censused at EVERY phase (byte-identical throughout: parents 741 / students 1,137 / payments 2,198 Σ 162,713,000 DZD / installments 5,956 / ledger 3,342):

1. **Excel Import** — the REAL production workbook through the REAL engine: the imported census is **byte-identical to production** (every count + every financial sum), zero student→parent orphans, per-row spot checks against the workbook's own cells. Edge cases: the duplicate row creates ONE student; the two-student family resolves to one parent; the missing-NEM row imports through the placeholder fallback; the no-NOM row is rejected; the re-run is fully idempotent.
2. **Backup** — through the app's exact Settings → Sauvegarde path: the archive decrypts + verifies, its payload carries the FULL server state, and the server metadata mirror carries the rows. **The defect found and fixed (BKUP-508):** the backup used to read the UI caches synchronously — a backup right after an import captured 741 parents and silently ZERO payments; a backup on a fresh app captured an ALL-EMPTY "verified" archive. **The fix:** the backup now warms every source from the server before snapshotting (demonstrated live pre-fix, verified live post-fix).
3. **Purge** — through the app's exact Zone de danger call: the dry-run counts the exact blast radius (14,115 rows) and deletes nothing; the wrong phrase is refused server-side; the EXECUTE removes every domain family with ZERO residue; the backup archives SURVIVE; the audit entry is written; the sync/backup RPCs untouched.
4. **Re-import after purge** — identical family-for-family to the first import (the purge genuinely resets the domain for a clean rebuild).
5. **Restore** — the archive restores into the offline operating layer with the full state (741/1,137/2,198/5,956/3,342), zero orphaned references, the restored-mode marker, and the server mirror's `restored` transition.

**Full evidence:** `docs/recovery/t-487-live-verification.md` (in the hub zip).

## The honest residuals

- **BKUP-509 (owner-gated):** the backup's 8 collections do not cover the activation codes (the purge deletes them; the re-import re-issues fresh ones; the archive never carried them) — a backup-format v2 decision.
- **The restore's server boundary** (documented since T-415): restore rehydrates the OFFLINE operating layer; full server rehydration stays the Excel-import path. The restore modal says "état opérationnel local" — accurate.
- **The deactivated test tenant**: an audited tenant cannot be deleted (the FK cascade into the append-only audit journal) — the FAKE-marked tenant row remains deactivated as the forensic record; zero active residue otherwise.

## The repository state

ONE authoritative `main` branch (the 14 residue refs + the task branch deleted after the ADR-028 rule-2 containment census — every commit remains reachable from main). The concurrent agent's note: any local branch can still push (a deleted remote ref is recreated harmlessly).

## How to run the app from the zip

See the hub zip's `AGENTS.md` §11 (desktop: `cd elimtiyaz-desktop && npm install && npm run dev` / the packaged build via `build-windows.sh`; the backend is the live Supabase project).

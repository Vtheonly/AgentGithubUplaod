# Supabase Relocation & Zero-Data-Loss Re-Sync Runbook — Session 13

**Date:** 2026-11-19 · **Session:** S13 · **Status:** DESIGN (read-only audit output; no code changed)

**Owner goal (verbatim intent):** Supabase does not have to be ripped out immediately, but it must be cleanly decoupled so the app can (a) keep using Supabase, and (b) **relocate/reconnect to a new Supabase account or project — or swap the backend entirely — without manually rebuilding, copying, re-uploading and re-downloading everything, and without losing any data** between offline work and backend relocation. End users are non-technical Windows operators: no backend configuration, no migration tooling, no cloud-console work may ever reach them.

**Relationship to the existing record:** `LOCAL-FIRST-BLUEPRINT.md` (S3) covers the permanent architecture (PGlite local engine, DataBackendPort, relay sync, LF-0..LF-5) and its §8 covers the one-time Supabase→local data migration. **This runbook covers the case the blueprint does not: staying on Supabase while moving BETWEEN Supabase projects/accounts.** The two share the same end-state: once LF-0..LF-5 lands, relocation degenerates to "change the sync-target profile and re-sync" (§6).

---

## §1 — What currently prevents "plug in a new project and go"

Each blocker is file:line-real; none is speculative.

| # | Blocker | Evidence | Severity |
|---|---|---|---|
| 1 | **The canonical-fallback config seam (the "two-gates family")** — parts of the app resolve the Supabase URL/keys from a compiled-in canonical fallback, NOT from the effective runtime config: the data layer honors the local toggle but the connectivity layer (health probe) does not, and the Configuration tab's refetch gate falls back to canonical keys | C-20 (bare dev defaults to LIVE canonical); BUG-042 (configuration-tab.tsx:85-105 × toast-provider.tsx:57-70 × canonical-key fallback); BUG-058 (`online-detector.ts:171-182` resolves `probeUrl` from the canonical fallback) | **BLOCKER** — after a profile swap, these paths would keep hammering the OLD project. T-559/T-560 + the BUG-058 probe fix are the prerequisite of ANY relocation. |
| 2 | **No profile concept** — a backend is identified by `SUPABASE_URL` + publishable/secret keys resolved through `supabase-client.ts` (292 lines) + per-machine `localStorage` (`el-imtiyaz.local-config` toggle, `el-imtiyaz.session`); there is no versioned, exportable "backend profile" object and no swap ceremony | supabase-client.ts; S3 SUPABASE-COUPLING-MAP §seam | HIGH |
| 3 | **Auth users live in the old project** — accounts are Supabase Auth rows; their UUIDs are baked into `user_profiles`, audit rows, `collected_by`/`actor_id` fields. A new project starts with ZERO users → nobody can log in, and re-created users get NEW UUIDs that orphan every historical attribution | 0123 gates (`has_any_role`, `current_tenant_id`); `getTenantId/requireTenantId/getActorId` (shared:166-186); config.toml `[auth]` | **BLOCKER** unless IDs are preserved |
| 4 | **The migration chain must exist on the target** — 152 migrations incl. the MIG-TOKENS registration block; RLS (324 policies / 108 enables), triggers, functions, the 0123 collections, the 0034/0041/0042/0049/0111 MV estate | supabase/migrations/* (S3 coupling map; S2 live census: 100 tables / 14 views / 5 matviews) | BLOCKER (mechanical: `supabase db push`) |
| 5 | **Edge Functions + secrets** — 16 EFs incl. `collect-payment`, `generate-receipt-pdf`, `ai-proxy`, `refresh-materialized-views`; secrets (`CRON_SECRET`, service key, AI keys) must be re-provisioned | supabase/functions/*; config.toml:91-138 | HIGH (some features silently degrade) |
| 6 | **Storage objects** — proof documents (`proof_path`/justificatif), any bucket assets; the DB rows carry URLs/paths that must remain valid | BUG-032 context (therapy attachments); payments `proof_path` | MEDIUM (depends on usage volume) |
| 7 | **Tenant + reference data** — the tenant row, roles, academic years, pricing configs, transport destinations, services, discounts; no seed ceremony exists for a fresh project beyond the migration chain's defaults | pricing repo (S2 dashboard/settings audits); 0123 `current_tenant_id()` | MEDIUM |
| 8 | **`sync_queue` + local offline queue state** — the server `sync_queue` table (0027) holds the processed-audit trail; the local IndexedDB store holds pending offline edits; entries carry tenant/actor IDs and base payloads for the 3-way guard | default-push-handler.ts:73+; sync-service store + fallback (S3 pipeline inventory; C-6: 5 producer / 8 push-path kinds) | HIGH for zero-data-loss (§4 phase 5) |
| 9 | **The renderer caches** — 9 SubjectBehavior caches + `CacheFreshness` TTL/focus re-seed self-heal after a swap, BUT the first post-swap volley re-downloads everything (see OPS-015 class 1) and any mid-swap offline edits must not be lost | cache-freshness.ts:32-66 | LOW (self-healing) once §1 blockers are fixed |
| 10 | **The integrity surfaces that would CATCH a bad relocation are themselves broken** — `reconcile()` cross-checks on truncated inputs (BUG-061) and restore never replays to the live store (ARCH-029/R-1) | DS/09 §1.4; S3 pipeline inventory R-1 | **BLOCKER for the verification gates** — fix first |

---

## §2 — Target concept: the BackendProfile

A single, versioned, exportable profile object replaces scattered env/localStorage resolution:

```
BackendProfile {
  id, label,                 // "Supabase EU-1 (old)", "Supabase EU-2 (new)", "Local relay"
  kind: "supabase" | "local-relay" | ...,
  url, publishableKey,       // never the secret key in the renderer (main-process vault only)
  projectRef, region,
  schemaVersion,             // last applied migration number (e.g. 0152)
  tenantBinding,             // the tenant UUID this installation operates as
  syncedAtCursor,            // last confirmed sync watermark (ADR-004 sequencing)
}
```

**One resolver, zero fallbacks:** a single `EffectiveBackendConfig` service (main process, exposed via the existing preload bridge) becomes the ONLY source every consumer reads — the data client (`supabase-client.ts`), the online detector (BUG-058 fix), the diagnostics runners, the Configuration tab (BUG-042/T-559 fix), the EF callers. The compiled-in canonical project demotes to "factory default profile", not a silent fallback. This is exactly the T-559/T-560/BUG-058 family fix, generalized.

**This is also the DataBackendPort's config half** (LOCAL-FIRST-BLUEPRINT §5): the profile is what sits BEHIND the port, so the UI/domain/storage never learn which backend is active.

---

## §3 — The relocation procedure (Supabase → Supabase, zero data loss)

Sequenced phases with verification gates; every phase is automatable — the end user at most clicks "Relocate backend…" and picks a profile file. Preconditions in **bold** are hard.

### Phase 0 — Preconditions (owner/engineer)
- **T-559/T-560 + BUG-058 fix executed** (single-source config; no canonical fallback anywhere).
- **ARCH-029 fixed** (restore replays to the live store) or the restore verification in Phase 4 done out-of-band.
- **BUG-061 fixed** (reconcile over full collections) so the Phase-4 gate is trustworthy.
- **The S11 §A1.5 legacy-row reconciliation completed** (1,281 pre-T-424 paid>due rows resolved or explicitly accepted) — otherwise the new backend inherits the ×10-adjacent confusion.
- Spend cap lifted on BOTH projects for the transfer window (the old project needs egress headroom for one final full export; OPS-011 is the standing blocker today).
- A canonical **backup v2 archive** taken locally (the unified pipeline's format, S3 02-UNIFIED-PIPELINE-DESIGN) — the rollback artifact.

### Phase 1 — Provision the target project
1. Create the project (any region; eu-west-1 for parity).
2. `supabase db push` the full migration chain (152 migrations; MIG-TOKENS registration rides along) → verify `schema_migrations` count and the 100-table census shape (S2 LIVE-CENSUS method, GET-only).
3. Deploy the 16 Edge Functions; set secrets (`CRON_SECRET`, service key, AI keys); create storage buckets with matching names/policies.
4. Seed reference data: the tenant row, roles, academic years, pricing configs (export from source via the existing export paths — these are small tables; the 0123-style jsonb dump is sufficient).

### Phase 2 — Export from the source (one-time ceremony; reuse the staged ones)
1. **Data:** the E7.9 final-export ceremony (EXECUTION-PLAN §4) — full canonical export. Alternative/complement: `pg_dump` through the pooler (ports verified OPEN, S13 probe P9) for a byte-exact table copy including sequences and constraints.
2. **Auth users:** admin API listing incl. IDs, emails, raw_user_meta_data, app_metadata (NOT passwords — Supabase does not export password hashes; see Phase 3 note).
3. **Storage:** object listing + download per bucket.
4. **Server state:** `sync_queue` rows, MV definitions are in the chain (no data), `schema_migrations` (proof of chain position).

### Phase 3 — Import into the target
1. Restore the pg_dump (or replay the canonical export through the unified pipeline's 10-step restore contract — AFTER ARCH-029 fix). Sequences must be re-synced (`setval`) — the classic restore pitfall; the pipeline's contract already hardens this.
2. **Auth users re-created with PRESERVED UUIDs** via the admin `createUser` API (`user_id` honored). Passwords: force a reset flow on first login per user (non-technical-acceptable: "your password was reset by the migration, check SMS/email"), or pre-arranged per-user passwords. `user_profiles` rows already reference the same UUIDs → attribution integrity preserved (blocker §1-3 cleared).
3. Storage objects re-uploaded to the same paths (URLs in `proof_path` remain valid if the bucket/public-URL shape matches; otherwise a path-rewrite pass over the affected columns).
4. `REFRESH MATERIALIZED VIEW` all five (or let the 01:00 cron do it) — cheap insurance even though DEAD-019 (no desktop consumers).
5. Re-run the migration chain's idempotent tails (grants/policies) if the restore was partial.

### Phase 4 — Verification gates (all must pass before cutover)
1. **Live census (GET-only)** on the target: table counts match the source export manifest exactly (the S2 census script re-run).
2. **The S8 §8 re-verification harness** against the target: the 47-test adversarial suite's live-DB group — per-student balance oracle **1137/1137 + 390/390, maxDelta 0 DZD**, the 940/197 indebted census (expected 5,963 installments).
3. **`reconcile()`** (post-BUG-061) green on the target from a clean client.
4. Auth smoke: one staff + one parent login, RLS spot-checks (`current_tenant_id()` resolves; a parent sees only their rows).
5. EF smoke: `collect-payment` dry path + `generate-receipt-pdf` on a test receipt.

### Phase 5 — Cutover & zero-data-loss re-sync
1. Freeze writes on the source (operational announcement / off-hours).
2. Delta export #2 (rows changed since Phase 2) → delta import → re-verify counts (this closes the transfer window to minutes).
3. **Swap the BackendProfile** (the new §2 service; user-visible step: pick profile, confirm, app re-clients everything).
4. **Offline-queue replay:** the local IndexedDB pending entries push through the normal drain (30 s poller) against the NEW backend with the 3-way conflict guard active (`conflict-detector.ts`): server rows fetched fresh, base payloads compared, genuine divergences parked as conflicts for the resolver modal — **no silent overwrites, no duplicate rows** (idempotency: the entity RPCs are `upsert_*_from_import` keyed on natural keys; `sync_queue` audit upsert is `ignoreDuplicates`).
5. Watch one TTL cycle: caches re-seed from the new backend; the sync badge settles to "À jour".

### Phase 6 — Decommission the source
1. Keep the source project READ-ONLY for one billing cycle (the rollback artifact + audit trail).
2. Final canonical backup of the source archived offline.
3. Then pause/delete the source project (this is the quota-trap escape — the whole point).

**Rollback:** at any point before Phase 5 step 3, swap the profile back (or restore the local backup v2). After Phase 5, the rollback is Phase 3 again from the delta manifests.

---

## §4 — What makes this "zero data loss" (and where it could still fail)

| Guarantee | Mechanism | Residual risk |
|---|---|---|
| No lost offline edits | Local queue survives the swap (IndexedDB); replay with 3-way guard parks conflicts instead of overwriting | Entries with stale `basePayload` older than the transfer window → they park as conflicts (safe, but need human resolution) — acceptable |
| No duplicate rows | Natural-key idempotent upserts (`upsert_*_from_import`) + `sync_queue` `ignoreDuplicates` audit | The pre-T-424 legacy rows double-importing IF the source export is taken twice — Phase 4 gate 2 catches it |
| No lost attribution | Auth UUID preservation (Phase 3.2) | Password-reset friction (communicated flow) |
| No lost files | Storage object copy + path validity check | BUG-032-adjacent: any attachment whose bytes were ALREADY discarded before the migration (pre-existing loss, not caused by relocation) |
| No lost financial truth | The per-student balance oracle + reconcile gates (Phase 4) | BUG-061/ARCH-029 unfixed → gates unreliable (hence Phase 0 hard prerequisites) |
| No mid-transfer split-brain | Write freeze + delta pass (Phase 5.1-5.2) | A user ignoring the freeze → their writes land in the delta export anyway (source is still authoritative until step 3) |

---

## §5 — Interim mitigations (before any of this is built)

If the owner must relocate SOONER than the fixes land (e.g., the quota wall forces it):
1. The data path (Phases 1-4) works TODAY without the profile service — the swap is manual env/localStorage surgery + app restart. The two-gates family (§1-1) means the health probe and Configuration tab must be treated as broken until T-559/T-560/BUG-058 land; everything else reads the effective config.
2. pg_dump through the pooler is the fastest byte-exact path (ports verified open, P9).
3. Do NOT attempt relocation without the Phase 4 verification gates, even manual ones — the balance oracle script (S8) is runnable against the target in minutes.

## §6 — The permanent end-state (why this runbook retires itself)

After LF-0..LF-5 (LOCAL-FIRST-BLUEPRINT): the local PGlite engine is the system of record; every read/write is local (OPS-015 classes 1-2 become IPC); the backend is a sync target behind the DataBackendPort with ADR-004's locally-authoritative sequencing. "Relocation" then means: **add a new BackendProfile, one full push of the local DB to the new target, cursor re-anchor** — no export ceremonies, no auth-user surgery (auth becomes local with the relay mapping), no storage bucket copy (files live locally, pushed on demand). The quota trap is escaped by construction (INV-2/INV-5), and the freemium quota can never lock the app out again — the exact owner constraint that started this investigation.

## §7 — Open items for the owner

1. Green-light T-559/T-560 + the BUG-058 probe fix as the FIRST execution items (they are already the top CRITICAL queue; this runbook adds a fourth consumer of the same fix family).
2 Decide the MV estate's fate (DEAD-019): drop in the end-state, or promote to the portal's reporting layer.
3. Decide whether relocation is ever needed as an interim procedure (§5) or whether LF-0..LF-5 lands first and this runbook is executed exactly once, in reverse (as the E7.9 final export into the local engine).

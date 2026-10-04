# T-487 — Live Verification Record (the integrated recovery-workflow E2E: Backup → Purge → Excel Import → Verify → Restore → Verify, in a fully isolated live tenant)

**Session:** 143rd (2026-10-04) · **Task:** T-487 (WKFL-500 + BKUP-508 + BKUP-509) · **Live project:** `vebfehrpzajhstyhinnw` (eu-west-1)
**Harness:** `elimtiyaz-desktop/scripts/t-487-workflow-e2e.ts` (driven with `npx tsx`, the t-425 headless pattern — the REAL ImportEngine + the REAL repositories + the REAL backup service + the REAL purge repository, all through the signed-in TEST super-admin session)
**Final verdict:** **73/73 GREEN** (`scripts/t-487-e2e-report-FINAL.json`, tag `t487-mut9cc83`) — with the production data **byte-identical at every phase checkpoint**.

## 1. The isolation model (the answer to the owner's #1 requirement: no production-data loss)

The test environment is a **dedicated run-unique FAKE-marked tenant** on the live project — never the real tenant. The boundary is the system's OWN architecture:

| Boundary layer | Mechanism | Live proof (phase 1) |
|---|---|---|
| RLS tenant scoping | Every domain table's policy is `tenant_id = current_tenant_id()` (0126's hoisted family) | P1.6: the signed-in TEST admin's `parents` read returns **0** real-tenant rows |
| Purge tenant resolution | `purge_student_parent_domain` resolves `coalesce(p_tenant_id, current_tenant_id())` — the TEST admin's profile binds the TEST tenant | P5.7: the executed purge's blast radius counted EXACTLY the test tenant's census |
| Import tenant scoping | The repositories write with the session's tenant (the localStorage session shim — the t-425 pattern) | P3.x: the imported census matches production family-for-family with zero cross-tenant rows |
| The data-safety invariant | The production fingerprint (parents/students/payments/installments/ledger/activation_codes + the three financial sums) re-censused at EVERY phase | P0.2, P5.12, P6.4, P7.8, P9.1, P9.7 — byte-identical throughout |

The production fingerprint bracketing the whole workflow: **parents 741 · students 1,137 · payments 2,198 (Σ 162,713,000 DZD) · installments 5,956 (Σ due 356,844,800 / Σ paid 162,614,100) · ledger 3,342 · activation_codes 740** — unchanged before, during (mid-workflow checkpoints), and after the entire run.

## 2. The workflow and its evidence (all through the app's REAL code paths)

### Phase 2/3 — Excel Import #1 (the REAL `2027-2026.xlsx` through the REAL ImportEngine + repositories)

- rowsRead=1,141 → 1,137 imported / 2 updated / 2 skipped / **0 rejected**, 73 warnings (auto-corrected data), **160.6 s** live.
- The resulting test-tenant census is **byte-identical to the production import** (the strongest available oracle — the same workbook): students 1,137 · parents 741 · payments 2,198 · installments 5,956 · ledger 3,342 · payments Σ 162,713,000 · due Σ 356,844,800 · paid Σ 162,614,100 (P3.1–P3.8).
- Zero student→parent orphans (P3.9); per-row spot checks against the workbook's own cells (P3.10: ZIREG LEA / MERABTI RIHAM / BOUAICHA ACIL — parent codes + phones match).

### Phase 4 — Backup (the REAL pipeline through `repos.backups.runBackup` — the exact Settings → Sauvegarde path)

**THE DEFECT DEMONSTRATED LIVE (pre-fix, BKUP-508):** the backup taken immediately after the import — with the cache state the import itself left behind — captured **parents=741, students=1,137, ledger=3,342 but payments=0 and installments=0** (a 333,379-byte archive, status `encrypted`, integrity `verified`, NO error raised): the import's identity resolution seeds SOME caches while the bulk write paths never seed others. A fresh-process backup (no import in the session) captured an **ALL-EMPTY snapshot (230 bytes!)** — the fresh-app operator going straight to Settings → Sauvegarde. Both variants: `scripts/t-487-e2e-report-pre-fix-p0-p3.json` (the partial-archive demonstration) + the session transcript (the 230-byte run).

**THE FIX (BKUP-508, commit `df28789`):** `runBackup` now awaits every snapshot source's public `refresh()` (the force-re-seed seam) BEFORE the synchronous `observe().get()` reads — duck-typed so the mock layer is skipped unchanged.

**POST-FIX EVIDENCE (the final run):** P4.2 GREEN — the post-import archive carries the FULL server state: **parents=741 / students=1,137 / ledger=3,342 / payments=2,198 / installments=5,956 == the server census**; the warmed backup's decrypted payload is complete (P4.6/P4.7, integrity `verified`); the server metadata mirror carries BOTH archives through the app's repository path (P4.8).

### Phase 5 — Purge (the REAL RPC through the repository's exact UI call, EXECUTE mode)

- The dry-run preview counted **exactly** the census: 741p/1,137s/2,198pay/5,956inst/3,342led, total 14,115 (P5.1/P5.2) — and deleted NOTHING (P5.3), returning the preserved-families evidence (P5.4).
- The wrong-phrase execute was REFUSED server-side (`confirmation_required`) with zero effect (P5.5/P5.6) — the server-side gate works even with the UI bypassed.
- The EXECUTE (`PURGER`) completed: **total=14,115 rows removed** with the audit entry written (P5.7/P5.10).
- **ZERO residue across every domain family** (P5.8) — parents, students, payments, installments, ledger, activation_codes, service_enrollments all zero.
- **The no-interference proofs (the owner's explicit gate):** both phase-4 backup archives SURVIVED the purge (P5.9, 2→2); the sync/backup RPCs still present (P5.11); the audit journal append-only (the purge WROTE its entry, deleted none).
- The production census mid-workflow: byte-identical (P5.12).

### Phase 6 — Excel Import #2 (the post-purge re-import — the workflow's "Verify Imported Data" step)

- The same workbook re-imported into the purged tenant: **1,137/741/2,198/5,956/3,342 — every family and every financial sum identical to import #1** (P6.2/P6.3). The purge genuinely resets the domain to a clean slate the importer can fully rebuild — no soft-delete keys, no sync-queue resurrection, no identity residue blocking the rebuild.

### Phase 7 — Edge cases (the crafted workbook: valid + duplicate + missing-NEM + invalid + multi-student)

- The DUPLICATE row created exactly ONE student (the within-batch dedupe — IMPORT-115) (P7.2).
- The two-student family resolves to ONE parent (the relationship) (P7.3).
- The missing-NEM row imported through the placeholder-parent fallback (P7.4) — its placeholder family may resolve BY NAME into an existing family (the documented multi-prong identity semantics; parents +2..+3, P7.6a).
- The no-NOM row was NOT imported (the required-field validation; rowsSkipped=1) (P7.5).
- The re-run is IDEMPOTENT: zero count changes, 0 imported / 5 updated / 1 skipped (P7.6b/P7.7).

### Phase 8 — Restore (the REAL pipeline through `repos.backups.restore` — the offline layer's rehydration)

- The wrong-passphrase restore REFUSED (`ERR_VALIDATION`) (P8.1) — the integrity gate.
- The real restore completed in **75 ms** and the offline layer carries the archive's FULL state: 741/1,137/2,198/5,956/3,342 (P8.2/P8.3) — the "Verify Original Data" step.
- Zero orphaned students INSIDE the restored state — every student→parent reference resolves (P8.4).
- The restored-from marker records the recovery (P8.5); the archive status transitioned to `restored` (P8.6); the SERVER mirror carries the transition with `restored_at` (P8.7).
- **BKUP-509 live measurement (P8.8):** the activation codes (743 live rows at that point) are NOT in the archive's 8 collections — the documented coverage gap between the backup format and the purge's blast radius (see §4).

### Phase 9 — Postflight + cleanup

- The production census byte-identical (P9.1/P9.7) — the whole workflow's data-safety proof.
- The cleanup purge removed the test tenant's domain (14,148 rows) with zero residue (P9.2/P9.3); the mirror rows removed (P9.4); the TEST admin's auth account removed (P9.5).
- **The honest end state (P9.6/P9.8):** the test tenant row is DEACTIVATED, not deleted — **LIVE DISCOVERY: an audited tenant cannot be deleted** (the `tenants → audit_logs` FK cascade collides with the `enforce_audit_log_append_only` trigger, SQLSTATE P0001). The deactivated FAKE-marked tenant row + its immutable audit journal remain as the forensic record (the T-486 precedent). Zero ACTIVE residue: no profiles, no role assignments, no domain rows, no mirror rows.

## 3. The local gates (the fix's regression surface)

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | **0 errors** (the §15.69a pipe trap caught live: the first "pass" was `head`'s exit code — re-verified unpiped) |
| The new suite `t-487-backup-snapshot-warmup.test.ts` | **12/12** (the lazy-repository warm-up contract, the honest failure degradation, the backup→wipe→restore round-trip, the 8 public-refresh source-scan guards + the warm-before-snapshot call-order guard) |
| The EXISTING T-415 backup family | **80/80 unchanged-green** (backup-restore-hardening + backup-crypto-vault + sync-conflict — the mock path is byte-identical; the fix is backward-compatible) |
| The FULL unified battery (`npm test`) | **GREEN — every gating layer**: typecheck 0 · vitest **4,779/0/5 BASELINE-MATCHED** (280 files; the registered baseline move cites T-487) · desktop runner 810/0/10 · mirror 774/0/10/36 · tier-4 784/820 0 rows · sanity 820/820 canonical 319/319 |
| `eslint` on every changed file | 0 errors (26 pre-existing warnings, none introduced) |

## 4. Problems flipped / documented

- **WKFL-500 → RESOLVED-TESTED:** the integrated cycle is now executed end-to-end with hard live evidence (this document) — the composition works: the purge's queue cleanup meets the re-import's preflight cleanly, the backup's snapshot timing is fixed (BKUP-508), and the restore rehydrates the full archived state.
- **BKUP-508 → RESOLVED-TESTED:** the warm-up seam (commit `df28789`), demonstrated pre-fix (the partial and the all-empty archives) and verified post-fix (the full-state archive) — pinned by the 12-test suite + the 8 source-scan guards.
- **BKUP-509 → DOCUMENTED (owner-gated fix):** the snapshot's 8 collections do not cover `activation_codes` (740 live rows) or target-linked `account_approval_requests` — the workflow Backup → Purge → Restore loses the portal-access layer (re-issuable via the UI, but a silent data delta). The fix (a backup-format v2 extension) requires first adding the missing activation-code repository contract — an owner-gated scope decision, registered.

## 5. New discoveries documented for the next agent

1. **The audited-tenant immutability (P9.6):** `delete from tenants` fails with P0001 once the tenant has audit rows — the FK cascade into `audit_logs` hits the append-only trigger. Any future isolated-tenant test harness must plan for the DEACTIVATED end state (FAKE-marked, `is_active=false`), never the deleted one.
2. **The §15.69a pipe trap recurred live in THIS session:** `npx tsc --noEmit 2>&1 | head -10; echo $?` reported head's 0 while tsc had FAILED with 3 errors (my new test's optional-metadata access). The unified runner's Layer-0 caught it. Never pipe a gate.
3. **The import's cache footprint:** the Excel import seeds parents/students/ledger caches (its identity resolution) but NEVER the payments/installments caches (the bulk write paths bypass the list caches) — the partial-archive variant of BKUP-508 was reachable exactly there. Any future "read the current state through the repositories" consumer must warm first or read the server directly.
4. **The GoTrue admin-create returns HTTP 200 (not 201)** for a freshly created user in this project's GoTrue version — harnesses must accept both.
5. **The management-API SQL endpoint + tsx headless pattern extends cleanly to the whole app stack**: the ImportEngine + repositories + backup service + purge repository all run under `npx tsx` with the localStorage/window shims + `fake-indexeddb/auto` (the vault) — the t-425 pattern is the template for any future live E2E.

## 6. What remains (the honest residuals)

- **BKUP-509** (the activation-codes coverage gap) — owner-gated: the backup-format v2 decision.
- **The restore's server boundary** (documented since T-415, re-verified here): the restore rehydrates the OFFLINE operating layer, NOT the server — full server rehydration stays the Excel-import path. The restore modal's text ("remplacera l'état opérationnel local") is accurate; the offline-layer semantics are the design.
- **The edge-case workbook's placeholder-family resolution** (P7.6a's +2..+3): the missing-NEM row's placeholder family may merge by name into an existing family — correct per the documented identity semantics, recorded here so no future harness hard-codes +3.

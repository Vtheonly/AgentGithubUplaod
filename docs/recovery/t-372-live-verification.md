# T-372 — Live Verification Report (SYNC-110: the website↔desktop student-document synchronization)

> 70th session, 2026-09-14. Task: `docs/recovery/task-registry.md` T-372 · Problem: `docs/recovery/problem-registry.md` SYNC-110.
> The owner's mandate: *documents uploaded from either platform must be stored and synchronized through the same backend/storage system so that both the website and desktop application can see all documents associated with the student — for ALL student documents.*

## 1. The live RED proof (captured BEFORE any change, at session open)

The owner's exact symptom reproduced with a live census (Management API SQL, `scripts/live-query.sh`):

| Store | LINDA ALIOUAT (`b0037eef-c26c-4684-bb0b-7fc2c75584fc`) content |
|---|---|
| `student-documents` bucket (storage) | **6 objects** — BOTH platforms' binaries (paths interoperable, same `<tenant>/<student>/<file>` convention) |
| `student_documents` table (the website's store) | 1 row — the website-uploaded `birth_certificate` (storage_path `…/birth_certificate-1789341527070.jpeg`) |
| `students.documents_json` column (the desktop's store) | 1 entry — the desktop-uploaded `ID-2.png` (`category:"justification"`, storagePath `…/1789365629667-t3rzmq-ID-2.png`, uploadedBy `admin@elimtiyaz.dz`) |

→ Each platform queried only its own metadata store; the storage layer was already unified. The split was purely METADATA (SYNC-110, registered OPEN before the fix per §13). Live chain at open: 93 migrations, top 0096 (0096 applied by the concurrent 69th session, file not yet committed).

Additional census finding (registered, NOT auto-fixed): 4 of the 6 bucket objects are **UPLOAD-104-era orphans** (binaries whose row insert 403'd while storage succeeded). Cross-checking sizes/timestamps shows each corresponds to a file the owner later re-uploaded SUCCESSFULLY (3× the same 3 029 615-byte PNG while the flow was broken, then the successful 104 115-byte jpeg; the id_photo orphan has the SAME 104 115 bytes as the successful birth_certificate row 2 minutes later). Auto-recovering them would mint duplicate document rows → owner decision, see `unknowns.md` UNKNOWN-022.

## 2. The fix (hub repo, one change set)

1. **Domain** (`src/domain/model/student.ts`): `StudentDocumentCategory` widened to the table CHECK constraint's exact 7 kinds (0005) — the website's `StudentDocumentKind` verbatim; `StudentDocument` gains optional `mimeType`/`sizeBytes`; NEW `StudentDocumentDraft`; the full-array `documents` field REMOVED from `UpdateStudentInput` (compile-time prevention of the clobber path's return).
2. **Contract** (`src/domain/repository/repository.ts`): `StudentRepository.addStudentDocument` / `removeStudentDocument` — the granular table-backed writes.
3. **Supabase repository** (`supabase-shared-repositories.ts`): `seed()` fetches the tenant's `student_documents` rows (one extra query per reseed — the established whole-tenant cache pattern) and embeds them into `Student.documents` via the new `mapStudentDocumentRow`/`embedStudentDocuments`; `addStudentDocument` INSERTs the canonical row (tenant_id, student_id, kind, file_name, storage_path, mime_type, size_bytes, uploaded_by, description); `removeStudentDocument` DELETEs with the matched-row probe (honest zero-match → notFound, §15.30b); the `documents_json` read in `mapStudentRow` and write in `updateStudent` are DELETED; uploader display names resolved best-effort through `user_profiles` (the chat-repository name-cache pattern; RLS-tolerant fallback "—").
4. **Mock repository**: the same granular contract in-memory (the observable store re-emits).
5. **DocumentsTab**: the 7 canonical kinds in the picker; add/remove through the granular methods (the vault upload flow unchanged — same bucket, same path convention); the tenant fallback chain `student?.tenantId ?? session?.tenantId ?? "mock"` (T-361 pattern).
6. **Migration 0098** (`0098_student_documents_unification.sql`): idempotent backfill of every legacy `documents_json` entry into the table (category→kind map: medical→medical_certificate, justification→justification_letter, contract, other; entries without storagePath skipped — NOT NULL; uploaded_by NULL — the json carries a display NAME, not a profile uuid); `documents_json` retained as a forensic archive, read by NO client.
7. **Website: NO code change** — the portal was already table-backed (T-360/T-367 fixed its upload path); its suites re-run as the parity evidence.

## 3. Live verification evidence

### 3.1 `scripts/verify_t-372.sql` (BEGIN…ROLLBACK, zero residue) — **7/7 GREEN**

| Check | Result |
|---|---|
| A1 legacy json entries | 1 |
| A2 table rows before | 1 |
| **A3 split-brain paths (the RED proof)** | **1 json entry with NO table row (desktop-only, pre-fix)** |
| B1 rows after the backfill | 2 |
| **D1 idempotent re-run** | **0 rows inserted by the second run** |
| **E1 LINDA unified** | **2 rows, kinds {birth_certificate, justification_letter}** |
| F1 skipped entries (no binary) | 0 |

### 3.2 Migration 0098 applied LIVE atomically (the T-091/MIG-TOKENS pattern)

`BEGIN; <0098 body> + INSERT INTO supabase_migrations.schema_migrations …; COMMIT;` — one Management-API call. Post-state: **mig_count 93 → 94, doc_rows 1 → 2, LINDA rows = 2.** (The first apply attempt failed on a Python f-string quoting bug in the payload builder — `ARRAY[t372_sync110_backfill]` unquoted — and rolled back cleanly; fixed and re-applied.)

**Numbering note (coordination):** the live chain carried 0096 (the concurrent 69th session's RPC, uncommitted file) and the concurrent 70th-b session registered T-371/WORKFORCE-501 with migration **0097** on the remote FIRST (commit 942d3a2 — discovered at my first push; my task renumbered T-371→**T-372**, migration 0097→**0098** at merge time). Applying 0098 while 0097 is not yet applied leaves a NUMBERING GAP in the live chain — safe: `supabase db push --include-all` applies missing migrations by FILE order, so the concurrent agent's next push lands 0097 and the chain self-heals (both sessions' file sets are disjoint).

### 3.3 `scripts/t-372-doc-sync-e2e.py` — the cross-platform round-trip — **11/11 GREEN**

Reuses the t-359 e2e conventions (GoTrue admin-created test parent, real PostgREST+RLS paths, zero-residue cleanup, env-only secrets):

| Check | Result |
|---|---|
| **A. desktop seed query: LINDA carries BOTH platforms' documents** | HTTP 200, 2 rows (kinds birth_certificate + justification_letter) |
| A2. backfilled legacy kind mapped (justification → justification_letter) | kinds exact |
| 0. test parent account created | HTTP 200 |
| C0. staff binary upload (canonical path) | HTTP 200 |
| C. staff (desktop payload) row insert | HTTP 201 |
| **D. DESKTOP→WEBSITE: parent sees the desktop-uploaded document** | HTTP 200 — the website's exact `useStudentDocuments` query |
| E. parent (website payload) row insert | HTTP 201 |
| **F. WEBSITE→DESKTOP: staff seed query sees the website-uploaded document** | HTTP 200 — the desktop's exact seed query |
| G. parent sees ONLY own children (0043 RLS scoping) | 0 leaked rows |
| H. staff DELETE (removeStudentDocument shape: id+student_id+tenant_id) | HTTP 204, row gone |
| Z. zero residue | parents 261 / students 393 / docs 2 before AND after |

### 3.4 Gates (every rung re-run AFTER the last file change — §15.25)

| Repo | tsc | eslint | vitest | build |
|---|---|---|---|---|
| Desktop (hub) | 0 errors | 0 errors (610 warnings — the 604 baseline + 6 in the new t-372 suite's fake-client, the established test-fake pattern) | **161 files / 3364 / 0 failed** (baseline 3350; +14 t-372 tests; vault-compliance rewritten to the granular contract) | GREEN |
| Website | — | clean | **48 files / 618 / 0 failed** | GREEN (strict) |

## 4. What remains unresolved (honest residuals)

1. **The 4 orphaned bucket binaries** (UPLOAD-104 era) — no metadata row anywhere; each corresponds to a later successful re-upload of the same file, so auto-recovery would mint duplicates → **UNKNOWN-022** (owner decision: recover as extra rows vs delete the orphans vs leave as forensic residue).
2. **`students.documents_json` retention** — the column stays as a forensic archive (no client reads/writes it after this task). Dropping it is a separate owner-gated schema decision (would be migration 0099+).
3. **The desktop's cache freshness** — documents load at seed and mutate incrementally; a website upload made while the desktop is open appears after the next reseed (the TTL/focus freshness policy, T-034/CROSS-104) — the same freshness characteristic as every other desktop surface. Realtime push for documents would ride T-337 (REALTIME-105) if the owner wants it.
4. **Migration numbering gap** (0097 not yet applied live while 0098 is) — self-heals at the concurrent session's next `db push`; documented above and in the task registry.
5. **Android** — out of this task's scope (the repo was not cloned by the owner for this session; the Android app has no student-document surface yet). When it gains one, it must write to the same `student_documents` table (the AGENTS.md §15.31 rule).

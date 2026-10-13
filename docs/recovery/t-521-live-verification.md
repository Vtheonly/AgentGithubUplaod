# T-521 Live Verification — the Expense Unification (issue #29)

> **Task:** T-521 (WORKFORCE-517..520, the 167th session, 2026-10-13)
> **Environment:** the live production Supabase (`vebfehrpzajhstyhinnw`, eu-west-1) — the owner's supplied `sbp_` Management token (the apply ladder) + the `sb_secret_` service key (the E2E scaffolding/cleanup ONLY).
> **Method:** the t500-staff-live-audit conventions — FAKE-T521 run-unique probes, a REAL JWT for every RLS-shaped call (the admin session for the reviewer paths, a provisioned WORKER probe for the submitter paths), the service role strictly for scaffolding + cleanup, the append-only `audit_logs` rows kept (§15.26), the zero-residue census at the end.

## The verification ladder

| # | Command | Result |
|---|---|---|
| 1 | `SUPABASE_ACCESS_TOKEN=sbp_… python3 scripts/t521-apply-0153.py` | **ALL GREEN** — migration 0153 applied live |
| 2 | `SUPABASE_SERVICE_ROLE_KEY=sb_secret_… python3 scripts/t521-expense-e2e.py` | **36 PASS / 0 FAIL** — the full unification chain |

## The apply ladder (t521-apply-0153.py)

- **PRE-PROBE:** `expense_attachments` did not exist; the chain had no `0153` row.
- **APPLY:** the migration's statements through the Management API SQL endpoint (one session; the COMMENT statements silently dropped per the documented quirk #1 — the DDL/DML all persisted).
- **POST-PROBE (all exact):**
  - the 12 columns in order: `id, tenant_id, expense_id, storage_bucket, storage_path, file_name, mime_type, size_bytes, uploaded_by, uploaded_at, source, created_at`;
  - the constraints: `expense_attachments_expense_id_storage_path_key` (the UNIQUE duplicate-upload guard), the PK, the two FKs (tenant cascade + expense cascade), the three CHECKs (bucket/source/size);
  - the three RLS policies: `expense_attachments_select` (SELECT), `expense_attachments_insert` (INSERT), `expense_attachments_delete` (DELETE) — no UPDATE policy (immutable metadata, by design);
  - `expense_tickets.responsible_profile_id` (uuid);
  - the chain registration row `0153 / expense_attachments_responsible`.

## The E2E (t521-expense-e2e.py) — 36 PASS / 0 FAIL

### A. One canonical stream (the "ddd" class)

- **A1** the admin session + profile resolve.
- **A2** the Finance tab's select (`*, expense_categories(code)`, order submitted_at desc) and the Android pull's select (the same embed, order id asc) return the **SAME row set** — one record store, many surfaces.

### B. The submitter probe

- **B1–B3** a FAKE-T521 worker (GoTrue admin-API create → profile activation → the 0023 worker role assignment) — the RLS-shaped submitter for the whole run.

### C. The Finance create (the desktop repository's exact insert shape)

- **C1** the insert with `responsible_profile_id` → **201** persisted.
- **C2** `responsible_profile_id` read back exactly as written.

### D. THE CROSS-SURFACE VISIBILITY (the "ddd" regression, live)

- **D1** the Finance tab's stream shows the ticket (`pending_approval`).
- **D2** the **Personnel review queue's pending filter** shows the SAME ticket — the surface that did not exist before T-521, reading the same table.
- **D3** the WORKER's own view through the **Android pull's exact select shape** (worker JWT, RLS submitter path) returns the row with the category embed.

### E. The attachment workflow (WORKFORCE-518)

- **E1** the WORKER uploads a real PNG to the private `expense-receipts` bucket at the canonical `<tenant>/<expense>/<file>` path — **through the worker's JWT (the 0018 storage RLS live)**.
- **E2** the `expense_attachments` metadata row (`source=mobile_camera` — the scanner's image) → 201.
- **E3** the same path again → **rejected** (HTTP 409 / SQLSTATE 23505 — the UNIQUE duplicate-upload guard).
- **E4** the desktop gallery's read-back query returns the scanner's attachment.
- **E5a** the WORKER's sign attempt is **REFUSED** (the 0018 `expense_receipts_read` policy grants read to super_admin/finoff/manager only — the receipts are financial documents; the worker can upload but not read back).
- **E5b** the privileged reviewer's sign issues the 5-minute URL (the vault contract).
- **E5c** the signed URL downloads the bytes → **200**.

### F. The approval lifecycle — the ANDROID PUSH SHAPES (the SyncQueueDispatcher's exact transition-only UPDATE payloads)

- **F1** the admin approves the worker's ticket: `pending_approval → approved_funds_released` → 200, the status read back.
- **F2** the disburse: `approved_funds_released → disbursed` → 200.
- **F3** the WORKER settles with the **attachment's storage path** as `receipt_path` + `final_spent_amount` → `settled_and_closed` → 200.
- **F3b** `receipt_path == the attachment's storage_path` — **the canonical integration**: the settle proof IS the attachment (never a data URL, never a manual re-type).
- **F4a** the admin-submitted probe (the owner's actual "ddd" usage pattern — the owner creates expenses as admin) → created.
- **F4b** the admin's self-approval attempt → **HTTP 400, P0001: "Self-approval is forbidden (plan §08 / WEAK-030)…"** — the 0064 trigger answers LIVE. **This is the honest explanation of the owner's own approval failures on self-submitted expenses: the rule (plan §08), not a defect.** (The authorization-bypass class AROUND this rule — the forged-approver path — is the concurrent T-527's SEC-118, registered separately and OUT of T-521's scope.)
- **F5** the reject transition with the mandatory reason → `rejected` + `rejected_reason` persisted.
- **F5b** the NULL `responsible_profile_id` stays NULL (flagged in the UI, never fabricated).

### G. RLS controls

- **G1** the worker's attachment DELETE affects **zero rows** (the §15.30b post-check: the row SURVIVES — the delete policy is privileged-only).
- **G2** anon reads nothing (the unauthenticated call returns the empty set).

### H. Cleanup (zero residue)

- **H1–H8** the attachment row, the storage object, the three probe expenses (cascade: transitions + attachments), the role assignment, the probe profile, the GoTrue probe user — each with an affected-row count assertion.
- **H9** the FAKE-T521 census: **0** rows (the sweep also catches any orphaned probe from a crashed earlier run — the first E2E run's crash left exactly the orphans the sweep removed).

## The desktop + Android batteries (the same session)

- **Desktop:** the full unified Layer-1 run — 314 files / 5,172 tests: **5,166 passed / 1 failed / 5 skipped**; the single failure was the T-361 UPLOAD-102 source guard tripping on this task's own header comment (the guard's regex treats a comment containing the literal `uploadPrivateMedia({…})` pattern as a call site) — fixed in the same session and re-verified **5/5**; the expense battery (t-521 repo 13 + t-521 UI 3 + t-521 personnel 5 + t-093 12 + WEAK-030 8 + t-361 5) all green; `tsc --noEmit` 0; eslint 0 errors on every changed file.
- **Android** (the elimtiyaz-android repo, commit `dacaa8b`): the full clean recompile (`./gradlew compileDebugKotlin --rerun-tasks`) **BUILD SUCCESSFUL** under the provisioned Temurin JDK 21 (`/home/z/my-project/jdk` — the container's system java is a JRE; the AGENTS.md §11 recipe re-provisioned); the FULL unit suite **779/779 GREEN** (the 4 pre-existing equivalence failures were the missing hub-sibling checkout — resolved by the canonical `../AgentGithubUplaod` sibling symlink, a pure test-environment fix); the NEW `ExpenseApprovalT521Test` **4/4** (the direct mapper unit test + the three source-scan pins).

## Honest boundaries (what this verification does NOT cover)

1. **SEC-118** (the concurrent T-527's registration): the forged-approver authorization class around the approval rule — the 0022 RPCs' caller verification and the RLS submitter-update breadth are OUT of T-521's scope and remain OPEN under their entry.
2. **The Android `expense_attachments` pull/push** (the Room v21 + the DTO + the sync-entity port + the gallery surface): the scanner's expense mode now uploads to the canonical bucket and returns its path (the settle integration verified live), but the Android attachment METADATA registration reads only `receipt_path` until that follow-up lands. Registered in WORKFORCE-518's entry with the exact spec.
3. **The owner's device eyeball**: the desktop's new surfaces (the Personnel review queue, the drawer's Justificatifs tab, the responsible select) ride the next packaged build.

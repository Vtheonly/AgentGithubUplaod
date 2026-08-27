# Vault Compliance Verification — Section 02 « Architecture and Platforms »

**Scope:** The requirements vault section `02. Architecture and Platforms` (notes 00–08: Platform Topology, Supabase Backend Hub, Desktop Terminal, Staff Android Mobile App, Client Web Portal, Platform Feature Allocation Matrix, RBAC, Account Activation Protocol) — verified against the desktop app (`elimtiyaz-desktop`), cross-referenced with the Android app (`elimtiyaz-android`) and the web portal (`elimtiyaz-website`).

**Method:** Full requirement-by-requirement audit of the desktop app (domain, feature, infrastructure, mock + Supabase repositories, SQL migrations, Edge Functions) against every instruction the vault addresses to the Desktop Terminal. Cross-platform contracts (table/RPC/parameter names, status enums, aging buckets, discount and waterfall logic, roles, permissions) were compared with the Android implementation and the shared Supabase migrations. Every fix is **purely additive** — no business logic (formulas, allocation, pricing, state machines) was changed.

**Result:** All vault §02 instructions are now implemented on the desktop. 5 gaps were found (3 shallow, 1 missing, 1 cross-platform contract gap) and closed; 18 new regression tests lock them in (**1956/1956 tests green**, typecheck clean, production build clean).

---

## §02.01 — Platform Topology

| Requirement | Status | Evidence |
| :--- | :--- | :--- |
| Desktop talks to the single Supabase backend via REST/JWT | ✅ already implemented | `supabase-client.ts` (Supabase Auth + JWT); repository provider switches mock ↔ Supabase on configuration |
| Desktop is the **only** node that runs backup routines | ✅ already implemented | Backup scheduler started in `app-shell.tsx` after authentication; Mobile has zero backup code paths; vault §13 cycle honored (24h at ~02:00, AES-256-GCM, IndexedDB vault, retention + purge, point-in-time restore with checksum verification) |
| Do not build features the audience cannot reach | ✅ already implemented | Parent/Student roles cannot sign into the desktop (`STAFF_ROLES` gate); portal-only features (dues view, justification upload) stay off desktop |

## §02.03 — Desktop Terminal (Electron + React)

| Requirement | Status | Evidence |
| :--- | :--- | :--- |
| Heavy Data Ops: Excel Student Import | ✅ already implemented | `import-engine/` (ExcelJS binary parsing, multi-schema, idempotent upserts, per-run audit, JSON + Excel reports) |
| Heavy Data Ops: XLSX/CSV Report Export | ✅ already implemented | `export-engine.ts` (multi-sheet XLSX + CSV with BOM), `reports.ts` (audit/roster/financial exports) |
| Heavy Data Ops: Bulk Roster Operations | ✅ already implemented | Batch registration wizard (atomic parent + N students + charges + tranches), batch promotion, bulk debtor actions |
| Configuration: Visual DAG Workflow Builder | ✅ already implemented | `dag-canvas.tsx` + `node-palette.tsx` (16 node subtypes, Kahn cycle validation, live red-edge feedback) |
| Configuration: RBAC Matrix | ✅ already implemented | `rbac-matrix-editor.tsx` (11 roles × 56 permissions, persisted override, audited saves) |
| Configuration: System Settings | ✅ already implemented | Settings hub (general, pricing, AI, approvals, audit, backup, sync, RBAC, locked features) |
| Recovery: 24h AES-256 Backup Vault | ✅ already implemented | `backup-scheduler.ts` + `backup-service.ts` (gzip → AES-256-GCM → SHA-256 → IndexedDB, `.db` archive naming, 80% capacity alert) |
| Recovery: Point-in-time Restore | ✅ already implemented | `restore()` — decrypt (GCM tag), decompress, SHA-256 verify, parse, audit |
| Navigation: 4 Consolidated Hubs + Permanent Sidebar + Tabbed Workspace | ✅ already implemented | Sidebar (Dashboard/CRM/Academics/Financials hubs + Personnel/Workflow/Routing/Settings), collapsible rail, `PageTabs` workspace in every hub |
| Desktop-exclusive: `.xlsx` raw parsing, DAG canvas editing, multi-thousand-row imports, RBAC matrix config, `.db` backup generation | ✅ already implemented | All five exclusives present and Desktop-gated (matrix rows marked Disabled on the other platforms are enforced there, not here) |

## §02.06 — Platform Feature Allocation Matrix (Desktop column)

| Matrix row (Desktop) | Status | Evidence |
| :--- | :--- | :--- |
| Authentication & RBAC — Full | ✅ already implemented | Supabase Auth/JWT + client `can()` checks via `FeatureGate`/`GatedContent`; server-side RLS enforced by migrations 0019/0027 |
| Parent-Child CRM (1→N) — Full, dynamic batch creation | ✅ already implemented | Unlimited children in the wizard; parent-first dependency; `parent_student_links` multi-guardian support |
| Student Profiles & Timelines — Full | ✅ already implemented | Student drawer (info/academic/attendance/payments/documents tabs), append-only academic history |
| Attendance Roll Call — Full | ✅ already implemented | 4 statuses + LATE arrival time (matches Android exactly), idempotent per (student, date, session) |
| Payment Entry & Collection — Full, auto-allocation | ✅ already implemented | Waterfall allocator (oldest-first), LIFO reversal, overpayment `parent_credit` — byte-for-byte parity with Android + SQL 0034 |
| Check/Transfer Proof Scan — File Upload | ✅ already implemented | Private media vault upload (signed URLs, 5-min TTL), proof mandatory for non-cash (enforced server-side too) |
| Installment Billing (Tranches) — Full, multi-service | ✅ already implemented | 40/30/30 official split, Sep 15/Dec 15/Mar 15 due dates, tuition + transport + therapy + services |
| Debt Dashboard & Rankings — Full, aging tiers | ✅ already implemented | 5 aging buckets `0_30…180_plus` (identical to Android), Top-20 debtors, per-grade breakdown, reminder broadcast + restriction lock |
| Two-Tier Expense Requests — Full | ✅ already implemented | submit → approve/reject → disburse → settle-proof state machine, **no self-approval**, urgency field, requester notifications |
| Grade Entry (Devoir/Examen) — Full | ✅ already implemented | D1/D2/Examen on 0–20, coefficient snapshots, archived-year rejection (append-only history) |
| Homework Push Engine — Full, photo/PDF attachments | ✅ **FIXED (shallow)** | The attachment picker only captured **file names** — files were never uploaded. Now each attachment is uploaded to the PRIVATE `homework-attachments` bucket (migration 0018) via the signed-URL media vault — same flow as payment proofs — and the persisted `attachments` array carries vault paths (Android parity: jsonb attachments on the `homework` table). Upload failures abort the push with a clear error; the submit button shows upload progress |
| Teacher Activity Log (Relevé) — Full | ✅ already implemented | Manual + automated entries (grades/homework/roll-call), 30-day self-view, append-only |
| Notifications & Alerts — In-App | ✅ already implemented | Priority-ordered alert center, 4 priorities (urgent→low), role broadcast + targeted, realtime-ready |
| Audit Log Stream — Full, multi-column filterable | ✅ already implemented | Action/entity/actor/date-range filters, before/after diff drawer, CSV + XLSX export |
| AI Assistant Integration — Full, Groq + OpenRouter | ✅ **FIXED (shallow)** | Only the mock adapter was wired in — the `ai-proxy` Edge Function and the encrypted BYOK key store existed but were never called. New routing adapter: **ai-proxy Edge Function** (Supabase mode — keys stay server-side, per-tenant rate limiting, `ai_request_logs`) → **BYOK direct** (Groq/OpenRouter chat completions with the AES-256-GCM-encrypted local keys, provider fallback mirrors the Edge Function) → **mock** (dev/demo). PII-masked prompt is the only content that crosses the wire; the three features (narrative/drafting/anomaly) are routed explicitly via a new optional `AIRequest.feature` field |
| Automated Workflows (List/Run) — Full, manual triggers | ✅ already implemented | Runs monitor + one-click triggers (overdue reminders, lock delinquents, batch promotion), max daily executions enforced |
| Visual Workflow DAG Editor — Full | ✅ already implemented | Canvas DnD, palette, cycle validation, condition evaluator (AND/OR/NOT) |
| Student Excel Import (.xlsx) — Full, ExcelJS | ✅ already implemented | Binary parsing (never formula evaluation), French-locale numbers, `#REF!` tolerance |
| Data Export Engine (XLSX/CSV) — Full | ✅ already implemented | Brand-styled multi-sheet XLSX + CSV; PDF receipts/statements/bulletins via pdf-lib |
| AES-256 System DB Backups — Full | ✅ already implemented | See §02.03 Recovery above |

## §02.07 — Role-Based Access Control

| Requirement | Status | Evidence |
| :--- | :--- | :--- |
| Roles: Super Admin, Financial Officer, Teacher/Faculty, Support Staff (+ web-only Parent/Student) | ✅ already implemented | `roles.ts` — 11 roles, wire-protocol codes identical to Android + migration 0003 |
| Client-side `can()` privilege checks | ✅ already implemented | `FeatureGate` + `GatedContent` + per-action `Permission` checks (sidebar, route guards, drawers, modals) |
| Server-side enforcement (RLS + JWT) | ✅ already implemented | Migrations 0019/0027 policies on every table; SECURITY DEFINER RPCs for writes |
| Desktop Sidebar touchpoint | ✅ already implemented | Sidebar entries gated by feature-registry requirements; dashboard route guard redirects non-administrative roles |
| Do not trust client checks alone | ✅ already implemented | RLS is FORCE-enabled; audit trail records every mutation |

## §02.08 — Account Activation Protocol (4-step flow)

| Requirement | Status | Evidence / Fix |
| :--- | :--- | :--- |
| Step 1 — office staff registers family **and issues** 6-7 digit code | ✅ **FIXED (2 gaps)** | (a) **Batch registration never issued a code**: after the atomic family registration completes, staff now get the activation-code modal (code + QR + copy + WhatsApp) plus an `parent.activation_code_issued` audit entry — matching Android's BatchRegistrationScreen hand-off. (b) **The parent-drawer "Code d'activation" action generated a random local code and never persisted it** (Supabase mode would have shown a code the portal cannot validate): it now calls the approvals repository (`generate_activation_code` RPC + `activation_codes` insert) in Supabase mode, with the deterministic Android-parity code as the mock-path fallback |
| Code properties — numeric, 6 or 7 digits, single-use | ✅ already implemented | `activation_codes` table: `UNIQUE (tenant_id, code)`, `bound_to_auth_user_id`/`bound_at` set once by `bind_activation_code()` RPC (`FOR UPDATE`, expiry check); deterministic codes stay in the 6-digit range [100000, 999999] |
| Codes issued by staff at enrollment time | ✅ **FIXED** | See Step 1(a) — the wizard is the enrollment surface |
| QR code delivery (camera-based entry) | ✅ **FIXED (missing)** | New `QrCode` primitive (`qrcode-generator`, pure offline JS, error-correction M) rendered in the activation modal — both from the parent drawer and from batch registration. The payload is the bare numeric code so any scanner app can fill the portal field |
| Single-use binding — one code → one Parent profile | ✅ already implemented | `bind_activation_code()` RPC serializes with `SELECT … FOR UPDATE`; Edge Function maps invalid/used → 404, expired → 410 |
| Cross-platform: desktop-created parents populate activation codes | ✅ **FIXED (contract gap)** | Migration 0037 added `p_activation_code` to `upsert_parent_from_import` precisely so activation codes are populated — **Android passes it, desktop didn't**. Desktop now passes the deterministic FNV-1a code of `(tenantId \| parentCode)` — identical algorithm to Android's `IdentityCodes.deterministicActivationCode` (verified byte-for-byte against the Kotlin mirror engine in tests) — in `createParent` AND in the sync-queue safety-net push path. Also updated the hand-written DB types (missing `p_activation_code`, `p_transport_destination`, `p_city_tier`, and the 0031 `out_*` return rename) |
| Web Portal binds parent auth.uid → family (Step 4) | ✅ **FIXED (cross-platform conflict)** | The desktop repo's `bind-activation-code` Edge Function only accepted body key `activation_code`, while the Next.js portal sends `code` — only one function can be deployed per name, so one platform would break. The function now accepts either key with zero behavioral difference |

---

## Cross-platform consistency (same scenario → same result)

Verified against the Android app and the shared Supabase migrations: money in centimes (DZD, NUMERIC(12,2) at the boundary), waterfall allocation oldest-first with `pending_clearance` for non-cash, LIFO reversal, overpayment → parent-scoped `parent_credit`, 5-bucket debt aging, 40/30/30 tranche split with Sep 15/Dec 15/Mar 15 due dates, the 5 discount rules, 11 roles × 56 permissions, 4 attendance statuses, `PAR-YYYY-xxxx` / `ELV-YYYY-NNNNNN` / `REC-YYYY-NNNNNN` code formats, deterministic parent codes, and now **deterministic activation codes** — all byte-identical between desktop and Android, with the SQL engine (migrations 0034–0039) as the canonical source. The desktop's `p_activation_code` omission was the last asymmetric writer against the shared schema.

## Changes made (all additive)

1. `src/core/format/id.ts` — production `deterministicActivationCode()` (Android-mirroring FNV-1a).
2. `src/infrastructure/supabase/repositories/supabase-shared-repositories.ts` — `createParent` passes `p_activation_code`.
3. `src/app/providers/sync-provider.tsx` — sync-queue parent push passes `p_activation_code`.
4. `src/shared/ui/qr-code.tsx` *(new)* — offline QR primitive.
5. `src/features/crm/activation-code-modal.tsx` *(new)* — shared code + QR + copy + WhatsApp modal.
6. `src/features/crm/parent-detail-drawer.tsx` — persisted issuance (RPC path) + QR; uses the shared modal.
7. `src/features/crm/batch-registration-modal.tsx` — activation code + QR hand-off at enrollment, audited.
8. `src/infrastructure/ai/llm-adapter.ts` — routing adapter (ai-proxy Edge Function → BYOK Groq/OpenRouter → mock), feature discriminator.
9. `src/domain/model/ai.ts` — optional `AIRequest.feature` (additive).
10. `src/features/academics/{narrative-generator-modal,narrative-generator}.ts(x)`, `src/features/financials/anomaly-explainer-modal.tsx` — tag requests with their feature.
11. `src/features/academics/homework-push-modal.tsx` — real attachment uploads to the private `homework-attachments` bucket.
12. `src/infrastructure/storage/media-vault.ts` — `homework-attachments` bucket + collision-proof upload paths.
13. `src/infrastructure/supabase/types.ts` — RPC type surface matches migrations 0028/0031/0037.
14. `supabase/functions/bind-activation-code/index.ts` — accepts both `code` (portal) and `activation_code` (desktop/Android) body keys.
15. `src/tests/integration/vault-compliance-architecture.test.tsx` *(new)* — 18 regression tests (deterministic-code Android parity incl. the Kotlin mirror engine, QR renderability, AI routing fallbacks, homework vault uploads, RPC contract shape).

**Validation:** `tsc --noEmit` clean · `vitest run` **1956/1956 pass** (was 1938) · `vite build` clean · business logic untouched (all 1938 pre-existing tests still green, including the cross-platform Tier-1–4 equivalence suites and the canonical financial-logic tests).

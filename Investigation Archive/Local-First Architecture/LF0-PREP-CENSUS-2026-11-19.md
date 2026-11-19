# LF-0 execution prep — the two static censuses (2026-11-19, Session 5)

Read-only deepening produced this session per `Handoffs/handoff-session-05.md` Lane B2. Both censuses feed ROADMAP **Phase 7 (LF-0)** directly:

- **Part A** — the 27-table untouched-set re-derived and, new this session, a **per-table writer map**: what the extraction script (LF-1/LF-2 scope) must read/serialize per untouched table, and the exact RPC-read checklist.
- **Part B** — the `auth.uid()` / JWT-claims attribution at exact-tokenizer precision, and the resulting **GUC-shim requirement list** for the chain-replay prologue (the LF-1 spike's first deliverable).

Method note (both parts): a quote/comment/dollar-quote-aware SQL tokenizer (single quotes with `''` escapes, `$tag$` AND `$$` bodies, `--`/`/* */` comments) over all 152 migrations; `.from()` census over non-test `src/` (`*.ts`/`*.tsx`, excluding `*.test.*` and `/tests/`). Scripts reproducible from the descriptions; outputs archived under `/tmp` during the session and inlined below.

---

## Part A — the untouched 27: verified exactly, now with writers

### A.1 Verification of the S4 record (C-1)

Live chain = **100 static, non-temp `CREATE TABLE` statements** (union over all migrations; zero in-string dynamic creates — the two `_t105_*` tables of migration 0063 are `CREATE TEMP TABLE`s dropped at the end of that migration and are not live chain). Client `.from()` touches **73** of them. Untouched = **27**, matching S4-CROSS-VERIFICATION C-1 **exactly, including `receipts`**:

> academic_history, account_adjustments, ai_provider_configs, ai_request_logs, device_tokens, discount_applications, exam_sessions, expense_state_transitions, filieres, grades, homework_assignments, invoices, notification_preferences, parent_student_links, performance_reviews, permissions, promotion_cycle_classes, promotion_cycles, re_enrollments, **receipts**, role_permissions, salary_adjustments, service_enrollments, sessions, tenant_role_overrides, workflow_audit_links, workflow_pending_resumes

(Census-method footnote: a strings-stripped regex census that also admits `CREATE TEMP TABLE` finds 28 — the 27 plus `_t105_corpus`; the exact tokenizer resolves this to the S4 number. ARCH-025's substance is unchanged and now carries a verified, reproducible table list.)

### A.2 Per-table writer map (new)

Legend: **POL** = RLS policies exist (table is tenant-gated); **SQLW** = migrations with `INSERT/UPDATE/DELETE` into the table (function bodies / seed); **TRG** = `CREATE TRIGGER … ON <table>` exists; **EF** = edge-function code references the table (service-role writer); **∅-writer** = no mutation found anywhere in the migration chain (created + policies only).

| Table | POL | SQLW (files) | TRG | EF |
|---|---|---|---|---|
| academic_history | 0019 | 0022, 0120, 0121 | — | — |
| account_adjustments | 0019, 0041 | 0120, 0121 | — | — |
| ai_provider_configs | 0019 | — | 0012 | ai-proxy |
| ai_request_logs | 0019 | — | — | ai-proxy |
| device_tokens | — | 0050 | 0027 | send-push-notification |
| discount_applications | 0019 | 0120, 0121 | — | — |
| exam_sessions | 0094 | — | 0094 | — |
| expense_state_transitions | 0019 | 0008 | — | — |
| filieres | 0107 | 0107 | — | — |
| grades | 0019, 0041 | 0120, 0121 | 0004 | ai-proxy |
| homework_assignments | 0019 | — | 0004 | — |
| invoices | 0019 | 0120, 0121 | 0007 | — |
| notification_preferences | 0043 | — | 0043 | send-push-notification |
| parent_student_links | 0019 | 0120, 0121 | — | — |
| performance_reviews | 0019 | — | 0010 | — |
| permissions | 0019 | 0023, 0157 | — | _shared/supabase.ts |
| promotion_cycle_classes | 0108 | 0108 | — | — |
| promotion_cycles | 0108 | 0108 | — | — |
| re_enrollments | 0128 | 0128 | — | — |
| **receipts** | 0019 | 0022, 0120, 0121 | 0007 | — |
| role_permissions | 0019 | 0023, 0157 | — | _shared/supabase.ts |
| salary_adjustments | 0019 | 0120, 0121 | — | — |
| service_enrollments | 0019, 0080 | 0120, 0121 | 0007 | — |
| sessions | 0019 | — | — | run-overdue-scan |
| tenant_role_overrides | 0019 | — | — | — |
| workflow_audit_links | 0019 | — | — | — |
| workflow_pending_resumes | — | — | 0081 | workflow-execute (engine + index), workflow-resume-scheduler |

### A.3 Writer classes (what each row means for extraction)

1. **RPC-body writers (SQLW inside `CREATE FUNCTION`)** — the dominant class: `academic_history`, `account_adjustments`, `discount_applications`, `parent_student_links`, `receipts`, `salary_adjustments`, `service_enrollments`, `invoices`, `expense_state_transitions`, `filieres`, `promotion_cycles(+classes)`, `re_enrollments`, `permissions`, `role_permissions`, `device_tokens`. These tables are written ONLY by the canonical RPCs — they are the **extraction script's RPC-read checklist**: when LF-2 serializes table state, for every table above the extraction must FIRST execute/capture the RPC set that writes it (e.g. `collect_and_allocate_payment` → `receipts`; `0120/0121` purge closures → their 6 victims). Concretely: the 0058 receipt-number allocation RPC and the 0022-era function bodies are the only legitimate `receipts` writers.
2. **Trigger-maintained tables** (`TRG`) — `grades`, `invoices`, `homework_assignments`, `exam_sessions`, `notification_preferences`, `device_tokens`, `performance_reviews`, `workflow_pending_resumes`, `receipts`, `service_enrollments`: state is derivable or side-effect-maintained; the extraction must capture *derived state at snapshot time* (SELECT), while the replay prologue must re-create the triggers (chain replay does this by design — TRGs ride the migration chain).
3. **Edge-function writers (EF)** — `ai_provider_configs`, `ai_request_logs` (ai-proxy), `device_tokens`, `notification_preferences` (send-push-notification), `workflow_pending_resumes` (workflow-execute / resume-scheduler), `sessions` (run-overdue-scan), `permissions`/`role_permissions` (shared supabase client reads them). These are written by the **service-role key outside any client seam** — under local-first they become either relay jobs (blueprint §7) or main-process equivalents; until then the local DB will not receive these writes and the sync plan must treat them as **server-origin tables** (same class as `receipts` under ADR-004's old regime).
4. **Seed/config tables** — `permissions`, `role_permissions` (0023 seed; 0157 removal), `filieres` (0107), `promotion_cycles` (0108), `re_enrollments` (0128): migration-time writes only; extraction = plain SELECT; replay = the migration chain itself.
5. **∅-writer tables** — `ai_request_logs` (EF only), `sessions` (auth-stack writer: GoTrue writes `auth.sessions`-shaped rows; here `public.sessions` with policies but no chain writer — treat as **platform-origin**), `tenant_role_overrides`, `workflow_audit_links` (created + policies; writers exist only at runtime via RPCs not found in the chain — flag for the LF-2 census to confirm with a live `pg_stat`-style probe when the cap is lifted).

### A.4 The RPC-read checklist (the deliverable's purpose, spelled out)

For LF-2's extraction script, the minimal RPC *read* set that guarantees every untouched table's state is captured either directly (SELECT) or via its writer's parameters (the queued-op form the unified pipeline already produces):

| Untouched table | Capture via |
|---|---|
| receipts | SELECT (snapshot) + replay guard: receipt numbers come from 0058 RPC at replay (ADR-004S sequencing) |
| academic_history, account_adjustments, discount_applications, parent_student_links, salary_adjustments | SELECT (pure snapshot; RPC writers replayed from the op-log re-derive nothing) |
| invoices, grades, service_enrollments | SELECT + verify trigger-derived columns post-replay (0007/0004 TRGs) |
| permissions, role_permissions | SELECT (seed rows) — exclude from op-log (config, not transactional) |
| filieres, promotion_cycles, promotion_cycle_classes, re_enrollments, expense_state_transitions | SELECT (snapshot) |
| exam_sessions, homework_assignments, performance_reviews, notification_preferences | SELECT (trigger-adjacent) |
| device_tokens, ai_provider_configs, ai_request_logs, sessions, workflow_pending_resumes, workflow_audit_links, tenant_role_overrides | **server-origin class** — do NOT extract from the desktop; origin = EF/auth stack; document per-table sync stance (relay job / drop / pairing artifact) |

---

## Part B — auth.uid() at exact precision + the GUC-shim requirement list

### B.1 Exact attribution (supersedes the "89" headline)

Exact-tokenizer census over all 152 migrations (comments, string literals, and `$tag$`/`$$` bodies distinguished):

| Context | Count | Files (representative) |
|---|---|---|
| **Static `CREATE POLICY` expressions** | **41** | 0019 (the bulk: parents ×3, students ×2, invoices, installments ×2, payments ×2, ledger_entries ×2, attendance_records ×6, assessments ×4, grades ×2, payment_allocations, student_documents ×2, service_enrollments ×2, user_profiles, calendar_events, objects ×4 — storage), account_approval_requests ×3 (0046-adjacent), student_academic_histories |
| **Function bodies (`$$`/`$tag$`)** | **28** | 0003_rbac ×2, 0050_fcm ×4, 0053 ×1, 0055 ×3, 0060 ×2, 0061 ×1, 0067 ×1, 0086 ×1, 0095 ×2, 0099 ×2, 0105 ×1, 0116 ×4, 0141 ×1, 0155 ×3 |
| **Dynamic-SQL (EXECUTE'd) policy strings** | **0** | — (all 324 policies are static code; the 242 earlier "dynamic" grep hits were name-strings/comments) |
| Non-executable: `--`/`/* */` comments | 18 | mostly 0019's pattern header |
| Non-executable: `COMMENT ON FUNCTION` string literals | 3 | 0003, 0050, 0099 |
| **Executable total (shim-relevant)** | **69** | — |
| Raw file text | 90 | — |

**Correction registered (C-8, recorded in FINDINGS_INDEX):** ARCH-035's supporting count "89 `auth.uid()` refs" is a methodology artifact of a comment-stripper that removed only 1 of the 21 non-executable occurrences. The executable count is **69** (41 policy + 28 function-body). The load-bearing conclusion — *the auth-schema GUC shim is mandatory for chain replay* — is unchanged and now carries the exact number.

### B.2 Shape classes (all 41 policy refs + 28 fn refs classified)

1. **Bare-uid comparisons in policies (41/41)** — every policy-level `auth.uid()` is a direct identity comparison or null-guard, e.g. `created_by = auth.uid()`, `auth.uid() = user_profile_id`, or existence filters. **No policy reads JWT claims beyond uid** (verified: zero `auth.jwt()/auth.role()/auth.email()/request.jwt.claims` matches across all 324 policy bodies). Policy authorization beyond identity flows through the **helper functions** (`current_tenant_id()`, `has_role()`, `has_any_role()`, `has_permission()`, `current_user_profile_id()`), which internally resolve `auth.uid()` (0099's parity hardening guarantees the SECURITY DEFINER helpers see the same caller identity).
2. **Function-body refs (28) — three sub-shapes:**
   - **Caller-verification guards** (the majority): SECURITY DEFINER RPCs compare `auth.uid()` against a row's owner/profile id or resolve the caller profile (0050 FCM ×4, 0060 transfer guard ×2, 0086, 0105, 0116 ×4, 0155 ×3, 0003 ×2, 0053, 0061, 0067, 0095 ×2, 0099 ×2, 0141).
   - **JWT-beyond-uid readers** — `auth.jwt() ->> 'role' = 'service_role'` service-role bypass checks: 0132, 0116, 0128, 0155 ×3 sites, 0107, 0055; plus `auth.jwt() IS NULL` anonymous-guard (0116:152) and 0058's receipt-allocation claims read.
   - **Direct GUC readers** — `current_setting('request.jwt.claims', true)::jsonb ->> 'email'` as actor-name fallback: **0120:537, 0121:486** (the purge closures).

### B.3 The GUC-shim requirement list (feeds LF-1's prologue design verbatim)

The shim (emulating the `auth` schema on PGlite) must provide, based on B.1/B.2:

1. **`auth.uid()`** — returns `request.jwt.claims` → `sub`; MUST be a stable SQL function (not SECURITY DEFINER) so both the 41 policy sites and the 28 function-body sites resolve identically. 69 call-sites ride on this alone.
2. **`auth.jwt()`** — returns the full claims JSONB; consumers branch on `->> 'role' = 'service_role'` (≥ 7 migration files) and null-check it. The shim's seeded claims MUST therefore include a **`role` claim** with the correct value per replay context (client ops → `authenticated`; relay/admin ops → `service_role` only where the op-log entry originated from an EF writer class of Part A.3-3).
3. **`request.jwt.claims` GUC** — set per connection/transaction with at minimum `sub`, `role`, `email` (0120/0121 read `email` directly). The `true` second argument of `current_setting` (missing-ok) means absent GUC degrades to `session_user` — the shim should still set it explicitly for audit-parity.
4. **`auth.role()` / `auth.email()`** — declared by pgjwt-era conventions; the census found **no executable callers** in policies or function bodies, so the shim may implement them as trivial wrappers or omit them (two skip-guards already planned for `uuid-ossp`/`pgjwt` per ARCH-035; if pgjwt is skipped, the shim owns these three function names outright).
5. **Replay-context rules** — every queued op must record the claims snapshot it was minted under (the unified pipeline's op-log already carries actor ids; it must additionally carry the `role` and `email` claims so replay reconstructs identical shim state). This is the LF-0/LF-1 interface requirement carried into ROADMAP 7.0's T-number drafts.

### B.4 Cross-checks this session performed

- The 41-policy attribution and the zero-JWT-in-policies result were cross-checked against the 0099 parity suite's guarantees (helpers see the same `auth.uid()`) — consistent: the shim satisfying B.3-1/2/3 satisfies every policy and every RPC guard simultaneously.
- The writer map (Part A) and the shim list (Part B) were cross-checked against each other: every EF-writer class table that an RPC guard touches (e.g. `device_tokens` ← 0050) appears in both, so no table's replay depends on an unmigrated identity surface.

*End of LF-0 prep record. No application source, configuration, schema, or dependency was modified; all counting scripts are description-reproducible.*

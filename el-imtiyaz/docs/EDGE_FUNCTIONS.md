# Edge Functions Reference

This document describes all 11 Supabase Edge Functions — what they do, how to call them, request/response formats, and deployment instructions.

## Overview

Edge Functions are Deno/TypeScript serverless functions that run on Supabase's edge network. They handle:
- Sensitive operations (API key proxying for AI, email, push)
- Atomic database operations (payment collection, refunds)
- Scheduled tasks (overdue scan, backup purge)
- Complex business logic (workflow DAG execution)

### Shared utilities

All Edge Functions import from `_shared/`:
- `_shared/cors.ts` — CORS headers + `handleOptions()` + `jsonError()` + `jsonOk()`
- `_shared/supabase.ts` — `createServiceRoleClient()`, `createAnonClient()`, `extractAuthContext()`, `requirePermission()`, `requireRole()`, `writeAuditLog()`

### Authentication patterns

```typescript
// Extract auth context from JWT
const ctx = await extractAuthContext(req);
if (!ctx) return jsonError(req, 401, "unauthorized", "Authentication required");

// Require a specific permission
if (!requirePermission(ctx, "collect_payment")) {
  return jsonError(req, 403, "forbidden", "collect_payment permission required");
}

// Require a specific role
if (!requireRole(ctx, "super_admin")) {
  return jsonError(req, 403, "forbidden", "Only super_admin can do this");
}
```

---

## Function 1: approve-signup-request

**Purpose:** Approve or reject web-initiated registration requests. Binds the user's auth.users.id to a parent or student profile.

**Endpoint:** `POST /functions/v1/approve-signup-request`

**Auth:** JWT + `super_admin` or `support_staff` role

### Request body

```typescript
{
  "request_id": "uuid",              // required
  "action": "approve" | "reject",    // required
  "target_parent_id": "uuid",        // for approve — bind to existing parent
  "target_student_id": "uuid",       // for approve (student role) — bind to existing student
  "create_new_parent": boolean,      // for approve — create new parent profile
  "new_parent": {                    // required if create_new_parent=true
    "first_name": "string",
    "last_name": "string",
    "primary_phone": "string",
    "email": "string",
    "national_id": "string",
    "address": "string",
    "city": "string",
    "relationship": "father" | "mother" | "guardian" | "other"
  },
  "decision_note": "string",         // required for reject; optional for approve
  "assign_role": "string"            // override role (default: based on requested_role)
}
```

### Response (200)

```json
{
  "data": {
    "request_id": "uuid",
    "status": "approved" | "rejected",
    "auth_user_id": "uuid",
    "target_parent_id": "uuid" | null,
    "target_student_id": "uuid" | null,
    "assigned_role": "parent" | "student" | "staff",
    "message": "Registration approved. User email@example.com can now sign in."
  }
}
```

### Flow

1. Web visitor signs up via Supabase Auth (Google OAuth or email/password)
2. The `handle_new_auth_user` trigger creates a `user_profiles` row (status='pending') + `account_approval_requests` row
3. Admin opens Desktop app → Settings → Inscriptions → reviews pending requests
4. Admin calls this function with approve/reject
5. On approve:
   - Updates `account_approval_requests.status` = 'approved'
   - Activates `user_profiles.status` = 'active'
   - Assigns role via `role_assignments`
   - Binds `parents.auth_user_id` or `students.auth_user_id` (if target provided)
   - Sends confirmation email (if Resend configured)
6. On reject:
   - Updates `account_approval_requests.status` = 'rejected'
   - Suspends `user_profiles.status` = 'suspended'

---

## Function 2: bind-activation-code

**Purpose:** Bind a 6-7 digit activation code to the caller's auth.users.id (parent web portal).

**Endpoint:** `POST /functions/v2/bind-activation-code`

**Auth:** JWT (caller must be authenticated via Google OAuth)

### Request body

```json
{
  "activation_code": "1234567"  // 6-7 digit numeric string
}
```

### Response (200)

```json
{
  "data": {
    "parent_id": "uuid",
    "parent_full_name": "Benali Karim",
    "student_count": 3,
    "message": "Account successfully linked to family: Benali Karim"
  }
}
```

### Flow

1. Office staff creates parent + N students on Desktop app
2. Staff generates a 6-7 digit activation code
3. Parent opens web portal, signs in via Google OAuth
4. Parent enters activation code
5. This function calls `bind_activation_code()` RPC which:
   - Validates code (exists, not used, not expired)
   - Marks code as bound (single-use enforcement)
   - Updates `parents.auth_user_id` to caller's auth.users.id
   - Returns parent info + student count

---

## Function 3: update-server-secret

**Purpose:** Update server-side secrets (Edge Function env vars) from the desktop UI.

**Endpoint:** `POST /functions/v1/update-server-secret` (update) or `DELETE /functions/v1/update-server-secret?key=KEY` (delete)

**Auth:** JWT + `super_admin` role

### Request body (POST)

```json
{
  "key": "GROQ_API_KEY",       // env var name (must be in allow-list)
  "value": "gsk_abc123...",    // the secret value
  "category": "ai",            // system_settings category
  "label_fr": "Clé API Groq"   // optional label
}
```

### Allow-list of keys

Only these keys can be updated:
- `GROQ_API_KEY`, `OPENROUTER_API_KEY`
- `RESEND_API_KEY`, `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME`
- `FCM_SERVER_KEY`, `FCM_SENDER_ID`
- `BACKUP_PASSPHRASE`
- `CRON_SECRET`
- `ALLOWED_ORIGINS`
- `LOG_LEVEL`

### Flow

1. SuperAdmin opens Desktop → Settings → Configuration → any secret field
2. Enters the secret value
3. This function:
   - Validates the key is in the allow-list
   - Calls Supabase Management API `POST /v1/projects/{ref}/secrets` to update the env var
   - Updates `system_settings.value_encrypted` = "********" (placeholder)
   - Writes audit log (value NOT included)
4. The actual value lives only in the Edge Function environment — NEVER in the database

### Required secrets

This function itself needs:
- `SUPABASE_ACCESS_TOKEN` — personal access token for Management API
- `SUPABASE_PROJECT_REF` — project reference ID

---

## Function 4: collect-payment

**Purpose:** Atomic payment collection — payment + installment update + ledger entry + receipt + audit log.

**Endpoint:** `POST /functions/v1/collect-payment`

**Auth:** JWT + `collect_payment` permission

### Request body

```json
{
  "parent_id": "uuid",
  "student_id": "uuid",
  "amount": 50000,
  "method": "cash" | "check" | "transfer",
  "invoice_id": "uuid",
  "installment_id": "uuid",
  "notes": "Tranche 2 paiement",
  "check_number": "12345",           // required if method=check
  "check_bank_name": "BNA",          // required if method=check
  "check_issue_date": "2026-01-15",  // required if method=check
  "check_clearance_date": "2026-01-20",
  "transfer_reference": "TRX123",    // required if method=transfer
  "transfer_source_bank": "CPA",     // required if method=transfer
  "proof_path": "tenant-id/payment-id/proof.jpg"  // required if method=check or transfer
}
```

### Response (200)

```json
{
  "data": {
    "payment_id": "uuid",
    "receipt_id": "uuid",
    "new_installment_status": "paid" | "partial" | "unpaid",
    "message": "Payment of 50000 DZD collected successfully"
  }
}
```

### Flow

1. Calls `collect_payment()` PostgreSQL function which atomically:
   - Inserts payment row (with method-specific validation)
   - Updates installment.amount_paid (trigger auto-computes status)
   - Appends ledger entry (negative amount = credit)
   - Generates receipt row
   - Writes audit log

---

## Function 5: refund-payment

**Purpose:** Atomic payment refund via reversal entry.

**Endpoint:** `POST /functions/v1/refund-payment`

**Auth:** JWT + `refund_payment` permission

### Request body

```json
{
  "payment_id": "uuid",
  "reason": "Check bounced - insufficient funds"
}
```

### Response (200)

```json
{
  "data": {
    "reversal_payment_id": "uuid",
    "message": "Payment uuid has been refunded. Reversal entry uuid created."
  }
}
```

### Flow

Calls `refund_payment()` PostgreSQL function which atomically:
1. Marks original payment status = 'refunded'
2. Inserts reversal payment row (linked via `reversal_of_payment_id`)
3. Reverses the ledger entry (positive amount = debit)
4. Updates installment.amount_paid (subtracts the refunded amount)
5. Writes audit log

---

## Function 6: ai-proxy

**Purpose:** Proxy AI requests to Groq/OpenRouter. API keys NEVER leave the server.

**Endpoint:** `POST /functions/v1/ai-proxy`

**Auth:** JWT + `use_ai` permission

### Request body

```json
{
  "feature": "narrative" | "drafting" | "anomaly",
  "prompt": "Generate a report card narrative for student...",
  "max_tokens": 800,
  "temperature": 0.6,
  "expense_context": {  // for anomaly feature only
    "ticket_id": "uuid",
    "amount": 50000,
    "category": "maintenance",
    "submitter_id": "uuid",
    "historical_avg": 30000
  }
}
```

### Response (200)

```json
{
  "data": {
    "feature": "narrative",
    "provider": "groq",
    "model": "llama-3.3-70b-versatile",
    "content": "L'élève a démontré...",
    "raw_content": "L'élève a démontré...",
    "tokens_used": 450,
    "latency_ms": 1200
  }
}
```

### Features

| Feature | System Prompt Summary | Max Tokens | Temperature |
|---------|----------------------|------------|-------------|
| `narrative` | Report card narrative writer (formal French, 3-5 paragraphs) | 800 | 0.6 |
| `drafting` | Administrative drafting (convocations, alerts, policy notices) | 1024 | 0.5 |
| `anomaly` | Financial anomaly detector (returns JSON signals) | 600 | 0.3 |

### Rate limiting

- Per-tenant rate limit (default 60 requests/minute) enforced via `ai_request_logs` table
- Falls back from Groq to OpenRouter when Groq returns 429

### PII masking

The desktop app masks PII BEFORE calling this function. The function passes the masked prompt directly to the AI provider. After receiving the response, the desktop app unmasks the PII locally.

---

## Function 7: workflow-execute

**Purpose:** Execute a workflow DAG (trigger → condition → action nodes).

**Endpoint:** `POST /functions/v1/workflow-execute`

**Auth:** JWT + `execute_workflow` permission

### Request body

```json
{
  "workflow_id": "uuid",
  "trigger_type": "manual_run",  // optional, defaults to "manual_run"
  "actor_note": "Manual trigger for testing"  // optional
}
```

### Response (200)

```json
{
  "data": {
    "run_id": "uuid",
    "workflow_id": "uuid",
    "workflow_code": "WF-OVERDUE-001",
    "status": "succeeded" | "failed",
    "duration_ms": 1500,
    "node_count": 5,
    "succeeded_nodes": 4,
    "failed_nodes": 0,
    "skipped_nodes": 1,
    "error": null,
    "node_results": [
      {
        "node_id": "trigger-1",
        "node_type": "manual_run",
        "status": "succeeded",
        "started_at": "2026-01-15T10:00:00Z",
        "completed_at": "2026-01-15T10:00:00Z",
        "duration_ms": 0,
        "output": { "trigger_type": "manual_run" }
      }
    ]
  }
}
```

### DAG execution

1. Fetches workflow definition (must be status='published')
2. Checks daily execution limit (`max_daily_executions`)
3. Inserts `workflow_runs` row (status='running')
4. Topological sort (Kahn's algorithm with cycle detection)
5. Walks nodes in order:
   - **Trigger nodes** → mark as 'succeeded' (entry points)
   - **Condition nodes** → evaluate; activate 'true' or 'false' branch
   - **Action nodes** → execute (send_email, apply_discount, etc.)
6. Updates `workflow_runs` with final status + node_results
7. Writes audit log

### Node types

**Triggers:** `payment_overdue`, `schedule`, `manual_run`, `invoice_created`, `student_enrolled`, `grade_published`

**Conditions:** `debt_over_threshold`, `payment_method_match`, `student_status_match`

**Actions:** `send_email`, `apply_discount`, `create_invoice`, `push_notification`, `log_audit`, `wait_duration`, `database_query`, `extract_field`

---

## Function 8: run-overdue-scan (Cron)

**Purpose:** Daily scan of overdue installments + generate priority-based alerts.

**Schedule:** `0 8 * * *` (daily at 08:00 UTC) — configured in `config.toml`

**Auth:** None (cron invocation) or JWT + `view_financials` permission (manual)

### Manual invocation

```bash
curl -X POST https://YOUR_REF.supabase.co/functions/v1/run-overdue-scan \
  -H "Authorization: Bearer YOUR_JWT" \
  -H "Content-Type: application/json" \
  -d '{"as_of": "2026-01-15"}'
```

### Response (200)

```json
{
  "data": {
    "tenants_scanned": 1,
    "total_overdue_installments": 15,
    "total_overdue_amount": 450000,
    "alerts_created": 12,
    "by_priority": {
      "urgent": 3,
      "high": 5,
      "medium": 4
    },
    "as_of": "2026-01-15"
  }
}
```

### Flow

1. Fetches all active tenants (or just caller's tenant for manual)
2. For each tenant, calls `run_overdue_scan()` RPC
3. For each overdue installment:
   - Computes `days_overdue` + `amount_overdue`
   - Determines priority: >90 days → urgent, 31-90 → high, 0-30 → medium
   - Idempotency check: skip if notification already exists for this installment
   - Inserts notification (target_role = 'financial_officer')
4. Writes audit log per tenant

---

## Function 9: expire-pending-approvals (Cron)

**Purpose:** Auto-expire stale approval requests past their 7-day window.

**Schedule:** `0 0 * * *` (daily at 00:00 UTC)

**Auth:** None (cron) or `CRON_SECRET` bearer (manual)

### Response (200)

```json
{
  "data": {
    "expired_count": 5,
    "tenants_affected": 2,
    "run_at": "2026-01-15T00:00:00Z",
    "message": "Expired 5 pending approval request(s) across 2 tenant(s)."
  }
}
```

### Flow

1. Calls `expire_pending_approvals()` RPC
2. For each affected tenant, writes audit log with action='account_approval.expire_batch'

---

## Function 10: refresh-materialized-views (Cron)

**Purpose:** Refresh all 5 materialized views concurrently.

**Schedule:** `0 1 * * *` (daily at 01:00 UTC)

**Auth:** None (cron) or `CRON_SECRET` bearer (manual)

### Response (200)

```json
{
  "data": {
    "refreshed_views": [
      "mv_dashboard_kpis",
      "mv_debt_aging",
      "mv_top_debtors",
      "mv_revenue_by_month",
      "mv_grade_summary"
    ],
    "failed_views": [],
    "message": "Successfully refreshed 5 materialized views.",
    "duration_ms": 2500
  }
}
```

### Flow

1. Calls `refresh_all_materialized_views()` RPC
2. If bulk RPC fails, falls back to per-view refresh (isolates errors)
3. Writes audit log

---

## Function 11: purge-expired-backups (Cron)

**Purpose:** Mark expired backup archives as 'purged' (ciphertext deletion happens in IndexedDB).

**Schedule:** `0 3 * * 0` (weekly Sunday at 03:00 UTC)

**Auth:** None (cron) or `CRON_SECRET` bearer (manual)

### Response (200)

```json
{
  "data": {
    "tenants_processed": 1,
    "tenants_with_purges": 1,
    "archives_purged": 3,
    "purged_archive_ids": ["uuid1", "uuid2", "uuid3"],
    "per_tenant": [
      {
        "tenant_id": "uuid",
        "archive_ids": ["uuid1", "uuid2", "uuid3"]
      }
    ],
    "message": "Marked 3 expired backup archive(s) as 'purged'. Desktop apps should sync their IndexedDB vaults."
  }
}
```

### Flow

1. Fetches all active tenants
2. For each tenant, calls `purge_expired_backups()` RPC
3. Returns the list of purged archive IDs so the desktop app can delete the corresponding ciphertext from IndexedDB

**Note:** This function only marks the metadata rows as 'purged'. The actual ciphertext deletion happens in the Electron app's IndexedDB vault on next sync.

---

## Deployment

### Deploy all functions

```bash
cd supabase

# Deploy each function
supabase functions deploy approve-signup-request
supabase functions deploy bind-activation-code
supabase functions deploy update-server-secret
supabase functions deploy collect-payment
supabase functions deploy refund-payment
supabase functions deploy ai-proxy
supabase functions deploy workflow-execute
supabase functions deploy run-overdue-scan
supabase functions deploy expire-pending-approvals
supabase functions deploy refresh-materialized-views
supabase functions deploy purge-expired-backups
```

### Verify deployment

```bash
# List deployed functions
supabase functions list

# Test a function (should return 401 without auth)
curl -s -o /dev/null -w "%{http_code}" https://YOUR_REF.supabase.co/functions/v1/collect-payment
# Expected: 401
```

### View logs

```bash
# Tail logs for a specific function
supabase functions logs collect-payment

# Or view in Dashboard: Functions → select function → Logs
```

### Update a function

```bash
# After editing supabase/functions/<name>/index.ts
supabase functions deploy <name>
```

### Delete a function

```bash
supabase functions delete <name>
```

---

## Configuration

The `supabase/config.toml` file configures all Edge Functions:

```toml
[functions.approve-signup-request]
verify_jwt = false  # callable without JWT (used during signup)

[functions.bind-activation-code]
verify_jwt = true

[functions.update-server-secret]
verify_jwt = true

[functions.collect-payment]
verify_jwt = true

[functions.refund-payment]
verify_jwt = true

[functions.ai-proxy]
verify_jwt = true

[functions.workflow-execute]
verify_jwt = true

# Scheduled functions (cron)
[functions.run-overdue-scan]
verify_jwt = true
cron = "0 8 * * *"  # daily at 08:00 UTC

[functions.expire-pending-approvals]
verify_jwt = false
cron = "0 0 * * *"  # daily at 00:00 UTC

[functions.refresh-materialized-views]
verify_jwt = false
cron = "0 1 * * *"  # daily at 01:00 UTC

[functions.purge-expired-backups]
verify_jwt = false
cron = "0 3 * * 0"  # weekly Sunday at 03:00 UTC
```

---

## Error Handling

All Edge Functions return consistent error responses:

```json
{
  "error": {
    "code": "forbidden",
    "message": "Only super_admin can approve registrations",
    "details": null
  }
}
```

### Common error codes

| HTTP Status | Code | Meaning |
|-------------|------|---------|
| 400 | `missing_fields` | Required fields missing from request body |
| 400 | `invalid_body` | Request body is not valid JSON |
| 400 | `invalid_action` | Action parameter has invalid value |
| 400 | `invalid_key` | Secret key not in allow-list |
| 400 | `empty_value` | Secret value cannot be empty |
| 401 | `unauthorized` | JWT missing or invalid |
| 403 | `forbidden` | JWT valid but lacks required permission/role |
| 404 | `not_found` | Referenced entity not found |
| 405 | `method_not_allowed` | HTTP method not supported |
| 409 | `already_refunded` | Payment already refunded |
| 410 | `code_expired` | Activation code has expired |
| 429 | `rate_limited` | Rate limit exceeded |
| 500 | `internal_error` | Unexpected server error |
| 502 | `ai_call_failed` | AI provider call failed |
| 502 | `management_api_failed` | Supabase Management API call failed |
| 503 | `ai_not_configured` | AI provider API key not configured |
| 503 | `management_api_not_configured` | SUPABASE_ACCESS_TOKEN not set |

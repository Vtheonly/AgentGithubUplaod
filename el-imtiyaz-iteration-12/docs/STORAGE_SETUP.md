# Storage Setup Guide

This document describes the 10 Supabase Storage buckets, their RLS policies, folder structure, and how to use them.

## Overview

The platform uses Supabase Storage for all file uploads. **No public URLs are allowed** — all access uses signed URLs with 5-minute default expiry (plan §13.04).

### Buckets

| # | Bucket | Purpose | Public? | Max Size | Allowed MIME Types |
|---|--------|---------|---------|----------|-------------------|
| 1 | `payment-proofs` | Check scans + transfer receipts | No | 10 MB | jpeg, png, webp, pdf |
| 2 | `expense-receipts` | Vendor receipts | No | 10 MB | jpeg, png, webp, pdf |
| 3 | `receipts` | Auto-generated PDF receipts | No | 5 MB | pdf |
| 4 | `student-documents` | Birth certificates, medical, contracts | No | 10 MB | jpeg, png, webp, pdf |
| 5 | `homework-attachments` | Teacher-uploaded PDFs/photos | No | 10 MB | jpeg, png, webp, pdf |
| 6 | `task-attachments` | Files attached to tasks | No | 10 MB | jpeg, png, webp, pdf, docx, xlsx, txt, csv |
| 7 | `chat-attachments` | Files shared in chat | No | 10 MB | jpeg, png, webp, pdf, xlsx, txt |
| 8 | `tenant-assets` | Logos, branding | No | 5 MB | jpeg, png, svg, webp |
| 9 | `ai-reports` | AI-generated PDFs | No | 5 MB | pdf, txt |
| 10 | `import-reports` | Excel/JSON import reports | No | 10 MB | xlsx, json, csv |

All buckets are created automatically by migration `0018_storage.sql`.

---

## Folder Structure (Enforced by RLS)

Every file upload must follow this path pattern:

```
<tenant_id>/<entity_id>/<filename>
```

**Example:**
```
00000000-0000-0000-0000-000000000001/payment-uuid-12345/check-scan.jpg
```

The RLS policy on `storage.objects` checks that the first path segment matches the caller's `tenant_id`:

```sql
CREATE POLICY payment_proofs_write ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'payment-proofs'
    AND (storage.foldername(name))[1] = public.current_tenant_id()::text
    AND public.has_any_role(array['super_admin', 'financial_officer', 'support_staff'])
  );
```

### Why this structure?

1. **Tenant isolation** — RLS can check the tenant_id from the path
2. **Entity grouping** — all files for one payment/student/expense are in one folder
3. **Easy cleanup** — delete the folder to remove all files for an entity
4. **No filename collisions** — UUIDs ensure uniqueness

---

## RLS Policies per Bucket

### payment-proofs

| Operation | Allowed Roles |
|-----------|---------------|
| Read | super_admin, financial_officer, support_staff |
| Write | super_admin, financial_officer, support_staff |
| Delete | super_admin only |

### expense-receipts

| Operation | Allowed Roles |
|-----------|---------------|
| Read | super_admin, financial_officer, manager, buyer |
| Write | All staff roles (anyone who can submit expenses) |
| Delete | super_admin only |

### receipts (auto-generated)

| Operation | Allowed Roles |
|-----------|---------------|
| Read | super_admin, financial_officer, support_staff, parent (own receipts only) |
| Write | super_admin, financial_officer, support_staff (system-generated via Edge Function) |
| Delete | super_admin only |

### student-documents

| Operation | Allowed Roles |
|-----------|---------------|
| Read | super_admin, financial_officer, support_staff, teacher, manager |
| Write | super_admin, support_staff |
| Delete | super_admin only |

### homework-attachments

| Operation | Allowed Roles |
|-----------|---------------|
| Read | super_admin, teacher, parent, student, support_staff |
| Write | super_admin, teacher |
| Delete | super_admin, teacher (own uploads) |

### task-attachments

| Operation | Allowed Roles |
|-----------|---------------|
| Read | All staff roles |
| Write | All staff roles |
| Delete | super_admin, creator |

### chat-attachments

| Operation | Allowed Roles |
|-----------|---------------|
| Read | Channel members only (enforced via `chat_channels.member_ids`) |
| Write | Channel members only |
| Delete | super_admin, message author |

### tenant-assets

| Operation | Allowed Roles |
|-----------|---------------|
| Read | super_admin, financial_officer |
| Write | super_admin only |
| Delete | super_admin only |

### ai-reports

| Operation | Allowed Roles |
|-----------|---------------|
| Read | super_admin, financial_officer, teacher |
| Write | super_admin, financial_officer (system-generated via Edge Function) |
| Delete | super_admin only |

### import-reports

| Operation | Allowed Roles |
|-----------|---------------|
| Read | super_admin, financial_officer, support_staff |
| Write | super_admin, financial_officer, support_staff |
| Delete | super_admin only |

---

## Signed URLs

### Why signed URLs?

Per plan §13.04: "No public URLs. Signed URLs only (5-min default expiry). Never cache signed URLs."

Signed URLs:
- Expire after a configurable time (default 5 minutes)
- Are tied to the requesting user's permissions
- Cannot be reused after expiry
- Are generated server-side (or client-side via Supabase SDK)

### Generating signed URLs (client-side)

```typescript
// Desktop app (TypeScript)
const { data, error } = await supabase.storage
  .from('payment-proofs')
  .createSignedUrl('tenant-id/payment-id/check.jpg', 300);  // 5 minutes

if (data) {
  window.open(data.signedUrl);
}
```

### Generating signed URLs (Edge Function)

```typescript
// In an Edge Function
const { data, error } = await supabase.storage
  .from('receipts')
  .createSignedUrl(path, 300);
```

### Upload flow

```typescript
// 1. Upload the file
const filePath = `${tenantId}/${paymentId}/check-scan.jpg`;
const { data, error } = await supabase.storage
  .from('payment-proofs')
  .upload(filePath, file, {
    contentType: 'image/jpeg',
    upsert: false,  // don't overwrite
  });

// 2. Save the path to the database
await supabase
  .from('payments')
  .update({ proof_path: filePath })
  .eq('id', paymentId);

// 3. Later, generate a signed URL to view
const { data: urlData } = await supabase.storage
  .from('payment-proofs')
  .createSignedUrl(filePath, 300);
```

---

## Mobile App Camera Capture

Per plan §13.05, the Android app captures photos directly via CameraX (not the device's default camera app):

1. Staff opens camera from expense ticket
2. Capture photo (CameraX API)
3. Auto-compress to WebP (quality 85, max 1920x1080)
4. Upload directly to private Supabase bucket (NOT to public gallery)
5. Attach signed URL to expense ticket
6. Reject images below minimum resolution threshold (640x480)

```kotlin
// Android (Kotlin) - pseudo-code
val image = cameraX.capture()
val webp = image.compress(WebP, 85, maxSize = 1920)
val path = "$tenantId/$expenseId/receipt-${UUID()}.webp"
supabase.storage.from("expense-receipts").upload(path, webp)
expense.receiptPath = path
```

---

## Storage Configuration

### File size limits

Configured in migration `0018_storage.sql`:

```sql
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'payment-proofs',
  'payment-proofs',
  false,
  10485760,  -- 10 MB in bytes
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
);
```

To change a bucket's limits, update the `storage.buckets` table:

```sql
UPDATE storage.buckets
   SET file_size_limit = 20971520  -- 20 MB
 WHERE id = 'payment-proofs';
```

### MIME type validation

Enforced at upload time. If the file's MIME type doesn't match the allowed list, the upload is rejected.

### Image compression (client-side)

The desktop app compresses images before upload:
- JPEG: quality 85, max 1920x1080
- PNG: convert to WebP if > 1 MB
- WebP: quality 85, max 1920x1080

This reduces storage costs + upload time.

---

## Verification

### Verify buckets exist

```bash
# List all buckets
curl -s https://YOUR_REF.supabase.co/storage/v1/bucket \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" | jq '.[].name'
```

Expected output:
```
"payment-proofs"
"expense-receipts"
"receipts"
"student-documents"
"homework-attachments"
"task-attachments"
"chat-attachments"
"tenant-assets"
"ai-reports"
"import-reports"
```

### Verify RLS policies

```sql
SELECT polname, polcmd, qual, with_check
  FROM pg_policy
 WHERE polrelid = 'storage.objects'::regclass
 ORDER BY polname;
```

You should see 20+ policies (2 per bucket: read + write).

### Test upload

```bash
# Upload a test file (replace placeholders)
curl -X POST \
  https://YOUR_REF.supabase.co/storage/v1/object/payment-proofs/TENANT_ID/test/test.jpg \
  -H "Authorization: Bearer USER_JWT" \
  -H "Content-Type: image/jpeg" \
  --data-binary @test.jpg

# Expected: 200 OK
```

### Test signed URL

```bash
# Generate a signed URL (requires user JWT)
curl -s -X POST \
  https://YOUR_REF.supabase.co/storage/v1/object/sign/payment-proofs/TENANT_ID/test/test.jpg \
  -H "Authorization: Bearer USER_JWT" \
  -H "Content-Type: application/json" \
  -d '{"expiresIn": 300}'

# Response: {"signedURL": "https://..."}
```

---

## Cleanup

### Delete files when an entity is deleted

When a parent is soft-deleted, their files should remain (for audit). When a parent is hard-deleted, their files should be removed:

```typescript
// List all files in the parent's folder
const { data: files } = await supabase.storage
  .from('student-documents')
  .list(`${tenantId}/${parentId}`);

// Delete each file
for (const file of files ?? []) {
  await supabase.storage
    .from('student-documents')
    .remove([`${tenantId}/${parentId}/${file.name}`]);
}
```

### Storage lifecycle (future)

For production, configure storage lifecycle rules:
- Move files older than 1 year to cold storage (Infrequent Access tier)
- Delete files older than 7 years (matches audit log retention)

This is configured in the Supabase Dashboard → Storage → Lifecycle rules (Pro tier feature).

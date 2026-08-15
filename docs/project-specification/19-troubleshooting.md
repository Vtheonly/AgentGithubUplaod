# 19 — Troubleshooting

Common failure modes, root causes, and fixes.

---

## 1. Orphaned Student Records

**Symptom:** Student with no linked Parent; bidirectional navigation breaks; family balance reports wrong numbers.

**Causes:**

- Code path bypassed the `parent_id` FK check.
- Parent was deleted without cascading or reassigning children.
- Bulk import skipped parent creation for a row.

**Diagnostic SQL:**

```sql
SELECT id, full_name, parent_id
FROM students
WHERE parent_id IS NULL
   OR parent_id NOT IN (SELECT id FROM parents);
```

**Fix:**

1. Create a Parent and link the student, OR reassign to an existing Parent.
2. Audit-log the fix.

**Prevention:**

- Enforce `parent_id` NOT NULL at the schema level.
- Use atomic transactions for all student creation paths.
- Block Parent deletion while Students are linked.

---

## 2. Failed Backup Verification

**Symptom:** The 24-hour daemon ran but the archive is corrupted, missing, or unopenable.

**Causes:**

- Disk full on the local vault.
- AES key changed without re-encrypting old archives.
- Supabase connection dropped mid-dump.
- Media bucket download timed out.

**Checklist:**

1. Check the daemon log timestamp + error.
2. Verify vault disk space.
3. Confirm the AES key in the secrets manager matches the historical key.
4. Verify Supabase connectivity from the Desktop.
5. Test restore of the most recent successful backup.

**Fix:**

1. Resolve the root cause.
2. Trigger an ad-hoc backup.
3. Verify with a staging test restore.

**Prevention:**

- Disk-space alerting at 80% vault capacity.
- Backup success/failure notification via Edge Function.
- Weekly test restore in staging.

---

## 3. Sync Conflicts in Offline Mode

**Symptom:** Mobile recorded attendance or expense offline; sync to Supabase fails or produces conflicts.

**Causes:**

- Same record modified on Desktop while Mobile was offline.
- Network reconnection mid-sync leaving partial uploads.
- Local Room DB schema drifted from server schema after an update.

**Fix:**

1. Identify the conflicting records.
2. Apply **last-write-wins** for non-critical fields (notes, descriptions).
3. Surface critical conflicts (payment amounts, grade changes) to the user for manual resolution.
4. Mark the sync queue item as completed.

**Prevention:**

- Include a `client_updated_at` timestamp on mobile records.
- Use server-side `updated_at` comparison to detect stale writes.
- Surface sync failures prominently in the mobile UI — do not let them fail silently.

---

## 4. Payment Proof Verification

**Symptom:** Receipt or check scan attached to a payment or expense ticket is blurry, cut off, or unreadable.

**Causes:**

- Camera moved during capture.
- Poor lighting.
- Over-compression.
- Staff uploaded from the gallery instead of using the live camera.

**Fix:**

1. Reject the unreadable image.
2. Notify the submitting staff to re-capture using the in-app camera.
3. Provide capture guidelines: hold steady, good lighting, fill the frame.

**Prevention:**

- Enforce minimum image resolution in the upload pipeline.
- Reject images below the clarity threshold.
- Provide in-app capture guidance (overlay frame, steady-hand detector).

---

## 5. Workflow Not Firing

**Symptom:** Workflow is deployed but not executing when the trigger condition is met.

**Causes:**

- Trigger node misconfigured (wrong event type or field).
- Condition evaluator returns `false` due to a logic bug.
- Edge Function deployment failed silently.
- Workflow is in "Draft" status, not "Published".

**Checklist:**

1. Verify the workflow status is `Published`.
2. Check Edge Function logs in Supabase.
3. Manually trigger the workflow to confirm the action chain.
4. Inspect the condition evaluator's input data.
5. Verify the trigger event is actually firing in the DB.

**Fix:**

1. Identify the failing node (trigger / condition / action).
2. Patch the node config.
3. Re-deploy to Edge Functions.
4. Test with mock data.

**Prevention:**

- Always test workflows with mock data before publishing.
- Add an audit log action as the final node so silent failures become visible.
- Monitor Edge Function execution logs.

---

## 6. DAG Cycle Detection Errors

**Symptom:** The visual DAG canvas rejects a workflow with a "cycle detected" error on publish.

**Causes:**

- A node output connects back to an upstream node, forming a loop.
- A `Transform` node feeds back into a `Trigger` node.
- The visual layout hides a back-edge.

**Fix:**

1. Identify the back-edge causing the cycle.
2. Either remove the back-edge OR insert a `Delay` + `Transform` pair to break the cycle into a finite sequence.
3. Re-run Kahn's algorithm to verify acyclicity.
4. Publish.

**Prevention:**

- Run cycle detection on every canvas save (not just on publish).
- Provide visual feedback (red edges) when a connection would create a cycle.

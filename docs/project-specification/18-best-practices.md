# 18 — Best Practices

Patterns and habits that keep the platform stable, auditable, and secure. Each practice consolidates rules stated elsewhere into actionable engineering discipline.

---

## 1. Atomic Database Transactions

Wrap multi-record writes in `BEGIN...COMMIT`. If any record fails, the entire operation rolls back.

### SQL pattern

```sql
BEGIN;
  INSERT INTO parents (...) VALUES (...) RETURNING id AS parent_id;
  -- use returned parent_id
  INSERT INTO students (parent_id, ...) VALUES (...);
  -- repeat for N students
  -- if any INSERT fails, ROLLBACK auto-fires
COMMIT;
```

### When to use

- Batch student creation (note 04).
- Bulk Excel imports (note 14).
- Two-tier expense workflow transitions (note 08).
- One-click batch promotion (note 06).
- Payment collection + waterfall allocation + ledger entry (note 07).

> **Critical rule:** Validate the entire form first, then commit once. Never commit the Parent before validating all child records. A partial commit leaves the database in an inconsistent state.

---

## 2. Audit Trail Hygiene

Every state-changing operation writes to the audit log.

### Requirements

- Every entry includes `before_json` + `after_json` snapshots.
- Every entry attributes to a real user ID (or `system` for automation).
- Append-only — no edits, no deletes.
- Mask sensitive fields if regulatory rules require (e.g. redact PII from `before_json` if the audit log is shared with a third-party auditor).
- Retention matches or exceeds legal requirements.

> **Critical rule:** Never truncate `before_json` / `after_json`. Storage is cheap; audit gaps are expensive. A truncated delta is worse than no delta — it gives a false sense of completeness.

---

## 3. Mobile Camera Capture Workflow

When capturing receipt photos, check scans, or other sensitive documents on Mobile:

1. Use the native **CameraX** API (not the device's default camera app).
2. **Auto-compress** to WebP before upload.
3. Upload directly to the **private Supabase bucket** — never save to the public gallery.
4. Generate a **fresh signed URL** when displaying the image later (note 12).
5. **Reject images** below the minimum resolution threshold.

> **Critical rule:** Never save captured images to the phone's public photo gallery. Gallery photos are backed up to cloud services, shared with family members, and persist after the app is uninstalled. A receipt photo in the gallery is a compliance violation.

---

## 4. Workflow DAG Validation

Before deploying a workflow:

1. Run **Kahn's algorithm** to verify DAG integrity (no cycles).
2. **Test against mock data** before deploying to production.
3. Add a `Delay` node between aggressive actions (e.g. email bursts) to avoid rate-limiting.
4. Include an **audit log write** as the final action node.
5. Set a **maximum execution count** per day per workflow to prevent runaway loops.
6. Use `AND` conditions to prevent accidental mass-firing (require multiple conditions to be true before an action executes).

> **Critical rule:** Never deploy a workflow that mutates data without an audit log action. A silent workflow failure is an unauditable state change — you cannot debug what you cannot see.

---

## 5. Parent-First Data Modeling

Always model Parent records before Student records.

### Pattern

1. Create or look up the Parent.
2. Validate the Parent profile.
3. Create the Student with `parent_id` FK.
4. Attach services / enrollments / discounts.
5. Commit the atomic transaction.

> **Critical rule:** Never allow a "create student" form that does not first select or create a Parent. The UI must enforce the dependency visually before submission — disable the submit button until a Parent is selected or created.

---

## 6. Color Token Discipline

1. Always reference **CSS variables** (e.g. `var(--color-primary-blue)`).
2. Never **hard-code hex strings** (e.g. `#349BD4`) in components.
3. When porting a color from a design tool (Figma, Sketch), add it to the **token file** first, then reference the token.
4. Use **semantic status tokens** (e.g. `var(--status-success)`) rather than raw color tokens when mapping a domain status to a color. This lets the status palette change without touching every component.

> **Critical rule:** Never copy hex strings from Figma into components. Port them into the token file first, then reference the token. Centralizing tokens means a theme change (e.g. adding a light mode) only requires editing the token file, not grep-and-replacing hex strings across hundreds of components.

# 16 — Deprecations and Removals

The authoritative list of permanently removed modules. These decisions are final — they are documented here so engineers do not accidentally re-create them "for backward compatibility."

This note consolidates the deprecation decisions also covered in note 01 — Conflict Resolutions.

---

## 1. Fee Templates Removal

**Status:** Completely removed from codebase, database, and UI.

**Replaced by:** Dynamic service enrollment logic. Each service (Tuition, Transport, Clubs, Therapy) has its own pricing configuration attached to the enrollment record, not to a separate template entity. Adjustments happen at the student account level via Discretionary Adjustments (note 07).

> **Critical rule:** Never build "fee templates" UI. Route stakeholders who ask for "fee templates" to the service configuration screens. The concept of a reusable fee template is deprecated — pricing is per-enrollment.

---

## 2. Scholarship System Removal

**Status:** Completely removed — all scholarship tracking rules, tables, and UI options purged.

**Replaced by:** Audited Discretionary Account Balance Adjustments with reason codes (note 07).

> **Critical rule:** Never re-create scholarship tables or UI. Route "scholarship" requests to the Discretionary Adjustments workflow. The word "scholarship" may still appear in user conversations, but the system has no scholarship module — it has audited adjustments with reason codes.

---

## 3. Excel Engine Purge

**Status:** Formula parser, Devis quote sheets, column-AM parsers, cell-matching engine, template mapping — all purged.

**Replaced by:** Excel survives only as a two-way data bridge (import `.xlsx` rosters, export `.xlsx` / `.csv` reports). `ExcelJS` is restricted to import/export service modules only. See note 14.

> **Critical rule:** Never re-introduce ExcelJS formula parsing into runtime code paths. The purge is final.

---

## Additional Deprecations

These decisions are documented in note 01 — Conflict Resolutions but are restated here for completeness:

### 4. No Native Client Mobile App

Parents and students access the platform **exclusively through the Web Portal** (browser). The Android app in the app store is staff-only.

> **Critical rule:** Never build a native parent/student mobile app. The Web Portal is the only client surface for non-staff users.

### 5. Backups Strictly Off Supabase

Backups **must never reside inside the primary Supabase instance**. Desktop-driven 24-hour AES-256 encrypted archive to a local/offsite vault with 365-day rolling retention. See note 13.

> **Critical rule:** Never store backup archives in a Supabase Storage bucket. A backup co-located with the primary data is lost when the primary data is lost.

### 6. Groq (Not Grok) as AI Provider

The AI provider is **Groq** (with a "Q") LPU API, not Grok (xAI). OpenRouter is the fallback gateway. See note 11.

> **Critical rule:** Never reference "Grok" or "xAI" in code, configuration, or documentation. The provider is Groq. The similarity in names is coincidental and has caused confusion in the past.

---

## Purged Database Structures

The following database tables and modules were removed when the Excel engine was purged:

| Purged structure | Replacement |
| :--- | :--- |
| `quote_blocks` | Structured `invoices` + `ledger_entries` tables |
| `spreadsheet_templates` | DB-driven subject-grade mapping (note 05) |
| `payment_audit_comments` | `audit_logs` table with `before_json` / `after_json` (note 12) |
| Formula parser service | N/A — no in-app formula evaluation |
| Cell-matching engine | N/A — no in-app cell matching |
| Devis sheet reproduction service | In-app billing engine (note 07) |

> **Critical rule:** Never re-create any purged table "for backward compatibility." The purge is final. Backward compatibility with legacy data is provided by the import pipeline, not by reviving the old schema.

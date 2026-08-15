# 01 — Conflict Resolutions

> **Why this section exists:** The project specification merged several drafts. Some drafts disagreed. This note records which rule survived and why, so the decision never needs to be re-litigated.

The merged drafts contained repeated, sometimes contradictory, descriptions of the same feature. In every case the **later, more specific revision explicitly overrode the earlier rule**. The surviving decisions are summarized below.

---

## The 8 Surviving Overrides

| Topic | Old rule | Surviving rule | Rationale |
| :--- | :--- | :--- | :--- |
| **Family size** | 4 children max per parent | **Unlimited 1 → N children** | The 4-child cap was an arbitrary legacy constraint. Parents must be able to link any number of dependent children. |
| **AI provider** | Grok (xAI) | **Groq LPU API** + OpenRouter fallback | Groq's LPU hardware delivers sub-second inference with a usable free tier. OpenRouter is the multi-model fallback gateway, never used in parallel with Groq. |
| **Excel engine** | Embedded formula parser, Devis sheets | **Purged — Excel is only a data bridge** | The in-app spreadsheet logic (SUM, VLOOKUP, cell matching, Devis reproduction) was unmaintainable. Excel survives only for `.xlsx` import and `.xlsx`/`.csv` export. |
| **Financial relief** | Scholarship system | **Discretionary Account Adjustments** | Scholarships lacked audit trails. All financial relief now flows through audited adjustments with reason codes and admin notes. |
| **Pricing model** | Fee Templates module | **Dynamic service enrollment** | Each service (Tuition, Transport, Clubs, Therapy) carries its own pricing attached to enrollment, not a separate template entity. |
| **Client mobile app** | Implicit native app | **Web Portal only** | Parents and students access the platform exclusively through a browser. The Android app is staff-only. |
| **Mobile parity** | Partial feature subset | **100% data read parity** | The Staff Android app reads everything the Desktop can read. The only exceptions are three physically-impractical operations: local DB backup, raw `.xlsx` parsing, visual DAG canvas editing. |
| **Backup location** | Could live in Supabase | **Strictly off Supabase** | Backups must never reside inside the primary Supabase instance. Desktop-driven 24-hour AES-256 encrypted archive to a local/offsite vault. |

---

## How These Overrides Propagate

Every other note in the project specification assumes the surviving rules above are in effect. If you encounter a description elsewhere in the spec that appears to contradict one of these eight decisions, the decision in this note wins.

### Key implications

- **Unlimited children** → the CRM data model (note 04) uses an unbounded 1→N relationship, and the batch registration workflow has no child-count limit.
- **Groq + OpenRouter** → the AI integration (note 11) routes through Groq first and only falls back to OpenRouter on rate-limit or model-variety needs.
- **Excel purged** → the data bridge (note 14) only handles import and export; no formula evaluation happens in-app.
- **Discretionary adjustments** → the financial engine (note 07) has no scholarship tables; all relief is an audited adjustment with a reason code.
- **Dynamic service enrollment** → pricing is attached to each enrollment record, not to a template (note 16).
- **Web Portal only** → the architecture (note 02) defines three frontends, but parents/students only use the browser.
- **100% read parity** → the platform feature allocation matrix (note 02) marks every read operation as available on both Desktop and Mobile.
- **Backups off Supabase** → the backup module (note 13) runs a Desktop daemon that pulls data out to a separate vault.

# Audits — Archival Evidence Base

> **What this folder is:** the two read-only audit reports that produced the project's problem registry, preserved **verbatim** (byte-identical below the archival banner at the top of each file). They are the evidence base for every problem ID, task and ADR in this documentation system. They are **read-only history**: never edit them, never append to them, never "fix" a finding inside them.

## Contents

| File | What it is | Findings |
|---|---|---|
| [`first-pass-audit.md`](first-pass-audit.md) | First pass: per-repo deep scans by agents 2-a (desktop), 2-b (Android), 2-c (website) + cross-repo analysis (shared multi-agent worklog format) | 86 |
| [`second-pass-audit.md`](second-pass-audit.md) | Second pass: six forensic auditors 3-A…3-F tracing each cross-cutting concern end-to-end (auth/activation/RLS · payment/refund/receipt · sync/offline/realtime/cache · parent/student/tenancy · chat/notifications/push · academic) | 99 |
| [`backend-health-check-2026-08-30.md`](backend-health-check-2026-08-30.md) | Session 8 LIVE backend health check: row counts, financial integrity, orphan detection, RLS probes, MV freshness, RPC inventory, auth-user census — executed against the production Supabase via REST (service_role) + Auth Admin API + EF probes | 11 findings (F-01…F-11) |

**Total raw findings: 185 → consolidated into 145 unique problems** in [`docs/recovery/problem-registry.md`](../recovery/problem-registry.md).

## How the audits relate to the rest of the documentation system

```
docs/audits/*.md               raw evidence (read-only, frozen)
        │ consolidate (merge duplicates, resolve collisions, absorb extend-chains)
        ▼
docs/recovery/problem-registry.md    THE authoritative problem list (145 problems)
        │ plan (group into phases, order by priority/dependency)
        ▼
docs/recovery/task-registry.md       THE authoritative task list (T-000…T-077)
        │ execute per docs/agents/workflow.md + git-workflow.md
        ▼
docs/recovery/change-log.md          verified history of what was fixed
```

- **Conflicts:** if anything in an audit contradicts the problem registry, **the registry wins** — the registry was reconciled against repository evidence after both audits.
- **New findings:** do NOT write them into the audit files. Add a new entry to the problem registry (next free ID in the category prefix), citing audit file + finding ID as evidence when applicable.
- **Citation rule:** cite the **registry ID** (e.g. `SEC-100`) in tasks, commits and change-log entries. Cite the raw audit (e.g. `docs/audits/second-pass-audit.md`, finding SEC-100) only when you need the full end-to-end trace or git-forensic evidence behind it.

## Reading the audit IDs safely (mapping rules)

The two audit passes were run by different agent sets and their ID spaces overlap. The registry header ("Consolidation rules applied") is the definitive statement; in short:

1. **ID collisions were renumbered.** The second pass's agent 3-A re-used `SEC-100`/`SEC-101`, which agent 3-B had already taken. In the registry, 3-A's two findings live on as **`SEC-111`** (`upsert_payment_from_import` is SECURITY DEFINER) and **`SEC-112`** (`revert_payment_allocation` has no tenant check). When you see `SEC-100`/`SEC-101` in `second-pass-audit.md`, check WHICH agent section it sits in: in agent 3-B's section they map to themselves; in agent 3-A's section they map to `SEC-111`/`SEC-112`.
2. **Extend-chains were absorbed.** Second-pass findings explicitly marked *extends <first-pass ID>* were merged into that parent problem (e.g. `TENANT-105` → `DEAD-100`, `PARENT-100` → `DRIFT-001`). Absorbed IDs are listed under *Consolidated from* / *Absorbed findings* in the registry and redirect to the surviving entry.
3. **Same-root families were merged.** E.g. the five receipt-numbering algorithms → `DRIFT-011`; the four equivalence test frameworks → `DUP-001`.
4. **Nothing was dropped silently.** Every raw ID appears in the registry either as its own entry, as a renumbered entry, or inside a *Consolidated from* / *Absorbed findings* list.

## Caveats when reading the audits

- **Paths are frozen at audit time.** References like `/home/z/my-project/repos/AgentGithubUplaod/…` point at the audit-time checkout. Map them to the repo layout (`elimtiyaz-desktop/…`, `app/src/…`, `src/…`) when following along.
- **Line numbers are audit-time snapshots.** Files have not been modified by the documentation reset (it touched only `.md` files), but any *repair* commit after T-001 will start shifting them. Re-locate by symbol name, not line number.
- **Severity/status reflect audit time (2026-08-28/29), not the current state.** For current status of any finding, read its registry entry. For the state of the project, read `docs/recovery/current-state.md`.
- The first-pass report's framing sections (audit scope, output format, per-repo assignments) describe how the audit was run — they are historical process records, not current instructions. **Current instructions live in `AGENTS.md` and `docs/agents/`.**

## Archival integrity

Each archived report is the original file with a single archival banner prepended (marked "ARCHIVAL COPY — DO NOT EDIT" and separated by a horizontal rule). Everything below that rule is byte-identical to the audit as produced. The verification of this reset (including the verbatim-suffix check for both files) is recorded in `docs/recovery/change-log.md`.

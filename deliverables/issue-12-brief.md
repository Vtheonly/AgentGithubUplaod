# Issue #12 — Purge Button (verbatim brief, retrieved 2026-09-26)

> Repository: Vtheonly/AgentGithubUplaod · Issue #12 · Title: "Purge Button"
> Retrieved via the GitHub issues page (the REST API was rate-limited / the PAT invalid).

## Task

Add a **Purge Button** that can completely purge student-related data from the system.

The purge must remove **everything associated with the students and their parents**, including but not limited to:

- Student records and profiles.
- Parent records/profiles associated with those students.
- Enrollments and academic/student-related records.
- Financial records associated with students or parents.
- Transactions.
- Payments and payment allocations.
- Debts, credits, balances, installments, and other payment-related records.
- Historical records that are specifically student/parent-associated.
- Any other dependent or derived data that belongs to the student/parent domain.

The implementation must account for all relationships and dependencies so that the purge does not leave orphaned, inconsistent, or partially deleted records.

The button should therefore represent a **full student/parent data reset**, not merely deletion of the student profile itself.

Before implementation, identify all student- and parent-related tables, relationships, references, derived records, and financial dependencies so the purge can cover the complete dependency graph safely.

This is intended as an administrative/destructive operation and should be implemented with appropriate safeguards and confirmation so it cannot be triggered accidentally.

---

## Implementation notes gathered this session (for the next session)

1. **The unregistered live migration `0118 purge_student_parent_domain`** (handed back by the 99th session in `docs/recovery/next-task.md`): a purge-domain RPC exists LIVE in `supabase_migrations.schema_migrations` with NO repo file — introspect the live DB FIRST (the live schema is the authority, AGENTS.md §57c). Either build on it or reconcile the divergence. Next free migration number: **0120**.
2. The desktop owns the canonical migration chain: `elimtiyaz-desktop/supabase/migrations/` (0001–0119 in the repo; 0118 live-only).
3. The financial domain spans: parents, students, enrollments, installments (INV-*), payments + allocations (the waterfall), ledger_entries, debts/credits/balances, audit_logs (student/parent events), activation_codes, receipts. The full dependency graph must be enumerated from the migration chain BEFORE writing the purge RPC.
4. The purge needs an owner-facing confirmation flow (destructive operation) — the desktop Settings or CRM surface is the natural home; follow ADR-002 (server-authoritative writes) — the purge must be a SQL RPC, not a client-side delete loop.
5. Follow the session discipline: read `AGENTS.md` first; register the task + problems BEFORE fixing (§13); problems go in `docs/recovery/problem-registry.md`; the task goes in `docs/recovery/task-registry.md` (the next T-number after T-415); verify with live evidence; commit per §14 (task/change/why/test/left/related); push + merge immediately (a concurrent agent works the same repo).

# AGENTS Charter Amendment — the VERBATIM adoption draft (G0-gated; DO NOT APPLY until Gate G0 lifts)

**Status:** a staged, ready-to-commit governance amendment produced by Session 26 (2026-11-21). `AGENTS.md` and `AGENTS_supabase.md` at the repository root are READ-ONLY under Gate `G0` (Issue #32, 0 comments) — this draft sits in the archive until the owner green-lights execution, at which point the executor copies the blocks below VERBATIM into the two files and commits them as their own commit (message: `Governance: adopt the Migration Consolidation & Egress Charter (OPS-020) — AGENTS.md §11.6 + AGENTS_supabase.md §6.7`).

**Source of truth:** `Investigation Archive/MIGRATION-CONSOLIDATION-AND-EGRESS-CHARTER.md` (the permanent standing rule, registered OPS-020). If this draft and the charter ever disagree, the CHARTER governs.

---

## Block A — to be appended at the END of `AGENTS.md` §11 ("How to run verification"), as §11.6

```markdown
### 11.6 Migration Consolidation & Egress Charter (permanent — OPS-020)

Any migration consolidation, schema-baseline regeneration, or relocation-target
seeding MUST satisfy the Migration Consolidation & Egress Charter
(`Investigation Archive/MIGRATION-CONSOLIDATION-AND-EGRESS-CHARTER.md`), in order:

1. **Never concatenate old migrations.** Consolidation produces ONE single,
   minimal, canonical migration file representing the database's exact
   authoritative latest state — generated from a live replayed catalog
   (the pg_dump introspection method), never a textual stitch. Intermediate
   artifacts are purged; originals move VERBATIM to `migrations_archive/`
   and are then frozen.
2. **Design for minimal future Supabase egress.** The consolidated schema is
   audited for egress BEFORE becoming the baseline: aggregation RPCs/MVs with
   the unique indexes `REFRESH CONCURRENTLY` requires on EVERY matview,
   keyset/cursor delta-sync primitives, transactional batch mutation RPCs,
   targeted projections (never `select("*")`), and no unused/high-churn artifacts.
3. **Mandatory 100% local validation before ANY remote touch.** A from-scratch
   local reconstruction (PGlite + the `0000_local_compat` prologue; harness
   outside the repo) must prove every axis — tables, columns, defaults,
   constraints/FKs, indexes, views, matviews + unique indexes, functions,
   triggers, RLS enable/policies (public AND storage), grants, buckets +
   storage policies, publication memberships, canonical seeds — with a written
   expected-vs-observed census table. Only a PASSING census unlocks any live
   apply, and only at the explicit relocation ceremony.
4. **Never touch production Supabase during consolidation.** Zero writes/DDL
   against any live project while consolidating or validating; probes are
   GET-only, keys outside the repo, masked in all output/commits.
5. **Do not break the test suite or the append-only guard.** The plan updates
   `scripts/check-migrations-append-only.sh` for the new layout, freezes the
   archive, and enumerates every migration-path test reference (OPS-018
   class) with file:line so the first post-consolidation execution commit is
   purely mechanical.

The append-only regime continues from the new baseline: the next schema change
ships as the next numbered migration beside it (0002, 0003, …). Re-consolidation
of the baseline is reconsidered only at a declared stage boundary (e.g., after
Stage A lands) via a fresh Rules 1–5 pass — never mid-flight.
```

## Block B — to be appended at the END of `AGENTS_supabase.md` §6 ("Rules that came out of this (never violate)"), as item 7

```markdown
7. **Migration consolidation is a CONCATENATION-FREE, egress-first discipline (OPS-020).**
   It is never a concatenation of the historical chain, and it is never applied
   to a live project without a 100% local from-scratch reconstruction proof
   first (the full census: tables/views/matviews/functions/triggers/RLS
   policies public+storage/grants/buckets/publication/seeds — PGlite harness
   outside the repo, results recorded in the Investigation Archive). The
   consolidated baseline must be audited for minimal future egress BEFORE
   adoption: unique indexes for `REFRESH CONCURRENTLY` on EVERY materialized
   view (the 0049 lesson — an unindexed matview silently breaks concurrent
   refresh), keyset/cursor delta-sync RPCs, transactional batch mutation RPCs,
   targeted projections, and no unused/high-churn artifacts. `0001_initial_
   consolidated_schema.sql` is the baseline of record; the archive
   (`migrations_archive/`) is frozen forensic history; the next change ships as
   `0002_*.sql` beside the baseline — never as an edit to either. See
   `Investigation Archive/MIGRATION-CONSOLIDATION-AND-EGRESS-CHARTER.md`.
```

---

## Adoption checklist (executed at G0-lift, one commit)

1. Verify Gate G0 is actually lifted (Issue #32 carries the owner's explicit green-light comment).
2. Copy Block A verbatim into `AGENTS.md` as §11.6 (end of §11).
3. Copy Block B verbatim into `AGENTS_supabase.md` as §6 item 7.
4. Commit with the message above; push; re-run the orphan check (OPS-020 must map in ROADMAP/EXECUTION-PLAN/BLUEPRINT/FINDINGS_INDEX — it already does as of v2.2).

*Staged by Session 26 (read-only on governance files — zero bytes of AGENTS.md / AGENTS_supabase.md were modified in producing this draft).*

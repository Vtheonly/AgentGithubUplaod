# DRAFT — Supersession ADR for ADR-002 (to be adopted verbatim in LF-0 / ROADMAP 7.0)

> **Drafting note (Session 5, 2026-11-19).** This is the archive staging copy ordered by `Handoffs/handoff-session-05.md` Lane B2. It is NOT applied to `docs/decisions/` — an execution session adopting it must (a) assign the next free ADR number (currently ADR-015+), (b) set the real adoption date, (c) move this text verbatim into `docs/decisions/ADR-0XX-....md` with `Status: Supersedes ADR-002 (accepted 2026-08-29); accepted <date>`, and (d) append a pointer line to ADR-002's Status section ("Superseded by ADR-0XX — see ..."). Gate: this draft is valid ONLY if owner decisions D-2/D-4 (LOCAL-FIRST-BLUEPRINT §11 / OWNER-DECISION-PACKET) left the local-first go unchanged — under the standing Session-5+ defaults they did.

---

# ADR-0XX — The canonical financial engine is the local Postgres RPC set in the desktop's main process; the desktop TS engine remains the reference mirror

## Status

Supersedes ADR-002 (the canonical financial engine is the server-side SQL RPC set) — the *authority and invariants are preserved; the location is inverted*. Drafted 2026-11-19 (Session 5 archive staging); adoption scheduled with ROADMAP 7.0 (LF-0).

## Context

ADR-002 made the server-side SQL RPCs the canonical financial writers because only the server could then enforce atomicity, audit triggers, and one-writer discipline across desktop, Android, and website clients. The local-first graduation (BLUEPRINT v1.2 §13; LOCAL-FIRST-BLUEPRINT §3/§5) moves the primary database into the desktop's Electron main process as PGlite — a real Postgres — while the hosted Supabase project is quota-restricted (OPS-011, three consecutive session re-tests) and is planned to retire from the write path. The decisive evaluation criterion in the local-first decision matrix was precisely "ADR-002 handling": where does the SQL-authoritative business logic live (LOCAL-FIRST-BLUEPRINT §3, weighted 4.4 vs 2.0/1.7/2.3 for the alternatives).

## Problem

"Server-authoritative" conflates two properties that must now be stated separately:
1. **Atomicity/one-writer/audit invariants** — enforced by executing canonical SQL RPC bodies inside a real Postgres transaction;
2. **A specific hosted provider being the location of that Postgres** — an operational fact that must not be load-bearing, because the hosted project's free-tier egress caps make it unavailable to the end users this desktop targets (Windows, non-technical).

## Decision

1. **The canonical financial writers remain the SAME SQL RPC bodies** — `collect_and_allocate_payment`, `revert_payment_allocation`, `mark_payment_cleared`, `mark_payment_bounced`, and the rest of the 56-RPC census (SUPABASE-COUPLING-MAP §1) — **executed in the local Postgres (PGlite) inside the Electron main process transaction**. The bodies are replayed verbatim from the existing migration chain (ARCH-035 gate: no extension blocker; prologue = two extension skip-guards + the auth-schema GUC shim per LF0-PREP-CENSUS-2026-11-19 Part B).
2. **The desktop TypeScript engine remains the executable reference specification** for read-side computation exactly as ADR-002 §2 established. Nothing moves; the money-parity suites (ADR-002's verification discipline) keep passing against the local engine because both sides are byte-identical (BLUEPRINT §13 money-parity gate: any failure means the port changed behavior — INV-2 standing gate).
3. **The hosted Supabase project is no longer the write location.** Client write paths route through the DataBackendPort (5 ports, LF-0) to the local engine; the hosted project's remaining role is the optional relay (blueprint §6-7) and, during the one-time migration window, the export source (ROADMAP Phase 7 interlocks).
4. **Android and website remain mirrors** with unchanged equivalence obligations where they exist; their write access is owner-gated (D-2) and, if granted, would be served by the relay's RPC-shaped surface (ADR-005 disposition, blueprint §10).
5. **RLS is re-homed, not dropped:** the 324 policies replay into the local engine and remain the same authorization logic; the GUC shim satisfies the 69 executable `auth.uid()` references and the `service_role` branch points (LF0-PREP Part B.3). "Never weaken RLS" (AGENTS §15.4) carries over unchanged — the policies are the SAME text.

## Alternatives

- **Promote the TS engine to sole authority** (scored 2.0 in the decision matrix) — rejected: it forfeits in-transaction atomicity for the 0087-class allocations, must re-fix the SQL gaps in TS, and breaks the 21 `fn_*` academic state machines that have no TS mirrors (coupling map §5 row 6, the single biggest migration risk).
- **Port PL/pgSQL to triggers in a TS-orchestrated engine** (2.3-adjacent) — rejected: re-implementation risk on the exact code paths ADR-002 exists to protect.
- **Keep hosted Supabase as writer with a proxy cache** (1.7) — rejected: recreates the quota/lock-in failure this program exists to remove (INV-9).

## Consequences

- Consequence-text updates inherit from ADR-002 with "the server" → "the local database service (main-process Postgres)"; every other consequence stands.
- Client-side "shadow" write paths remain defects by definition — now including any desktop code path that writes financial tables without routing through the port (the repository's fail-closed contract, ARCH-005/006, already enforces this).
- The `upsert_*_from_import` RPCs remain import/sync-only helpers, never substitutes.
- New consequence: **the replay context must be recorded per queued op** (claims snapshot: `sub`, `role`, `email`) so the GUC shim reconstructs identical authorization state at replay (LF0-PREP Part B.3-5).
- New consequence: **offline sequencing of receipt numbers is governed by the ADR-004 supersession**, not here — the two drafts are mutually consistent by construction.

## Affected Components

Main-process PGlite engine (new, LF-1+); the full migration chain replayed in-place; `supabase-client.ts` hard-lock removal + the 16 bypass files routed (ROADMAP 7.0, C-7 scope); repository ports (5 interfaces); the 56-RPC set executed locally; parity/equivalence suites unchanged.

## Related Problems

ARCH-023 (hard-lock), ARCH-025 (untouched tables), ARCH-031 (session shape), ARCH-035 (extension gate), BUG-038 (adapter clock — unaffected by this ADR), OPS-011 (quota restriction — the operational trigger).

## Related Tasks

ROADMAP 7.0 (LF-0) — adoption; 7.1 (LF-1) — the engine + GUC shim; 7.2/7.3 — data migration + cut-over. Supersedes the "server" language of ADR-002's verification section: the equivalence suites compare the SAME SQL against the SAME TS mirrors over the shared scenario corpus, now with the SQL executed locally.

## Verification

1. The existing financial parity suites pass against the local engine unchanged (money-parity gate, BLUEPRINT §13).
2. Chain-replay prologue completes on PGlite with the two skip-guards + GUC shim (ARCH-035/LF0-PREP Part B).
3. A concurrent-collections integration test (N clients against one local engine) produces N consecutive unique receipts and no double-allocation — the ADR-002 atomicity guarantee re-proven locally.

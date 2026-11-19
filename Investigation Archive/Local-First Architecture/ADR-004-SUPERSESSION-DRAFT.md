# DRAFT — Supersession ADR for ADR-004 (to be adopted verbatim in LF-0/LF-4 / ROADMAP 7.0)

> **Drafting note (Session 5, 2026-11-19).** Archive staging copy ordered by `Handoffs/handoff-session-05.md` Lane B2; NOT applied to `docs/decisions/`. Adoption procedure: assign next free ADR number, set the real date, move verbatim, pointer-line ADR-004. Mutually consistent with the ADR-002 supersession draft (same staging folder). Gates: D-1 (sync topology) gates the relay-sequencing clause only — the local-sequential core is valid under every topology option; D-2 gates the Android clause. Standing Session-5+ defaults assumed where unanswered.

---

# ADR-0XX — Receipt numbers are locally-authoritative and sequential; cross-installation order is a relay-sequencing concern, not a client-minting concern

## Status

Supersedes ADR-004 (receipt numbers are server-authoritative and sequential) — the *sequence, auditability, and no-client-minting principles are preserved; the authority moves from the hosted server to the local Postgres, with relay-sequenced blocks for multi-installation correctness*. Drafted 2026-11-19 (Session 5 archive staging); adoption scheduled with ROADMAP 7.0 (LF-0) core clause and 7.4 (LF-4) relay clause.

## Context

ADR-004 centralized receipt-number minting inside the server-side `collect_and_allocate_payment` (`MAX(6-digit suffix)+1` per tenant+year, zero-padded `REC-YYYY-NNNNNN`, migration 0040/0058) because five colliding client algorithms once coexisted (DRIFT-011). Local-first moves the canonical writer (the same RPC body) into the desktop's local Postgres (ADR-002 supersession), which breaks the single physical assumption underneath "server-authoritative": when more than one installation can collect payments, more than one Postgres mints receipts. The hosted project is quota-restricted and retiring from the write path (OPS-011), so "ask the server" is no longer a valid minting path for the primary (desktop) experience.

## Problem

Preserve the ADR-004 guarantees — per-tenant-year sequential, human-auditable, collision-free — on a **multi-writer topology where the writers are per-installation Postgres instances**, without (a) re-introducing client-side invented numbers, (b) creating an online-only hard dependency for the primary local experience (the app must work fully offline), or (c) metered per-number coordination costs (INV-9).

## Decision

1. **The ONLY receipt-number generator remains the canonical RPC algorithm** (`MAX(suffix)+1`, `REC-YYYY-NNNNNN`, zero-padded) — now executed by the **local** `collect_and_allocate_payment` body. No client (desktop UI, import path, Android, website) ever mints a receipt number; the ADR-004 removal of the four client-side generation paths stands permanently.
2. **`receipt_sequences` counter table (tenant+year)** lives in the local DB as the fast path — allocation = the RPC's `MAX+1` read verified against the counter inside the same transaction (same guarantee, same body, local instance).
3. **Single-installation mode (the default; D-1 default topology):** the local sequence IS authoritative. Sequentiality and uniqueness hold within the installation — which is the entire write surface. This is strictly the ADR-004 guarantee with the server relocated.
4. **Multi-installation mode (relay present, D-1 opted-in):** installations obtain **sequence blocks** from the relay (contiguous, gap-tolerant, e.g. 100 numbers per request); a collection mints `block-offset + local-increment` and records the block in `receipt_sequences`. Cross-installation auditability is preserved by the relay's total op order (the ordered op-log, blueprint §7); the auditor can still reconstruct the full sequence because every number's block provenance is stored.
5. **Offline collections mint normally** from the local counter; if a relay-conflict is later detected (both installations minted overlapping ranges), the replay layer assigns the final public number at replay time and the UI displays a **provisional local reference** until then — the exact mechanism ADR-004's own consequence §2 already designed for offline Android ("the server-assigned number after sync"), generalized to the desktop.
6. **The `receipts` table becomes locally written** (it was the pointed RPC/EF/trigger-only omission, C-1): extraction/migration must snapshot it (LF0-PREP Part A.4) and the migration's one-time export carries the existing sequence watermark so the local counter starts exactly where the hosted history ends (no gap, no reuse).

## Alternatives

- **UUID receipts** — rejected again (ADR-004 §Alternatives): loses the auditable sequence.
- **Per-device static ranges without a relay** — rejected: silent collisions at range exhaustion; block-based relay allocation supersedes it with recorded provenance.
- **Keep server-minting for desktop (hybrid)** — rejected: online-only financial writes recreate the availability failure (the app must collect payments with zero connectivity) and preserve the OPS-011 dependency on the primary path.
- **Timestamp-based numbers** — rejected: non-sequential, unauditable (DRIFT-011 recurrence).

## Consequences

- ADR-004's consequence §1 ("all four client-side generation paths removed") is inherited and extended: **no fifth path may appear** in the local UI/import layers.
- ADR-004's consequence §2 (provisional reference → final number at sync) becomes the GENERAL desktop behavior for relay-conflict replay, instead of an Android-only note.
- Uniqueness across installations is sequencing-dependent (blueprint §10 "honestly lost" row) — strictly weaker than single-DB uniqueness, accepted consciously for INV-1/INV-2, mitigated by block provenance records.
- The 0058 hardening (caller-verification for receipt allocation) replays locally; its `auth.uid()` guard is satisfied by the GUC shim (LF0-PREP Part B.3-1).
- Migration: the hosted sequence watermark (per tenant+year) is captured during the one-time cap-lifted export and seeded into `receipt_sequences` before the first local collection (ROADMAP Phase 7 interlock; zero data loss requirement).

## Affected Components

Local `collect_and_allocate_payment` body (unchanged SQL, local instance); `receipt_sequences` (new local table); relay block-allocation endpoint (LF-4, D-1-gated); desktop provisional-reference UI path; sync/replay layer (final-number assignment); one-time migration export (watermark seed).

## Related Problems

DRIFT-011, CROSS-101, ARCH-029 (restore must preserve the sequence watermark), C-1/ARCH-025 (`receipts` writer visibility), OPS-011.

## Related Tasks

ROADMAP 7.0 (LF-0) — decision clause 1-2 + 6 (watermark seed); 7.4 (LF-4) — clauses 4-5; P-2/P-3 (pipeline) — restore-contract interaction: a restored archive MUST restore the watermark too (registered as an explicit R-row requirement).

## Verification

1. Single-installation: N concurrent collections produce N consecutive, unique, zero-padded `REC-YYYY-NNNNNN` numbers (the ADR-004 integration test, now against the local engine).
2. Multi-installation (relay): two installations collecting concurrently from distinct blocks produce disjoint numbers; the concatenated sequence over the relay's op order is gap-tolerant and reconstructable from block provenance.
3. Migration: the first local receipt after migration continues the hosted sequence exactly (no reuse, no gap) — verified against the exported watermark.
4. Grep finds no client-side receipt-number formatting outside the canonical local RPC path (the ADR-004 grep discipline, re-pointed).

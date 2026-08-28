# ADR-001 — The desktop repository owns the single canonical migration chain

## Status

Accepted (2026-08-29)

## Context

The system shares one Supabase project across three repositories, but each repo grew its own `supabase/` folder: the desktop chain (0001–0043, complete), the website's four portal patches numbered 0025–0028 (colliding with canonical 0025–0028; their content was absorbed into desktop 0043), and the Android repo's six stale copies of 0034–0036/0040–0042 (missing `SET search_path` hardening, unusable without the base schema).

## Problem

Supabase tracks migrations by filename across the project. Colliding numbers mean one chain silently shadows the other (e.g. website `0025_device_tokens` vs desktop `0025_waterfall_allocation`); partial copies mislead operators into provisioning broken databases (`CROSS-001`, `CROSS-003`).

## Decision

`elimtiyaz-desktop/supabase/migrations/` in this repository is the **single canonical migration chain**. All schema changes land here as new migrations with the next free number. Client repositories must not carry independent migration files; where a client repo needs to document backend dependencies, it references this chain rather than copying it.

## Alternatives

- A fourth, backend-only repository for migrations — rejected: adds a repo to a 3-repo system the owner did not ask to restructure; the desktop repo already owns the Edge Functions too.
- Keeping per-repo folders "in sync" by hand — rejected: already proven to drift within weeks.

## Consequences

- Provisioning = apply this chain only; the website/Android folders become non-authoritative and should be removed or reduced to pointer notes (task T-048).
- Every agent must check this chain (not a client copy) before reasoning about schema.

## Affected Components

All three repositories' `supabase/` folders; all provisioning/CI flows.

## Related Problems

CROSS-001, CROSS-003 (incl. absorbed CROSS-007, CROSS-010, ACAD-104)

## Related Tasks

T-048

## Verification

A fresh Supabase project provisioned from this chain alone passes the financial equivalence suites (`financial-tests/equivalence/`) and contains the tables/RPCs the website and Android code actually call.

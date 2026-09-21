# T-398 — Live Verification (PERF-502: the ONE-round-trip registration)

**Date:** 2026-09-21 (82nd session) · **Task:** T-398 · **Problems:** PERF-502 (+ the T-397-registered pricing-read leg) · **Status:** COMPLETE — VERIFIED

**Owner report (verbatim):** "is there no way to make it faster????" — after T-397 a 1-student registration still took ~11 sequential round-trips (live 3,189 ms from the sandbox; the owner's Algeria→eu-west-1 route at 476–952 ms/RTT projects ~5–10 s).

## What changed

1. **Migration 0102** — `register_family_batch(p_tenant_id, p_parent, p_students, p_ledger_entries, p_installments)`: ONE SECURITY DEFINER transaction that CALLS the canonical idempotent upserts internally (`upsert_parent_from_import` + `upsert_student_from_import` — zero identity-logic reimplementation), resolves the client's 0-based `student_ref` indexes to the server uuids, derives `account_id` server-side (the exact `deriveAccountId` string format), writes the billing legs `ON CONFLICT DO NOTHING` (the IMPORT-107/IMPORT-110 wire semantics), and RETURNS the full parent + student rows (zero follow-up fetches). Grants narrowed to `authenticated` + `service_role` with an EXPLICIT `anon` revoke (dry-run-proven: the platform's default privileges hand anon EXECUTE at creation — a PUBLIC revoke alone is not enough).
2. **Migration 0103** (the same-session fix-up, the REG-001 0031-style pattern) — the **source_id identity continuity**: the client cannot know the server uuids before the single call, so the billing source_ids carry the deterministic CODES; the RPC substitutes the code tokens with the uuids the upserts just resolved (including an EXISTING student's uuid when the name fallback converged on an old-path row). The stored identities are byte-identical to the old client-orchestrated path (`reg-<studentUuid>-t<n>`, `reg-<parentUuid>-fee`, `<studentUuid>:<category>:T<n>`) — cross-path re-registrations CONVERGE, never duplicate. Plus the blank student_code guard.
3. **The client rewire** — `SupabaseStudentRepository.batchRegister` builds ALL rows locally (the SAME `createChargeEntry` factory + the SAME installment shapes — the canonical TS calc engine stays the ONLY derivation of money amounts) and issues ONE `register_family_batch` call through `rpcWithIdempotentRetry`. **ATOMIC failure semantics** (the registered upgrade of the DATA-019 scope decision): any leg failing rolls back EVERYTHING; the error carries "RIEN n'a été écrit" + the actual reason in BOTH `message` and `userMessage`. The wizard passes its already-loaded pricing config through the new optional `BatchRegistrationInput.pricingConfig` (kills the 5-6 sequential pricing reads AND guarantees preview == persisted); the DB read stays as the backward-compatible fallback. §15.37 blank-string `classId` guard at the seam.

## The measured evidence

### The latency (the owner's actual question)

| Path | Round-trips | Live wall clock (sandbox) | Owner's route projection |
|---|---|---|---|
| Original (pre-T-397) | 21+ sequential | 6,984 ms | 10–20 s (the report) |
| T-397 (bulk legs) | ~11 | 3,189 ms | ~5–10 s |
| **T-398 (this task)** | **1** | **368 ms** (`t-398-registration-live-e2e.ts` Run 1) | **≈ 0.6–1.2 s** |

The re-run (idempotency probe): 313 ms, converges on the same parent + student, ZERO duplicate ledger/installment rows.

### verify_t-398.sql — 12/12 on BOTH live projects (chain 100/100 each)

- **C1/C2** function shape (SECURITY DEFINER, `search_path=public`, 5 args/4 OUT) + grants (authenticated + service_role EXECUTE; PUBLIC/anon none).
- **C3** happy path: 4 ledger + 3 installments written, the FULL parent + student rows returned.
- **C4** `account_id` = `parent:<uuid>:category:tuition:student:<uuid>` (the deriveAccountId format, byte-exact).
- **C5/C6** the 0103 substitution: stored source_ids are the OLD path's uuid forms; the literal code forms are absent.
- **C7** end-to-end idempotency: the SAME payload re-run writes 0 new rows, no duplicates.
- **C8** ATOMICITY: a poisoned billing row (CHECK-violating entry_type) raises and rolls back the WHOLE registration — the parent/student rows the upserts created inside the same call are GONE (orphan_parent=0).
- **C9** the out-of-range student_ref guard: clean loud rejection ("student_ref 99 hors limites (0..0)").
- **C10** the 0037 activation-code write survives the composite call.
- **C11** entry_date + at filled on every charge row.
- **C12** CROSS-PATH CONVERGENCE (the 0103 substitution's purpose): a re-registration whose student CODE differs (the old-path client shape) but whose name is the same converges on the EXISTING student via the upsert's name fallback AND the substituted source_ids — 0 duplicate charges, 0 duplicate tranches, 1 student, uuid-form identities.

### The REAL `batchRegister` end-to-end (`scripts/t-398-registration-live-e2e.ts`) — 17/17 PASS

The REAL repository code (not a wire replica) against production, signed in as the documented admin: Ok in **368 ms**; the parent + student domain models returned (mapParentRow/mapStudentRow + the gradeLevel patches); 4 ledger + 3 installments persisted; `source_id = reg-<uuid>-t1` (the 0103 substitution END-TO-END through the real client); `account_id` in the deriveAccountId format; Σ ledger tranches = Σ installments (305,000 = 305,000 — the ledger and the schedule agree); the idempotent re-run converges with zero duplicates; zero residue after the canonical soft-delete cleanup.

### The T-396 CRUD suite re-run — 27/27 ALL GREEN

The whole backend write surface (insert/update/delete/fetch/bulk/relations/validation/server errors/consistency) still passes after the migrations + the rewire — the suite's own legs (the direct upsert RPCs, the bulk upserts, the soft-delete RPCs) are untouched by T-398 and keep working.

## Gates

- tsc: 6 errors = the pre-existing concurrent-agent fixture baseline (zero new — verified per-file).
- t-397 (updated to the new contract): **8/8** — exactly 1 RPC + 0 reads + 0 upserts when the config is passed; the billing content INSIDE the payload (student_ref + code source_ids); the returned-row mapping; the atomic Err; the batch retry ×1 (network-class) / no retry (hard).
- t-398 (NEW): **4/4** — the pricingConfig fallback (reads happen, still 1 RPC); the multi-student + transport payload; the §15.37 blank-classId guard.
- FULL vitest: **3549 passed / 21 failed / 5 skipped** — +7 passing vs the 81st-session baseline (3542/21/5), the failing set IDENTICAL (the concurrent agent's fixture drift — untouched).
- Append-only guard: 100 migration files, +2 new (0102, 0103), 0 edited; t-058 6/6.

## Residuals / notes

- The chain is now 0001–**0103** on BOTH projects (next free **0104**). The 79th session's "next free 0102" note for T-337 is superseded.
- The mock repository's `batchRegister` is untouched (it was already fully atomic via its snapshot rollback — the Supabase path now matches its semantics; `billingWarning` stays in the contract for the mock path).
- The parent-list cache note: the singleton parent repository's list refreshes exactly as before (the wizard's `onSubmitted` opens the drawer by the returned id) — behavior-preserving, unchanged by T-398.
- The `enrollmentDate` input to `evaluateAllSystemDiscounts` is now `at` (NOW) instead of the fetched row's `enrollment_date` (which the RPC defaults to `current_date` — the same "today" the old path read back after its fetch round-trip).

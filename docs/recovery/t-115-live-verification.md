# T-115 — Live Verification Record (migration 0065: canonical identity codes)

> **Task:** T-115 (19th repair session, 2026-09-02) · **Problem:** ARCH-013 (new) · **Closes the backend half of:** DRIFT-001 / T-018
> **Live project:** hkvkefubghbbotgnteir (eu-west-1) · **Method:** Management API SQL endpoint with the owner's access token (MIG-TOKENS pattern)

## 1. How 0065 was discovered

The 19th session opened with the mandated live-chain diff (AGENTS.md §15 rule 11). The local
chain after the 18th session close: **61 files = 0001–0064** (numbers 0015–0017 never existed —
known gap). The live `supabase_migrations.schema_migrations` returned **62 rows**: the local 61
**plus `0065` (name `canonical_identity_codes`, statements
`['0065_canonical_identity_codes.sql']`)**. The row appeared AFTER the 18th-session close
(2026-09-01 ~04:31 UTC, last commit) and no `0065_*` file, no task entry, and no problem entry
existed anywhere in the three repositories — the migration was applied live by an actor outside
the committed repos (its function bodies self-cite "T-115", an ID that was never registered).
This is the **second occurrence of the ARCH-011 class** (0053/0054 were the first) and is
registered as **ARCH-013**.

## 2. Scope of what 0065 changed (extracted from the live catalog)

| Object | Change |
|---|---|
| `fn_fnv1a(text)` | NEW — FNV-1a 32-bit hash in plpgsql, bit-exact with the JS `Math.imul` / Kotlin Int canonical implementations (signed-XOR normalization + mod 2^32 multiply) |
| `fn_stable_hash(text)` | NEW — upper 6 hex chars of `fn_fnv1a` (mirrors `stableHash()` on both clients) |
| `fn_deterministic_parent_code(year, phone, display_name, first_name, last_name, fallback_seed)` | NEW — `PAR-{year}-{hash(identity)}`; identity = trimmed non-empty fields joined `'|'`; empty identity → stable seed, never random |
| `fn_deterministic_activation_code(parent_code, tenant_id)` | NEW — 6 digits `[100000, 999999]` from `fn_fnv1a('{tenant}|{parent_code}')` |
| `batch_register_family` | REWRITTEN — deterministic parent code (was `gen_random_bytes(3)` in 0022); empty identity REJECTED; default activation code deterministic with a collision fallback to `generate_activation_code`; audit entries tagged `deterministic_fnv1a_0065` |
| `generate_activation_code` | UNCHANGED (byte-identical to 0005's version) |
| Grants/ACL | unchanged (default PUBLIC EXECUTE, same as the chain's posture) |

**Impact analysis:** `batch_register_family` has **no runtime callers** in any client (typed in
desktop `types.ts` + website `database.ts`, never invoked — verified by repo-wide search), so
the rewrite changes no current client flow. The 4 new functions are pure additions.

## 3. Reconstruction (file == live)

`elimtiyaz-desktop/supabase/migrations/0065_canonical_identity_codes.sql` was written from the
live definitions (`pg_get_functiondef`). One-time verification: the file was applied inside
`BEGIN; … ROLLBACK;` on the live DB with pre/post definition comparison —

```
FILE==LIVE definitions: ok=true, pre=5 post=5 matches=5 mismatched=''   (5/5 byte-identical)
```

## 4. Live verification (verify_t-115.sql — BEGIN/ROLLBACK, re-runnable)

Run 2026-09-02 via the Management API SQL endpoint. **19/19 checks TRUE**:

- **C1 presence (3/3):** the 5 functions present · registration row
  `version=0065, name=canonical_identity_codes, statements=['0065_canonical_identity_codes.sql']` ·
  unique `(tenant_id, parent_code)` constraint `parents_tenant_id_parent_code_key` exists.
- **C2 deterministic generator vectors (10/10):** the SQL functions reproduce EXACTLY the
  values computed by the desktop canonical TS engine (`src/core/format/id.ts`, executed via
  Node 24 type stripping): `fn_stable_hash('0554288142|MAMER')='60E2BA'`, `''`→`811C9D`,
  `'orphan-parent'`→`C13D99`; parent codes `PAR-2026-60E2BA` (basic), trim/drop-empty variant
  identical, fallback-seed `PAR-2026-CB27E1`, orphan default `PAR-2026-C13D99`, 4-field
  `PAR-2025-D93B0A`; activation codes `553830` (tenant) / `905025` (null tenant).
- **C3 batch_register_family contract (6/6):** empty identity REJECTED ("parent identity fields
  required") · registration A creates the parent with the deterministic code
  (`created=PAR-2026-C1BC71 expected=PAR-2026-C1BC71`) · explicit activation code honored
  (`T115FIX`) · DUPLICATE registration of the same identity REFUSED via unique constraint
  (`unique_violation: parents_tenant_id_parent_code_key` — the idempotency gate) · registration
  B's DEFAULT activation code is the deterministic value (`issued=668214 expected=668214`) ·
  both audit entries carry `code_rule='deterministic_fnv1a_0065'` (count=2).

All C3 mutations were inside the ROLLBACK wrapper — post-run leak checks: 0 test parents, 259
parents total (unchanged), 0 tagged audit rows persisted.

## 5. Discoveries (persisted so the next agent does not rediscover them)

1. **The Management API SQL endpoint silently DROPS `COMMENT ON` statements.** `CREATE TABLE` +
   `INSERT` in the same payload persist; `COMMENT ON … IS '…'` (alone, inside `BEGIN;…COMMIT;`,
   or in a multi-statement payload) returns success but never lands — `obj_description()` stays
   NULL. Consequently the committed 0065's comments exist only in the FILE (a fresh CLI
   deployment applies them); the live catalog carries NULL comments. Same cosmetic-divergence
   class as the documented 0049/0050 live-label quirk. Recorded in AGENTS.md §11.1.
2. **`batch_register_family` REQUIRES `date_of_birth` in every student JSON object**
   (`students.date_of_birth` is NOT NULL and the RPC does not default it) — callers must always
   supply it (a first call without it fails with 23502). Pinned in the desktop regression suite.
3. **`pg_get_functiondef` output is the only reliable reconstruction source** — the raw chain
   files render `$$` bodies and multi-line attributes differently, so byte comparisons must use
   `pg_get_functiondef` on BOTH sides (pre/post) — that is what the one-time check does.
4. The 0065 actor cited a task ID ("T-115") that was never registered — this session registered
   T-115 properly and wrote this document. Process rule reinforced: an unregistered task ID in
   live SQL is drift bait for the next agent.

## 6. Cross-platform consistency after 0065 (the owner's mandate)

- **Desktop TS** (`src/core/format/id.ts`): the canonical generators are pinned to the live SQL
  vectors by `src/tests/infrastructure/t-115-sql-identity-equivalence.test.ts` (8/8) — any drift
  on either side now fails the desktop suite.
- **Android Kotlin** (`core/IdentityCodes.kt`): the same FNV-1a semantics (verified by the
  pinned-vector equivalence of the TS leg + the 12th-session T-018 port; the corpus-level
  Android equivalence runs under T-105's triple comparator).
- **Mock layer** (desktop): `MockParentRepository.createParent` switched from
  `randomParentSuffix()` (which mirrored 0022's now-DEAD random server path) to the canonical
  `deterministicParentCode` + duplicate-identity refusal (the server's unique-constraint
  mirror) — `src/tests/infrastructure/t-018-mock-canonical-create.test.ts` (4/4). The dead
  `randomParentSuffix` copies were deleted (id.ts + supabase-shared-repositories.ts).
- **Typed RPC registrations:** desktop `types.ts` + website `database.ts` gained the 4 new
  function signatures (per AGENTS.md §7 cross-client schema rule).

## 7. Application record

`scripts/apply_0065_live.sh` (MIG-TOKENS pattern: `BEGIN; <file> + registration ON CONFLICT DO
NOTHING; COMMIT;`) was executed 2026-09-02: the pre-existing registration row is preserved
(name/statements verified), the CREATE OR REPLACE statements are idempotent no-ops on the
already-applied state, and verify_t-115.sql re-ran **19/19 TRUE** after the apply. No data was
touched (0065 is DDL-only; the 259 production parent codes are import-path products and are
untouched by design).

## 8. Suites at this task's close (desktop repo)

- `npx vitest run src/tests/infrastructure/t-115-sql-identity-equivalence.test.ts` — **8/8**.
- `npx vitest run src/tests/infrastructure/t-018-mock-canonical-create.test.ts` — **4/4**.
- Full desktop suite: **75 files / 2235 tests ALL PASS** (+12 vs the 18th-session baseline
  2223). `tsc --noEmit` clean; `eslint` 0 errors / 384 warnings (baseline 385 — one warning
  left with the deleted dead code).

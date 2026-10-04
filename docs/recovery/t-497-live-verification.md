# T-497 — The LIVE Verification of the Composite (sort_key, id) Keyset (SYNC-304 / migration 0143, the 148th session, 2026-10-05)

**The mandate:** the owner's standing "make sure it works" token set + the 148th session's fix. The four `pull_*_for_sync` RPCs — the Android app's private sync streams — paginated on NON-UNIQUE cursors; this session's opening live pins (read-only, the Management-API SQL endpoint) found three concrete failure modes live-capable on the owner's actual data, and migration 0143 + the Android `SyncKeyset` drain close them.

**The runner:** `elimtiyaz-desktop/scripts/t497-live-verification.py` (the t495 conventions — the app's OWN REST paths, the signed-in admin's JWT, honest PASS/FAIL, read-only by construction: only SELECT-shaped STABLE RPCs and the auth token grant; zero writes, zero residue).

**THE VERDICT: 27 PASS / 0 FAIL** (`docs/recovery/t-497-live-verification-evidence.txt`).

## The migration (applied live atomically, the T-091 pattern)

`0143_composite_keyset_sync_rpcs.sql` — rehearsed first (`scripts/t497-apply-0143.py`: the exact payload wrapped in BEGIN…ROLLBACK against the live catalog, CLEAN, pre-state == post-state), then applied atomically (`scripts/apply_0143_live.sh`: BEGIN + the file + COMMIT — the file carries its own `schema_migrations` registration). The post-apply pins:

- All four RPCs on the 4-arg signature `(p_tenant_id, p_since, p_after_id, p_limit)` — the old 3-arg overloads DROPPED (§15.32), exactly one overload each.
- The pinned ACL shape re-granted per function: `{=X/postgres, postgres=X/postgres, anon=X/postgres, authenticated=X/postgres, service_role=X/postgres}` — byte-identical to the pre-migration pin.
- `ledger_entries.updated_at` exists: `NOT NULL DEFAULT now()` + the `ledger_entries_touch_updated_at` BEFORE UPDATE trigger (the exact payments/parents/students pattern — the table NEVER had the column; that is WHY 0037 keyed the RPC on the business date).
- The 3 342 ledger rows backfill to the migration instant — ONE uniform tie group, exactly as designed (the composite keyset pages through it by id; 3 342 < the installed APK's 5 000-row page, so the old client cannot stick on it either).
- Registered: `0143 / composite_keyset_sync_rpcs` (the chain now 0001–0143 applied live; the stray live-0118 row + the 0102/0109/0110 registration-shape quirks are the documented pre-existing state, T-470's census).

## V1 — the full-population composite drains (16/16)

Every RPC drained page-by-page on the `(p_since, p_after_id)` composite — the Android `drainByCursor`'s exact loop — against the live census:

| Stream | Page | Drained | Live | Verdict |
|---|---|---|---|---|
| `pull_parents_for_sync` | 1 000 | 741 | 741 | PASS |
| `pull_students_for_sync` | 1 000 (2 pages) | 1 137 | 1 137 | PASS |
| `pull_payments_for_sync` | 5 000 | 2 198 | 2 198 | PASS |
| `pull_ledger_entries_for_sync` | 5 000 | 3 342 | 3 342 | PASS |

Per stream: drained == the live table count · all ids distinct · `(updated_at, id)` strictly monotonic across the whole drain · every row carries a non-null `updated_at` (the ledger's first time ever — the column did not exist before 0143).

## V2 — THE STRADDLE PROOF (the live students tie pair, 2/2)

The live students table holds 4 tie pairs (8 rows sharing `updated_at` values) — the exact raw material of the pre-0143 silent skip. On a real pair (a, b) at instant T:

- **The composite leg reaches b**: `p_since=T, p_after_id=a.id, p_limit=5` → b present (5 rows, all ≥ the boundary). **Under the pre-0143 function this call was IMPOSSIBLE — there was no way to express "the rows after a within the tie".**
- **The 3-arg call cannot see it**: `p_since=T, p_limit=5` (the installed APK's shape) returns only strictly-newer rows — neither a nor b. This is the preserved exclusive semantics — the exact silent skip the composite leg closes, pinned as the live contrast.

## V3 — THE UNIFORM-GROUP PROOF (the payments' frozen 2 198-row backfill, 2/2)

The live payments table's 2 198 rows ALL share one frozen bulk-backfill timestamp — the exact raw material of the pre-0143 stuck cliff (a uniform group ≥ the page could never advance):

- **The composite pages INSIDE the uniform group**: `p_after_id = the 1000th id` (in `(updated_at, id)` order), `p_limit=5` → exactly the 5 rows after it, ids byte-matching the SQL truth.
- **The 3-arg inclusive call re-fetches from the group's start** — the preserved old semantics (the re-fetch/stuck behavior the composite leg removes).

## V4 — THE LEDGER CURSOR PROOF (3/3)

- The RPC returns `updated_at` non-null on every row (pre-0143: the column was never returned — the Android cursor was NULL on every row, the silent single-page truncation past 5 000).
- The whole first page shares the backfill instant `2026-10-04T20:41:13` — the designed uniform group.
- The composite pages inside it by id: 5 rows after the first id, all at the backfill instant, exact continuation.

## V5 — THE INSTALLED-APK COMPATIBILITY (4/4)

Every RPC answers the 3-arg named call shape (`p_tenant_id, p_since, p_limit` — the T-495 APK's exact call) with HTTP 200 and correct rows: parents 741 · students 1 000 (the gateway slice, as designed) · payments 2 198 · ledger 3 342. **The owner's installed APK keeps working against the migrated backend, unchanged.**

## The Android half (the same session, the android repo)

`PullSyncRepository` — the drain generalized to `<T, C>` (the table paths keep their plain id cursor); the NEW `SyncKeyset(since, afterId)` composite cursor on all four RPC paths (`p_after_id` passed from the second page on); the NULL-cursor stop now LOGS (it was silent — the ledger truncation's invisibility). `PullKeysetT497Test` 5/5 (the straddle drain, the uniform-group drain, the call-shape contract, the NULL-cursor honest stop, the four-path wiring source-scan) + `PullPaginationT493Test` 9/9 + `PullPaginationT495Test` 6/6 + the full `./gradlew test` gate (the session's closeout carries the counts).

## What remains (honest)

1. **The live-device eyeball**: the owner's next APK install (this session's build) exercising a real sync cycle — the on-device census (Room == 741/1 137/2 198/3 342 after a pull) remains the one-line owner check.
2. **The desktop battery was NOT re-run this session** — zero TS sources changed (the migration is server-SQL + android-only paths, source-scanned in SYNC-303); the hub-side verification is the chain check + this live run. The next desktop-touching session re-runs it.
3. **The `p_since` round-trip precision**: the composite leg's `updated_at = p_since` equality relies on the timestamptz ISO round-trip (microsecond precision, pinned by V1's monotonicity check — exact). A future client that RE-FORMATS timestamps before re-sending them would break the equality leg; the Android client passes the server's string verbatim (pinned by the call-shape source scan).

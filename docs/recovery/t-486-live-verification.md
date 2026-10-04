# T-486 — The Owner-Sanctioned FAKE-Probe Data Hygiene (Live-Applied + Verified 15/15)

**Date:** 2026-10-04 · **Branch:** `chore/t486-fake-probe-archive` · **Task registry:** docs/recovery/task-registry.md (T-486)

## 1. The mandate

The T-485 eyeball pass closed the 139th audit's checklist with ONE owner-gated item left on its honest list (§5.3 of `t-485-eyeball-pass-verification.md`): the live `personnel` table's FAKE-prefixed probe rows — the rows the Relevé staff picker and the Annuaire listed because they ARE live rows. The owner's 142nd-session "do it for me" (delivered with the full infrastructure token set) executed that recommendation.

## 2. The pre-apply census (the row source pinned BEFORE any write)

The Management-API SQL census (2026-10-04, `scripts/t486-census.sh` output recorded in this session) found **17 probe rows, nothing else**:

| Class | Count | State |
|---|---|---|
| The t-400-era "FAKE {name}" teaching staff (`fake.t1`..`fake.t8@elimtiyaz-test.dz`) | **8** | `is_active=true`, `deleted_at=null`, `user_id=null` (all unbound — zero account impact) |
| The T-485 pass's own Eye probes (SUP/W2/WH) | 3 | already archived (the pass's zero-residue cleanup) |
| The T-400 workers | 5 | already archived |
| The T-412 payroll probe | 1 | already archived |

**The discovery that reframes the outcome:** the live tenant's ENTIRE active personnel set was the 8 FAKE rows — there are no real staff rows in this live database (a pre-production system). Archiving the probes therefore leaves the personnel surfaces at their **honest empty state** — which is exactly the T-477/T-479/T-484 discipline: no fabricated rows pretending to be real staff.

## 3. The method (the app's own write path, zero bypass)

Per-row archive through the app's OWN `deletePersonnel` write shape — an RLS-checked PostgREST PATCH signed in as the owner-pinned admin (OPS-310: the credential was used for sign-in only, never modified, never rotated):

```
PATCH /rest/v1/personnel?id=eq.<uuid>&tenant_id=eq.<tenant>
{ "deleted_at": now(), "is_active": false, "updated_at": now() }
```

The t-369 soft-delete convention — **never a hard DELETE**: releve_entries, class homeroom references and audit history survive (plan §09). The runner (`elimtiyaz-desktop/scripts/t486-fake-probe-archive.py`, committed as evidence) asserts the §15.30b discipline at every step: the pre-census pins the exact 8 ids (the run REFUSES if the live state moved), each PATCH is followed by a re-read asserting the archive stamp, and the post-census re-derives the app-visible list.

## 4. The verification (15/15 GREEN)

```
  GREEN  admin sign-in (OPS-310 owner-pinned)
  GREEN  pre-census: the app-visible list resolves — http=200 n=8
  GREEN  pre-census: exactly the 8 known FAKE ids are active+visible
  GREEN  pre-census: all 8 targets unbound (user_id null — no account impact)
  GREEN  archive FAKE Ahmed FAKE-Benali (1aeb1a80) — patch=204 re-read: is_active=False deleted_at=2026-10-04T01:54:00+00:00
  … (all 8 identical: patch=204, the re-read GREEN) …
  GREEN  post-census: zero FAKE rows in the app-visible list (the Relevé picker / Annuaire source)
  GREEN  post-census: the real staff count is exactly pre-8 — visible 8 -> 0
  GREEN  post-census: all 8 targets now carry the archive stamp — archived_fake_rows=9 (the 8 new + the T-412 probe already archived)
== T-486 ARCHIVE SUMMARY: 15/15 GREEN, 0 RED ==
```

The app-visible list (`deleted_at IS NULL` — the exact filter `SupabasePersonnelRepository.refresh()` applies, the source of the Relevé staff picker and the Annuaire) went from 8 FAKE rows to **0 rows**. The 9 already-archived probes were untouched (the honest record).

## 5. The audit posture (documented honestly)

Personnel UPDATEs write no `audit_logs` rows: there is no DB trigger on `personnel` (the 0014 triggers make `audit_logs` itself append-only; its writers are the RPCs and the app's `SupabaseAuditLogRepository`), and the repository's own `deletePersonnel` — which has NO UI surface today — writes no audit row either. The archive therefore produced the byte-identical data-and-audit state the app's own repository method would produce. The honest record of THIS operation lives here: the census (§2), the committed runner, the assertions (§4), and the git history.

## 6. Left open (the honest list)

1. The live tenant now has ZERO personnel rows — every personnel surface (the Relevé picker, the Annuaire, the drawer, the task assignee pickers) shows its honest empty state until the owner creates real staff (the Annuaire's "Ajouter" flow or the onboarding wizard). This is the correct pre-production posture: empty and honest, not fake and populated.
2. The already-archived probe rows (3 Eye + 5 T400 + 1 T-412) remain as the honest archive record — visible nowhere in the app (the `deleted_at IS NULL` filter), kept for referential history.
3. REALTIME-105's registered residual (the replay-on-remount stale toast) — unchanged, the standing queue owns it.

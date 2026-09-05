# ADR-013 — Overdue alerts are lifecycle-managed: active-dedup + resolution on the tracked set

- **Status:** Accepted (2026-09-05, 27th session)
- **Deciders:** Agent session (owner mandate: fix the "1,000 notifications" complaint; the lifecycle half needed no product input — the inverse half, alert VOLUME, is explicitly NOT decided here and stays open as UNKNOWN-020)
- **Resolves:** the lifecycle half of NOTIF-200 (alerts never resolved; dedup counted dismissed rows)
- **Task:** T-172 (EF + desktop generator + Android pull filter)

## Context

The overdue scan (`run-overdue-scan` daily cron + the desktop dashboard's
"Scan retards" button via `SupabaseOverdueAlertGenerator`) created one
`kind=alert` notification per overdue installment, deduplicated permanently
by `(link_entity_type='installment', link_entity_id)`. Nothing ever resolved
an alert when its installment was paid — the feed only grew. Live evidence
at the 27th session open: **958 rows, all unread, 0 dismissed**, created on
two scan days, all `target_role=financial_officer`. Worse, the dedup fetch
counted DISMISSED rows: had anyone manually dismissed an alert, a later
payment-revert could never re-alert it.

The `notifications` table (migration 0013) already has the columns needed
(`dismissed_at`, hidden from every read path by `WHERE dismissed_at IS NULL`
in the desktop repository); the problem was purely a missing lifecycle in
the two generators (EF ≡ desktop reference equivalence is mandatory).

## Decision

1. **The dedup key counts ACTIVE alerts only** (`dismissed_at IS NULL`).
   A dismissed/resolved alert frees its `(link_entity_type, link_entity_id)`
   key: if the installment becomes overdue again (e.g. a payment is
   reverted, restoring the balance), a fresh alert is created. Idempotency
   of repeated scans is preserved (active key → skip).
2. **Alerts resolve when the condition resolves.** Every scan computes the
   *tracked set* = installments that are overdue-with-balance (INV-4
   threshold > 0.001 DZD, status ≠ paid/cancelled) ∪ upcoming-with-balance
   (≤ 7 days). Any ACTIVE installment alert whose `link_entity_id` is NOT
   in the tracked set is **resolved**: `dismissed_at = now` (chunked bulk
   UPDATE). Resolution uses the SAME column as user dismissal — both mean
   "hidden from every feed" (0013 semantics); the append-only row and its
   audit history are preserved, no hard delete.
3. **The EF (service_role) is the authoritative resolver; the desktop
   generator mirrors it best-effort.** `notifications_update` RLS allows
   `super_admin` but blocks `financial_officer` on role-broadcast rows
   (NOTIF-100) — the daily cron therefore guarantees resolution within a
   day regardless of who clicks "Scan retards". A client-side resolution
   failure logs a warning and never fails the scan.
4. **Android pulls active rows only**: `pullNotifications` filters
   `dismissed_at IS NULL` as a top-level AND (parity with the desktop
   repository's read path).

## Consequences

- The feed reflects CURRENT overdue reality: an alert exists while its
  installment is overdue-with-balance, disappears when it is not, and can
  reappear. Live proof (2026-09-05): 958 → 691 active, 267 resolved,
  `active_without_live_overdue = 0`.
- User dismissal of an overdue alert is now TEMPORARY by design: the next
  scan re-creates it while the installment stays overdue. This is the
  honest trade-off of freeing the dedup key; if the school wants "dismiss
  means permanently ignore this installment", that is a NEW product
  decision (would need a per-installment mute flag — not built).
- NOT decided here: the VOLUME shape (691 truthful alerts for a
  691-overdue corpus — digest vs per-installment). That is UNKNOWN-020 /
  T-173 and requires its own ADR if changed, shipped to BOTH generators.
- Known residual (registered in T-173): Android Room has no `dismissedAt`
  column — rows resolved server-side linger locally until role eviction;
  fixing it needs a Room migration.

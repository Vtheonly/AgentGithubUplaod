# T-172 — Live Verification (run-overdue-scan alert lifecycle)

> 2026-09-05, 27th session. Deployed the T-172 `run-overdue-scan` rewrite
> (active-only dedup + stale-alert resolution) and verified it against the
> LIVE project `hkvkefubghbbotgnteir`. Complements
> `docs/recovery/t-095-live-verification.md` (the previous EF verification)
> and follows the curl-matrix convention of T-004.

## 1. Deployment

- CLI: `/home/z/my-project/bin/supabase` v2.116.0 (re-downloaded this session — the container had reset).
- `supabase link --project-ref hkvkefubghbbotgnteir` — OK (owner sbp_ token).
- `supabase functions deploy run-overdue-scan --project-ref hkvkefubghbbotgnteir --no-verify-jwt` —
  **Deployed Functions on project hkvkefubghbbotgnteir: run-overdue-scan**
  (assets: index.ts + `_shared/supabase.ts`, `_shared/cors.ts`, `_shared/cron-auth.ts`).

## 2. Auth matrix (SEC-105 contract preserved after the T-172 rewrite)

| Probe | Token | Result |
|---|---|---|
| NO Authorization header | — | **401** |
| Invalid Bearer | `invalid-token-123` | **401** |
| Legacy anon key (JWT) | `eyJ…anon…` | **401** |
| New API secret key | `sb_secret_…` (ADR-009 format) | **200** |

> ADR-009 note (operational, already documented in
> `docs/operations/credentials.md` by T-126, re-confirmed this session):
> the LEGACY service_role JWT (`eyJ…service_role…`) does NOT authenticate
> the cron EFs — the EF env secret `SUPABASE_SERVICE_ROLE_KEY` carries the
> new `sb_secret_…` value. Future live EF invocations must use the
> sb_secret value (or CRON_SECRET).

## 3. Live execution (cron-style, service-role authority)

```bash
curl -s -X POST "$BASE/functions/v1/run-overdue-scan" \
  -H "Authorization: Bearer sb_secret_…" -d '{}'
```

Response:

```json
{"data":{"tenants_scanned":1,"total_overdue_installments":691,
 "total_overdue_amount":58355700,"alerts_created":0,"alerts_resolved":267,
 "by_priority":{"urgent":691,"high":0,"medium":0},
 "upcoming_due_alerts":0,"audit_failures":0,"as_of":"2026-09-05"}}
```

Interpretation:
- `alerts_created: 0` — every still-overdue installment already carried an
  active alert (idempotent dedup held).
- **`alerts_resolved: 267`** — the new lifecycle step found 267 active
  alerts whose installment had left the tracked set (paid / no remaining
  balance) and resolved them (dismissed_at set) in one chunked pass.
- `audit_failures: 0` — the per-tenant audit row (now carrying
  `alerts_resolved`) was written.

## 4. DB state before / after (Management API SQL)

| Metric | Before | After |
|---|---|---|
| notifications active (dismissed_at IS NULL) | 958 | **691** |
| notifications dismissed | 0 | **267** |
| unread active | 958 | 691 |
| active alerts with NO live overdue installment | (n/a — pre-fix) | **0** |

The last row is the truthfulness invariant (cross-join check):

```sql
SELECT count(*) FROM notifications n
WHERE n.dismissed_at IS NULL
  AND n.link_entity_type = 'installment'
  AND NOT EXISTS (
    SELECT 1 FROM installments i
    WHERE i.id = n.link_entity_id::uuid
      AND i.status NOT IN ('paid','cancelled')
      AND i.due_date < '2026-09-06'
      AND (i.amount_due - i.amount_paid) > 0.001
  );
-- 0  → every active alert maps to a REAL overdue installment with a balance.
```

## 5. Idempotency

The 958→691 delta matches `alerts_resolved=267` exactly, and
`active_without_live_overdue = 0` means a re-run resolves nothing more
(`alerts_resolved: 0` on subsequent invocations) and creates nothing
(dedup). The desktop `SupabaseOverdueAlertGenerator` mirror was verified
in-suite (13/13) — it applies the same two lifecycle rules through the
caller's session (best-effort per NOTIF-100; the daily cron is
authoritative).

## 6. Cross-platform consumers

- Desktop: `SupabaseNotificationRepository.refresh()` already filters
  `.is("dismissed_at", null)` — resolved alerts disappear from the bell
  and alerts tab with the next cache refresh (TTL + focus-refresh).
- Android: `pullNotifications` now filters `dismissed_at IS NULL`
  (T-172, source-scanned) — resolved rows stop entering Room. Known gap
  (T-173): rows already cached locally linger until role eviction (Room
  lacks a dismissedAt column).
- Website: untouched — the portal queries parent-targeted notifications
  only; financial_officer-targeted alerts are invisible to parents by RLS
  and by the query's `or(...)` filter.

## 7. What remains

- 691 active unread alerts remain — one per genuinely overdue installment
  (the business reality of the corpus). The VOLUME design decision
  (digest vs per-installment) is deferred to T-173 / UNKNOWN-020.
- NOTIF-100 (role-broadcast mark-read RLS) and NOTIF-104 (Android
  local/server read-state desync) remain the pre-existing blockers,
  unchanged by this task.

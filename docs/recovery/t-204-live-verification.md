# T-204 — Live full-stack consistency verification round (31st session)

- **Date:** 2026-09-06, 31st repair session
- **Task:** T-204 (the owner's "apply the migration tokens; ensure everything works correctly across all platforms and the migration is properly applied and remains consistent everywhere" mandate — EVIDENCE round, run AFTER the 30th session's applies and mid-way through the 31st session's UI work)
- **Verifier:** live Supabase project `hkvkefubghbbotgnteir` (eu-west-1), fresh `sbp_` access token re-supplied this session
- **Script:** `/home/z/my-project/scripts/t-204-live-verification.sh` (persisted OUTSIDE the repos — it carries keys, per the T-140 convention)
- **Mode:** probes only — no mutations of any kind

## Result: ALL GREEN

| # | Check | Result |
|---|---|---|
| 1 | Migration chain live vs local (76 files, sorted string-diff) | **MATCH — 76/76 = 0001–0079, zero drift** (latest: 0079_drop_orphaned_receipts) |
| 2 | `auth/v1/health` with the LEGACY anon JWT | **200** |
| 3 | `auth/v1/health` with the NEW `sb_publishable_…` key | **200** (ADR-009 dual acceptance holds) |
| 4 | REST `/rest/v1/tenants` with legacy anon key | **200** (routing + PostgREST processing) |
| 5 | REST `/rest/v1/tenants` with publishable key | **200** |
| 6 | EF fleet — every function's live status | **13/13 ACTIVE** (list below); the hub's `supabase/functions/` source has exactly the same 13 function directories (excluding `_shared`) — **source ⇄ live deployment 1:1** |
| 7 | ALLOWED_ORIGINS preflight echoes (the canonical 4-origin set from credentials.md §2.2) | `http://localhost:5173` → echoed · `http://localhost:3000` → echoed · `http://localhost:3100` → echoed · `https://elimtiyaz-website.vercel.app` → echoed — **ACT-203's deployed state intact** |
| 8 | Non-allowlisted origin (`https://evil-example.com`) | **NOT echoed** (ACAO falls back to the first allowlisted origin — the allowlist ENFORCES) |
| 9 | `bind-activation-code` anonymous POST (no Authorization header) | **401** (the security posture holds) |

## EF fleet detail (live API, 2026-09-06)

| Function | Status | verify_jwt |
|---|---|---|
| ai-proxy | ACTIVE | true |
| approve-signup-request | ACTIVE | false (verifies the caller itself) |
| bind-activation-code | ACTIVE | false (serves PENDING users — T-147 discovery 2) |
| collect-payment | ACTIVE | true |
| create-user-account | ACTIVE | false (service-role + super_admin gate) |
| expire-pending-approvals | ACTIVE | false (CRON_SECRET gated) |
| purge-expired-backups | ACTIVE | false (CRON_SECRET gated) |
| refresh-materialized-views | ACTIVE | false (CRON_SECRET gated) |
| refund-payment | ACTIVE | true |
| run-overdue-scan | ACTIVE | false (CRON_SECRET gated) |
| send-push-notification | ACTIVE | false (Bearer compare in-EF) |
| update-server-secret | ACTIVE | true |
| workflow-execute | ACTIVE | true |

## Discoveries (persisted so the next agent does not rediscover them)

1. **The "EF fleet 14/14 ACTIVE" figure in the 24th/30th-session notes is STALE.** The live
   Functions API returns **13** functions (the 13 above, all ACTIVE), and the hub source
   carries exactly 13 function directories. The 14th was almost certainly the website's
   drifted `send-push-notification` copy or the pre-T-146 `bind-activation-code` website
   copy counted alongside the hub's before their removal (T-126/T-146) — the live fleet
   and the hub source agree 1:1 today. Future session notes should say **13/13**.
2. **The Management API functions list returns `status: "ACTIVE"` (uppercase).** A
   `select(.status=="active")` jq filter counts ZERO — case matters; grep the list or
   lowercase before comparing.
3. The publishable key continues to work as `apikey` on BOTH auth and REST endpoints
   (the 17th-session ADR-009 dual-acceptance regime, re-proved post-0079).

## Gaps / follow-ups

- None from this round. The standing owner-gated residuals remain (FIREBASE_SERVICE_ACCOUNT_JSON for real FCM sends; RESEND_API_KEY for workflow emails; the website web-push Firebase env vars) — unchanged from the 30th-session close.

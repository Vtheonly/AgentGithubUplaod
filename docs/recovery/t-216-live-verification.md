# T-216 — MIG-TOKENS full consistency re-verification round (32nd session close)

**Date:** 2026-09-07 (32nd repair session close) · **Task:** T-216
**Verifier:** live Supabase project `hkvkefubghbbotgnteir` (eu-west-1), the
fresh `sbp_` access token supplied by the owner this session
**Script:** `/home/z/my-project/scripts/t-216-live-verification.sh`
(persisted OUTSIDE the repos — it carries keys, per the T-140/T-204
convention)
**Mode:** probes only — no mutations of any kind

## Result: ALL GREEN (10/10 probe families)

| # | Check | Result |
|---|---|---|
| 1 | Migration chain live vs local | **77/77 = 0001–0080, ZERO DRIFT** (0080 = this session's INFO-300 tightening, applied atomically with registration by T-214) |
| 2 | Policy census (T-215's new script, chain vs live) | **chain=189 live=189, live_only=0 chain_only=0** — zero policy drift |
| 3 | `auth/v1/health` with the LEGACY anon JWT | **200** |
| 4 | `auth/v1/health` with the NEW `sb_publishable_…` key | **200** (ADR-009 dual acceptance holds) |
| 5 | REST `/rest/v1/tenants` with anon key / publishable key | **200 / 200** |
| 6 | EF fleet live status + 1:1 with the hub source dirs | **13/13 ACTIVE, 1:1 = True** (ai-proxy, approve-signup-request, bind-activation-code, collect-payment, create-user-account, expire-pending-approvals, purge-expired-backups, refresh-materialized-views, refund-payment, run-overdue-scan, send-push-notification, update-server-secret, workflow-execute) |
| 7 | ALLOWED_ORIGINS preflight (canonical 4-origin set, credentials.md §2.2) | `http://localhost:5173` → echoed · `http://localhost:3000` → echoed · `http://localhost:3100` → echoed · `https://elimtiyaz-website.vercel.app` → echoed (probed individually after the script's initial probe used a wrong variant `elimtiyaz.vercel.app` — noted below) |
| 8 | Non-allowlisted origin (`https://evil-example.com`) | **NOT echoed** (ACAO falls back to the first allowlisted origin — the allowlist ENFORCES; ACT-203 intact) |
| 9 | `bind-activation-code` anonymous POST (no Authorization) | **401** (the security posture holds) |
| 10 | Migration 0080 live (INFO-300) | **live policy count n=1 with `has_role` in the qual** — the parent-own-student scoping is deployed |

## Discoveries / notes (persisted so the next agent does not rediscover them)

1. **Probe-origin typo class:** the script's first run probed
   `https://elimtiyaz.vercel.app` (wrong — the canonical production origin
   is `https://elimtiyaz-website.vercel.app`, credentials.md §2.2). The
   wrong variant correctly did NOT echo (indistinguishable from the evil
   origin). Lesson: when a preflight does not echo, FIRST re-check the
   canonical origin string before suspecting the allowlist regressed.
2. The 31st-session figure **13/13 ACTIVE** is re-proved (the older
   "14/14" note remains stale — see the T-204 discovery).
3. The dual-key regime (legacy anon JWT + new publishable key) remains
   healthy on BOTH the auth and REST endpoints (ADR-009).

## Gaps / follow-ups

- None from this round. The standing owner-gated residuals remain
  (FIREBASE_SERVICE_ACCOUNT_JSON for real FCM sends; RESEND_API_KEY for
  workflow emails; the website web-push Firebase env vars) — unchanged
  from the 31st-session close.

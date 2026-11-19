# Infrastructure Status — per-run standing record

**Session 5 probe run:** 2026-11-19T01:39Z (sandbox, GET-only protocol per S4-CROSS-VERIFICATION §3.2)
**Probe script:** 10-probe set mirroring Session 2/3/4 methodology; tokens used in-memory only, masked in all output, never written to any file.

## Verdict at a glance

| Asset | Status this run | Registered ID | Change vs Session 4 (01:20Z same day) |
|---|---|---|---|
| GitHub repo + PAT | **WORKING** — API 200, `push=True`, default branch `main` | — | none |
| Supabase REST (secret key, root + table) | **RESTRICTED** — HTTP 402 `exceed_egress_quota` | OPS-011 | none (persists) |
| Supabase REST (publishable key) | HTTP 401 `Secret API key required` (key-type gate before quota gate) | OPS-011 | none (same body as S4) |
| Supabase Auth JWKS | **RESTRICTED** — HTTP 402 `exceed_egress_quota` | OPS-011 | none |
| Supabase Auth health (publishable AND secret key) | **RESTRICTED** — HTTP 402 `exceed_egress_quota` | OPS-011 | none |
| Supabase management API (access token) | **INVALID** — HTTP 401 `Invalid access token` | OPS-013 | none (persists) |
| Firebase GCIP endpoint (web API key) | HTTP 400 `CONFIGURATION_NOT_FOUND` — key format-accepted, config not exposed | OPS-013 | none (same as S4 first test) |
| Pooler TCP `aws-1-eu-west-1.pooler.supabase.com:6543 / :5432` | **OPEN** both ports | OPS-011 addendum | none |
| Vercel PAT | not re-tested this run (S4 verdict: INVALID; no website-scope work in this session) | OPS-013 | carries forward |
| Direct Postgres | never provided (owner sheet has `[YOUR-PASSWORD]` placeholder); no login attempted, per charter | — | — |

## Live-mode implication (unchanged, now 3-session-stable)

- The project has been quota-restricted on every probe run since Session 2 (2026-11-19 ~00:0xZ), through Session 3, Session 4 (01:20Z), and this run (01:39Z). **Live mode remains broken for the app** and the live-DB census (SESSION_LOG open question 1) remains blocked.
- The one-time spend-cap lift remains the single owner action that unblocks (a) the live census and (b) the final full export required by the local-first migration (LOCAL-FIRST-BLUEPRINT §8; ROADMAP Phase 7 interlocks).
- The network path (pooler) is open, so a cap lift would take effect without infra changes; untested-only dimension is Postgres auth, which requires the owner password.

## Probe detail (masked)

```
P1  GET /rest/v1/ (publishable)     → 401 {"message":"Secret API key required",...}
P2  GET /rest/v1/ (secret)          → 402 exceed_egress_quota
P3  GET /rest/v1/students?limit=1 (secret) → 402 exceed_egress_quota
P4  GET /auth/v1/.well-known/jwks.json → 402 exceed_egress_quota
P5  GET /auth/v1/health (publishable)  → 402 exceed_egress_quota
P5b GET /auth/v1/health (secret)       → 402 exceed_egress_quota
P6  GET /rest/v1/?apikey= (publishable)→ 401 Secret API key required
P7  GET api.supabase.com/v1/projects/… (mgmt token) → 401 Invalid access token
P8  GET identitytoolkit.googleapis.com/v1/projects?name=projects/elimtiyaz-android (FB key) → 400 CONFIGURATION_NOT_FOUND
P9  TCP pooler :6543 OPEN, :5432 OPEN
P10 GET api.github.com/repos/Vtheonly/AgentGithubUplaod (PAT) → 200, permissions.push=true
```

## Cumulative credential scorecard (OPS-013, unchanged)

| Credential | S4 verdict | S5 re-test |
|---|---|---|
| Supabase publishable key | recognized; project restricted | re-confirmed (P1/P5) |
| Supabase secret key | recognized; project restricted | re-confirmed (P2/P3/P5b) |
| Supabase management token | invalid 401 | re-confirmed invalid (P7) |
| GitHub PAT | working, full push | re-confirmed working (P10) |
| Vercel PAT | invalid | not re-tested (out of session scope) |
| Firebase web API key | format-valid, functionally unverified | unchanged (P8 non-mutating probe only) |

**Standing note:** credential values are never stored in this archive; this file intentionally contains only masked references. OPS-012 (rotate all committed credentials) remains an open owner action.

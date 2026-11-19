# Infrastructure Status — per-run standing record

**Session 6 probe run:** 2026-11-19 (sandbox, GET-only protocol per S4-CROSS-VERIFICATION §3.2; keys used in-memory only, masked in all output, never written to any file).
**Session 6 special context:** the owner supplied a NEW credential set this session (publishable key, secret key, management access token, Firebase key, GitHub PAT) with the instruction to "make sure it works". Result recorded below — the new keys are RECOGNIZED (they clear the key-type/auth gates) but the project remains plan-restricted; the restriction is at the Supabase plan/spend-cap layer, not the credential layer.
**Probe script:** 10-probe set mirroring the Session 2/3/4/5 methodology.

## Verdict at a glance

| Asset | Status this run (S6) | Registered ID | Change vs Session 5 |
|---|---|---|---|
| GitHub repo + PAT | **WORKING** — API 200, push confirmed (session branch pushed) | — | none |
| Supabase REST (secret key, root + table) | **RESTRICTED** — HTTP 402 `exceed_egress_quota` | OPS-011 | none (persists; now **5-run-stable**) |
| Supabase REST (publishable key) | HTTP 401 `Secret API key required` (key-type gate before quota gate — the NEW publishable key is format-recognized) | OPS-011 | none (same body as S5) |
| Supabase Auth JWKS | **RESTRICTED** — HTTP 402 `exceed_egress_quota` | OPS-011 | none |
| Supabase Auth health (publishable AND secret key) | **RESTRICTED** — HTTP 402 `exceed_egress_quota` | OPS-011 | none |
| Supabase management API (**NEW** access token provided S6) | **INVALID** — HTTP 401 `Invalid access token` | OPS-013 | none (the new token replaces the old invalid one; it ALSO tests invalid — expired/revoked/mistyped at the Supabase side) |
| Firebase GCIP endpoint (web API key) | HTTP 400 `CONFIGURATION_NOT_FOUND` — key format-accepted, config not exposed | OPS-013 | none |
| Pooler TCP `aws-1-eu-west-1.pooler.supabase.com:6543 / :5432` | **OPEN** both ports | OPS-011 addendum | none |
| Vercel PAT | not re-tested this run (S4 verdict: INVALID; no website-scope work in this session) | OPS-013 | carries forward |
| Direct Postgres | password still a `[YOUR-PASSWORD]` placeholder in the owner sheet; no login attempted, per charter | — | — |

## Live-mode implication (unchanged, now 5-run-stable)

- The project has been quota-restricted on every probe run since Session 2 (2026-11-19), through Sessions 3, 4, 5, and this run (S6). **Live mode remains broken for the app** and the live-DB census (SESSION_LOG open question 1) remains blocked.
- **The newly provided keys do NOT change this verdict** — the 402 `exceed_egress_quota` body is returned after successful key recognition, which means the blocker is the plan's spend cap, not the credentials. No credential rotation can unblock it; the owner must lift the spend cap (or upgrade the plan) in the Supabase dashboard. This is exactly the failure mode the local-first migration exists to escape (OPS-011 → LOCAL-FIRST-BLUEPRINT INV-2/INV-5).
- The one-time spend-cap lift remains the single owner action that unblocks (a) the live census and (b) the final full export required by the local-first migration (LOCAL-FIRST-BLUEPRINT §8; ROADMAP Phase 7 interlocks; EXECUTION-PLAN §1 gate G2 + §4 stage E7.9).
- The network path (pooler) is open, so a cap lift would take effect without infra changes; untested-only dimension is Postgres auth, which requires the owner password.

## Probe detail (masked)

```
P1  GET /rest/v1/ (publishable)     → 401 {"message":"Secret API key required",...}
P2  GET /rest/v1/ (secret)          → 402 exceed_egress_quota
P3  GET /rest/v1/students?limit=1 (secret) → 402 exceed_egress_quota
P4  GET /auth/v1/.well-known/jwks.json → 402 exceed_egress_quota
P5  GET /auth/v1/health (publishable)  → 402 exceed_egress_quota
P5b GET /auth/v1/health (secret)       → 402 exceed_egress_quota
P6  (superseded by P1 with the new publishable key — same 401 key-type gate)
P7  GET api.supabase.com/v1/projects/… (NEW mgmt token) → 401 Invalid access token
P8  GET identitytoolkit.googleapis.com/v1/projects?name=projects/elimtiyaz-android (FB key) → 400 CONFIGURATION_NOT_FOUND
P9  TCP pooler :6543 OPEN, :5432 OPEN
P10 GET api.github.com/repos/Vtheonly/AgentGithubUplaod (PAT) → 200 + push verified by this session's branch push
```

## Cumulative credential scorecard (OPS-013, updated S6)

| Credential | S5 verdict | S6 re-test (new key set where provided) |
|---|---|---|
| Supabase publishable key | recognized; project restricted | NEW key recognized (401 key-type gate on root); project still restricted |
| Supabase secret key | recognized; project restricted | NEW key recognized; project still restricted (402 quota) |
| Supabase management token | invalid 401 | NEW token **also invalid** (401) — owner action: issue a fresh non-expired token if the census ceremony is wanted |
| GitHub PAT | working, full push | re-confirmed working (200 + this session's push) |
| Vercel PAT | invalid | not re-tested (out of session scope) |
| Firebase web API key | format-valid, functionally unverified | unchanged (P8 non-mutating probe only) |

**Standing note:** credential values are never stored in this archive; this file intentionally contains only masked references. OPS-012 (rotate all committed credentials) remains an open owner action. **Diagnostic for the owner:** if the intent of the S6 credential set was to restore live mode, the missing piece is the spend-cap lift in the Supabase dashboard (Project Settings → spend cap / plan) — not new keys.

---

## Session 8 probe run (2026-11-19) — the Excel-import live-lane gate

**Context:** the owner's S8 mandate ("test it heavly on the excel import on the db") made the live Supabase import path the preferred heavy-test target. Probe set re-run (GET-only, keys in-memory only, masked):

```
P1  GET /rest/v1/ (publishable)              → 401 {"message":"Secret API key required"} (key-type gate — key recognized)
P2  GET /rest/v1/ (secret)                  → 402 exceed_egress_quota
P3  GET /rest/v1/students?select=id&limit=1 → 402 exceed_egress_quota
P4  GET /auth/v1/health (secret)             → 402 exceed_egress_quota
```

**Verdict:** OPS-011 is now **6-run-stable** (S2→S8). The live-DB import-flush lane stays owner-gated on the spend cap — exactly as in Sessions 2-6, the blocker is the plan layer, not the credentials (P1's key-type gate proves the publishable key is recognized; P2's quota body proves the secret key is recognized).

**What was done instead (the full substitute for the live lane):** the heavy testing ran through the engine's REAL DB write path (`ImportEngine` + `RepositoryStorageAdapter` + the real domain calc modules) against instrumented in-memory stub repositories (the repo's own t-105 test convention — the same method that produced the T-420 live-verified forensics). Result: 197 tests green across two layers (150 repo regression tests + the 47-test S8 adversarial harness, incl. the independent per-student balance oracle 1137/1137 + 390/390 and the 940/197 indebted census). The only untested dimension is the wire itself — see `Deep Sweep/04-DEEP-EXCEL-IMPORT-ENGINE-AUDIT-2026-11-19.md` §8 for the one-time unblock ceremony (cap lift → re-run harness Group A against the Supabase repositories; expect 5,963 installments per the §7.4 note).

---

## Session 9 probe run (2026-11-19) — Lane-B census session

**Context:** routine 6-hourly sweep (S9); the S8 handoff's gate check + the Lane-B UnifiedModal consumer census. GET-only probe set re-run (keys in-memory only, masked):

```
P1  GET /rest/v1/ (publishable)              → 401 {"message":"Secret API key required"} (key-type gate — key recognized)
P2  GET /rest/v1/ (secret)                   → 402 exceed_egress_quota
P3  GET /rest/v1/students?select=id&limit=1  → 402 exceed_egress_quota
P4  GET /auth/v1/.well-known/jwks.json       → 402 exceed_egress_quota
P5  GET /auth/v1/health (secret)             → 402 exceed_egress_quota
P7  GET api.supabase.com/v1/projects/… (mgmt token) → 401 Invalid access token
P10 GET api.github.com/repos/Vtheonly/AgentGithubUplaod (PAT) → 200 (+ this session's push verifies write path)
```

**Verdict:** OPS-011 is now **7-run-stable** (S2→S9): REST root/table, JWKS, and auth-health all return the identical `exceed_egress_quota` 402; the management token stays 401-invalid. The spend cap is still in place — the live-DB lane (the S8 §8 one-time re-verification ceremony; the E7.9 final export) remains owner-gated exactly as before. The blocker is the plan layer, not the credentials (P1's key-type gate + P2's quota body prove both keys are recognized). No re-verification ceremony was due this run.

**Session 9 note:** the Deep Sweep Lane-B census (05-DEEP-UNIFIEDMODAL-CONSUMER-CENSUS) was completed instead — static analysis only, no live interaction needed.

---

## Session 10 probe run (2026-11-19) — runtime-lane session (OPS-011 8-run-stable)

**Context:** routine 6-hourly sweep (S10); the never-run runtime lane executed (mock-mode dev server UI inspection — Deep Sweep/06). GET-only probe set re-run at session start (keys in-memory only, masked):

```
P1  GET /rest/v1/ (publishable)              → 401 {"message":"Secret API key required"} (key-type gate — key recognized)
P2  GET /rest/v1/ (secret)                   → 402 exceed_egress_quota
P3  GET /rest/v1/students?select=id&limit=1  → 402 exceed_egress_quota
P4  GET /auth/v1/.well-known/jwks.json       → 402 exceed_egress_quota
P5  GET /auth/v1/health (secret)             → 402 exceed_egress_quota
P7  GET api.supabase.com/v1/projects/… (mgmt token) → 401 Invalid access token
P10 GET api.github.com/repos/Vtheonly/AgentGithubUplaod (PAT) → 200 (+ this session's push verifies write path)
```

**Verdict:** OPS-011 is now **8-run-stable** (S2→S10): REST root/table, JWKS, and auth-health all return the identical `exceed_egress_quota` 402; the management token stays 401-invalid. The spend cap is still in place — the live-DB lane (Deep Sweep/04 §8 ceremony; the E7.9 final export) remains owner-gated. Blocker = plan layer, not credentials (P1 key-type gate + P2 quota body prove both keys recognized).

**NEW this run — the runtime lane made the restriction CONCRETE:** inside the app itself, the renderer's live-wire callers all 402 too, and the Configuration tab's error-refetch loop (BUG-042, Deep Sweep/06 §3) amplified that into **7,148 doomed requests from two tab visits** (plus ~12 pre-login warm-up queries at the login screen). The deployed desktop build (production flags force the same canonical URL/key) would behave identically for end users. **The cap lift is now urgent for two independent reasons: the one-time census/export ceremonies AND the deployed app's own stability under BUG-042** (the T-559/T-560 fix removes the amplification but the 402 state itself only the owner can lift).

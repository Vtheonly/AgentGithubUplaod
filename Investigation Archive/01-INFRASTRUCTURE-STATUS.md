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

---

## Session 11 probe run (2026-11-19) — the 20-point checklist session (OPS-011 9-run-stable)

**Context:** the owner's NEW sweep mandate (the 20-point Bug/UX/Architecture checklist appended to Issue #32, with a fresh credential set and the instruction "make sure it works"). GET-only probe set re-run at session start (keys in-memory only, masked; script outside the repo at `/home/z/my-project/scripts/s11_infra_probe.sh`):

```
P1  GET /rest/v1/ (publishable)              → 401 {"message":"Secret API key required"} (key-type gate — key recognized)
P2  GET /rest/v1/ (secret)                   → 402 exceed_egress_quota
P3  GET /rest/v1/students?select=id&limit=1  → 402 exceed_egress_quota
P4  GET /auth/v1/.well-known/jwks.json       → 402 exceed_egress_quota
P5  GET /auth/v1/health (secret)             → 402 exceed_egress_quota
P5b GET /auth/v1/health (publishable)        → 402 exceed_egress_quota
P7  GET api.supabase.com/v1/projects/… (mgmt token) → 401 Invalid access token
P8  GET identitytoolkit.googleapis.com (FB key) → 400 CONFIGURATION_NOT_FOUND (format-accepted)
P9  TCP pooler :6543 OPEN, :5432 OPEN
P10 GET api.github.com/repos/Vtheonly/AgentGithubUplaod (PAT) → 200 (+ this session's push verifies the write path)
```

**Verdict:** OPS-011 is now **9-run-stable** (S2→S11): REST root/table, JWKS, and auth-health all return the identical `exceed_egress_quota` 402; the management token stays 401-invalid; the pooler network path is open. The blocker remains the **plan/spend-cap layer, not the credentials** (P1's key-type gate + P2's quota body prove both Supabase keys are recognized; the fresh GitHub PAT is fully working). The live-DB lane — now carrying BOTH the S8 §8 re-verification ceremony AND the S11 ×10/legacy-row reconciliation (Deep Sweep/07 §A1.5: enumerate the pre-T-424 `amount_paid > amount_due` rows, per-student workbook-vs-books oracle) — stays owner-gated exactly as before. **Diagnostic for the owner (unchanged):** the missing piece is the spend-cap lift in the Supabase dashboard (Project Settings → spend cap / plan), not new keys.

---

## Session 12 probe run (2026-11-19) — the runtime spot-verification session (OPS-011 10-run-stable)

**Context:** handoff-session-12 gate check — the GET-only probe set re-run (script outside the repo; live key values redacted from the script after the run — no token material remains in any file):

```
P1  GET /rest/v1/ (publishable)              → 401 {"message":"Secret API key required"} (key-type gate — key recognized)
P2  GET /rest/v1/ (secret)                   → 402 exceed_egress_quota
P3  GET /rest/v1/students?select=id&limit=1  → 402 exceed_egress_quota
P4  GET /auth/v1/.well-known/jwks.json       → 402 exceed_egress_quota
P5  GET /auth/v1/health (secret)             → 402 exceed_egress_quota
P5b GET /auth/v1/health (publishable)        → 402 exceed_egress_quota
P7  GET api.supabase.com/v1/projects/… (mgmt token) → 401 Invalid access token
P8  GET identitytoolkit.googleapis.com (FB key) → 400 CONFIGURATION_NOT_FOUND (format-accepted)
P10 GET api.github.com/repos/Vtheonly/AgentGithubUplaod (PAT) → 200 (+ this session's push verifies the write path)
```

**Verdict:** OPS-011 is now **10-run-stable** (S2→S12): the identical restriction signature persists; the blocker remains the plan/spend-cap layer (both Supabase keys recognized; the GitHub PAT fully working). The three owner-gated ceremonies (live census; S8 §8 re-verification; S11 §A1.5 ×10/legacy-row reconciliation) wait on the same single cap lift. **Runtime corroboration this session:** the app's own traffic under the cap is now measured end-to-end — the one-time 11-REST warm-up + the NEW perpetual ~30 s health-probe drip (BUG-058, ~240 doomed requests/hour in any mode) — making the cap lift urgent for a THIRD independent reason (deployed-app stability, beyond the ceremonies and BUG-042's amplification).

---

## Session 13 probe run (2026-11-19) — the egress/truncation/relocation session (OPS-011 11-run-stable)

**Context:** handoff-session-13 gate check — the owner re-issued the deep-audit mandate (egress/truncation/relocation) with a fresh credential set and the instruction "test if it works make sure it works". GET-only probe set re-run at session start (keyless script outside the repo at `/home/z/my-project/scripts/s13_infra_probe.sh`; keys passed via environment, never written to any file):

```
P1  GET /rest/v1/ (publishable)              → 401 {"message":"Secret API key required"} (key-type gate — key recognized)
P2  GET /rest/v1/ (secret)                   → 402 exceed_egress_quota
P3  GET /rest/v1/students?select=id&limit=1  → 402 exceed_egress_quota
P4  GET /auth/v1/.well-known/jwks.json       → 402 exceed_egress_quota
P5  GET /auth/v1/health (secret)             → 402 exceed_egress_quota
P5b GET /auth/v1/health (publishable)        → 402 exceed_egress_quota
P7  GET api.supabase.com/v1/projects/… (mgmt token) → 401 Invalid access token
P8  GET identitytoolkit (FB web key)         → 400 CONFIGURATION_NOT_FOUND (format-accepted)
P9  TCP pooler :6543 OPEN, :5432 OPEN
P10 GET api.github.com/repos/Vtheonly/AgentGithubUplaod (PAT) → 200 (+ this session's push verifies the write path)
P11 GET api.vercel.com/v2/user (Vercel PAT)  → 200  ← NEW: the Vercel PAT is VALID (S4's INVALID verdict was for the OLD token; the re-supplied token authenticates as the owner's Vercel account)
```

**Verdict:** OPS-011 is now **11-run-stable** (S2→S13): REST root/table, JWKS, and auth-health all return the identical `exceed_egress_quota` 402; the management token stays 401-invalid. The blocker remains the **plan/spend-cap layer, not the credentials** (P1's key-type gate + P2's quota body prove both Supabase keys are recognized; the GitHub PAT is fully working). The three owner-gated ceremonies stay gated exactly as before. **Credential-scorecard update (OPS-013 / SESSION_LOG open question 8):** the Vercel PAT, invalid at S4, now tests **VALID (200)** — the owner rotated it; the management token is still invalid (a fresh non-expired token is wanted only if the management-API census ceremony is desired).

**NEW this session — the cap-lift sequencing constraint (OPS-015, Deep Sweep/09 §3.1):** the S13 egress verification consolidated the app's four live-mode traffic classes (the 30 s/focus TTL re-seed volley ≈13k+ rows per cycle at current scale; the dashboard's uncached per-filter-change collection downloads ×2; BUG-042's amplification — suppressed today only because the 402 state trips the offline detector; BUG-058's drip). **Consequence: when the cap is lifted, the app will immediately re-burn the egress quota unless T-559/T-560 + the BUG-058 probe fix are executed FIRST** — the three staged ceremonies should then run in the same one-time window. The relocation runbook (Local-First Architecture/RELOCATION-RUNBOOK.md §Phase 0) lists the cap lift as a precondition of the transfer window on BOTH projects.

---

## Session 14 probe run (2026-11-20) — the school-Excel/pedagogy session (OPS-011 12-run-stable)

**Context:** handoff-session-14 gate check — the owner supplied a fresh credential set with the instruction "test if it works make sure it works". GET-only probe set re-run at session start (keyless script outside the repo at `/home/z/my-project/scripts/infra_test.sh`; keys sourced via environment from a chmod-600 env file OUTSIDE the repo — never written into any repo file; no token material appears in any committed artifact):

```
P1  GET /rest/v1/ (publishable)              → 401 {"message":"Secret API key required"} (key-type gate — key recognized)
P2  GET /rest/v1/ (secret)                   → 402 exceed_egress_quota
P3  GET /rest/v1/students?select=id&limit=1  → 402 exceed_egress_quota
P4  GET /auth/v1/.well-known/jwks.json       → 402 exceed_egress_quota
P5  GET /auth/v1/health (secret)             → 402 exceed_egress_quota
P5b GET /auth/v1/health (publishable)        → 402 exceed_egress_quota
P7  GET api.supabase.com/v1/projects/… (mgmt token) → 401 Invalid access token
P8  GET identitytoolkit (FB web key)         → 400 CONFIGURATION_NOT_FOUND (format-accepted)
P9  TCP pooler :6543 OPEN, :5432 OPEN (direct db.vebfehrpzajhstyhinnw.supabase.co:5432 — DNS does not resolve from the sandbox; the pooler is the operative path)
P10 GET api.github.com/repos/Vtheonly/AgentGithubUplaod (PAT) → 200 (+ this session's push verifies the write path)
P11 GET api.vercel.com/v2/user (Vercel PAT)  → 200 (still VALID — the S13 rotation holds)
```

**Verdict:** OPS-011 is now **12-run-stable** (S2→S14): REST root/table, JWKS, and auth-health all return the identical `exceed_egress_quota` 402; the management token stays 401-invalid. The blocker remains the **plan/spend-cap layer, not the credentials** (P1's key-type gate + P2's quota body prove both Supabase keys — including the new secret-key set — are recognized; the GitHub PAT is fully working with push verified this session; the Vercel PAT remains valid). The three owner-gated ceremonies stay gated exactly as before, and the OPS-015 cap-lift sequencing constraint stands unchanged (T-559/T-560 + the BUG-058 probe fix MUST land before any live traffic).

**Credential hygiene note (S14):** the full credential set was supplied in chat by the owner and is stored ONLY outside the repo (chmod-600 env file at `/home/z/my-project/scripts/credentials.env`, consumed via environment by the probe script and the git remote) — the token-hygiene grep over every changed file before every push ran clean. Since the tokens were pasted in plaintext chat, the standing recommendation to rotate them (OPS-012 family) is repeated in the session reply.

---

## Session 15 probe run (2026-11-20) — the pedagogy-unification session (OPS-011 13-run-stable)

**Context:** handoff-session-15 gate check — the dedicated Pedagogy Unification, Relational Linking & Legacy Deletion mandate (read-only blueprint mode). GET-only probe set re-run at session start (keyless script outside the repo; keys via environment from the chmod-600 env file OUTSIDE the repo — no token material in any committed artifact):

```
P1  GET /rest/v1/ (publishable)              → 401 (key-type gate — key recognized)
P2  GET /rest/v1/ (secret)                   → 402 exceed_egress_quota
P3  GET /rest/v1/students?select=id&limit=1  → 402 exceed_egress_quota
P4  GET /auth/v1/.well-known/jwks.json       → 402 exceed_egress_quota
P5  GET /auth/v1/health (publishable)        → 402 exceed_egress_quota
P7  GET api.supabase.com/v1/projects/… (mgmt token) → 401 Invalid access token
P8  GET identitytoolkit (FB web key)         → 400 (format-accepted; probe-credential refusal shape)
P9  TCP pooler :6543 OPEN, :5432 OPEN (direct db host DNS does not resolve from the sandbox — the pooler is the operative path)
P10 GET api.github.com/user + /repos/… (PAT) → 200s incl. Issue #32 + comments (0 comments — no owner activity; gates unchanged)
P11 GET api.vercel.com/v2/user (Vercel PAT)  → 200 (still VALID)
```

**Verdict:** OPS-011 is now **13-run-stable** (S2→S15): REST root/table, JWKS, and auth-health all return the identical `exceed_egress_quota` 402; the management token stays 401-invalid; the blocker remains the **plan/spend-cap layer, not the credentials**. GitHub PAT fully working (repo + Issue #32 reads); Vercel PAT still valid. The OPS-015 cap-lift sequencing constraint stands unchanged (T-559/T-560 + the BUG-058 probe fix MUST land before any live traffic). Credential hygiene: unchanged posture — the token-hygiene grep over every changed file before push; the standing rotation recommendation repeated in the session reply.

---

## Session 16 probe run (2026-11-20) — the BUG-044-origin + [S-A]/[S-B] verification session (OPS-011 14-run-stable)

**Context:** handoff-session-16 gate check — Lane B depth session (BUG-044's loop origin, the last open runtime item + the DS/11 §8 subagent-claim re-verification), read-only. GET-only probe set re-run at session start (keyless script `infra_test_s16.sh` outside the repo; keys via environment from the chmod-600 env file OUTSIDE the repo — no token material in any committed artifact):

```
P1  GET /rest/v1/ (publishable)              → 401 (key-type gate — key recognized)
P2  GET /rest/v1/ (secret)                   → 402 exceed_egress_quota
P3  GET /rest/v1/students?select=id&limit=1  → 402 exceed_egress_quota
P4  GET /auth/v1/.well-known/jwks.json       → 402 exceed_egress_quota
P5  GET /auth/v1/health (publishable)        → 402 exceed_egress_quota
P5b GET /auth/v1/health (secret)             → 402 exceed_egress_quota
P7  GET api.supabase.com/v1/projects/… (mgmt token) → 401 Invalid access token
P8  GET identitytoolkit (FB web key)         → 400 CONFIGURATION_NOT_FOUND (format-accepted)
P9  TCP pooler :6543 OPEN, :5432 OPEN
P9c direct db host db.vebfehrpzajhstyhinnw.supabase.co — NOW RESOLVES from the sandbox
    (S15 recorded it unresolvable; a sandbox-side DNS change, not a project change —
    login still untested per charter: the password remains a [YOUR-PASSWORD] placeholder)
P10 GET api.github.com/repos/… (PAT)         → 200; Issue #32 → 200 (open, 0 comments,
    updated_at 2026-11-19T00:06:59Z — no owner activity; gates unchanged) + this
    session's branch push verifies the write path
P11 GET api.vercel.com/v2/user (Vercel PAT)  → 200 (still VALID)
```

**Verdict:** OPS-011 is now **14-run-stable** (S2→S16): REST root/table, JWKS, and auth-health all return the identical `exceed_egress_quota` 402; the management token stays 401-invalid; the blocker remains the **plan/spend-cap layer, not the credentials** (both Supabase keys recognized; GitHub PAT fully working incl. push; Vercel PAT still valid). The OPS-015 cap-lift sequencing constraint stands unchanged — now sharpened by DS/12 §2: with the cap lifted and the toast-churn family unfixed, a single failing tab visit re-burns egress through **five** request loops (BUG-042's proven one + the four newly censused sites), not one. Credential hygiene: unchanged posture — the token-hygiene grep over every changed file before push; the standing rotation recommendation (OPS-012 family) repeated in the session reply.

---

## Session 17 probe run (2026-11-20) — the owner-infrastructure-question session (OPS-011 15-run-stable)

**Context:** handoff-session-17 gate check — the sandbox had recycled since S16 (repo re-cloned from `main` at `0bdb55dd`; the credentials env + keyless probe script survived at `/home/z/my-project/scripts/` and were reused, chmod-600 posture unchanged). The owner asked directly whether the audit is blocked by the Supabase restriction and what the plan is. GET-only probe set re-run at session start (keyless script `infra_test_s16.sh` outside the repo; keys via environment only — no token material in any committed artifact):

```
P1  GET /rest/v1/ (publishable)              → 401 {"message":"Secret API key required"} (key-type gate — key recognized)
P2  GET /rest/v1/ (secret)                   → 402 exceed_egress_quota
P3  GET /rest/v1/students?select=id&limit=1  → 402 exceed_egress_quota
P4  GET /auth/v1/.well-known/jwks.json       → 402 exceed_egress_quota
P5  GET /auth/v1/health (publishable)        → 402 exceed_egress_quota
P5b GET /auth/v1/health (secret)             → 402 exceed_egress_quota
P7  GET api.supabase.com/v1/projects/… (mgmt token) → 401 Invalid access token
P8  GET identitytoolkit (FB web key)         → 400 CONFIGURATION_NOT_FOUND (format-accepted)
P9  TCP pooler :6543 OPEN, :5432 OPEN
P9c direct db host RESOLVES from the sandbox (S16 datum carries; login still untested per charter —
    the password remains a [YOUR-PASSWORD] placeholder)
P10 GET api.github.com/repos/… (PAT)         → 200; Issue #32 → 200 (open, 0 comments,
    updated_at 2026-11-19T00:06:59Z — no owner activity; gates unchanged)
P11 GET api.vercel.com/v2/user (Vercel PAT)  → 200 (still VALID)
```

**Verdict:** OPS-011 is now **15-run-stable** (S2→S17): the identical restriction signature persists on REST root/table, JWKS, and auth-health; the management token stays 401-invalid; the blocker remains the **plan/spend-cap layer, not the credentials** (both Supabase keys recognized; GitHub PAT fully working; Vercel PAT still valid). The three owner-gated ceremonies (live census; S8 §8 re-verification; S11 §A1.5 ×10/legacy-row reconciliation) and the E7.9 final export remain staged, and the **OPS-015 sequencing constraint stands unchanged**: T-559/T-560 (now the five-site loop family) + the BUG-058 probe fix MUST land before the cap is lifted, else the app immediately re-burns egress through five request loops + the 30 s probe drip.

**Session 17 note (the direct answer to the owner's question, recorded for the file):** the restriction does NOT block schema access — the complete schema is in-source (152 migration files under `elimtiyaz-desktop/supabase/migrations/`, censused at 100 tables in S2 from the migration chain) and every edge function/RPC/policy is in the repo. What the cap blocks is live runtime verification only (data reads, auth flows, the three staged ceremonies). The cap lift itself is exclusively an owner billing action (Supabase Dashboard → Project Settings → spend cap / plan upgrade) — the 402 body states it verbatim; no credential rotation can substitute (15-run-proven). Lane note: no new investigation lane was due this run — the S16 runtime-item backlog is EMPTY; this session is the standing gate check + the infrastructure-question reply.

---

## Session 19 probe run (2026-11-20) — the standing 6-hour sweep (OPS-011 16-run-stable)

**Context:** the standing recurring sweep, owner silent (Issue #32 open, **0 comments**, `updated_at 2026-11-19T00:06:59Z` — unchanged since S16; the 19th consecutive silent run). The sandbox had recycled again: the repo was re-cloned from `main` at `d5534a6f` (the S18 merge commit); the credentials env (chmod-600) + the keyless probe script survived at `/home/z/my-project/scripts/` and were reused — no token material in any committed artifact. GET-only probe set re-run at session start:

```
P1  GET /rest/v1/ (publishable)              → 401 {"message":"Secret API key required"} (key-type gate — key recognized)
P2  GET /rest/v1/ (secret)                   → 402 exceed_egress_quota
P3  GET /rest/v1/students?select=id&limit=1  → 402 exceed_egress_quota
P4  GET /auth/v1/.well-known/jwks.json       → 402 exceed_egress_quota
P5  GET /auth/v1/health (publishable)        → 402 exceed_egress_quota
P7  GET api.supabase.com/v1/projects/… (mgmt token) → 401 Invalid access token
P8  GET identitytoolkit (FB web key)         → 400 CONFIGURATION_NOT_FOUND (format-accepted)
P9  TCP pooler :6543 OPEN, :5432 OPEN
P9c direct db host db.vebfehrpzajhstyhinnw.supabase.co — DOES NOT RESOLVE this run
    (flips back from S16/S17's "resolves"; a sandbox-side DNS variance, not a project
    change — the poolers remain the operative path; login still untested per charter,
    the password remains a [YOUR-PASSWORD] placeholder)
P10 GET api.github.com/user + /repos/… + Issue #32 (PAT) → 200s (authenticates as the
    owner account; Issue #32 open, 0 comments — no owner activity; gates unchanged)
    + this session's branch push verifies the write path
P11 GET api.vercel.com/v2/user (Vercel PAT)  → 200 (still VALID)
```

**Verdict:** OPS-011 is now **16-run-stable** (S2→S19; S18 cited S17's run rather than re-probing): REST root/table, JWKS, and auth-health all return the identical `exceed_egress_quota` 402; the management token stays 401-invalid; the blocker remains the **plan/spend-cap layer, not the credentials** (P1's key-type gate + P2's quota body prove both Supabase keys recognized; GitHub PAT fully working incl. push; Vercel PAT still valid). The three owner-gated ceremonies and the E7.9 final export stay gated; the **OPS-015 sequencing constraint stands unchanged** (T-559/T-560 five-site family + the BUG-058 probe fix MUST land before any cap lift).

**S19 integrity datum (the recycle check, recorded for the file):** `git diff 6c0b007e..d5534a6f` contains **zero non-archive changes** (7 files, all under `Investigation Archive/` + `Refactoring Unified/`) — the S18 guide's verification commit is the current app-source state, so its claims carry unchanged. Spot re-verified the guide's three most load-bearing claims personally at HEAD: the build-time hardcode constants (`supabase-client.ts:35-38`), the packager's canonical-key guard Set (`build-windows.mjs:161-163`), and the payload assertions (`build-windows.mjs:303-315` family) — all intact; zero `.env*` files anywhere (re-confirmed).

## Session 21 probe run (2026-11-20) — the phase-transition cleanup + the owner-token verification (OPS-011 17-run-stable)

**Context:** the owner's post-phase-transition instruction — "They're still 20 branches — I want all branches merged and only the main to be kept" — plus the newest full credential set ("test if it works, make sure it works"). The Session 20 consolidation had already verified every investigation branch merged; this session re-ran the deletion safety gate (`git rev-list --count main..<branch>` = **0 for every branch**, all 19 remote + the 2 local refs) and executed the cleanup: **all 19 remote investigation branches deleted via regular `git push origin --delete` (no force-push), both local refs deleted (`investigation/session-20`, `backup/pre-merge-archive`) — only `main` remains** (`git ls-remote --heads origin` = `refs/heads/main` alone, at `2bde3363`; the REST `/repos/…/branches` endpoint transiently returned 404 right after the mass ref deletion — a GitHub-side anomaly, the repo still lists normally via `/user/repos` and the git transport is the confirmation of record). Tokens live only in the chmod-600 env file outside the repo; GET-only probe set re-run with the newest owner-supplied values:

```
P1  GET /rest/v1/ (publishable)              → 401 {"message":"Secret API key required"} (key-type gate — key recognized)
P2  GET /rest/v1/ (secret)                   → 402 exceed_egress_quota
P3  GET /rest/v1/students?select=id&limit=1  → 402 exceed_egress_quota
P4  GET /auth/v1/.well-known/jwks.json       → 402 exceed_egress_quota
P5  GET /auth/v1/health (publishable)        → 402 exceed_egress_quota
P5b GET /auth/v1/settings (publishable)      → 402 exceed_egress_quota
P7  GET api.supabase.com/v1/projects/… (the FRESH owner-supplied management token) → 401 {"message":"Invalid access token"}
P8  identitytoolkit probe (FB web key)       → 400 CONFIGURATION_NOT_FOUND (format-accepted, as S19)
P9  TCP pooler :6543 OPEN, :5432 OPEN
P9c direct db host db.vebfehrpzajhstyhinnw.supabase.co — DOES NOT RESOLVE this run (the sandbox DNS
    variance continues; poolers remain the operative path; the DB password remains a
    [YOUR-PASSWORD] placeholder in every supplied URL — login untestable)
P10 GET api.github.com/user (PAT)            → 200 (authenticates as the owner account; the 19 branch
    deletions + this session's pushes verify the git write path)
P11 GET api.vercel.com/v2/user (Vercel PAT)  → 200 (VALID)
```

**Verdict:** OPS-011 is now **17-run-stable** — the fresh Supabase key set changes nothing; the blocker remains the **plan/spend-cap layer, not the credentials** (the exact 402 body: "The project owner must upgrade their plan or remove spend caps to restore service"). **The freshly supplied management token is ALSO 401-invalid** ("Invalid access token" — the same verdict as every prior management token; the live-census ceremony remains token-gated on the owner side too). GitHub PAT fully working (200s; the deletion pushes prove the write path); Vercel PAT valid; Firebase web key format-accepted; poolers OPEN. The **OPS-015 sequencing constraint stands unchanged** (T-559/T-560 five-site loop family + the BUG-058 fix BEFORE any cap lift). **The direct "does it work" answer:** repository operations (read/merge/push/branch management) — **WORKING** (proven by this cleanup); Vercel — **WORKING**; the Supabase data plane — **STILL BLOCKED** by the spend cap (an owner billing action, 17-run-proven, not a credential problem); the Supabase management API — **token-rejected**; the database — TCP-reachable via both pooler ports but login untested (placeholder password). The blueprint phase proceeds unaffected (the schema is fully in-source; all backend code is in-repo).

---

## Session 23 run (2026-11-20 — the unified-Excel audit; the 18th consecutive probe run)

```
P1  GET /rest/v1/ (publishable)             → 401 {"message":"Secret API key required"} (key-type gate — key recognized)
P2  GET /rest/v1/ (secret)                  → 402 exceed_egress_quota
P3  GET /rest/v1/students?select=id&limit=1 → 402 exceed_egress_quota
P4  GET /auth/v1/.well-known/jwks.json     → 402 exceed_egress_quota
P4b GET /auth/v1/health                    → 402 exceed_egress_quota
P4c GET /auth/v1/settings                  → 402 exceed_egress_quota
P7  GET api.supabase.com/v1/projects/… (management token) → 401 Invalid access token
P8  identitytoolkit probe (FB web key)     → 400 CONFIGURATION_NOT_FOUND (format-accepted, as S19-S22)
P9  TCP pooler :6543 OPEN, :5432 OPEN
P9c direct db host db.vebfehrpzajhstyhinnw.supabase.co — DOES NOT RESOLVE this run (the sandbox DNS
    variance continues; poolers remain the operative path)
P10 GET api.github.com/user (PAT)          → 200 (the session's clone/push path verified)
P11 GET api.vercel.com/v2/user (Vercel PAT)→ 200 (VALID)
Issue #32: 200; comments → 0 (the 18th consecutive silent run — no owner activity; G0 gates unchanged)
```

**Verdict:** OPS-011 is now **18-run-stable** — the blocker remains the plan/spend-cap layer (not credentials). GitHub PAT valid (clone + this session's pushes); Vercel PAT valid; poolers OPEN. The unified-Excel X-lane's live ceremony (T-603..T-611 execution + the DS/13 §8 G1-G7 local gates first) stays owner-gated exactly like every other execution lane.

---

## Session 24 run (2026-11-20 — the final-unified-blueprint verification + consolidated-schema session; the 19th consecutive probe run AND the first full TWO-PROJECT probe set)

**Context:** the owner's consolidated mandate (codebase audit re-verification, the final unified-blueprint completeness audit, and the single-file schema consolidation). The GET-only probe set was extended this session to probe BOTH Supabase projects (OLD `vebfehrpzajhstyhinnw` AND NEW `gvuvibcsfjhwcjikgxql`) plus both management tokens — the first run to do so. Keys in-memory only, masked below; script outside the repo (`/home/z/my-project/scripts/s24_infra_probe.sh`).

```
GitHub
P10  GET api.github.com /repos/Vtheonly/AgentGithubUplaod (PAT) → 200
P10b GET /repos/.../issues/32 (PAT)           → 200; comments → 0 (the 19th consecutive silent run; G0 gates unchanged)

Vercel
P11  GET api.vercel.com/v2/user (PAT)          → 200 (VALID — user merselfares2, team default)

OLD project (vebfehrpzajhstyhinnw — the quota-blocked source)
P1o  GET /rest/v1/ (publishable)               → 401 {"message":"Secret API key required"} (key-type gate — key recognized)
P2o  GET /rest/v1/ (secret)                    → 402 exceed_egress_quota
P3o  GET /rest/v1/students?select=id&limit=1   → 402 exceed_egress_quota
P4o  GET /auth/v1/.well-known/jwks.json        → 402 exceed_egress_quota
P5o  GET /auth/v1/health (secret)              → 402 exceed_egress_quota

NEW project (gvuvibcsfjhwcjikgxql — the relocation target)
P1n  GET /rest/v1/ (publishable)               → 401 {"message":"Secret API key required"} (key-type gate — key recognized)
P2n  GET /rest/v1/ (secret)                    → 200 (Swagger descriptor returned — THE NEW PROJECT IS ALIVE AND NOT QUOTA-BLOCKED)
P3n  GET /rest/v1/students?select=id&limit=1   → 404 PGRST205 "Could not find the table 'public.students' in the schema cache"
                                                 → THE NEW PROJECT IS SCHEMA-EMPTY (a blank relocation target)
P4n  GET /auth/v1/.well-known/jwks.json        → 200 (ES256 keys present)
P5n  GET /auth/v1/health (secret)              → 200 (GoTrue v2.198.0 healthy)

Supabase management API
P7o  GET api.supabase.com /v1/projects/<OLD> (OLD mgmt token) → 401 Invalid access token (unchanged)
P7n  GET api.supabase.com /v1/projects/<NEW> (NEW mgmt token) → 200 — FIRST-EVER VALID management token
     (project "digitalforgedv-max_elemtiyaz", ref gvuvibcsfjhwcjikgxql, region eu-west-1)

Firebase / network
P8   identitytoolkit probe (FB web key)        → 400 CONFIGURATION_NOT_FOUND (format-accepted, unchanged)
P9   TCP pooler aws-1-eu-west-1 :6543 OPEN, :5432 OPEN

Local verification harness (new this session — supports the schema-consolidation mandate)
H1   PGlite 0.5.17 (PostgreSQL 18.7 wasm32)    → AVAILABLE in the sandbox, in-memory
H2   extensions pgcrypto / pg_trgm / btree_gist → ALL LOADABLE via the PGlite contrib plugins
     (gen_random_uuid works; the % trigram operator works; btree_gist EXCLUDE constraints work)
H3   extensions uuid-ossp / pgjwt              → NOT loadable in PGlite (as LF0-PREP-CENSUS documented —
     the consolidated schema's verification run uses the same skip-guard discipline)
```

**Verdict — a MATERIAL infrastructure change, the first since OPS-011 stabilized:**

1. **OPS-011 is now 19-run-stable** on the OLD project — the blocker remains the plan/spend-cap layer (not credentials).
2. **The NEW project (`gvuvibcsfjhwcjikgxql`) is alive, healthy, and NOT quota-blocked**: its REST root answers 200 with the secret key, its auth service is healthy, and its JWKS endpoint is live. **Its public schema is EMPTY** (the `students` probe 404s with `PGRST205`) — it is exactly a blank, spend-cap-free relocation target.
3. **The NEW management token is the first VALID one in the program's history** (200 on the management API; the OLD token remains 401-invalid). This unblocks the management-API side of any future relocation ceremony.
4. **Relocation implications (registered for the T-573..T-575 lane):** the target project is ready and reachable; what it lacks is exactly the SCHEMA — which is what this session's consolidated single-file schema (`0001_initial_consolidated_schema.sql`) produces. No live write was performed against the new project this session (GET-only protocol maintained; the schema-consolidation verification ran on a local PGlite instance instead — see H1-H3 and the S24 schema-verification record).
5. The OLD project's spend cap still gates the OLD project's live census/export ceremonies (T-598, E7B-9) — unchanged; but the relocation lane (and hence the desktop's escape from OPS-011) is no longer blocked on anything owner-side except the execution green-light itself.

---

## Session 25 probe run (2026-11-21) — the standing gate check + the two-project refresh (OPS-011 20-run-stable)

**Context:** the recurring sweep (S25). The owner remains silent on Issue #32 (0 comments — the 20th consecutive silent run; G0 stays ACTIVE; the run stayed read-only). Between S24 and this run the owner held an interactive setup chat: the consolidated credential inventory (both Supabase projects, the GitHub PAT, the four-repo list) was supplied in chat with the instruction to perform the Google OAuth setup directly — that chat's evidence record enters the archive this run as `02-NEW-PROJECT-VERIFICATION.md`. The Firebase and Vercel tokens are NOT in the current env set (P8/P11 skipped, per the S4 not-re-tested precedent). Probe set re-run (keyless script outside the repo; keys via the chmod-600 env file; masked output):

```
P1  GET {OLD}/rest/v1/ (publishable)             -> 401 key-type gate (key recognized)
P2  GET {OLD}/rest/v1/ (secret)                  -> 402 exceed_egress_quota
P3  GET {OLD}/rest/v1/students?select=id&limit=1 -> 402 exceed_egress_quota
P4  GET {OLD}/auth/v1/.well-known/jwks.json      -> 402 exceed_egress_quota
P5  GET {OLD}/auth/v1/health (secret)            -> 402 exceed_egress_quota
P5b GET {OLD}/auth/v1/health (publishable)       -> 402 exceed_egress_quota
P5c GET {OLD}/auth/v1/settings (publishable)     -> 402 exceed_egress_quota
P7a mgmt: OLD token -> OLD project               -> 401 invalid (unchanged since S2)
P7b mgmt: NEW token -> OLD project               -> 403 (the two-account split — no cross-account reach)
P7c mgmt: NEW token -> NEW project               -> 200 ACTIVE_HEALTHY (OPS-017 refresh)
P7d mgmt: NEW token -> /v1/projects list         -> 200, list = [the NEW project] only
P8  Firebase format check                        -> SKIPPED (token not in the current env set)
P9  pooler :6543 / :5432                         -> OPEN both; the direct db host DNS still unresolvable (sandbox-side variance)
P10 GET api.github.com/user (PAT)                -> 200 (+ this run's clone/push verified the write path)
P11 Vercel PAT                                   -> SKIPPED (token not in the current env set)
N2  GET {NEW}/rest/v1/ (secret)                  -> 200 (REST alive)
N3  GET {NEW}/rest/v1/students                   -> 404 PGRST205 (fresh schema, unchanged)
N4  GET {NEW}/auth/v1/health (secret)            -> 200 (GoTrue alive)
N6  GET {NEW}/auth/v1/admin/users                -> 200 (0 users — fresh auth)
N7  GET {NEW}/auth/v1/settings (publishable)     -> 200 (external: google=true, email=true, all others false)
Nc  mgmt auth-config (booleans only)             -> google_enabled=true, client_id SET, secret SET; site_url still the localhost default
```

**Verdict:** OPS-011 is now **20-run-stable** (S2→S25) — the identical restriction signature; the blocker remains the OLD account's plan/spend-cap layer, not the credentials. The NEW project stays fully alive (OPS-017), and the S25 configuration audit adds the NEW datum registered as **OPS-019**: Google sign-in is ALREADY fully wired on the NEW project's Supabase side (enabled + client ID + secret set from the owner's earlier attempt) — the remaining OAuth blocker is Google-side (the client's authorized redirect URIs; the owner's single manual step; two completion paths in `02-NEW-PROJECT-VERIFICATION.md` §3). OPS-015 sequencing unchanged (T-559/T-560/T-594 before ANY live traffic on ANY project). The three OLD-project ceremonies stay owner-gated; the G2R lane's first live step (the consolidated-baseline deployment to the NEW project) stays G0-gated. **Credential hygiene escalation:** the full inventory (both projects' key sets + the access token) was pasted in plaintext chat — the OPS-012 rotation recommendation now covers the COMPLETE set, to execute once the OAuth setup completes.

---

## Session 26 probe run (2026-11-21) — the readiness-audit session (OPS-011 21-run-stable; P8/P11 RESTORED)

**Context:** the S26 pre-coding readiness audit (read-only; G0 ACTIVE — Issue #32 at 0 comments, the 21st consecutive silent run). The owner re-supplied the full credential inventory in the session prompt (including the Firebase web key and the Vercel PAT) — **P8/P11 were therefore RESTORED this run** after their S25 skip. Keys in-memory only, masked below; probe script outside the repo.

```
GitHub
P10  GET api.github.com/user (PAT)                  -> 200 (login Vtheonly; the run's clone verified the read path)
P10b GET /repos/Vtheonly/AgentGithubUplaod/issues/32/comments (PAT) -> 200; body [] — 0 comments (the 21st silent run; G0 ACTIVE)

Vercel
P11  GET api.vercel.com/v2/user (PAT)              -> 200 (VALID — user merselfares2@…; RESTORED after the S25 skip: the token was in this session's env set)

OLD project (vebfehrpzajhstyhinnw — the quota-blocked source)
P1o  GET /rest/v1/ (publishable)                   -> 401 key-type gate (key recognized)
P2o  GET /rest/v1/ (secret)                        -> 402 exceed_egress_quota
P3o  GET /rest/v1/students?select=id&limit=1       -> 402 exceed_egress_quota
P4o  GET /auth/v1/.well-known/jwks.json            -> 402 exceed_egress_quota
P5o  GET /auth/v1/health (secret)                  -> 402 exceed_egress_quota

NEW project (gvuvibcsfjhwcjikgxql — the relocation target)
P2n  GET /rest/v1/ (secret)                        -> 200 (Swagger descriptor — alive, not quota-blocked)
P3n  GET /rest/v1/students?select=id&limit=1       -> 404 PGRST205 (schema-empty — unchanged)
P5n  GET /auth/v1/health (secret)                  -> 200 (GoTrue v2.198.0 healthy)

Supabase management API
P7a  GET /v1/projects/<OLD> (OLD mgmt token)        -> 401 Invalid access token (unchanged since S2)
P7c  GET /v1/projects/<NEW> (NEW mgmt token)        -> 200 (ACTIVE_HEALTHY; the OPS-017 state unchanged)
P7d  GET /v1/projects list (NEW mgmt token)         -> 200 (list = the NEW project only)

Firebase
P8   GET identitytoolkit.googleapis.com/v1/projects?name=projects/elimtiyaz-android (FB web key, X-Goog-Api-Key) -> 400 CONFIGURATION_NOT_FOUND (format-accepted; RESTORED after the S25 skip — the S19-S24 signature unchanged)
```

**Verdict:** OPS-011 is now **21-run-stable** (S2→S26) — the identical 402 signature on every OLD-project lane; the blocker remains the plan/spend-cap layer. The NEW project is unchanged (alive, schema-empty, OPS-017). P8/P11 are back in the standing set while their tokens remain in the session env. The OPS-019 Google-side blocker is unchanged (the S26 session made no Supabase-side config change; the owner's D-21 manual step stands). Zero live writes anywhere; every probe GET-only.

## Session 28 probe run (2026-11-21) — the G0-lift execution bootstrap session (OPS-011 22-run-stable)

GET-only; keys in-memory only, masked; the S26 probe-set methodology re-run exactly (the OLD/NEW REST lanes + the PAT checks + the Issue #32 gate — S27 skipped the live set, honestly recorded; this run restores it, and it doubles as the G0-lift bootstrap's gate check).

```text
OLD project (vebfehrpzajhstyhinnw — quota-blocked source)
P2o  GET /rest/v1/ (secret)                           -> 402 exceed_egress_quota (the cap UNCHANGED)

NEW project (gvuvibcsfjhwcjikgxql — the relocation target)
P2n  GET /rest/v1/ (secret)                           -> 200 (Swagger descriptor — alive, not quota-blocked)
P3n  GET /rest/v1/students?select=id&limit=1 (secret) -> 404 PGRST205 (schema-empty — unchanged)
P5n  GET /auth/v1/health (secret)                     -> 200 (GoTrue healthy)

Tokens
GH1  GET api.github.com/user (PAT)                    -> 200 (the push credential VALID)
VC1  GET api.vercel.com/v2/user (PAT)                 -> 200 (the cutover credential VALID — ready for T-614)

Owner gate
IS32 GET repos/Vtheonly/AgentGithubUplaod/issues/32/comments (PAT) -> 200, 0 comments (the 23rd consecutive silent run; the G0-lift authority is the owner's standing chat directive of 2026-11-21, not an Issue #32 comment — recorded in EXECUTION-PLAN §1 + SESSION_LOG row 28 + the next-task.md queue header)
```

**Verdict:** OPS-011 is now **22-run-stable** (S2→S28) — the identical 402 signature on the OLD-project lane; the blocker remains the plan/spend-cap layer (an owner billing action exclusively). The NEW project remains alive/uncapped/schema-empty (the OPS-017 state unchanged). **G0 = LIFTED** per the owner's standing directive (2026-11-21) — the execution sessions are GO from Session 28 onward; OPS-015 + G2 still gate all live traffic/deploys/cap-lifts.

## Session 29 probe run (2026-11-21) — the first full execution session (Track 1 + Track 2 complete; OPS-011 23-run-stable)

```
Old project (vebfehrpzajhstyhinnw)
P2o  GET /rest/v1/ (secret)                           -> 402 (exceed_egress_quota — UNCHANGED, the 23rd identical signature)

New project (gvuvibcsfjhwcjikgxql)
P2n  GET /rest/v1/ (secret)                           -> 200 (alive, uncapped — unchanged)
P3n  GET /rest/v1/students?select=id&limit=1 (secret) -> 404 PGRST205 (schema-empty — unchanged)
P5n  GET /auth/v1/health (secret)                     -> 200 (GoTrue healthy)

Tokens
GH1  GET api.github.com/user (PAT)                    -> 200 (VALID — the session's 8 commits + the merge all landed on origin/main)
VC1  GET api.vercel.com/v2/user (PAT)                 -> 200 (VALID — ready for T-614's owner window)

Owner gate
IS32 GET repos/Vtheonly/AgentGithubUplaod/issues/32/comments (PAT) -> 200, 0 comments (the 24th consecutive silent run; the execution authority remains the owner's standing chat directive of 2026-11-21 — G0 LIFTED permanently)
IS32 (android/website repos)                         -> not-an-array (issue #32 exists only on the hub repo — the established pattern)
```

**Verdict:** OPS-011 is now **23-run-stable** (S2→S29) — the identical 402 signature on the OLD-project lane; the blocker remains the plan/spend-cap layer (an owner billing action exclusively). The NEW project remains alive/uncapped/schema-empty. **The OPS-015 Track 2 code precondition (T-559 + T-560 + T-594) went GREEN this session** — the live-traffic/zero-deploy/zero-cap-lift locks still STAND (G2 unlifted), but their code-side precondition is satisfied; the remaining gates for any live window are the owner-side actions (D-21, the cutover-time secrets, the cap lift itself).

## Session 30 probe run (2026-11-21) — the Track 3 head session (T-550/T-573/T-552/ARCH-046; OPS-011 24-run-stable)

> **Environment-recovery note (honest record):** the sandbox recycle wiped `/home/z/my-project/.secrets/env`, the git credential store and the repo clones. They were RECONSTRUCTED at session open from the owner's standing protocol/summary + repo sources: the three repos re-cloned, the credential store re-seated from the preserved PAT, and the key inventory re-filled — the OLD-project ANON key was recovered verbatim from the committed website default (`elimtiyaz-website/src/lib/public-config.ts`, the T-516 current-live key), while the OLD SECRET key was never committed anywhere (by design) and is recorded EMPTY. The OLD-project lanes therefore ran on the recovered ANON key this run (the S26-lane probe's secret lane is N/A); the exceed_egress_quota egress signature is auth-independent and re-confirmed via the 402 status + the quota body message.

```
Old project (vebfehrpzajhstyhinnw — quota-blocked source)
P2o  GET /rest/v1/ (secret)                           -> N/A (OLD secret key never committed; not in env)
P2oa GET /rest/v1/ (ANON lane - recovered key)        -> 401 (the OpenAPI root requires a higher-privileged key)
P3oa GET /rest/v1/students?select=id&limit=1 (ANON)   -> 402 exceed_egress_quota (the quota body message — UNCHANGED, the 24th identical signature)

New project (gvuvibcsfjhwcjikgxql — the relocation target)
P2n  GET /rest/v1/ (secret)                           -> 200 (alive, uncapped — unchanged)
P3n  GET /rest/v1/students?select=id&limit=1 (secret) -> 404 PGRST205 (schema-empty — unchanged)
P5n  GET /auth/v1/health (secret)                     -> 200 (GoTrue healthy)

Tokens
GH1  GET api.github.com/user (PAT)                    -> 200 (VALID — the re-seated credential store pushed this session's branch)
VC1  GET api.vercel.com/v2/user (PAT)                 -> 200 (VALID — ready for T-614's owner window)

Owner gate
IS32 GET repos/Vtheonly/AgentGithubUplaod/issues/32/comments (PAT) -> 200, 0 comments (the 25th consecutive silent run; the execution authority remains the owner's standing chat directive of 2026-11-21 — G0 LIFTED permanently)
IS32 (android/website repos)                         -> not-an-array (issue #32 exists only on the hub repo — the established pattern)
```

**Verdict:** OPS-011 is now **24-run-stable** (S2→S30) — the identical 402 signature on the OLD-project lane (re-confirmed through the recovered ANON lane; the blocker remains the plan/spend-cap layer, an owner billing action exclusively). The NEW project remains alive/uncapped/schema-empty (OPS-017 unchanged). **OPS-015/G2 live locks STAND** — this session executes the Track 3 code lane (T-550 the port seam → T-573 the BackendProfile switcher → T-552 → ARCH-046), which is G2-independent (Path 2); zero live traffic, zero deploys, zero cap lifts, zero packaged builds run here.

## Session 31 probe run (2026-11-21) — the Track 3 bypass-routing session (T-552; OPS-011 25-run-stable)

> **Environment-recovery note (honest record):** the sandbox recycled AGAIN before the session open — `/home/z/my-project/.secrets/env`, the git credential store and the repo clones were wiped. Reconstructed per the S30 method: the three repos re-cloned; the OLD-project ANON key recovered verbatim from the committed website default (`elimtiyaz-website/src/lib/public-config.ts`, the T-516 current-live key). The GITHUB_PAT, the VERCEL_PAT and the NEW-project (gvuvibcsfjhwcjikgxql) keys are NOT recoverable this window (they were never committed anywhere — by design; the persisted tool-results + repo sources carry no trace). The probe set therefore ran its ANON-lane subset; the PAT lanes and the NEW-project secret lanes are recorded N/A (honest), and **the session's git push is BLOCKED** — the commits live on the local session branch + main (merged locally); the next PAT-carrying session (or the owner) pushes both.

```
Old project (vebfehrpzajhstyhinnw — quota-blocked source)
P2oa GET /rest/v1/ (ANON recovered)                     -> 401 (the OpenAPI root requires a higher-privileged key — the established ANON-lane shape)
P3oa GET /rest/v1/students?select=id&limit=1 (ANON)     -> 402 exceed_egress_quota (the quota body message — UNCHANGED, the 25th identical signature)

New project (gvuvibcsfjhwcjikgxql — the relocation target)
P5n  GET /auth/v1/health (no key available this window)  -> 401 (the service responds — alive; the secret-lane health check N/A this run)

Tokens
GH1  GET api.github.com/user (PAT)                       -> N/A (PAT not recoverable this window — recorded)
VC1  GET api.vercel.com/v2/user (PAT)                    -> N/A (PAT not recoverable this window — recorded)

Owner gate
IS32 GET issue #32 comments (PAT)                        -> N/A (PAT not recoverable; the G0 execution authority remains the owner's standing chat directive of 2026-11-21 — LIFTED permanently, independent of the issue's comment state)
```

**Verdict:** OPS-011 is now **25-run-stable** (S2→S31) — the identical 402 signature on the OLD-project lane (re-confirmed through the recovered ANON lane; the blocker remains the plan/spend-cap layer, an owner billing action exclusively). The NEW project answered (401 without a key = alive, uncapped — consistent with every prior run). **OPS-015/G2 live locks STAND** — this session executed the Track 3 code lane (T-552 — the 17 bypass files' import-seam routing), which is G2-independent (zero live traffic, zero deploys, zero cap lifts, zero packaged builds).

## Session 33 probe run (2026-11-21) — the Track 3 preflight-of-record session (T-575; OPS-011 26-run-stable)

> **Environment note (fresh sandbox, fully recovered):** a brand-new sandbox opened this session — no clones, no node_modules, no `.secrets`. Reconstructed from the owner's in-chat credentials block: the three repos re-cloned (the PAT re-validated 200 below), `npm ci` clean in `elimtiyaz-desktop/`, the secrets re-stored OUTSIDE the repos (the S28 discipline). The full probe set ran this window (every lane answered).

```
Old project (vebfehrpzajhstyhinnw — quota-blocked source)
P3oa GET /rest/v1/tenants?select=id&limit=1 (ANON)     -> 402 exceed_egress_quota (the quota body — UNCHANGED, the 26th identical signature)

New project (gvuvibcsfjhwcjikgxql — the relocation target)
P5n  GET /rest/v1/tenants?select=id&limit=1 (publishable) -> 404 PGRST205 "Could not find the table 'public.tenants' in the schema cache" (alive, uncapped, SCHEMA-EMPTY — the honest today-state; exactly the shape T-575's new preflight of record rejects as NOT parity until the §A.2 apply lands)

Tokens
GH1  GET api.github.com/user (PAT)                       -> 200 VALID (this session's pushes landed through it: main 305f54ec→c67d053c + execution/session-33-t575-preflight)
VC1  GET api.vercel.com/v2/user (PAT)                    -> 200 VALID

Website lane
W1   GET https://elimtiyaz-website.vercel.app/            -> 200 (the portal live; still OLD-project-pinned per the S27 audit — the T-614 redeploy pending, owner-gated)

Owner gate
IS32 GET issues/32/comments (AgentGithubUplaod, PAT)     -> 200, 0 comments (the 26th consecutive silent run; the execution authority remains the owner's standing chat directive of 2026-11-21 — G0 LIFTED permanently)
```

**Verdict:** OPS-011 is now **26-run-stable** (S2→S33) — the identical 402 signature on the OLD-project lane (the blocker remains the plan/spend-cap layer, an owner billing action exclusively). The NEW project remains alive/uncapped/schema-empty (OPS-017 unchanged — the exact state T-575's census verdicts are built to name honestly). **OPS-015/G2 live locks STAND** — this session executed the Track 3 code lane (T-575 — the preflight of record), which is G2-independent: zero live traffic, zero deploys, zero cap lifts, zero packaged builds (the new remote preflight lanes execute only inside a real packaging run, the t-573 precedent).

## Session 34 probe run (2026-11-21) — the relocation-auth-tooling session (T-574; OPS-011 27-run-stable)

> **Environment note (fresh sandbox, fully recovered):** the secrets store (`/home/z/my-project/.secrets/credentials.env` + `github.pat`) survived this window — the PAT re-validated 200 below and both session commits (`033a89e5` → `0f9af36c`) pushed through it. The full GET-only probe set ran (every lane answered).

```
Old project (vebfehrpzajhstyhinnw — quota-blocked source)
P3oa GET /rest/v1/tenants?select=id&limit=1 (ANON)     -> 402 exceed_egress_quota (the quota body message — UNCHANGED, the 27th identical signature)

New project (gvuvibcsfjhwcjikgxql — the relocation target)
P3n  GET /rest/v1/tenants?select=id&limit=1 (publishable) -> 404 PGRST205 "Could not find the table 'public.tenants' in the schema cache" (alive, uncapped, SCHEMA-EMPTY — the honest today-state; exactly the state T-575's preflight of record rejects as NOT parity until the §A.2 apply lands)
P5n  GET /auth/v1/health (publishable)                    -> 200 (GoTrue healthy — version v2.198.0; the lane T-574's auth tooling targets)

Tokens
GH1  GET api.github.com/user (PAT)                        -> 200 VALID (this session's pushes landed through it: execution/session-34-t574-relocation-auth)
VC1  GET api.vercel.com/v2/user (PAT)                     -> 200 VALID (user merselfares2-9361 — ready for T-614's owner window)

Website lane
W1   GET https://elimtiyaz-website.vercel.app/            -> 200 (the portal live; still OLD-project-pinned per the S27 audit — the T-614 redeploy pending, owner-gated)

Owner gate
IS32 GET issues/32/comments (AgentGithubUplaod, PAT)      -> 200, 0 comments (the 27th consecutive silent run; the execution authority remains the owner's standing chat directive of 2026-11-21 — G0 LIFTED permanently)
```

**Verdict:** OPS-011 is now **27-run-stable** (S2→S34) — the identical 402 signature on the OLD-project lane (the blocker remains the plan/spend-cap layer, an owner billing action exclusively). The NEW project remains alive/uncapped/schema-empty (OPS-017 unchanged) — and its GoTrue service answered healthy (v2.198.0), the exact lane T-574's tooling addresses at the owner's cutover window. **OPS-015/G2 live locks STAND** — this session executed the Track 3 code lane (T-574 — the relocation auth tooling), which is G2-independent: zero live traffic beyond the standing GET-only probe set, zero deploys, zero cap lifts, zero packaged builds (the tool's remote lanes execute only at the owner's cutover window, the t-575 precedent).

## Session 35 probe run (2026-11-21, GET-only, the S33/S34 pattern — probe-s34.sh)

- P3oa OLD project REST (ANON): **402 exceed_egress_quota — UNCHANGED (28-run-stable OPS-011)**
- P3n NEW project REST (publishable): 404 PGRST205 (the schema-empty honest today-state — no tables applied yet; the 0001..0005 chain awaits the owner's apply window)
- P5n NEW project /auth/v1/health: **200 (GoTrue v2.198.0)**
- GH1 GitHub PAT: **200 (login: Vtheonly)** · VC1 Vercel PAT: **200 (user: merselfares2-9361)**
- W1 https://elimtiyaz-website.vercel.app/: **200** · IS32 Issue #32 comments: **0 (the 28th consecutive silent run)**
- Verdict: the OPS-011 cap state unchanged; the G2 spend-cap lift is still the owner's billing action; zero live traffic beyond this GET-only set (OPS-015 honored).

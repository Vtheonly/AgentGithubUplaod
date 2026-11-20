# Session 25 Report — the standing sweep + the OAuth-setup record

**Date:** 2026-11-21 · **Type:** recurring 6-hour sweep (read-only; G0 ACTIVE) · **Branch:** `investigation/session-25` · **Base:** `main` at the S24 records commit.

## 1. Scope executed

1. **Bootstrap (Step 0):** fresh-sandbox clone of the hub repo with the PAT from the outside-repo env file (the env file's mode was found loosened to 755 by the sandbox recycle — re-tightened to 600 first); `Investigation Archive/README.md` → `SESSION_LOG.md` → `Handoffs/handoff-session-24.md` → `Refactoring Unified/EXECUTION-PLAN.md` §14 read; the S24 state confirmed (v2.1 blueprints; the consolidated-baseline migration; OPS-017).
2. **G0 check:** Issue #32 read via the API — **0 comments** (the 20th consecutive silent run). G0 stays ACTIVE → **no application-code changes**; the run stayed in the documentation/verification lane, exactly per the S24 handoff's not-lifted branch.
3. **The infra gate check:** the canonical GET-only probe set re-run (keyless script outside the repo: `scripts/s25_infra_probe.sh`; keys via the chmod-600 env file) — old-project P1–P5c/P7/P9/P10 + the new-project N-set refresh + the three-pair management-API matrix (P7a–P7d).
4. **The S24-interactive-chat record:** the 2026-11-21 owner chat (the consolidated credential inventory + the "do it yourself" OAuth mandate) and its verification evidence entered the archive; the register, the log, the index, the packet, the report, and the handoff updated.

## 2. Infra verdict (masked; full transcript in `01-INFRASTRUCTURE-STATUS.md` S25)

| Lane | Result |
|---|---|
| OLD project REST/Auth (P1–P5c) | 401 key-type gate on the publishable root; **402 `exceed_egress_quota` on every secret/auth lane** → **OPS-011 20-run-stable** (S2→S25) |
| Management API (P7a–P7d) | OLD token → OLD project: 401 (unchanged since S2); NEW token → OLD project: **403** (the two-account split); NEW token → NEW project: **200 ACTIVE_HEALTHY**; the projects list: the NEW project only |
| Pooler (P9) | `aws-1-eu-west-1.pooler…:6543/:5432` OPEN; the direct db host's DNS still unresolvable (sandbox-side variance) |
| GitHub (P10) | 200 + this run's clone and five pushes verified the write path |
| Firebase (P8) / Vercel (P11) | **SKIPPED** — the tokens are not in the current env set (S4 not-re-tested precedent; the owner can re-supply them if the standing record should carry them) |
| NEW project (N2–N7) | REST 200; students 404 (fresh schema); auth health 200; admin users 200 (**0 users**); settings 200 (`google=true, email=true`, all other providers false) |
| NEW project auth config (Nc) | `google_enabled=true`, client ID SET, secret SET; `site_url` still the localhost:3000 default |

## 3. New findings / register changes

- **OPS-019** (new, the next-free OPS slot): Google sign-in on the NEW project is **fully wired on the Supabase side** (enabled + client ID + secret set — the owner's earlier attempt) **but blocked on the Google side** — the client's authorized redirect URIs do not include the new project's callback. Two completion paths (A: edit the existing client; B: create + replace, appliable programmatically via the Management API's update-auth-config endpoint when the values are supplied). The Google-side create/edit is the owner's ONE manual step (no API path exists for OAuth client creation).
- **D-21** (OWNER-DECISION-PACKET addendum): the owner's chat mandate recorded — assistant-executed OAuth setup; the one owner-manual step pending; the widened OPS-012 rotation recommendation (the FULL inventory was pasted in plaintext chat — rotate both projects' key sets + the access token once the OAuth setup completes).
- **Next free IDs after S25:** DEAD-026, DUP-039, ARCH-051, BUG-071, OPS-020; next correction C-27.

## 4. Files written this session (all inside `Investigation Archive/`)

`01-INFRASTRUCTURE-STATUS.md` (S25 run section) · `02-NEW-PROJECT-VERIFICATION.md` (new — sanitized: no token shapes) · `Findings and Hypotheses/FINDINGS_INDEX.md` (S25 addendum) · `OWNER-DECISION-PACKET.md` (D-21 addendum) · `SESSION_LOG.md` (row 25) · `README.md` (Session 25 section) · `Session Reports/session-25-report.md` (this file) · `Handoffs/handoff-session-25.md`.

## 5. Verification

- GET-only probes throughout; the keyless script pattern maintained; no key material in any output, file, or commit message (the bare-pattern hygiene grep ran clean before every push).
- The app source untouched: the session's diff touches ONLY `Investigation Archive/` files.
- Issue #32 untouched (0 comments; no comment posted — the sweep never posts).

## 6. What this session did NOT do (and why)

- No execution of the T-queue (G0 not lifted).
- No Google-side OAuth client creation (behind the owner's Google login — no API path; the prepared values await the owner in `02-NEW-PROJECT-VERIFICATION.md` §3).
- No P8/P11 probes (token unavailability recorded rather than guessed).
- No schema deployment to the NEW project (G2R's first live step is G0-gated, and OPS-015's ordering binds any live traffic).

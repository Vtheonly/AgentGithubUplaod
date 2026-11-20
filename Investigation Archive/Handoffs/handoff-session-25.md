# Handoff — Session 25 → the next sweep

**Date:** 2026-11-21 · **HEAD at close:** the S25 session-records commits on `main` (clean, pushed) · **G0:** still ACTIVE (Issue #32: 0 comments — the 20th consecutive silent run).

## The state of record (what changed this session)

1. **OPS-011 is 20-run-stable** — the OLD project (`vebfehrpzajhstyhinnw`) still 402 `exceed_egress_quota` on every REST/Auth lane; the blocker stays the OLD account's plan/spend-cap layer. P7a (OLD token) still 401. The three OLD-project ceremonies remain owner-gated, unchanged.
2. **The NEW project (`gvuvibcsfjhwcjikgxql`) re-verified ALIVE** (OPS-017 refresh): REST/auth/mgmt 200s, fresh schema (no `public.students`), **0 auth users**, ACTIVE_HEALTHY — and the S25 config audit adds **OPS-019**: Google sign-in is **already fully wired on its Supabase side** (enabled + client ID + secret set from the owner's earlier attempt); the blocker is Google-side (the client's redirect URIs lack the new project's callback).
3. **The 2026-11-21 interactive setup chat entered the archive** as `02-NEW-PROJECT-VERIFICATION.md` (the two-project verification + the Google-provider audit + the exact console values + the two completion paths). The owner's mandate is **D-21**; the plaintext-chat inventory widened the OPS-012 rotation recommendation to the COMPLETE set.
4. **P8/P11 were skipped** this run — the Firebase/Vercel tokens are not in the current env set (the owner's 2026-11-21 inventory did not include them). If the owner re-supplies them, restore the two probes; otherwise the S25 note stands.

## The next session's bootstrap (in order)

1. `git fetch origin && git status` (clean; sync `main`); check the env file's mode (the sandbox recycle loosened it once — enforce 600).
2. Read: `Investigation Archive/README.md` (the S25 rows) → `SESSION_LOG.md` row 25 → this handoff → `Refactoring Unified/EXECUTION-PLAN.md` v2.1 (unchanged this session — §14 is still the S24 delta).
3. Check Issue #32 for the owner's green-light (G0). **If lifted:** execute §3's immediate queue — the **OPS-018 preamble first** (the 31 `src/tests` migration-path updates, one mechanical commit), then T-549 → T-559/T-560/T-594 → T-550/T-573 → T-552, carrying the S24 corrections (C-23/C-24/C-25, Deep Sweep/14). **If not lifted:** the standing GET-only probe set + any documentation/verification work the owner mandates.
4. **The OAuth lane (D-21), independent of G0:** if the owner supplies the Google client credentials in chat (Option B), apply them to the NEW project via the Management API's update-auth-config endpoint and verify with the masked config GET (booleans only); if the owner reports the existing client edited (Option A), verify nothing on the Supabase side changed and close OPS-019. Either way, remind the owner of the consent-screen publish/test-user requirement and the post-setup rotation.
5. The one-time live window (G2, after T-559/T-560/T-594 green): the full verify_t-376 12/12, the live census, the T-598 reconciliation oracle, and the **consolidated-baseline deployment to the NEW project** (the T-575 preflight's first target; Path 2 in the relocation guide).

## The corrections the executor must carry (unchanged from S24 — see handoff-session-24 + Deep Sweep/14)

- T-594 narrows (C-23): mock mode is already silent; fix the configured-mode probe resolution (~120/h, not ~240/h).
- T-569's DB-side deletion scope is EMPTY (C-24): app-side only; `class_subjects` is the DB truth.
- T-588's store inventory is 13+ (C-25); T-592's volley budget is 30 caches/18 files (ARCH-049); T-591 gains BUG-069; E2.4 gains DUP-037.
- BUG-046's fix surface is 7 synthetic entry sites (the root: `unified-payment-modal.tsx:283-285`).
- REAL_TUITION_BY_GRADE is not year-keyed at all — ARCH-037/T-587 is stronger than the v2.0 framing.

## Standing constraints (unchanged)

Read-only until G0 lifts; one T-task per commit with the five-question body; push immediately; never force-push; SQL/EF changes under the §11.1 ceremony; RLS never weakened; the archive never touched again; the web portal and Android keep consuming Supabase unchanged (D-17); OPS-015's cap-lift ordering is absolute; NO key material in any file, output, or commit message — keys live only in the outside-repo chmod-600 env file.

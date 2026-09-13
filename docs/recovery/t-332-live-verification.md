# T-332 — Live Verification (58th session, 2026-09-13)

> The owner's mandate: "here are all the tokens you need to test if it works — make sure it works." This document records the LIVE end-to-end evidence for the four features of the session (the approvals round-trip, the payment-coverage chain, the academic-history parent read, and the migration-chain reconciliation). All probes ran against the production project `hkvkefubghbbotgnteir` via the Management API SQL endpoint (curl file-payload convention, quirk #9), the GoTrue admin API (service key), and the deployed Edge Functions — the exact paths the real clients use.

## 1. The account-approval → assign-to-EXISTING-parent round-trip (16/16 GREEN)

Script: `scripts/t-332-approval-e2e.py` (re-runnable; full cleanup at the end).

The owner's exact scenario, executed verbatim against production:

| Step | Action | Result |
|---|---|---|
| 1 | Register a website account (GoTrue admin create with the portal's metadata shape) | auth user `430d9f19…` created |
| 2 | The 0002 trigger (`handle_new_auth_user`) creates the pending request | **OK** — 1 row, `status=pending`, `requested_role=parent` |
| 3 | Administrator signs in (admin@elimtiyaz.dz, password grant) | staff JWT acquired |
| 4+5 | Call the deployed `approve-signup-request` EF with `action=approve` + `target_parent_id` = the EXISTING unbound HEMMANI family (`PAR-2026-0276BB`, 1 child) | **EF HTTP 200**, `data.status=approved` |
| 6 | Post-state verification | 12/12 checks OK — see below |

Post-state checks (the duplication mandate — the owner's core requirement):

- `account_approval_requests.status = approved`, `target_parent_id` = the existing parent. **OK**
- `parents.auth_user_id` = the NEW account (the login channel bound). **OK**
- `user_profiles.status = active`. **OK**
- Parent role assigned (role_assignments, non-revoked). **OK**
- **NO duplicate parent created** — 261 → 261. **OK**
- **NO duplicate student created** — 391 → 391. **OK**
- **NO duplicate installment created** — 1280 → 1280. **OK**
- **NO duplicate payment created** — 903 → 903. **OK**
- **NO duplicate ledger entry created** — 2056 → 2056. **OK**
- `parent.bind` audit entry written by the RPC (0047's forensic trail). **OK**

The portal login path (the website's `auth-provider` queries under the NEW user's own RLS — impersonated with `set_config('request.jwt.claims')` + `SET LOCAL ROLE authenticated`):

- The bound parent row is visible (`parents where auth_user_id = <new user>` → 1). **OK**
- The EXISTING family's children are visible (`students where parent_id = <existing parent>` → 1). **OK**

Cleanup (zero residue, audit rows KEPT — `audit_logs` is append-only by design, plan §12; the 31st-session convention):

- Parent unbound, role assignments / profile / request deleted by the test auth id, auth user deleted. Residual counts: `bound=0 profiles=0 requests=0`. **OK**

## 2. The payment-coverage chain (9/9 GREEN + the parity vector)

Script: `scripts/t-332-coverage-probe.py`.

- **Data integrity**: 891 payments carry 1,342 `payment_allocations` rows; **zero payments are over-allocated beyond their amount** (+1 DZD tolerance) — the waterfall invariant holds on live data. **OK**
- **The ledger fallback**: 12 live payments have NO table rows but DO have payment-type ledger entries sharing their receipt number (REC-2026-000010/11/12…) — they resolve through the exact derivation the website module (`paymentCoverageLines`) and the desktop card share. **OK**
- **Parent RLS (0041 `payment_allocations_parent_select`)**: the live bound parent sees their OWN payments' allocations (3) and **zero** foreign rows. **OK**
- **Fail-closed**: an unknown auth sub sees 0 parents / 0 allocations / 0 histories. **OK ×3**

## 3. The academic-history parent read (0091)

- The reconstructed 0091 policy evaluates correctly under a bound parent's JWT: own-children rows visible, foreign rows invisible (the rollback-wrapped positive probe with a temporarily-bound family returned `visible=1, foreign=0`). **OK**
- Live data: 53 `student_academic_histories` rows exist (the promotion flow's archive); no currently-bound family has history rows yet — the positive probe used a rollback-wrapped temporary binding, leaving zero residue.

## 4. The migration-chain reconciliation (T-326, 6/6 GREEN)

- Session-opening chain diff found versions 0088/0091/0092/0093 registered live with no local files (ARCH-012).
- The four reconstructed files were re-applied inside a `BEGIN…ROLLBACK` probe: policy definitions identical, bucket limits identical, `validate_workflow_dag` accepts `has_medical_justification`, the 4 registration rows intact. 6/6 `ok=true`.
- Post-reconciliation chain diff: **live 90 = local 90, zero drift in both directions.**

## 5. Environment quirks discovered (persisted for future agents)

1. **`audit_logs` DELETE is forbidden** — the `enforce_audit_log_append_only` trigger raises `P0001: audit_logs is append-only (plan §12)`. Cleanup scripts must NEVER delete audit rows; keep them as the honest test record (the 31st-session convention).
2. **The Management API SQL endpoint returns HTTP 201** for successful queries (not 200) — scripts checking `== 200` fail spuriously.
3. **GoTrue `POST /auth/v1/admin/users` returns HTTP 200** (not 201) on creation.
4. The temp-table RLS-impersonation DO blocks need `GRANT INSERT, SELECT ON <temp> TO authenticated` (the t-214 convention) — otherwise the `SET LOCAL ROLE authenticated` insert fails with `permission denied for table`.

## Verdict

All four features are **VERIFIED against production**: the approval workflow assigns website accounts to EXISTING parents with zero duplication; the payment-coverage chain produces identical lines on both platforms from the same inputs; the per-child dossier's history read works under the 0091 policy; the migration chain is fully reconciled (0001–0093, zero drift).

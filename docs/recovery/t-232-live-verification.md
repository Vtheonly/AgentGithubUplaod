# T-232 — Final live verification: the complete DAG pipeline, end-to-end (DAG-100 closure)

**Date:** 2026-09-07 (34th session) · **Task:** T-232 · **Problem closed:** DAG-100 (VERIFIED)
**Live project:** `hkvkefubghbbotgnteir` · **Migrations:** 79/79 = 0001–0082 · **EFs:** workflow-execute v27 + workflow-resume-scheduler v1

## What this matrix proves

The owner's demanded pipeline — **ON THE LIVE BACKEND, through the DESKTOP's exact contract** (PostgREST + RLS with a real staff JWT, not the service-role SQL the per-task matrices used):

```
Create DAG → Connect nodes → Validate → Reject cyclic → Save → Reload →
Publish (version 1) → Trigger (EF) → Execute nodes → Evaluate conditions
(REAL data) → Follow the correct branch → Execute actions (real) →
Persist run → Inspect execution history
```

plus the failure paths (park → unpublish → honest cancellation, duplicate-execution protection, honest undeliverables).

## The matrix (18/18 GREEN)

Harness: `scripts/t232-final-matrix.sh` (sanitized: all credentials via env vars).

| # | Check | Evidence |
|---|-------|----------|
| 1–2 | **Create**: the desktop's exact PostgREST insert (RLS `workflows_admin`) creates the draft; `version = 0` (never published) | `workflows` row |
| 3 | **Reject cyclic**: the desktop's update+publish PATCH (cyclic dag_definition + status=published) is REJECTED by the 0081/0082 SQL gate — `cycle detected` | PostgREST 400 |
| 4–5 | **Publish**: the desktop's deploy PATCH (status + last_deployed_at in ONE update) → `published`, `version = 1` | `workflows` row |
| 6 | **Reload**: the definition round-trips losslessly through the desktop's refresh query (6 nodes / 6 edges byte-identical) | PostgREST GET |
| 7–9 | **Trigger + Execute** with the REAL debtor (HAMIDI, 1,507,000 DZD outstanding): the gate `parent.outstanding_balance > 1,000,000` is TRUE on the REAL `compute_parent_summary` value; the route_switch takes **route A** (balance > 1,200,000) — `aUrgent` succeeded, `aNormal` **skipped** (true divergence); the convergence node ran ONCE; taken path `t1→c1→r1→aUrgent→fin` | EF response |
| 10 | **Honest undeliverable**: HAMIDI has NO portal account → the parent notification reports `undeliverable: 1` with the reason (NO fake dispatch) | node output |
| 11–12 | **Real delivery**: the linked parent (ALIOUAT) receives the in-app notification via the canonical 0077 RPC; the notifications row TARGETS the parent's portal account (verified through the user_profiles join) | `notifications` row |
| 13 | **Audit**: the `workflow.run` audit entry for the run (which workflow, version, trigger, node counts, duration) | `audit_logs` |
| 14 | **Execution history**: the desktop monitor's query (`workflow_runs` + `workflows(name)` embed) returns the complete row — status, trigger_type, **workflow_version**, the name via embed, 6 node_results, duration | PostgREST GET |
| 15 | **Park**: a 30s delay parks the run (pending_resumes row) | EF + SQL |
| 16–18 | **Failure path**: the workflow is DISABLED while parked → the scheduler **cancels** the resume and the run FAILS honestly with `resume cancelled: workflow 'WF-T232-PARK' is no longer published` | scheduler summary + run row |

## The full task-set evidence chain

| Task | Matrix | Result |
|------|--------|--------|
| T-223 (schema + SQL validation) | `scripts/verify_t-223.sql` | 25/25 live |
| T-224 (pure engine) | `workflow-engine.test.ts` | 27 tests (incl. dry-run equivalence) |
| T-225 (EF rewrite + deploy) | `scripts/t225-live-matrix.sh` | 33/33 live |
| T-226 (real actions) | `scripts/t226-action-matrix.sh` | 15/15 live |
| T-227 (real context) | `scripts/t227-context-matrix.sh` | 10/10 live (server-wins-over-client) |
| T-228 (delay/resume scheduler) | live multi-hop cycles | park→resume→re-park→complete + duplicate claim 0 |
| T-229 (dry-run) | `scripts/t229-dryrun-matrix.sh` | 10/10 live (prediction parity) |
| T-230 (desktop wiring) | `t-230-server-pipeline-wiring.test.ts` | 8 tests |
| T-231 (Android contract) | gradle `WorkflowRunContractT231Test` | 6 tests (+ full 416-test suite green) |
| **T-232 (this)** | `scripts/t232-final-matrix.sh` | **18/18 live** |

Suites at close: desktop **105 files / 2578 tests / 0 failures** + tsc clean + eslint 0 errors; Android **49 suites / 416 tests / 0 failures** (JDK 21 + SDK 35 provisioned in-session); website untouched (read-only portal, no DAG surface by design).

## Honest residuals (documented, not hidden)

- `apply_discount` / `create_invoice` / `generate_document` / `account_adjustment` / `database_query` are **honest skips** — they need owner-ratified canonical financial RPCs (AGENTS.md §15 rule 2); they will never fake a write.
- `send_email` real path needs `RESEND_API_KEY`; FCM push delivery needs `FIREBASE_SERVICE_ACCOUNT_JSON` + `FIREBASE_PROJECT_ID` — both owner-gated; failures are recorded per-recipient (in-app rows still deliver).
- `send_whatsapp` prepares the wa.me link honestly; no WhatsApp Business API integration exists (no delivery is claimed).
- The desktop click-through in the running Electron app is host-gated (AGENTS.md §11); the server round-trip this UI performs is exactly what T-232 exercised.
- Scheduler crash-recovery hardening (stale claimed rows) is inert-first-release (documented in the EF source).

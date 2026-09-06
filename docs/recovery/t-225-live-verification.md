# T-225 — Live verification: the rewritten workflow-execute Edge Function (DAG-101 closure)

**Date:** 2026-09-07 (34th session) · **Task:** T-225 · **Problems closed:** DAG-101 (EF half)
**Live project:** `hkvkefubghbbotgnteir` · **Migration chain at test time:** 78/78 = 0001–0081 · **EF version:** workflow-execute v22 (deployed this task, on the pure engine)

## What this proves

The pre-T-225 deployment (v21) could not execute ANY workflow: it selected a nonexistent `definition`/`version` column (every call 404'd), inserted four nonexistent `workflow_runs` columns, and dispatched nodes by flat legacy type strings the desktop never persists. The rewrite (engine.ts + actions.ts + index.ts on the 0081 schema contract) executes real workflow DAGs on the live backend with the desktop dry-run's branch semantics.

## The matrix (33/33 GREEN)

Harness: `scripts/t225-live-matrix.sh` (idempotent; creates its own `WF-T225-*` workflows; staff JWT via the `dag-verify-t225@elimtiyaz-test.dz` test user — super_admin in the primary tenant).

| # | Check | Evidence |
|---|-------|----------|
| 1–3 | Test workflows inserted (LIVE / CAP / PAUSE), cyclic stays draft | SQL rows |
| 4–6 | Valid publishes accepted (through the 0081 SQL gate), `version = 1`, **cyclic publish REJECTED** with `workflow publish rejected: cycle detected — 2 node(s) involved (Kahn)` | SQL gate |
| 7–9 | Auth matrix: no Authorization → 401 · anon key as Bearer → 401 · invalid JWT → 401 | curl status codes |
| 10–11 | Real execution returns a `run_id`, status `succeeded` | EF response |
| 12–16 | Run row carries the 0081 contract columns: `actor_note` ("T-225 live verification"), `request_id` (correlation id header → row), `workflow_version` = 1, `completed_at` set | `workflow_runs` row |
| 17–20 | **Branch semantics**: the gate passed, route A executed, route B **skipped** (`branch_not_taken`), the convergence node executed ONCE | node_results |
| 21 | Route evidence recorded (route evaluations in the route_switch output; first-passing-route short-circuit) | node output |
| 22 | `extract_field` resolved `workflow.name` → `WF-T225-LIVE` (real transform) | node output |
| 23–24 | Workflow counters updated by the EF (`last_executed_at` set, `total_executions` incremented — never done before) | `workflows` row |
| 25 | `workflow.run` audit entry written for the run | `audit_logs` |
| 26–27 | Daily cap: first run 200, second run **429 daily_limit_reached** (max=1) | curl |
| 28 | Draft workflow → **409 workflow_not_published** | curl |
| 29 | Unknown workflow id → **404** | curl |
| 30 | `trigger_type: "laser_beam"` → **400 invalid_trigger_type** (the run-trigger enum is enforced) | curl |
| 31–33 | Pause path: 90s delay → status `paused`, `workflow_pending_resumes` row written (pending), run stays `running` with the park note in node_results | EF + SQL |

## Node-by-node execution record (the auditability contract)

```
t1   trigger    payment_overdue      succeeded  trigger entry point
c1   condition  debt_over_threshold  succeeded  (condition_result: true, gate)
r1   condition  route_switch         succeeded  (routes: [Route-A passed])
a1   action     log_audit            succeeded  log_audit action=workflow.t225.test_a
a2   action     log_audit            skipped    branch_not_taken
x1   transform  extract_field        succeeded  extract_field 'workflow.name' → string
```

Taken path: `t1->c1, c1->r1, r1->a1, a1->x1` (returned as `taken_edge_keys`).

## Cross-references

- Desktop unit tests of the engine: `src/tests/infrastructure/workflow-engine.test.ts` (27 tests, incl. dry-run equivalence)
- Server-side validation (SQL): `scripts/verify_t-223.sql` (25/25 GREEN live)
- The paused run is resumed + verified in T-228's matrix (`workflow-resume-scheduler`)
- Action executor evidence per subtype: T-226's matrix

#!/bin/bash
# T-225 LIVE VERIFICATION MATRIX — the rewritten workflow-execute EF.
# Runs against the live project with a real staff JWT. Creates its own
# test workflows (WF-T225-* codes) and verifies:
#   auth matrix, valid execution with branch semantics, correct run-row
#   columns, progressive node_results, workflow counters, audit entry,
#   daily cap 429, draft/409, 404, invalid trigger_type 400, park path.
# Everything is inspectable afterwards; the workflows stay for T-226/232.
set -euo pipefail

SUPA_URL="https://hkvkefubghbbotgnteir.supabase.co"
ANON_KEY="${SUPABASE_ANON_KEY:?set SUPABASE_ANON_KEY}"
JWT="${SUPA_TEST_JWT:?set SUPA_TEST_JWT (a staff JWT with execute_workflow)}"
EF="$SUPA_URL/functions/v1/workflow-execute"
PASS=0; FAIL=0
declare -a RESULTS

check() {
  local name="$1" cond="$2" detail="$3"
  if [ "$cond" = "1" ]; then PASS=$((PASS+1)); RESULTS+=("PASS $name");
  else FAIL=$((FAIL+1)); RESULTS+=("FAIL $name — $detail"); fi
}

sql() {
  python3 -c "import json,sys; print(json.dumps({'query': sys.stdin.read()}))" | \
  curl -s -X POST "https://api.supabase.com/v1/projects/hkvkefubghbbotgnteir/database/query" \
    -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN:?set SUPABASE_ACCESS_TOKEN}" \
    -H "Content-Type: application/json" --data @-
}

echo "=== 1. Create + publish the test workflows ==="
# WF-T225-LIVE: trigger → gate (workflow.name == WF-T225-LIVE) → route_switch
# (2 routes on workflow.code) → two log_audit actions → extract_field.
sql > /dev/null << 'EOSQL'
delete from public.workflow_pending_resumes where workflow_id in (select id from public.workflows where code in ('WF-T225-LIVE', 'WF-T225-CAP', 'WF-T225-PAUSE', 'WF-T225-CYCLIC'));
delete from public.workflow_runs where workflow_id in (select id from public.workflows where code in ('WF-T225-LIVE', 'WF-T225-CAP', 'WF-T225-PAUSE', 'WF-T225-CYCLIC'));
delete from public.workflows where code in ('WF-T225-LIVE', 'WF-T225-CAP', 'WF-T225-PAUSE', 'WF-T225-CYCLIC');
EOSQL

DEF_LIVE='{"nodes":[{"id":"t1","type":"trigger","subtype":"payment_overdue","label":"Paiement en retard","position":{"x":0,"y":0},"config":{}},{"id":"c1","type":"condition","subtype":"debt_over_threshold","label":"Gate","position":{"x":1,"y":0},"config":{"condition":{"kind":"comparison","field":"workflow.name","op":"==","value":"WF-T225-LIVE"}}},{"id":"r1","type":"condition","subtype":"route_switch","label":"Aiguillage","position":{"x":2,"y":0},"config":{"routes":[{"label":"Route-A","condition":{"kind":"comparison","field":"workflow.code","op":"==","value":"WF-T225-LIVE"}},{"label":"Route-B","condition":{"kind":"comparison","field":"workflow.code","op":"==","value":"NEVER"}}]}},{"id":"a1","type":"action","subtype":"log_audit","label":"Action-A","position":{"x":3,"y":-1},"config":{"action":"workflow.t225.test_a"}},{"id":"a2","type":"action","subtype":"log_audit","label":"Action-B","position":{"x":3,"y":1},"config":{"action":"workflow.t225.test_b"}},{"id":"x1","type":"transform","subtype":"extract_field","label":"Extract","position":{"x":4,"y":0},"config":{"field":"workflow.name"}}],"edges":[{"id":"e1","source":"t1","target":"c1"},{"id":"e2","source":"c1","target":"r1"},{"id":"e3","source":"r1","target":"a1"},{"id":"e4","source":"r1","target":"a2"},{"id":"e5","source":"a1","target":"x1"},{"id":"e6","source":"a2","target":"x1"}]}'

TENANT=$(echo "select id from public.tenants where is_active and deleted_at is null limit 1;" | sql | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['id'])")

python3 - "$TENANT" "$DEF_LIVE" << 'PYEOF' > /dev/null
import json, sys
tenant, defn = sys.argv[1], sys.argv[2]
# printed payload is consumed by the caller via file
open('/tmp/t225_wf_live.sql', 'w').write(
  "insert into public.workflows (tenant_id, code, name, description, dag_definition, status, max_daily_executions) "
  f"values ('{tenant}', 'WF-T225-LIVE', 'WF-T225-LIVE', 'T-225 live verification', '{defn}'::jsonb, 'published', 50);"
)
open('/tmp/t225_wf_cap.sql', 'w').write(
  "insert into public.workflows (tenant_id, code, name, description, dag_definition, status, max_daily_executions) "
  f"values ('{tenant}', 'WF-T225-CAP', 'WF-T225-CAP', 'T-225 cap verification', "
  "'{\"nodes\":[{\"id\":\"t1\",\"type\":\"trigger\",\"subtype\":\"manual_run\",\"label\":\"T\",\"position\":{\"x\":0,\"y\":0},\"config\":{}},{\"id\":\"a1\",\"type\":\"action\",\"subtype\":\"log_audit\",\"label\":\"A\",\"position\":{\"x\":1,\"y\":0},\"config\":{\"action\":\"workflow.t225.cap\"}}],\"edges\":[{\"id\":\"e1\",\"source\":\"t1\",\"target\":\"a1\"}]}'::jsonb, 'published', 1);"
)
open('/tmp/t225_wf_pause.sql', 'w').write(
  "insert into public.workflows (tenant_id, code, name, description, dag_definition, status, max_daily_executions) "
  f"values ('{tenant}', 'WF-T225-PAUSE', 'WF-T225-PAUSE', 'T-225 pause verification', "
  "'{\"nodes\":[{\"id\":\"t1\",\"type\":\"trigger\",\"subtype\":\"manual_run\",\"label\":\"T\",\"position\":{\"x\":0,\"y\":0},\"config\":{}},{\"id\":\"d1\",\"type\":\"delay\",\"subtype\":\"wait_duration\",\"label\":\"Wait\",\"position\":{\"x\":1,\"y\":0},\"config\":{\"duration_ms\":90000}},{\"id\":\"a1\",\"type\":\"action\",\"subtype\":\"log_audit\",\"label\":\"After\",\"position\":{\"x\":2,\"y\":0},\"config\":{\"action\":\"workflow.t225.after_pause\"}}],\"edges\":[{\"id\":\"e1\",\"source\":\"t1\",\"target\":\"d1\"},{\"id\":\"e2\",\"source\":\"d1\",\"target\":\"a1\"}]}'::jsonb, 'published', 50);"
)
open('/tmp/t225_wf_cyclic.sql', 'w').write(
  "insert into public.workflows (tenant_id, code, name, description, dag_definition, status, max_daily_executions) "
  f"values ('{tenant}', 'WF-T225-CYCLIC', 'WF-T225-CYCLIC', 'T-225 cyclic (must stay draft)', "
  "'{\"nodes\":[{\"id\":\"n1\",\"type\":\"action\",\"subtype\":\"log_audit\",\"label\":\"A\",\"position\":{\"x\":0,\"y\":0},\"config\":{}},{\"id\":\"n2\",\"type\":\"action\",\"subtype\":\"log_audit\",\"label\":\"B\",\"position\":{\"x\":1,\"y\":0},\"config\":{}}],\"edges\":[{\"id\":\"e1\",\"source\":\"n1\",\"target\":\"n2\"},{\"id\":\"e2\",\"source\":\"n2\",\"target\":\"n1\"}]}'::jsonb, 'draft', 50);"
)
PYEOF

# Publish LIVE/CAP/PAUSE through the publish gate (the SQL trigger validates).
for f in live cap pause; do
  SQLFILE="/tmp/t225_wf_${f}.sql"
  # insert as draft, then publish via update (exercises the 0081 gate)
  sed 's/, .published., /, '"'"'draft'"'"', /' "$SQLFILE" | sql > /dev/null
done
CODE=$(echo "select code from public.workflows where code='WF-T225-LIVE' limit 1;" | sql | python3 -c "import json,sys; print(len(json.load(sys.stdin)))")
check "wf_live_inserted" "$([ "$CODE" = "1" ] && echo 1 || echo 0)" "insert failed"
CODE=$(echo "select code from public.workflows where code='WF-T225-CAP' limit 1;" | sql | python3 -c "import json,sys; print(len(json.load(sys.stdin)))")
check "wf_cap_inserted" "$([ "$CODE" = "1" ] && echo 1 || echo 0)" "insert failed"
CODE=$(echo "select code from public.workflows where code='WF-T225-PAUSE' limit 1;" | sql | python3 -c "import json,sys; print(len(json.load(sys.stdin)))")
check "wf_pause_inserted" "$([ "$CODE" = "1" ] && echo 1 || echo 0)" "insert failed"
# cyclic draft
cat /tmp/t225_wf_cyclic.sql | sql > /dev/null
CYC=$(echo "select status from public.workflows where code='WF-T225-CYCLIC';" | sql | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['status'])")
check "cyclic_stays_draft" "$([ "$CYC" = "draft" ] && echo 1 || echo 0)" "status=$CYC"

echo "=== 2. Publish gate (valid workflows) ==="
echo "update public.workflows set status='published' where code in ('WF-T225-LIVE','WF-T225-CAP','WF-T225-PAUSE');" | sql > /dev/null
PUB=$(echo "select count(*) from public.workflows where code in ('WF-T225-LIVE','WF-T225-CAP','WF-T225-PAUSE') and status='published';" | sql | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['count'])")
check "publish_valid_ok" "$([ "$PUB" = "3" ] && echo 1 || echo 0)" "published count=$PUB"
VER=$(echo "select version from public.workflows where code='WF-T225-LIVE';" | sql | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['version'])")
check "publish_version_1" "$([ "$VER" = "1" ] && echo 1 || echo 0)" "version=$VER"
# cyclic publish attempt → rejected
PUBLISH_ERR=$(echo "update public.workflows set status='published' where code='WF-T225-CYCLIC';" | sql 2>&1 | head -c 200)
check "cyclic_publish_rejected" "$(echo "$PUBLISH_ERR" | grep -q 'publish rejected' && echo 1 || echo 0)" "$PUBLISH_ERR"

WFID=$(echo "select id from public.workflows where code='WF-T225-LIVE';" | sql | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['id'])")
CAPID=$(echo "select id from public.workflows where code='WF-T225-CAP';" | sql | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['id'])")
PAUSEID=$(echo "select id from public.workflows where code='WF-T225-PAUSE';" | sql | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['id'])")

echo "=== 3. Auth matrix ==="
S=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$EF" -H "Content-Type: application/json" -d "{\"workflow_id\":\"$WFID\"}")
check "no_auth_401" "$([ "$S" = "401" ] && echo 1 || echo 0)" "got $S"
S=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$EF" -H "Content-Type: application/json" -H "Authorization: Bearer $ANON_KEY" -d "{\"workflow_id\":\"$WFID\"}")
check "anon_key_401" "$([ "$S" = "401" ] && echo 1 || echo 0)" "got $S"
S=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$EF" -H "Content-Type: application/json" -H "Authorization: Bearer invalid.jwt.token" -d "{\"workflow_id\":\"$WFID\"}")
check "invalid_jwt_401" "$([ "$S" = "401" ] && echo 1 || echo 0)" "got $S"

echo "=== 4. Main execution (branch semantics + honest columns) ==="
RESP=$(curl -s -X POST "$EF" -H "Content-Type: application/json" -H "Authorization: Bearer $JWT" \
  -H "x-request-id: t225-verify-main" \
  -d "{\"workflow_id\":\"$WFID\",\"trigger_type\":\"payment_overdue\",\"actor_note\":\"T-225 live verification\"}")
RUNID=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin).get('data',{}).get('run_id',''))")
check "exec_returns_run_id" "$([ -n "$RUNID" ] && echo 1 || echo 0)" "$(echo "$RESP" | head -c 300)"
STATUS=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin).get('data',{}).get('status',''))")
check "exec_status_succeeded" "$([ "$STATUS" = "succeeded" ] && echo 1 || echo 0)" "status=$STATUS"

# Run row columns (the DAG-101 contract).
RUNROW=$(echo "select status, trigger_type, actor_id is not null and actor_id <> '00000000-0000-0000-0000-000000000000' as has_actor, actor_note, request_id, workflow_version, completed_at is not null as completed, duration_ms is not null as has_duration from public.workflow_runs where id = '$RUNID';" | sql | python3 -c "import json,sys; print(json.dumps(json.load(sys.stdin)[0]))")
echo "run row: $RUNROW"
check "run_row_actor_note" "$(echo "$RUNROW" | python3 -c "import json,sys; d=json.load(sys.stdin); print(1 if d['actor_note']=='T-225 live verification' else 0)")" "actor_note wrong"
check "run_row_request_id" "$(echo "$RUNROW" | python3 -c "import json,sys; d=json.load(sys.stdin); print(1 if d['request_id']=='t225-verify-main' else 0)")" "request_id wrong"
check "run_row_workflow_version" "$(echo "$RUNROW" | python3 -c "import json,sys; d=json.load(sys.stdin); print(1 if d['workflow_version']==1 else 0)")" "workflow_version wrong"
check "run_row_completed" "$(echo "$RUNROW" | python3 -c "import json,sys; d=json.load(sys.stdin); print(1 if d['completed'] else 0)")" "not completed"

# Branch semantics: gate TRUE (name matches) + route A taken (code matches)
# → a1 runs, a2 skipped, x1 runs.
NODES=$(echo "$RESP" | python3 -c "
import json, sys
d = json.load(sys.stdin)
out = {r['node_id']: r['status'] for r in d.get('data',{}).get('node_results', [])}
print(json.dumps(out))
")
echo "node outcomes: $NODES"
check "gate_passed" "$(echo "$NODES" | python3 -c "import json,sys; d=json.load(sys.stdin); print(1 if d.get('c1')=='succeeded' else 0)")" "c1"
check "route_a_taken" "$(echo "$NODES" | python3 -c "import json,sys; d=json.load(sys.stdin); print(1 if d.get('a1')=='succeeded' else 0)")" "a1"
check "route_b_skipped" "$(echo "$NODES" | python3 -c "import json,sys; d=json.load(sys.stdin); print(1 if d.get('a2')=='skipped' else 0)")" "a2"
check "convergence_once" "$(echo "$NODES" | python3 -c "import json,sys; d=json.load(sys.stdin); print(1 if d.get('x1')=='succeeded' else 0)")" "x1"
# route evidence in the route_switch output
ROUTES=$(echo "$RESP" | python3 -c "
import json, sys
d = json.load(sys.stdin)
r1 = next((r for r in d.get('data',{}).get('node_results', []) if r['node_id']=='r1'), None)
print(json.dumps((r1 or {}).get('output', {}).get('routes', [])))
")
check "route_evidence_recorded" "$(echo "$ROUTES" | python3 -c "import json,sys; r=json.load(sys.stdin); print(1 if len(r)==1 and r[0]['passed'] and r[0]['route']=='Route-A' else 0)")" "$ROUTES (short-circuit: the first passing route wins)"
# extract_field found the value
EXTRACT=$(echo "$RESP" | python3 -c "
import json, sys
d = json.load(sys.stdin)
x1 = next((r for r in d.get('data',{}).get('node_results', []) if r['node_id']=='x1'), None)
print(json.dumps((x1 or {}).get('output', {})))
")
check "extract_field_real" "$(echo "$EXTRACT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(1 if d.get('found') and d.get('extracted')=='WF-T225-LIVE' else 0)")" "$EXTRACT"

echo "=== 5. Workflow counters (EF-owned) ==="
COUNTERS=$(echo "select last_executed_at is not null as has_ts, total_executions from public.workflows where id='$WFID';" | sql | python3 -c "import json,sys; print(json.dumps(json.load(sys.stdin)[0]))")
check "counter_last_executed" "$(echo "$COUNTERS" | python3 -c "import json,sys; print(1 if json.load(sys.stdin)['has_ts'] else 0)")" "$COUNTERS"
check "counter_total_incremented" "$(echo "$COUNTERS" | python3 -c "import json,sys; print(1 if json.load(sys.stdin)['total_executions']>=1 else 0)")" "$COUNTERS"

echo "=== 6. Audit entry ==="
AUDIT=$(echo "select count(*) from public.audit_logs where tenant_id='$TENANT' and action='workflow.run' and entity_id='$RUNID';" | sql | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['count'])")
check "audit_entry_written" "$([ "$AUDIT" -ge 1 ] && echo 1 || echo 0)" "audit count=$AUDIT"

echo "=== 7. Daily cap (max=1) ==="
R1=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$EF" -H "Content-Type: application/json" -H "Authorization: Bearer $JWT" -d "{\"workflow_id\":\"$CAPID\"}")
check "cap_first_ok" "$([ "$R1" = "200" ] && echo 1 || echo 0)" "got $R1"
sleep 2
R2=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$EF" -H "Content-Type: application/json" -H "Authorization: Bearer $JWT" -d "{\"workflow_id\":\"$CAPID\"}")
check "cap_second_429" "$([ "$R2" = "429" ] && echo 1 || echo 0)" "got $R2"

echo "=== 8. Draft workflow → 409 / unknown → 404 / bad trigger → 400 ==="
CYCID=$(echo "select id from public.workflows where code='WF-T225-CYCLIC';" | sql | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['id'])")
S=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$EF" -H "Content-Type: application/json" -H "Authorization: Bearer $JWT" -d "{\"workflow_id\":\"$CYCID\"}")
check "draft_409" "$([ "$S" = "409" ] && echo 1 || echo 0)" "got $S"
S=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$EF" -H "Content-Type: application/json" -H "Authorization: Bearer $JWT" -d "{\"workflow_id\":\"00000000-0000-0000-0000-000000000099\"}")
check "unknown_404" "$([ "$S" = "404" ] && echo 1 || echo 0)" "got $S"
S=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$EF" -H "Content-Type: application/json" -H "Authorization: Bearer $JWT" -d "{\"workflow_id\":\"$WFID\",\"trigger_type\":\"laser_beam\"}")
check "bad_trigger_400" "$([ "$S" = "400" ] && echo 1 || echo 0)" "got $S"

echo "=== 9. Pause path (90s delay parks the run) ==="
PRESP=$(curl -s -X POST "$EF" -H "Content-Type: application/json" -H "Authorization: Bearer $JWT" -d "{\"workflow_id\":\"$PAUSEID\"}")
PSTATUS=$(echo "$PRESP" | python3 -c "import json,sys; print(json.load(sys.stdin).get('data',{}).get('status',''))")
PRUN=$(echo "$PRESP" | python3 -c "import json,sys; print(json.load(sys.stdin).get('data',{}).get('run_id',''))")
check "pause_status" "$([ "$PSTATUS" = "paused" ] && echo 1 || echo 0)" "status=$PSTATUS $(echo "$PRESP" | head -c 200)"
PARKED=$(echo "select count(*) from public.workflow_pending_resumes where run_id='$PRUN' and status='pending';" | sql | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['count'])")
check "pause_row_written" "$([ "$PARKED" = "1" ] && echo 1 || echo 0)" "parked=$PARKED"
RUNSTILL=$(echo "select status from public.workflow_runs where id='$PRUN';" | sql | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['status'])")
check "paused_run_running" "$([ "$RUNSTILL" = "running" ] && echo 1 || echo 0)" "run status=$RUNSTILL"

echo ""
echo "================ T-225 LIVE MATRIX SUMMARY ================"
for r in "${RESULTS[@]}"; do echo "$r"; done
echo "PASS=$PASS FAIL=$FAIL"
echo "(paused run id: $PRUN — scheduler resume verified in T-228)"

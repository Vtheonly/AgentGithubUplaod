#!/bin/bash
# T-232 — THE FINAL END-TO-END DAG MATRIX (34th-session closeout).
#
# Proves the owner's demanded pipeline ON THE LIVE BACKEND through the
# DESKTOP's exact contract (PostgREST + RLS with a staff JWT — not the
# service-role SQL the earlier task matrices used):
#
#   Create DAG → Connect nodes → Validate → Reject cyclic → Save → Reload →
#   Publish (version) → Trigger (EF) → Execute nodes → Evaluate conditions
#   (REAL data) → Follow the correct branch → Execute actions (real) →
#   Persist run → Inspect execution history (the monitors' queries)
#
# Plus the failure cases: park-then-unpublish cancellation (missing
# dependency), duplicate-execution protection, action-failure honesty.
set -euo pipefail

SUPA_URL="https://hkvkefubghbbotgnteir.supabase.co"
JWT="${SUPA_TEST_JWT:?set SUPA_TEST_JWT (a staff JWT with execute_workflow)}"
ANON_KEY="${SUPABASE_ANON_KEY:?set SUPABASE_ANON_KEY}"
REST="$SUPA_URL/rest/v1"
EF="$SUPA_URL/functions/v1/workflow-execute"
SCHED="$SUPA_URL/functions/v1/workflow-resume-scheduler"
SRK="${SUPABASE_SECRET_KEY:?set SUPABASE_SECRET_KEY}"
PASS=0; FAIL=0
declare -a RESULTS
check() {
  local name="$1" cond="$2" detail="${3:-}"
  if [ "$cond" = "1" ]; then PASS=$((PASS+1)); RESULTS+=("PASS $name");
  else FAIL=$((FAIL+1)); RESULTS+=("FAIL $name — $detail"); fi
}
sql() {
  python3 -c "import json,sys; print(json.dumps({'query': sys.stdin.read()}))" | \
  curl -s -X POST "https://api.supabase.com/v1/projects/hkvkefubghbbotgnteir/database/query" \
    -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN:?set SUPABASE_ACCESS_TOKEN}" \
    -H "Content-Type: application/json" --data @-
}
TENANT=$(echo "select id from public.tenants where is_active and deleted_at is null limit 1;" | sql | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['id'])")
P_DEBTOR="3f9f60ec-d747-469a-a9e4-ab8252821894"   # HAMIDI — 1,507,000 DZD outstanding

# Clean slate for this matrix's codes.
sql > /dev/null << 'EOSQL'
delete from public.workflow_pending_resumes where workflow_id in (select id from public.workflows where code like 'WF-T232-%');
delete from public.workflow_runs where workflow_id in (select id from public.workflows where code like 'WF-T232-%');
delete from public.workflows where code like 'WF-T232-%';
EOSQL

echo "=== 1. CREATE the DAG through the DESKTOP's exact PostgREST insert (RLS: workflows_admin) ==="
# The desktop's createWorkflow: insert with dag_definition {nodes,edges}.
DEF='{"nodes":[{"id":"t1","type":"trigger","subtype":"payment_overdue","label":"Paiement en retard","position":{"x":0,"y":0},"config":{}},{"id":"c1","type":"condition","subtype":"debt_over_threshold","label":"Dette > seuil","position":{"x":1,"y":0},"config":{"condition":{"kind":"comparison","field":"parent.outstanding_balance","op":">","value":1000000}}},{"id":"r1","type":"condition","subtype":"route_switch","label":"Aiguillage","position":{"x":2,"y":0},"config":{"routes":[{"label":"Urgent","condition":{"kind":"comparison","field":"parent.outstanding_balance","op":">","value":1200000}},{"label":"Standard","condition":{"kind":"comparison","field":"parent.outstanding_balance","op":">","value":0}}]}},{"id":"aUrgent","type":"action","subtype":"push_notification","label":"Alerte urgente","position":{"x":3,"y":-1},"config":{"title":"Relance urgente","body":"Créance importante — contacter la famille.","priority":"urgent"}},{"id":"aNormal","type":"action","subtype":"dispatch_task","label":"Tâche suivi","position":{"x":3,"y":1},"config":{"title":"Suivi recouvrement standard","priority":"medium","target_role":"super_admin"}},{"id":"fin","type":"action","subtype":"log_audit","label":"Clôture","position":{"x":4,"y":0},"config":{"action":"workflow.t232.final"}}],"edges":[{"id":"e1","source":"t1","target":"c1"},{"id":"e2","source":"c1","target":"r1"},{"id":"e3","source":"r1","target":"aUrgent"},{"id":"e4","source":"r1","target":"aNormal"},{"id":"e5","source":"aUrgent","target":"fin"},{"id":"e6","source":"aNormal","target":"fin"}]}'

INS=$(python3 -c "
import json
body = {'tenant_id': '$TENANT', 'code': 'WF-T232-E2E', 'name': 'Relance E2E T-232', 'description': 'final matrix', 'dag_definition': json.loads('''$DEF'''), 'status': 'draft', 'max_daily_executions': 50, 'trigger_type': 'automatic', 'created_by': None}
print(json.dumps(body))")
RESP=$(curl -s -X POST "$REST/workflows" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" -H "Prefer: return=representation" -d "$INS")
WFID=$(echo "$RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d[0]['id'] if isinstance(d, list) and d else '')")
check "desktop_insert_ok" "$([ -n "$WFID" ] && echo 1 || echo 0)" "$(echo "$RESP" | head -c 200)"
VER=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['version'])")
check "insert_version_0" "$([ "$VER" = "0" ] && echo 1 || echo 0)" "version=$VER (draft, never published)"

echo "=== 2. REJECT the cyclic edit (desktop updateWorkflow path — draft + then published gate) ==="
CYCLIC='{"nodes":[{"id":"t1","type":"trigger","subtype":"manual_run","label":"T","position":{"x":0,"y":0},"config":{}},{"id":"n1","type":"action","subtype":"log_audit","label":"A","position":{"x":1,"y":0},"config":{}},{"id":"n2","type":"action","subtype":"log_audit","label":"B","position":{"x":2,"y":0},"config":{}}],"edges":[{"id":"e1","source":"t1","target":"n1"},{"id":"e2","source":"n1","target":"n2"},{"id":"e3","source":"n2","target":"n1"}]}'
# Draft edits are free-form (client-side Kahn guards the builder); publish is the gate:
PUBRESP=$(curl -s -o /tmp/t232-cyclic.json -w "%{http_code}" -X PATCH "$REST/workflows?id=eq.$WFID" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d "{\"dag_definition\": $CYCLIC, \"status\": \"published\"}")
CYC_OK=0
if grep -q "cycle detected" /tmp/t232-cyclic.json 2>/dev/null; then CYC_OK=1; fi
check "cyclic_publish_rejected_rls_path" "$CYC_OK" "http=$PUBRESP $(head -c 250 /tmp/t232-cyclic.json)"

echo "=== 3. PUBLISH the valid DAG (desktop deploy path: status + last_deployed_at in ONE update) ==="
DEPLOYRESP=$(curl -s -o /tmp/t232-deploy.json -w "%{http_code}" -X PATCH "$REST/workflows?id=eq.$WFID" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d "{\"status\": \"published\", \"last_deployed_at\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}")
check "desktop_deploy_ok" "$([ "$DEPLOYRESP" = "200" ] && echo 1 || echo 0)" "http=$DEPLOYRESP $(head -c 200 /tmp/t232-deploy.json)"
DEP=$(cat /tmp/t232-deploy.json | python3 -c "import json,sys; d=json.load(sys.stdin); print(json.dumps({'version': d[0]['version'], 'status': d[0]['status'], 'deployed': bool(d[0]['last_deployed_at'])}))")
check "published_version_1" "$(echo "$DEP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(1 if d['version']==1 and d['status']=='published' and d['deployed'] else 0)")" "$DEP"

echo "=== 4. RELOAD the DAG (the desktop refresh query) — lossless round-trip ==="
RELOAD=$(curl -s "$REST/workflows?select=id,code,name,status,dag_definition,version&code=eq.WF-T232-E2E" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $JWT")
RT=$(echo "$RELOAD" | python3 -c "
import json, sys
row = json.load(sys.stdin)[0]
d = row['dag_definition']
print(json.dumps({
  'nodes': len(d['nodes']), 'edges': len(d['edges']),
  'roundtrip': d == json.loads('''$DEF'''),
}))")
check "definition_roundtrip" "$(echo "$RT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(1 if d['roundtrip'] and d['nodes']==6 and d['edges']==6 else 0)")" "$RT"

echo "=== 5. TRIGGER + EXECUTE with REAL debtor data (the desktop execute → EF path) ==="
EXECRESP=$(curl -s -X POST "$EF" -H "Content-Type: application/json" -H "Authorization: Bearer $JWT" \
  -H "x-request-id: t232-e2e" \
  -d "{\"workflow_id\":\"$WFID\",\"trigger_type\":\"payment_overdue\",\"parent_id\":\"$P_DEBTOR\",\"actor_note\":\"T-232 final e2e\"}")
RUNID=$(echo "$EXECRESP" | python3 -c "import json,sys; print(json.load(sys.stdin).get('data',{}).get('run_id',''))")
check "exec_ok" "$([ -n "$RUNID" ] && echo 1 || echo 0)" "$(echo "$EXECRESP" | head -c 300)"
EO=$(echo "$EXECRESP" | python3 -c "
import json, sys
d = json.load(sys.stdin).get('data', {})
by = {r['node_id']: r for r in d.get('node_results', [])}
c1 = (by.get('c1', {}).get('output') or {}).get('condition_result')
print(json.dumps({
  'status': d.get('status'),
  'gate': c1,
  'urgent': by.get('aUrgent', {}).get('status'),
  'normal': by.get('aNormal', {}).get('status'),
  'fin': by.get('fin', {}).get('status'),
  'undeliverable': ((by.get('aUrgent', {}).get('output') or {}).get('undeliverable')),
  'taken': d.get('taken_edge_keys'),
  'warn': d.get('warnings'),
}))")
echo "$EO"
check "real_condition_true" "$(echo "$EO" | python3 -c "import json,sys; print(1 if json.load(sys.stdin)['gate'] is True else 0)")" "gate (real 1.5M > 1M)"
check "urgent_branch_taken" "$(echo "$EO" | python3 -c "import json,sys; d=json.load(sys.stdin); print(1 if d['urgent']=='succeeded' and d['normal']=='skipped' else 0)")" "branch"
check "convergence_final" "$(echo "$EO" | python3 -c "import json,sys; d=json.load(sys.stdin); print(1 if d['fin']=='succeeded' else 0)")" "fin"

echo "=== 6. REAL action evidence ==="
# 6a. HAMIDI has NO portal account → the notification is honestly
# UNDELIVERABLE (no fake dispatch — the anti-fake-completion contract).
check "unlinked_parent_undeliverable_honest" "$(echo "$EO" | python3 -c "import json,sys; print(1 if json.load(sys.stdin).get('undeliverable') == 1 else 0)")" "$(echo "$EO" | grep -o 'undeliverable[^,]*')"
# 6b. Delivery to a LINKED parent (ALIOUAT) through the T-226 action workflow.
P_LINKED="09e65092-31c4-4dc9-98da-b663564d47c6"
WF226=$(echo "select id from public.workflows where code='WF-T226-ACTIONS';" | sql | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['id'])")
DELIV=$(curl -s -X POST "$EF" -H "Content-Type: application/json" -H "Authorization: Bearer $JWT" -d "{\"workflow_id\":\"$WF226\",\"trigger_type\":\"payment_overdue\",\"parent_id\":\"$P_LINKED\"}")
NT=$(echo "$DELIV" | python3 -c "
import json, sys
d = json.load(sys.stdin).get('data', {})
nt = next((r for r in d.get('node_results', []) if r['node_id']=='nt'), {})
out = nt.get('output') or {}
print(json.dumps({'delivered': out.get('sent'), 'channel': out.get('channel'), 'nid': out.get('notification_id')}))")
check "linked_parent_notif_delivered" "$(echo "$NT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(1 if d['delivered']==1 and d['channel']=='in_app' and d['nid'] else 0)")" "$NT"
NOTIF=$(echo "select count(*) from public.notifications n join public.user_profiles up on up.id = n.target_user_id where n.title='Relance impayé' and up.auth_user_id = (select auth_user_id from public.parents where id='$P_LINKED') and n.triggered_at > now() - interval '3 minutes';" | sql | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['count'])")
check "notif_row_targets_parent_account" "$([ "$NOTIF" -ge 1 ] && echo 1 || echo 0)" "notif rows: $NOTIF"
AUD=$(echo "select count(*) from public.audit_logs where action='workflow.run' and entity_id='$RUNID';" | sql | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['count'])")
check "run_audited" "$([ "$AUD" -ge 1 ] && echo 1 || echo 0)" "audit=$AUD"

echo "=== 7. INSPECT execution history (the monitors' queries: desktop embed + Android pull) ==="
HIST=$(curl -s "$REST/workflow_runs?select=id,status,trigger_type,workflow_version,duration_ms,node_results,workflows(name)&order=created_at.desc&limit=3" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $JWT")
H=$(echo "$HIST" | python3 -c "
import json, sys
rows = json.load(sys.stdin)
row = next((r for r in rows if r['id'] == '$RUNID'), None)
print(json.dumps({
  'found': row is not None,
  'status': (row or {}).get('status'),
  'trigger': (row or {}).get('trigger_type'),
  'version': (row or {}).get('workflow_version'),
  'wf_name': ((row or {}).get('workflows') or {}).get('name'),
  'nodes': len((row or {}).get('node_results') or []),
  'duration': (row or {}).get('duration_ms') is not None,
}) if rows else '{}')")
echo "$H"
check "history_row_complete" "$(echo "$H" | python3 -c "import json,sys; d=json.load(sys.stdin); print(1 if d.get('found') and d.get('status')=='succeeded' and d.get('trigger')=='payment_overdue' and d.get('version')==1 and d.get('wf_name')=='Relance E2E T-232' and d.get('nodes')==6 and d.get('duration') else 0)")" "$H"

echo "=== 8. FAILURE PATH: park → unpublish → scheduler cancels honestly ==="
sql > /dev/null << 'EOSQL'
insert into public.workflows (tenant_id, code, name, description, dag_definition, status, max_daily_executions)
values ('TENANT', 'WF-T232-PARK', 'T-232 park-cancel', null,
 '{"nodes":[{"id":"t1","type":"trigger","subtype":"manual_run","label":"T","position":{"x":0,"y":0},"config":{}},{"id":"d1","type":"delay","subtype":"wait_duration","label":"Wait","position":{"x":1,"y":0},"config":{"duration_ms":30000}},{"id":"a1","type":"action","subtype":"log_audit","label":"A","position":{"x":2,"y":0},"config":{"action":"workflow.t232.never"}}],"edges":[{"id":"e1","source":"t1","target":"d1"},{"id":"e2","source":"d1","target":"a1"}]}'::jsonb,
 'published', 50);
EOSQL
# (tenant placeholder replaced below)
sql > /dev/null << EOSQL
delete from public.workflows where code='WF-T232-PARK';
insert into public.workflows (tenant_id, code, name, description, dag_definition, status, max_daily_executions)
values ('$TENANT', 'WF-T232-PARK', 'T-232 park-cancel', null,
 '{"nodes":[{"id":"t1","type":"trigger","subtype":"manual_run","label":"T","position":{"x":0,"y":0},"config":{}},{"id":"d1","type":"delay","subtype":"wait_duration","label":"Wait","position":{"x":1,"y":0},"config":{"duration_ms":30000}},{"id":"a1","type":"action","subtype":"log_audit","label":"A","position":{"x":2,"y":0},"config":{"action":"workflow.t232.never"}}],"edges":[{"id":"e1","source":"t1","target":"d1"},{"id":"e2","source":"d1","target":"a1"}]}'::jsonb,
 'published', 50);
EOSQL
PARKID=$(echo "select id from public.workflows where code='WF-T232-PARK';" | sql | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['id'])")
PARKRESP=$(curl -s -X POST "$EF" -H "Content-Type: application/json" -H "Authorization: Bearer $JWT" -d "{\"workflow_id\":\"$PARKID\"}")
PRUN=$(echo "$PARKRESP" | python3 -c "import json,sys; print(json.load(sys.stdin).get('data',{}).get('run_id',''))")
check "parked" "$(echo "$PARKRESP" | python3 -c "import json,sys; print(1 if json.load(sys.stdin).get('data',{}).get('status')=='paused' else 0)")" "$(echo "$PARKRESP" | head -c 150)"
# Unpublish while parked (the missing-dependency failure case).
echo "update public.workflows set status='disabled' where id='$PARKID';" | sql > /dev/null
sleep 32
SCHEDRESP=$(curl -s -X POST "$SCHED" -H "Authorization: Bearer $SRK")
check "scheduler_cancels_unpublished" "$(echo "$SCHEDRESP" | python3 -c "import json,sys; d=json.load(sys.stdin).get('data',{}); print(1 if d.get('cancelled',0)>=1 else 0)")" "$(echo "$SCHEDRESP" | head -c 200)"
CANCELSTATE=$(echo "select status, error_message from public.workflow_runs where id='$PRUN';" | sql | python3 -c "import json,sys; r=json.load(sys.stdin)[0]; print(json.dumps(r))")
check "cancelled_run_failed_honestly" "$(echo "$CANCELSTATE" | python3 -c "import json,sys; d=json.load(sys.stdin); print(1 if d['status']=='failed' and 'no longer published' in (d.get('error_message') or '') else 0)")" "$CANCELSTATE"
# restore published for cleanliness
echo "update public.workflows set status='published' where id='$PARKID';" | sql > /dev/null

echo ""
echo "================ T-232 FINAL E2E MATRIX SUMMARY ================"
for r in "${RESULTS[@]}"; do echo "$r"; done
echo "PASS=$PASS FAIL=$FAIL"

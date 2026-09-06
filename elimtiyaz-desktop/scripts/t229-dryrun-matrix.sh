#!/bin/bash
# T-229 DRY-RUN MATRIX — the EF's safe test-execution mode, dedicated
# verification: real entity context, real condition evaluation, simulated
# actions (zero side effects), no workflow_runs row, one audit entry, and
# PREDICTION PARITY — the dry-run's branch decisions must match the real
# execution's on the same workflow + entity.
set -euo pipefail

SUPA_URL="https://hkvkefubghbbotgnteir.supabase.co"
JWT="${SUPA_TEST_JWT:?set SUPA_TEST_JWT (a staff JWT with execute_workflow)}"
EF="$SUPA_URL/functions/v1/workflow-execute"
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
P_DEBTOR="3f9f60ec-d747-469a-a9e4-ab8252821894"   # HAMIDI — 1,507,000 outstanding
WFID=$(echo "select id from public.workflows where code='WF-T226-ACTIONS';" | sql | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['id'])")

RUNS_BEFORE=$(echo "select count(*) from public.workflow_runs where workflow_id='$WFID';" | sql | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['count'])")
NOTIF_BEFORE=$(echo "select count(*) from public.notifications where title='Relance impayé';" | sql | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['count'])")
TASKS_BEFORE=$(echo "select count(*) from public.tasks where title='Suivi recouvrement';" | sql | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['count'])")

echo "=== dry-run the full action workflow (debtor, simulated) ==="
RESP=$(curl -s -X POST "$EF" -H "Content-Type: application/json" -H "Authorization: Bearer $JWT" \
  -d "{\"workflow_id\":\"$WFID\",\"trigger_type\":\"payment_overdue\",\"parent_id\":\"$P_DEBTOR\",\"dry_run\":true}")
OUT=$(RESP_JSON="$RESP" python3 << 'PYEOF'
import json, os
d = json.loads(os.environ["RESP_JSON"]).get('data', {})
by = {r['node_id']: r for r in d.get('node_results', [])}
def out(nid, k, default=None):
    return ((by.get(nid, {}).get('output') or {}).get(k)) if by.get(nid) else default
print(json.dumps({
  'dry_run': d.get('dry_run'),
  'status': d.get('status'),
  'run_id': d.get('run_id', None),
  'nt_sim': out('nt', 'simulated'),
  'ns_sim': out('ns', 'simulated'),
  'tk_sim': out('tk', 'simulated'),
  'rs_sim': out('rs', 'simulated'),
  'wa_sim': out('wa', 'simulated'),
  'skipped': out('sk', 'skipped'),
  'taken': d.get('taken_edge_keys'),
}))
PYEOF
)
echo "$OUT"
check "dry_run_flag" "$(echo "$OUT" | python3 -c "import json,sys; print(1 if json.load(sys.stdin)['dry_run'] is True else 0)")" "flag"
check "dry_run_no_run_id" "$(echo "$OUT" | python3 -c "import json,sys; print(1 if json.load(sys.stdin)['run_id'] is None else 0)")" "returned a run id!"
check "actions_simulated" "$(echo "$OUT" | python3 -c "
import json,sys
d = json.load(sys.stdin)
sims = [d['nt_sim'], d['ns_sim'], d['tk_sim'], d['rs_sim'], d['wa_sim']]
print(1 if all(s is True for s in sims) else 0)")" "not all simulated"

sleep 2
RUNS_AFTER=$(echo "select count(*) from public.workflow_runs where workflow_id='$WFID';" | sql | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['count'])")
check "no_run_row" "$([ "$RUNS_AFTER" = "$RUNS_BEFORE" ] && echo 1 || echo 0)" "runs $RUNS_BEFORE → $RUNS_AFTER"
NOTIF_AFTER=$(echo "select count(*) from public.notifications where title='Relance impayé';" | sql | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['count'])")
check "no_notification_side_effect" "$([ "$NOTIF_AFTER" = "$NOTIF_BEFORE" ] && echo 1 || echo 0)" "notifications $NOTIF_BEFORE → $NOTIF_AFTER"
TASKS_AFTER=$(echo "select count(*) from public.tasks where title='Suivi recouvrement';" | sql | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['count'])")
check "no_task_side_effect" "$([ "$TASKS_AFTER" = "$TASKS_BEFORE" ] && echo 1 || echo 0)" "tasks $TASKS_BEFORE → $TASKS_AFTER"
FLAG=$(echo "select is_financially_restricted from public.parents where id='$P_DEBTOR';" | sql | python3 -c "import json,sys; print(str(json.load(sys.stdin)[0]['is_financially_restricted']).lower())")
check "no_restriction_side_effect" "$([ "$FLAG" = "false" ] && echo 1 || echo 0)" "parent flag=$FLAG"
DRY_AUDIT=$(echo "select count(*) from public.audit_logs where action='workflow.dry_run' and entity_id='$WFID' and created_at > now() - interval '2 minutes';" | sql | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['count'])")
check "dry_run_audited" "$([ "$DRY_AUDIT" -ge 1 ] && echo 1 || echo 0)" "audit entries: $DRY_AUDIT"

echo "=== prediction parity: dry-run vs real execution on the T-227 gate/route workflow ==="
WF227=$(echo "select id from public.workflows where code='WF-T227-CTX';" | sql | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['id'])")
DRY=$(curl -s -X POST "$EF" -H "Content-Type: application/json" -H "Authorization: Bearer $JWT" \
  -d "{\"workflow_id\":\"$WF227\",\"trigger_type\":\"payment_overdue\",\"parent_id\":\"$P_DEBTOR\",\"dry_run\":true}")
REAL=$(curl -s -X POST "$EF" -H "Content-Type: application/json" -H "Authorization: Bearer $JWT" \
  -d "{\"workflow_id\":\"$WF227\",\"trigger_type\":\"payment_overdue\",\"parent_id\":\"$P_DEBTOR\"}")
PARITY=$(DRY_JSON="$DRY" REAL_JSON="$REAL" python3 << 'PYEOF'
import json, os
dry = json.loads(os.environ["DRY_JSON"]).get('data', {})
real = json.loads(os.environ["REAL_JSON"]).get('data', {})
def verdicts(d):
    return {r['node_id']: r['status'] for r in d.get('node_results', [])}
dv, rv = verdicts(dry), verdicts(real)
same = dv == rv
print(json.dumps({'parity': same, 'dry_status': dry.get('status'), 'real_status': real.get('status'),
                  'dry_gate': ((dry.get('node_results') or [{}])[1].get('output') or {}).get('condition_result') if len(dry.get('node_results', [])) > 1 else None}))
PYEOF
)
echo "$PARITY"
check "prediction_parity" "$(echo "$PARITY" | python3 -c "import json,sys; print(1 if json.load(sys.stdin)['parity'] else 0)")" "$PARITY"
check "same_final_status" "$(echo "$PARITY" | python3 -c "import json,sys; d=json.load(sys.stdin); print(1 if d['dry_status']=='succeeded' and d['real_status']=='succeeded' else 0)")" "$PARITY"

echo ""
echo "================ T-229 DRY-RUN MATRIX SUMMARY ================"
for r in "${RESULTS[@]}"; do echo "$r"; done
echo "PASS=$PASS FAIL=$FAIL"

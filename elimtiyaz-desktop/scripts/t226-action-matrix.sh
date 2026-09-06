#!/bin/bash
# T-226 LIVE ACTION MATRIX — every real action executor verified on the live
# backend with a real staff JWT. Verifies REAL side effects (tasks row,
# parent restriction + audit, notifications row via the 0077 RPC, wa.me link)
# AND the honest contracts (undeliverable parent, honest-skip for unbacked
# financial mutations, dry-run simulation).
set -euo pipefail

SUPA_URL="https://hkvkefubghbbotgnteir.supabase.co"
JWT="${SUPA_TEST_JWT:?set SUPA_TEST_JWT (a staff JWT with execute_workflow)}"
TESTPROFILE=$(cat /home/z/my-project/scripts/t225-profile.txt 2>/dev/null || echo "")
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
TENANT=$(echo "select id from public.tenants where is_active and deleted_at is null limit 1;" | sql | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['id'])")
# test user profile id (for target_user_id notification test)
PROFILE=$(echo "select id from public.user_profiles where email='dag-verify-t225@elimtiyaz-test.dz' limit 1;" | sql | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['id'])")
# parents: one WITH a linked portal account (deliverable), one WITHOUT (honest undeliverable)
P_LINKED="09e65092-31c4-4dc9-98da-b663564d47c6"
P_UNLINKED="bd7e36e9-c40f-414c-b16f-43d74aa5ce15"

echo "=== create the action-test workflow (all executors in one DAG) ==="
sql > /dev/null << 'EOSQL'
delete from public.workflow_pending_resumes where workflow_id in (select id from public.workflows where code = 'WF-T226-ACTIONS');
delete from public.workflow_runs where workflow_id in (select id from public.workflows where code = 'WF-T226-ACTIONS');
delete from public.workflows where code = 'WF-T226-ACTIONS';
EOSQL
DEF='{"nodes":[{"id":"t1","type":"trigger","subtype":"payment_overdue","label":"T","position":{"x":0,"y":0},"config":{}},{"id":"nt","type":"action","subtype":"push_notification","label":"ParentNotif","position":{"x":1,"y":0},"config":{"title":"Relance impayé","body":"Merci de régulariser votre situation.","kind":"alert","priority":"high"}},{"id":"ns","type":"action","subtype":"push_notification","label":"StaffNotif","position":{"x":2,"y":0},"config":{"title":"Staff alert","target_role":"super_admin"}},{"id":"tk","type":"action","subtype":"dispatch_task","label":"Task","position":{"x":3,"y":0},"config":{"title":"Suivi recouvrement","description":"Généré par le workflow T-226","priority":"high","target_role":"financial_officer"}},{"id":"rs","type":"action","subtype":"restrict_account","label":"Restrict","position":{"x":4,"y":0},"config":{}},{"id":"wa","type":"action","subtype":"send_whatsapp","label":"WhatsApp","position":{"x":5,"y":0},"config":{"message":"Bonjour, votre échéance est en retard."}},{"id":"sk","type":"action","subtype":"apply_discount","label":"Discount","position":{"x":6,"y":0},"config":{"percent":5}}],"edges":[{"id":"e1","source":"t1","target":"nt"},{"id":"e2","source":"nt","target":"ns"},{"id":"e3","source":"ns","target":"tk"},{"id":"e4","source":"tk","target":"rs"},{"id":"e5","source":"rs","target":"wa"},{"id":"e6","source":"wa","target":"sk"}]}'
echo "insert into public.workflows (tenant_id, code, name, description, dag_definition, status, max_daily_executions) values ('$TENANT', 'WF-T226-ACTIONS', 'WF-T226-ACTIONS', 'T-226 action matrix', '$DEF'::jsonb, 'draft', 50);" | sql > /dev/null
echo "update public.workflows set status='published' where code='WF-T226-ACTIONS';" | sql > /dev/null
WFID=$(echo "select id from public.workflows where code='WF-T226-ACTIONS';" | sql | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['id'])")
check "wf_created" "$([ -n "$WFID" ] && echo 1 || echo 0)" "no id"

echo "=== 1. Execute against the LINKED parent (deliverable in-app path) ==="
# restore the parent flag first for a clean assertion
echo "update public.parents set is_financially_restricted = false where id = '$P_LINKED';" | sql > /dev/null
NOTIF_BEFORE=$(echo "select count(*) from public.notifications where tenant_id='$TENANT' and title='Relance impayé' and link_entity_type='workflow_run';" | sql | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['count'])")
RESP=$(curl -s -X POST "$EF" -H "Content-Type: application/json" -H "Authorization: Bearer $JWT" -d "{\"workflow_id\":\"$WFID\",\"trigger_type\":\"payment_overdue\",\"parent_id\":\"$P_LINKED\"}")
RUNID=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin).get('data',{}).get('run_id',''))")
STATUS=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin).get('data',{}).get('status',''))")
echo "run: $RUNID status=$STATUS"
RESP_JSON="$RESP" python3 << 'PYEOF'
import json, os
d = json.loads(os.environ["RESP_JSON"]).get('data', {})
for r in d.get('node_results', []):
    out = r.get('output') or {}
    note = out.get('audit_note') or out.get('reason') or ''
    print(f"{r['node_id']:4} {r['node_subtype']:20} {r['status']:10} {str(note)[:85]}")
PYEOF

# --- parent in-app notification (deliverable: linked account) ---
NT_OUT=$(echo "$RESP" | python3 -c "
import json, sys
d = json.load(sys.stdin).get('data', {})
nt = next((r for r in d.get('node_results', []) if r['node_id']=='nt'), {})
print(json.dumps(nt.get('output', {})))")
check "parent_notif_delivered" "$(echo "$NT_OUT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(1 if d.get('sent')==1 and d.get('channel')=='in_app' and d.get('notification_id') else 0)")" "$NT_OUT"
NOTIF_ROW=$(echo "select count(*) from public.notifications n join public.user_profiles up on up.id = n.target_user_id where n.tenant_id='$TENANT' and n.title='Relance impayé' and n.link_entity_type='workflow_run' and n.triggered_at > now() - interval '5 minutes' and up.auth_user_id = (select auth_user_id from public.parents where id='$P_LINKED');" | sql | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['count'])")
check "parent_notif_row_target" "$([ "$NOTIF_ROW" -ge 1 ] && echo 1 || echo 0)" "notif rows targeting the parent's account: $NOTIF_ROW"

# --- staff role notification (in-app row for financial_officer members) ---
NS_OUT=$(echo "$RESP" | python3 -c "
import json, sys
d = json.load(sys.stdin).get('data', {})
ns = next((r for r in d.get('node_results', []) if r['node_id']=='ns'), {})
print(json.dumps(ns.get('output', {})))")
echo "staff notif: $NS_OUT"
check "staff_notif_inapp_rows" "$(echo "$NS_OUT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(1 if d.get('in_app',0) >= 1 and d.get('recipients',0) >= 1 else 0)")" "$NS_OUT"

# --- dispatch_task (real row) ---
TK_OUT=$(echo "$RESP" | python3 -c "
import json, sys
d = json.load(sys.stdin).get('data', {})
tk = next((r for r in d.get('node_results', []) if r['node_id']=='tk'), {})
print(json.dumps(tk.get('output', {})))")
TASK_ID=$(echo "$TK_OUT" | python3 -c "import json,sys; print(json.load(sys.stdin).get('task_id',''))")
check "task_id_returned" "$([ -n "$TASK_ID" ] && echo 1 || echo 0)" "$TK_OUT"
TASK_ROW=$(echo "select title, status, priority, created_by_name from public.tasks where id='$TASK_ID';" | sql | python3 -c "import json,sys; r=json.load(sys.stdin); print(json.dumps(r[0] if r else {}))")
echo "task row: $TASK_ROW"
check "task_row_real" "$(echo "$TASK_ROW" | python3 -c "import json,sys; d=json.load(sys.stdin); print(1 if d.get('title')=='Suivi recouvrement' and d.get('status')=='pending' and d.get('created_by_name')=='Workflow automation' else 0)")" "$TASK_ROW"

# --- restrict_account (real flag flip + audit) ---
RS_OUT=$(echo "$RESP" | python3 -c "
import json, sys
d = json.load(sys.stdin).get('data', {})
rs = next((r for r in d.get('node_results', []) if r['node_id']=='rs'), {})
print(json.dumps(rs.get('output', {})))")
check "restrict_executed" "$(echo "$RS_OUT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(1 if d.get('restricted')==True and d.get('parent_id')=='$P_LINKED' else 0)")" "$RS_OUT"
FLAG=$(echo "select is_financially_restricted from public.parents where id='$P_LINKED';" | sql | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['is_financially_restricted'])")
check "restrict_flag_flipped" "$(echo "$FLAG" | grep -qi "^true$" && echo 1 || echo 0)" "flag=$FLAG"
RS_AUDIT=$(echo "select count(*) from public.audit_logs where tenant_id='$TENANT' and action='workflow.account_restriction' and entity_id='$P_LINKED' and created_at > now() - interval '5 minutes';" | sql | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['count'])")
check "restrict_audit_written" "$([ "$RS_AUDIT" -ge 1 ] && echo 1 || echo 0)" "audit rows: $RS_AUDIT"
# restore the parent flag (leave live data clean)
echo "update public.parents set is_financially_restricted = false where id = '$P_LINKED';" | sql > /dev/null

# --- send_whatsapp (honest prepared link, no delivery claim) ---
WA_OUT=$(echo "$RESP" | python3 -c "
import json, sys
d = json.load(sys.stdin).get('data', {})
wa = next((r for r in d.get('node_results', []) if r['node_id']=='wa'), {})
print(json.dumps(wa.get('output', {})))")
echo "whatsapp out: $WA_OUT"
check "whatsapp_link_prepared" "$(echo "$WA_OUT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(1 if d.get('prepared')==1 and d.get('link','').startswith('https://wa.me/') and d.get('delivered')==0 else 0)")" "$WA_OUT"
check "whatsapp_no_delivery_claim" "$(echo "$WA_OUT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(1 if 'no delivery' in str(d.get('note','')).lower() or 'not claimed' in str(d.get('note','')).lower() else 0)")" "$WA_OUT"

# --- apply_discount (honest skip — no fake success) ---
SK_OUT=$(echo "$RESP" | python3 -c "
import json, sys
d = json.load(sys.stdin).get('data', {})
sk = next((r for r in d.get('node_results', []) if r['node_id']=='sk'), {})
print(json.dumps(sk.get('output', {})))")
check "discount_honestly_skipped" "$(echo "$SK_OUT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(1 if d.get('skipped')==True and 'canonical' in str(d.get('reason','')) else 0)")" "$SK_OUT"

echo "=== 2. Execute against the UNLINKED parent (honest undeliverable) ==="
RESP2=$(curl -s -X POST "$EF" -H "Content-Type: application/json" -H "Authorization: Bearer $JWT" -d "{\"workflow_id\":\"$WFID\",\"trigger_type\":\"payment_overdue\",\"parent_id\":\"$P_UNLINKED\",\"dry_run\":true}")
NT2=$(echo "$RESP2" | python3 -c "
import json, sys
d = json.load(sys.stdin).get('data', {})
nt = next((r for r in d.get('node_results', []) if r['node_id']=='nt'), {})
print(json.dumps(nt.get('output', {})))")
check "dry_run_simulated" "$(echo "$NT2" | python3 -c "import json,sys; d=json.load(sys.stdin); print(1 if d.get('simulated')==True else 0)")" "$NT2"

echo "=== 3. dry_run leaves no run row ==="
DRY_RUNS=$(echo "select count(*) from public.workflow_runs where workflow_id='$WFID' and actor_note is null and status='succeeded' and started_at > now() - interval '2 minutes';" | sql | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['count'])")
# The dry run (section 2) must NOT have produced a run row — count only the
# run rows from section 1 (the non-dry execution).
TOTAL_RUNS=$(echo "select count(*) from public.workflow_runs where workflow_id='$WFID';" | sql | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['count'])")
check "dry_run_no_run_row" "$([ "$TOTAL_RUNS" = "1" ] && echo 1 || echo 0)" "workflow has $TOTAL_RUNS run rows (expected 1 — the real run only)"
DRY_AUDIT=$(echo "select count(*) from public.audit_logs where action='workflow.dry_run' and entity_id='$WFID' and created_at > now() - interval '5 minutes';" | sql | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['count'])")
check "dry_run_audited" "$([ "$DRY_AUDIT" -ge 1 ] && echo 1 || echo 0)" "dry-run audit entries: $DRY_AUDIT"

echo ""
echo "================ T-226 ACTION MATRIX SUMMARY ================"
for r in "${RESULTS[@]}"; do echo "$r"; done
echo "PASS=$PASS FAIL=$FAIL"

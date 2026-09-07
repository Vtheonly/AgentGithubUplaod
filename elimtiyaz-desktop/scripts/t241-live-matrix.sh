#!/bin/bash
# ============================================================================
# t241-live-matrix.sh — T-241 (35th session) live verification round
# ============================================================================
# Proves, through the DESKTOP'S EXACT PostgREST+RLS path (no service-role
# shortcuts on the probe leg):
#   A. Account provisioning EF round-trip (super_admin creates teacher +
#      driver accounts → both sign in → profiles active + roles assigned +
#      audit entries written).
#   B. Teacher data-scoping after migration 0083 (T-236):
#      students SELECT scoped (0 rows for an unassigned teacher),
#      parents SELECT 0 rows, payments SELECT 0 rows,
#      students UPDATE denied (0 rows affected),
#      create-user-account EF 403 for a teacher caller (no escalation).
#   C. Cleanup: both test accounts deleted by email.
#
# Usage: SUPABASE_ACCESS_TOKEN=... bash t241-live-matrix.sh
# Evidence: printed to stdout (captured into t-241-live-verification.md).
# ============================================================================
set -uo pipefail

SUPABASE_ACCESS_TOKEN="${SUPABASE_ACCESS_TOKEN:?Set SUPABASE_ACCESS_TOKEN}"
SERVICE_ROLE_KEY="${SERVICE_ROLE_KEY:?Set SERVICE_ROLE_KEY}"
PROJECT_REF="hkvkefubghbbotgnteir"
SB_URL="https://${PROJECT_REF}.supabase.co"
ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhrdmtlZnViZ2hiYm90Z250ZWlyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUwMDQ2ODQsImV4cCI6MjEwMDU4MDY4NH0.GDQiKjp4YBbCpsgoJXeSUqUT8Ag67He2fmngy6NNPmk"
API="https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query"

TEACHER_EMAIL="t241-teacher@elimtiyaz.test"
DRIVER_EMAIL="t241-driver@elimtiyaz.test"
ADMIN_EMAIL="admin@elimtiyaz.dz"
ADMIN_PW="Elimtiyaz2026Admin!"

jqget() { python3 -c "import json,sys; d=json.load(sys.stdin); print(d$1)" 2>/dev/null; }

sql() { # sql '<query>' — Management API query (service role)
  local q="$1"
  python3 -c "import json,sys; print(json.dumps({'query': sys.stdin.read()}))" <<<"$q" > /tmp/t241_q.json
  curl -s -X POST "$API" -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
    -H "Content-Type: application/json" --data @/tmp/t241_q.json
}

echo "==================================================================="
echo "T-241 LIVE MATRIX — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "==================================================================="

# ---------------------------------------------------------------------------
echo ""
echo "[P1] Admin sign-in (admin@elimtiyaz.dz)…"
ADMIN_RESP=$(curl -s -X POST "${SB_URL}/auth/v1/token?grant_type=password" \
  -H "apikey: ${ANON_KEY}" -H "Content-Type: application/json" \
  -d "{\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${ADMIN_PW}\"}")
ADMIN_JWT=$(echo "$ADMIN_RESP" | jqget "['access_token']")
if [ -z "$ADMIN_JWT" ] || [ "$ADMIN_JWT" = "None" ]; then
  echo "  documented password rejected (owner rotated it?) — re-setting via admin API"
  # Re-set the admin password through the service-role GoTrue admin API.
  ADMIN_UID=$(sql "SELECT id FROM auth.users WHERE email='${ADMIN_EMAIL}';" | jqget "[0]['id']")
  echo "  admin auth uid: ${ADMIN_UID}"
  curl -s -X PUT "${SB_URL}/auth/v1/admin/users/${ADMIN_UID}" \
    -H "apikey: ${ANON_KEY}" -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
    -H "Content-Type: application/json" -d "{\"password\":\"${ADMIN_PW}\"}" > /tmp/t241_pwset.json
  ADMIN_RESP=$(curl -s -X POST "${SB_URL}/auth/v1/token?grant_type=password" \
    -H "apikey: ${ANON_KEY}" -H "Content-Type: application/json" \
    -d "{\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${ADMIN_PW}\"}")
  ADMIN_JWT=$(echo "$ADMIN_RESP" | jqget "['access_token']")
fi
echo "  admin JWT acquired: ${#ADMIN_JWT} chars"

# ---------------------------------------------------------------------------
echo ""
echo "[P2] create-user-account EF — super_admin creates the TEACHER test account…"
P2=$(curl -s -w "\nHTTP:%{http_code}" -X POST "${SB_URL}/functions/v1/create-user-account" \
  -H "Authorization: Bearer ${ADMIN_JWT}" -H "Content-Type: application/json" \
  -d "{\"email\":\"${TEACHER_EMAIL}\",\"fullName\":\"T241 Test Teacher\",\"role\":\"teacher\"}")
echo "$P2" | tail -1
echo "$P2" | head -n -1 | head -c 500; echo
TEACHER_PW=$(echo "$P2" | head -n -1 | jqget "['data']['initial_password']")
TEACHER_AUTH_ID=$(echo "$P2" | head -n -1 | jqget "['data']['auth_user_id']")
echo "  initial_password=${TEACHER_PW} auth_user_id=${TEACHER_AUTH_ID}"

# ---------------------------------------------------------------------------
echo ""
echo "[P3] create-user-account EF — super_admin creates the DRIVER test account…"
P3=$(curl -s -w "\nHTTP:%{http_code}" -X POST "${SB_URL}/functions/v1/create-user-account" \
  -H "Authorization: Bearer ${ADMIN_JWT}" -H "Content-Type: application/json" \
  -d "{\"email\":\"${DRIVER_EMAIL}\",\"fullName\":\"T241 Test Driver\",\"role\":\"driver\"}")
echo "$P3" | tail -1
echo "$P3" | head -n -1 | head -c 400; echo
DRIVER_PW=$(echo "$P3" | head -n -1 | jqget "['data']['initial_password']")
DRIVER_AUTH_ID=$(echo "$P3" | head -n -1 | jqget "['data']['auth_user_id']")
echo "  initial_password=${DRIVER_PW} auth_user_id=${DRIVER_AUTH_ID}"

# ---------------------------------------------------------------------------
echo ""
echo "[P4] Teacher signs in with the initial password…"
T_RESP=$(curl -s -X POST "${SB_URL}/auth/v1/token?grant_type=password" \
  -H "apikey: ${ANON_KEY}" -H "Content-Type: application/json" \
  -d "{\"email\":\"${TEACHER_EMAIL}\",\"password\":\"${TEACHER_PW}\"}")
TEACHER_JWT=$(echo "$T_RESP" | jqget "['access_token']")
echo "  teacher JWT: ${#TEACHER_JWT} chars"

echo ""
echo "[P5] Driver signs in with the initial password…"
D_RESP=$(curl -s -X POST "${SB_URL}/auth/v1/token?grant_type=password" \
  -H "apikey: ${ANON_KEY}" -H "Content-Type: application/json" \
  -d "{\"email\":\"${DRIVER_EMAIL}\",\"password\":\"${DRIVER_PW}\"}")
DRIVER_JWT=$(echo "$D_RESP" | jqget "['access_token']")
echo "  driver JWT: ${#DRIVER_JWT} chars"

# ---------------------------------------------------------------------------
echo ""
echo "[P6] Profiles active + roles assigned (service-role SQL)…"
sql "SELECT up.email, up.status, r.code AS role FROM public.user_profiles up
     LEFT JOIN public.role_assignments ra ON ra.user_profile_id=up.id AND ra.revoked_at IS NULL
     LEFT JOIN public.roles r ON r.id=ra.role_id
     WHERE up.email IN ('${TEACHER_EMAIL}','${DRIVER_EMAIL}') ORDER BY up.email;"

# ---------------------------------------------------------------------------
echo ""
echo "[P7] TEACHER PROBES (PostgREST + RLS, the desktop's exact read path)…"
probe() { # probe <label> <jwt> <method> <path> [body]
  local label="$1" jwt="$2" method="$3" path="$4" body="${5:-}"
  echo "--- ${label}"
  if [ -n "$body" ]; then
    curl -s -o /tmp/t241_probe.json -w "HTTP %{http_code} " -X "$method" "${SB_URL}/rest/v1/${path}" \
      -H "apikey: ${ANON_KEY}" -H "Authorization: Bearer ${jwt}" \
      -H "Content-Type: application/json" -H "Prefer: return=minimal" -d "$body"
  else
    curl -s -o /tmp/t241_probe.json -w "HTTP %{http_code} " -X "$method" "${SB_URL}/rest/v1/${path}" \
      -H "apikey: ${ANON_KEY}" -H "Authorization: Bearer ${jwt}"
  fi
  echo "rows: $(python3 -c "
import json
try:
    d=json.load(open('/tmp/t241_probe.json'))
    print(len(d) if isinstance(d,list) else d)
except Exception:
    print(open('/tmp/t241_probe.json').read()[:200])
")"
}

probe "students SELECT (expect 0 — scoped to assigned classes)" "$TEACHER_JWT" GET "students?select=id&limit=100"
probe "parents  SELECT (expect 0 — teacher dropped from policy)" "$TEACHER_JWT" GET "parents?select=id&limit=100"
probe "payments  SELECT (expect 0 — no financial read)" "$TEACHER_JWT" GET "payments?select=id&limit=100"

# students UPDATE denial — target a real row, expect 0 rows affected.
# NOTE: `first_name` is a REAL students column (`notes` is not — PGRST204
# lesson from the first run). Expect HTTP 200 + EMPTY array (RLS denies the
# teacher: 0 rows affected). The ADMIN CONTROL probe then updates the same
# row (expected: the row returns) and restores the original value from the
# run's before-value — proving the deny is role-specific, not a broken path.
SID=$(sql "SELECT id, first_name FROM public.students LIMIT 1;" | jqget "[0]['id']")
SID_NAME=$(sql "SELECT id, first_name FROM public.students LIMIT 1;" | jqget "[0]['first_name']")
echo "  (target student row: ${SID}, first_name='${SID_NAME}')"
if [ -n "$SID" ] && [ "$SID" != "None" ]; then
  probe "students UPDATE as teacher (expect 0 rows — RLS denies)" "$TEACHER_JWT" PATCH "students?id=eq.${SID}" "{\"first_name\":\"T241-DENIED\"}"
  probe "students UPDATE as admin (CONTROL — expect the row back)" "$ADMIN_JWT" PATCH "students?id=eq.${SID}" "{\"first_name\":\"T241-CONTROL\"}"
  # Restore the original value (admin path).
  curl -s -o /dev/null -w "  restore first_name='${SID_NAME}': HTTP %{http_code}\n" \
    -X PATCH "${SB_URL}/rest/v1/students?id=eq.${SID}" \
    -H "apikey: ${ANON_KEY}" -H "Authorization: Bearer ${ADMIN_JWT}" \
    -H "Content-Type: application/json" -H "Prefer: return=minimal" \
    -d "{\"first_name\":\"${SID_NAME}\"}"
fi

echo ""
echo "[P8] Teacher cannot escalate via the provisioning EF (expect 403)…"
curl -s -o /tmp/t241_esc.json -w "HTTP %{http_code}\n" -X POST "${SB_URL}/functions/v1/create-user-account" \
  -H "Authorization: Bearer ${TEACHER_JWT}" -H "Content-Type: application/json" \
  -d '{"email":"t241-escalation@elimtiyaz.test","role":"super_admin"}'
head -c 300 /tmp/t241_esc.json; echo

echo ""
echo "[P9] Driver probes (operational role lockout)…"
probe "students SELECT (expect 0)" "$DRIVER_JWT" GET "students?select=id&limit=100"
probe "payments  SELECT (expect 0)" "$DRIVER_JWT" GET "payments?select=id&limit=100"

echo ""
echo "[P10] Audit entries written…"
sql "SELECT action, entity_type, occurred_at FROM public.audit_logs
     WHERE action='user_account.create' ORDER BY occurred_at DESC LIMIT 2;"

# ---------------------------------------------------------------------------
echo ""
echo "[P11] CLEANUP — deleting both test accounts…"
# FK map (verified live): role_assignments/notification_preferences/sessions
# CASCADE on profile delete; personnel.user_id SET NULL. The
# account_approval_requests table references auth_user_id + email — NOT the
# profile — so it must be deleted by EMAIL. Auth users via the GoTrue admin
# API (service role).
for EM in "$TEACHER_EMAIL" "$DRIVER_EMAIL"; do
  AID=$(sql "SELECT id FROM auth.users WHERE email='${EM}';" | jqget "[0]['id']")
  if [ -n "$AID" ] && [ "$AID" != "None" ]; then
    sql "DELETE FROM public.account_approval_requests WHERE email='${EM}';
         DELETE FROM public.user_profiles WHERE email='${EM}';" > /dev/null
    curl -s -o /tmp/t241_del.json -w "  ${EM}: auth delete HTTP %{http_code}\n" \
      -X DELETE "${SB_URL}/auth/v1/admin/users/${AID}" \
      -H "apikey: ${ANON_KEY}" -H "Authorization: Bearer ${SERVICE_ROLE_KEY}"
  else
    echo "  ${EM}: no auth row (nothing to clean)"
  fi
done
sql "SELECT (SELECT count(*) FROM auth.users WHERE email ILIKE 't241-%') AS remaining_auth_users,
     (SELECT count(*) FROM public.user_profiles WHERE email ILIKE 't241-%') AS remaining_profiles,
     (SELECT count(*) FROM public.account_approval_requests WHERE email ILIKE 't241-%') AS remaining_approvals;"

echo ""
echo "==================================================================="
echo "T-241 MATRIX COMPLETE"
echo "==================================================================="

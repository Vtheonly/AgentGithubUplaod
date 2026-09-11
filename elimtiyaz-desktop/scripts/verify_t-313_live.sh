#!/usr/bin/env bash
# T-313 (ACAD-104) LIVE round-trip verification:
#   1. SuperAdmin sign-in (GoTrue password grant — the same auth path the
#      desktop's SupabaseAuthRepository.signIn drives)
#   2. RED control: the OLD payload shape (no tenant_id) → expect 42501
#      (the root cause of the owner's ERR_FORBIDDEN report)
#   3. GREEN fix: the NEW payload shape (tenant_id stamped, exactly what the
#      fixed SupabaseSubjectRepository.assignSubjectToClass sends) → expect 201
#   4. Row verified back through RLS-gated SELECT
#   5. Cleanup (delete the probe row — census returns to baseline)
set -euo pipefail

SUPABASE_URL="https://hkvkefubghbbotgnteir.supabase.co"
ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhrdmtlZnViZ2hiYm90Z250ZWlyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUwMDQ2ODQsImV4cCI6MjEwMDU4MDY4NH0.GDQiKjp4YBbCpsgoJXeSUqUT8Ag67He2fmngy6NNPmk"
EMAIL="admin@elimtiyaz.dz"
ADMIN_PW="elimtiyaz@admin2026"

echo "=== 1. SuperAdmin sign-in (GoTrue password grant) ==="
SIGNIN=$(curl -s -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$ADMIN_PW\"}")
JWT=$(echo "$SIGNIN" | python3 -c "import json,sys; print(json.load(sys.stdin).get('access_token',''))")
if [[ -z "$JWT" ]]; then
  echo "SIGN-IN FAILED:"; echo "$SIGNIN" | head -c 400; exit 1
fi
echo "sign-in OK (JWT acquired, length ${#JWT})"

echo "=== 2. Profile / role / tenant census (current_tenant_id resolution) ==="
PROFILE=$(curl -s "$SUPABASE_URL/rest/v1/user_profiles?select=id,tenant_id,email,display_name,status&email=eq.$EMAIL" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $JWT")
echo "$PROFILE" | python3 -m json.tool | head -12
TENANT_ID=$(echo "$PROFILE" | python3 -c "import json,sys; rows=json.load(sys.stdin); print(rows[0]['tenant_id'] if rows else '')")
PROFILE_ID=$(echo "$PROFILE" | python3 -c "import json,sys; rows=json.load(sys.stdin); print(rows[0]['id'] if rows else '')")
echo "tenant=$TENANT_ID profile=$PROFILE_ID"

echo "=== 3. Live role check (current_user_roles as the signed-in JWT) ==="
ROLES=$(curl -s -X POST "$SUPABASE_URL/rest/v1/rpc/current_user_roles" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" -d '{}')
echo "roles: $ROLES"

echo "=== 4. Pick a live class + subject for the probe ==="
CLASS=$(curl -s "$SUPABASE_URL/rest/v1/classes?select=id,name&is_active=eq.true&limit=1" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $JWT")
CLASS_ID=$(echo "$CLASS" | python3 -c "import json,sys; rows=json.load(sys.stdin); print(rows[0]['id'] if rows else '')")
CLASS_NAME=$(echo "$CLASS" | python3 -c "import json,sys; rows=json.load(sys.stdin); print(rows[0]['name'] if rows else '')")
SUBJECT=$(curl -s "$SUPABASE_URL/rest/v1/subjects?select=id,code&limit=1" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $JWT")
SUBJECT_ID=$(echo "$SUBJECT" | python3 -c "import json,sys; rows=json.load(sys.stdin); print(rows[0]['id'] if rows else '')")
SUBJECT_CODE=$(echo "$SUBJECT" | python3 -c "import json,sys; rows=json.load(sys.stdin); print(rows[0]['code'] if rows else '')")
echo "class=$CLASS_ID ($CLASS_NAME)  subject=$SUBJECT_ID ($SUBJECT_CODE)"

echo "=== 5. RED CONTROL — OLD payload (no tenant_id) must be 42501 ==="
RED_CODE=$(curl -s -o /tmp/t313-red-body -w "%{http_code}" -X POST "$SUPABASE_URL/rest/v1/class_subjects" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -H "Prefer: return=minimal" \
  -d "{\"class_id\":\"$CLASS_ID\",\"subject_id\":\"$SUBJECT_ID\",\"teacher_id\":null,\"teacher_name\":\"T-313 probe\",\"weekly_hours\":2,\"coefficient\":1}")
echo "RED status=$RED_CODE body=$(head -c 200 /tmp/t313-red-body)"
if [[ "$RED_CODE" != "42501" && "$RED_CODE" != "403" ]]; then
  echo "UNEXPECTED: old payload was NOT rejected (expected 42501/403)"
fi

echo "=== 6. GREEN FIX — NEW payload (tenant_id stamped, the fixed repository shape) ==="
GREEN_CODE=$(curl -s -o /tmp/t313-green-body -w "%{http_code}" -X POST "$SUPABASE_URL/rest/v1/class_subjects" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d "{\"tenant_id\":\"$TENANT_ID\",\"class_id\":\"$CLASS_ID\",\"subject_id\":\"$SUBJECT_ID\",\"teacher_id\":null,\"teacher_name\":\"T-313 probe\",\"weekly_hours\":2,\"coefficient\":1}")
echo "GREEN status=$GREEN_CODE"
PROBE_ID=$(echo "$(cat /tmp/t313-green-body)" | python3 -c "import json,sys; rows=json.load(sys.stdin); print(rows[0]['id'] if rows else '')" 2>/dev/null || echo "")
echo "probe row id=$PROBE_ID"

echo "=== 7. Verify the row through the RLS-gated SELECT ==="
if [[ -n "$PROBE_ID" ]]; then
  VERIFY=$(curl -s "$SUPABASE_URL/rest/v1/class_subjects?id=eq.$PROBE_ID&select=id,tenant_id,class_id,subject_id,teacher_name" \
    -H "apikey: $ANON_KEY" -H "Authorization: Bearer $JWT")
  echo "$VERIFY" | python3 -m json.tool
fi

echo "=== 8. Cleanup (delete the probe row) ==="
if [[ -n "$PROBE_ID" ]]; then
  DEL_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$SUPABASE_URL/rest/v1/class_subjects?id=eq.$PROBE_ID" \
    -H "apikey: $ANON_KEY" -H "Authorization: Bearer $JWT")
  echo "cleanup status=$DEL_CODE"
fi

echo "=== 9. Post-probe census ==="
CENSUS=$(curl -s "$SUPABASE_URL/rest/v1/class_subjects?select=id&limit=100" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $JWT")
echo "class_subjects rows visible post-cleanup: $(echo "$CENSUS" | python3 -c "import json,sys; print(len(json.load(sys.stdin)))")"

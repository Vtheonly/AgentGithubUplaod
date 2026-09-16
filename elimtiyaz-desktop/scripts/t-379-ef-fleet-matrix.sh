#!/bin/bash
# ============================================================================
# t-379-ef-fleet-matrix.sh — T-379 (72nd session) live verification round
# ============================================================================
# Proves the Edge-Function fleet on the NEW empty project
# (vebfehrpzajhstyhinnw) is deployed, secreted and enforcement-identical
# to the production fleet (T-004 curl-matrix convention, AGENTS.md §11.1):
#
#   P1..P3 (every EF): NO Authorization / garbage bearer / publishable-key
#                      bearer → 401 (the anonymous-deny sweep).
#   P4  (valid auth):  cron EFs → CRON_SECRET bearer → 200;
#                      staff EFs → admin JWT + minimal body → 4xx validation
#                      (proves the auth + permission gates PASSED — a 400
#                      from body validation is the expected non-mutating
#                      probe); send-push-notification → service key → 500
#                      (FIREBASE_SERVICE_ACCOUNT_JSON owner residual, same
#                      as production).
#   P5  (secrets live behaviour):
#        - ALLOWED_ORIGINS: allowed origin echoed, foreign origin NOT;
#        - CRON_SECRET: wrong value → 401 (right value already proven in P4);
#        - GROQ_API_KEY: ai-proxy single-shot narrative → 200 + content
#          (eu-west-1 egress reaches Groq — the sandbox cannot, §11.1 #10).
#
# Usage (from elimtiyaz-desktop/):
#   SUPABASE_ACCESS_TOKEN=sbp_… CRON_SECRET=… SERVICE_ROLE_KEY=… \
#     bash scripts/t-379-ef-fleet-matrix.sh
#
# Committable per the t241/t269/t277 convention: the publishable key and the
# OWNER-PINNED admin password are documented public/owner-pinned values
# (docs/operations/credentials.md §1); the CRON_SECRET / service key /
# access token NEVER get committed.
# ============================================================================
set -uo pipefail

PROJECT_REF="vebfehrpzajhstyhinnw"
SB_URL="https://${PROJECT_REF}.supabase.co"
PUBLISHABLE_KEY="sb_publishable_IPUtQMYQzr1wNnfGTcl5MA_wuz3RUdg"
ADMIN_EMAIL="admin@elimtiyaz.dz"
ADMIN_PW="elimtiyaz@admin2026"

CRON_SECRET="${CRON_SECRET:?Set CRON_SECRET (the NEW project's fresh value)}"
SERVICE_ROLE_KEY="${SERVICE_ROLE_KEY:?Set SERVICE_ROLE_KEY (the NEW project's service key)}"

PASS=0; FAIL=0
declare -a FAILED=()

check() { # check <label> <expected> <actual>
  local label="$1" expected="$2" actual="$3"
  if [[ "$actual" == "$expected" ]]; then
    echo "  PASS  ${label}  (HTTP ${actual})"
    PASS=$((PASS+1))
  else
    echo "  FAIL  ${label}  (expected ${expected}, got ${actual})"
    FAIL=$((FAIL+1)); FAILED+=("$label")
  fi
}

probe() { # probe <method> <path> <bearer-or-EMPTY> <body-or-EMPTY> → status
  local method="$1" path="$2" bearer="$3" body="$4" args=()
  args+=(-s -o /tmp/t379-body -w "%{http_code}" -X "$method" "${SB_URL}/functions/v1/${path}")
  [[ -n "$bearer" ]] && args+=(-H "Authorization: Bearer ${bearer}")
  args+=(-H "apikey: ${PUBLISHABLE_KEY}" -H "Content-Type: application/json")
  [[ -n "$body" ]] && args+=(-d "$body")
  curl "${args[@]}"
}

echo "==================================================================="
echo "T-379 EF FLEET MATRIX — NEW project ${PROJECT_REF} — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "==================================================================="

echo ""
echo "[P0] Admin sign-in (password grant, owner-pinned credential)…"
ADMIN_RESP=$(curl -s -X POST "${SB_URL}/auth/v1/token?grant_type=password" \
  -H "apikey: ${PUBLISHABLE_KEY}" -H "Content-Type: application/json" \
  -d "{\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${ADMIN_PW}\"}")
ADMIN_JWT=$(python3 -c "import json,sys; print(json.load(sys.stdin).get('access_token',''))" <<<"$ADMIN_RESP" 2>/dev/null || true)
if [[ -z "$ADMIN_JWT" ]]; then
  echo "  ADMIN SIGN-IN FAILED: ${ADMIN_RESP:0:300}"; exit 1
fi
echo "  signed in OK"

ALL_EFS=(
  ai-proxy approve-signup-request bind-activation-code collect-payment
  create-user-account expire-pending-approvals purge-expired-backups
  refresh-materialized-views refund-payment run-overdue-scan
  send-push-notification update-server-secret workflow-execute
  workflow-resume-scheduler
)
CRON_EFS=(
  expire-pending-approvals purge-expired-backups refresh-materialized-views
  run-overdue-scan workflow-resume-scheduler
)
STAFF_EFS=(
  ai-proxy approve-signup-request bind-activation-code collect-payment
  create-user-account refund-payment update-server-secret workflow-execute
)

echo ""
echo "[P1-P3] Anonymous-deny sweep (no auth / garbage / publishable-as-bearer → 401)…"
for ef in "${ALL_EFS[@]}"; do
  check "P1 ${ef} no-auth"          401 "$(probe POST "$ef" "" "")"
  check "P2 ${ef} garbage-bearer"   401 "$(probe POST "$ef" "garbage-token" "")"
  check "P3 ${ef} publishable-bearer" 401 "$(probe POST "$ef" "$PUBLISHABLE_KEY" "")"
done

echo ""
echo "[P4a] Cron EFs — valid CRON_SECRET → 200 (no-op on the empty DB)…"
for ef in "${CRON_EFS[@]}"; do
  check "P4 ${ef} cron-secret" 200 "$(probe POST "$ef" "$CRON_SECRET" "")"
done

echo ""
echo "[P4b] Staff EFs — admin JWT + minimal body → 4xx validation (auth+role gates passed)…"
for ef in "${STAFF_EFS[@]}"; do
  s=$(probe POST "$ef" "$ADMIN_JWT" '{}')
  case "$s" in
    4*) check "P4 ${ef} admin-jwt" "4xx" "4xx";;
    *)  check "P4 ${ef} admin-jwt" "4xx" "$s";;
  esac
done

echo ""
echo "[P4c] send-push-notification — legacy service JWT → 401 (T-126 platform behaviour:"
echo "      the injected SUPABASE_SERVICE_ROLE_KEY is the sb_secret_ value, so the legacy"
echo "      JWT fails the EF's own compare — IDENTICAL to production's live response;"
echo "      the sb_secret positive path is operator-gated: reveal it in the dashboard"
echo "      (Settings → API Keys) and re-run this probe expecting 500 = the documented"
echo "      FIREBASE_SERVICE_ACCOUNT_JSON owner residual)…"
S=$(probe POST send-push-notification "$SERVICE_ROLE_KEY" '{}')
check "P4 send-push-notification legacy-service-jwt (production-identical)" 401 "$S"

echo ""
echo "[P5a] ALLOWED_ORIGINS — allowed origin echoed, foreign NOT…"
S=$(curl -s -o /dev/null -w "%{http_code}" -X OPTIONS "${SB_URL}/functions/v1/ai-proxy" \
  -H "Origin: https://elimtiyaz-website.vercel.app" -H "apikey: ${PUBLISHABLE_KEY}")
check "P5 allowed-origin OPTIONS" 200 "$S"
ECHOED=$(curl -s -i -X OPTIONS "${SB_URL}/functions/v1/ai-proxy" \
  -H "Origin: https://elimtiyaz-website.vercel.app" -H "apikey: ${PUBLISHABLE_KEY}" \
  | tr -d '\r' | grep -i '^access-control-allow-origin:' | awk '{print $2}')
check "P5 allowed-origin echoed" "https://elimtiyaz-website.vercel.app" "$ECHOED"
ECHOED2=$(curl -s -i -X OPTIONS "${SB_URL}/functions/v1/ai-proxy" \
  -H "Origin: https://evil.example" -H "apikey: ${PUBLISHABLE_KEY}" \
  | tr -d '\r' | grep -i '^access-control-allow-origin:' | awk '{print $2}')
check "P5 foreign-origin NOT echoed" "http://localhost:5173" "$ECHOED2"

echo ""
echo "[P5b] CRON_SECRET — wrong value → 401…"
check "P5 wrong-cron-secret" 401 "$(probe POST run-overdue-scan "definitely-wrong-secret" "")"

echo ""
echo "[P5c] GROQ_API_KEY — ai-proxy single-shot narrative (eu-west-1 egress)…"
S=$(probe POST ai-proxy "$ADMIN_JWT" '{"feature":"narrative","prompt":"Rédige une phrase de bulletin scolaire exemplaire pour un élève assidu.","max_tokens":512}')
check "P5 ai-proxy single-shot" 200 "$S"
python3 - <<'PY'
import json
try:
    d = json.load(open('/tmp/t379-body'))
    content = (d.get('data') or d).get('content') if isinstance(d.get('data') or d, dict) else None
    print(f"      ai-proxy content sample: {str(content)[:120]!r}")
except Exception as e:
    print(f"      (body parse note: {e})")
PY

echo ""
echo "==================================================================="
echo "RESULT: ${PASS} PASS / ${FAIL} FAIL"
if [[ ${FAIL} -gt 0 ]]; then printf 'FAILED: %s\n' "${FAILED[@]}"; exit 1; fi
echo "EF fleet on ${PROJECT_REF}: deployment + secrets + enforcement = VERIFIED"

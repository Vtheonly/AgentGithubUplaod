#!/bin/bash
# ============================================================================
# t277-live-matrix.sh — T-277 (42nd session) live verification round
# ============================================================================
# Proves, against the LIVE ai-proxy Edge Function, WITHOUT the sbp_ token
# (owner-gated this session — the deploy step is in the runbook below):
#   P1. Admin sign-in (JWT acquisition) — the documented account.
#   P2. 27-SCHEMA agent-stream probe → the deployed EF's tools CAP state:
#       expected 400 invalid_tools on the pre-T-277 deployment (cap 20).
#       This is EVIDENCE, not failure: it pins the exact deploy dependency
#       (the committed cap-40 code needs `supabase functions deploy`).
#   P3. ≤20-schema agent-stream probe → 200 + SSE text chunks from Groq
#       (GROQ_API_KEY still live through the EF's eu-west-1 egress).
#   P4. Hardening regression: invalid model id → 400 invalid_model.
#   P5. Hardening regression: invalid role → 400 invalid_role.
#
# OWNER RUNBOOK (the one gated step this session):
#   SUPABASE_ACCESS_TOKEN=sbp_… supabase functions deploy ai-proxy \
#     --project-ref hkvkefubghbbotgnteir --no-verify-jwt
#   then re-run this script: P2 flips to HTTP 200 (cap 40 ≥ 27 schemas).
#
# Usage: bash t277-live-matrix.sh   (no token needed — probes only)
# Evidence: printed to stdout (captured into t-277-live-verification.md).
# ============================================================================
set -uo pipefail

PROJECT_REF="hkvkefubghbbotgnteir"
SB_URL="https://${PROJECT_REF}.supabase.co"
ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhrdmtlZnViZ2hiYm90Z250ZWlyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUwMDQ2ODQsImV4cCI6MjEwMDU4MDY4NH0.GDQiKjp4YBbCpsgoJXeSUqUT8Ag67He2fmngy6NNPmk"
EF="${SB_URL}/functions/v1/ai-proxy"

ADMIN_EMAIL="admin@elimtiyaz.dz"
ADMIN_PW="elimtiyaz@admin2026"

jqget() { python3 -c "import json,sys; d=json.load(sys.stdin); print(d$1)" 2>/dev/null; }

echo "==================================================================="
echo "T-277 LIVE MATRIX — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "==================================================================="

# ---------------------------------------------------------------------------
echo ""
echo "[P1] Admin sign-in (admin@elimtiyaz.dz)…"
ADMIN_RESP=$(curl -s -X POST "${SB_URL}/auth/v1/token?grant_type=password" \
  -H "apikey: ${ANON_KEY}" -H "Content-Type: application/json" \
  -d "{\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${ADMIN_PW}\"}")
ADMIN_JWT=$(echo "$ADMIN_RESP" | jqget "['access_token']")
if [ -z "$ADMIN_JWT" ] || [ "$ADMIN_JWT" = "None" ]; then
  echo "  FAILED to acquire admin JWT:"
  echo "$ADMIN_RESP" | head -c 400
  exit 1
fi
echo "  admin JWT acquired: ${#ADMIN_JWT} chars"

# Build N dummy tool schemas (the EF validates the ARRAY SHAPE before the
# provider forward — the count is what these probes exercise).
mktools() {
  python3 -c "
import json,sys
n = int(sys.argv[1])
tools = [{'type':'function','function':{'name':f'probe_tool_{i}','description':'probe','parameters':{'type':'object','properties':{}}}} for i in range(n)]
print(json.dumps(tools))
" "$1"
}

# ---------------------------------------------------------------------------
echo ""
echo "[P2] 27-schema agent-stream → the deployed EF's tools-cap state…"
TOOLS_27=$(mktools 27)
P2_BODY=$(python3 -c "
import json,sys
print(json.dumps({'stream':True,'model':'openai/gpt-oss-20b','messages':[{'role':'user','content':'bonjour'}],'tools':json.loads(sys.argv[1])}))
" "$TOOLS_27")
P2=$(curl -s -o /tmp/t277_p2.json -w "%{http_code}" -X POST "$EF" \
  -H "Authorization: Bearer ${ADMIN_JWT}" -H "Content-Type: application/json" \
  -d "$P2_BODY")
echo "  HTTP $P2 — $(head -c 200 /tmp/t277_p2.json)"
if [ "$P2" = "400" ]; then
  echo "  → LIVE CAP STILL 20 (pre-T-277 deployment): the cap-40 deploy is"
  echo "    the owner-gated step (runbook in this header). EXPECTED pre-deploy."
elif [ "$P2" = "200" ]; then
  echo "  → CAP RAISED (≥27): the T-277 deployment is LIVE. ✅"
fi

# ---------------------------------------------------------------------------
echo ""
echo "[P3] 20-schema agent-stream → expect 200 + SSE from Groq…"
TOOLS_20=$(mktools 20)
P3_BODY=$(python3 -c "
import json,sys
print(json.dumps({'stream':True,'model':'openai/gpt-oss-20b','messages':[{'role':'user','content':'Dis bonjour en un mot.'}],'tools':json.loads(sys.argv[1])}))
" "$TOOLS_20")
P3=$(curl -s -o /tmp/t277_p3.txt -w "%{http_code}" --max-time 60 -X POST "$EF" \
  -H "Authorization: Bearer ${ADMIN_JWT}" -H "Content-Type: application/json" \
  -d "$P3_BODY")
echo "  HTTP $P3"
if [ "$P3" = "200" ]; then
  SSE_LINES=$(grep -c "^data:" /tmp/t277_p3.txt || true)
  HAS_CONTENT=$(grep -c '"content"' /tmp/t277_p3.txt || true)
  echo "  SSE data lines: ${SSE_LINES}; content chunks: ${HAS_CONTENT}"
  echo "  first chunk: $(grep '^data:' /tmp/t277_p3.txt | head -1 | head -c 160)"
else
  echo "  body: $(head -c 300 /tmp/t277_p3.txt)"
fi

# ---------------------------------------------------------------------------
echo ""
echo "[P4] Hardening regression: invalid model id → expect 400 invalid_model…"
P4=$(curl -s -o /tmp/t277_p4.json -w "%{http_code}" -X POST "$EF" \
  -H "Authorization: Bearer ${ADMIN_JWT}" -H "Content-Type: application/json" \
  -d '{"stream":true,"model":"DROP TABLE users; --","messages":[{"role":"user","content":"hi"}]}')
echo "  HTTP $P4 — $(head -c 200 /tmp/t277_p4.json)"

# ---------------------------------------------------------------------------
echo ""
echo "[P5] Hardening regression: invalid role → expect 400 invalid_role…"
P5=$(curl -s -o /tmp/t277_p5.json -w "%{http_code}" -X POST "$EF" \
  -H "Authorization: Bearer ${ADMIN_JWT}" -H "Content-Type: application/json" \
  -d '{"stream":true,"model":"openai/gpt-oss-20b","messages":[{"role":"hacker","content":"hi"}]}')
echo "  HTTP $P5 — $(head -c 200 /tmp/t277_p5.json)"

echo ""
echo "==================================================================="
echo "T-277 matrix complete. P2 is the deploy-dependency evidence;"
echo "P3 is the Groq-through-EF liveness proof."
echo "==================================================================="

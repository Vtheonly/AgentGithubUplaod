#!/bin/bash
# T-186/ACT-203 (29th session): add the production portal origin to the live
# Edge-Function ALLOWED_ORIGINS secret (bind-activation-code preflight 403/
# CORS class). The EF code is CORRECT (hub supabase/functions/_shared/cors.ts
# echoes any allowlisted Origin); the deployed SECRET value only carried the
# dev origin http://localhost:5173 — the browser rejected every preflight
# from https://elimtiyaz-website.vercel.app ("The 'Access-Control-Allow-Origin'
# header has a value 'http://localhost:5173' that is not equal to the supplied
# origin").
#
# Usage:  SUPABASE_ACCESS_TOKEN=sbp_... bash update_allowed_origins.sh
# Effect: instant, live, no redeploy needed (function env, not code).
# Safe:   MERGES missing origins into the existing value — never removes
#         owner-added entries; idempotent (re-run = no-op).
set -euo pipefail

SUPABASE_ACCESS_TOKEN="${SUPABASE_ACCESS_TOKEN:?Set SUPABASE_ACCESS_TOKEN (the sbp_… owner access token) in your environment before running}"
PROJECT_REF="hkvkefubghbbotgnteir"
EF_URL="https://${PROJECT_REF}.supabase.co/functions/v1/bind-activation-code"

# The origins every legitimate client uses (credentials.md §2.2 canonical):
#  - http://localhost:5173      — desktop Electron dev (Vite)
#  - http://localhost:3000/3100 — website dev (matches the auth uri_allow_list)
#  - https://elimtiyaz-website.vercel.app — the production portal
REQUIRED_ORIGINS="http://localhost:5173,http://localhost:3000,http://localhost:3100,https://elimtiyaz-website.vercel.app"

echo "== 1. Current ALLOWED_ORIGINS (census) =="
CURRENT=$(curl -s "https://api.supabase.com/v1/projects/${PROJECT_REF}/secrets" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  | python3 -c "import json,sys; secrets=json.load(sys.stdin); print(next((s['value'] for s in secrets if s['name']=='ALLOWED_ORIGINS'), ''))")
echo "   live value: '${CURRENT}'"

echo "== 2. Merging required origins (nothing is ever removed) =="
MERGED=$(python3 - "$CURRENT" "$REQUIRED_ORIGINS" <<'PY'
import sys
current, required = sys.argv[1], sys.argv[2]
have = [o.strip() for o in current.split(",") if o.strip()]
missing = [o for o in required.split(",") if o and o not in have]
merged = ",".join(have + missing)
print(f"{merged}\t{','.join(missing) if missing else '-'}")
PY
)
NEW_VALUE=$(echo "$MERGED" | cut -f1)
MISSING=$(echo "$MERGED" | cut -f2)

if [ "$MISSING" = "-" ]; then
  echo "   nothing to add — ALLOWED_ORIGINS already covers every required origin. No PATCH issued."
else
  echo "   adding: ${MISSING}"
  echo "   new value: ${NEW_VALUE}"
  echo "== 3. PATCHing the function secret =="
  HTTP_CODE=$(curl -s -o /tmp/allowed_origins_response.json -w "%{http_code}" \
    -X PATCH "https://api.supabase.com/v1/projects/${PROJECT_REF}/secrets" \
    -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
    -H "Content-Type: application/json" \
    --data "$(python3 -c "import json; print(json.dumps([{'name':'ALLOWED_ORIGINS','value':'$NEW_VALUE','type':'string'}]))")")
  echo "   HTTP ${HTTP_CODE}"; head -c 300 /tmp/allowed_origins_response.json; echo ""
  if [ "$HTTP_CODE" != "200" ]; then
    echo "   PATCH FAILED — the live value is UNCHANGED. Owner fallback: Supabase Dashboard →"
    echo "   Project Settings → Edge Functions → Secrets → ALLOWED_ORIGINS → append the missing origins."
    exit 1
  fi
fi

echo "== 4. Live verification: preflight (OPTIONS) from each required origin =="
for ORIGIN in $(echo "$REQUIRED_ORIGINS" | tr ',' ' '); do
  ACAO=$(curl -s -i -X OPTIONS "$EF_URL" \
    -H "Origin: ${ORIGIN}" \
    -H "Access-Control-Request-Method: POST" \
    -H "Access-Control-Request-Headers: authorization,apikey,content-type" \
    | tr -d '\r' | grep -i '^access-control-allow-origin:' | cut -d' ' -f2)
  if [ "$ACAO" = "$ORIGIN" ]; then
    echo "   PASS  ${ORIGIN} → echoed"
  else
    echo "   FAIL  ${ORIGIN} → '${ACAO}' (secret propagation can take a minute — re-run the probe)"
    exit 1
  fi
done

echo ""
echo "DONE — the production portal origin is allowlisted; activation preflights pass."
echo "The portal needs NO redeploy (this changed a live function secret, not code)."

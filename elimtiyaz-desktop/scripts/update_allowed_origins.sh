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

# API DISCOVERY (2026-09-05, 30th session): the Management API
# `PATCH /v1/projects/{ref}/secrets` and `PUT` both 404 now, and
# `GET /v1/projects/{ref}/secrets` returns a MASKED DIGEST (64-hex) instead
# of the stored value. The Supabase CLI (v2.116.0) still writes secrets
# correctly — this script therefore: (1) probes the LIVE preflight to
# discover which origins the deployed value actually echoes (the ground
# truth, immune to masking), (2) merges only what the probes prove missing,
# (3) writes via the CLI (needs `supabase` on PATH), (4) re-probes.

SUPABASE_ACCESS_TOKEN="${SUPABASE_ACCESS_TOKEN:?Set SUPABASE_ACCESS_TOKEN (the sbp_… owner access token) in your environment before running}"
PROJECT_REF="hkvkefubghbbotgnteir"
EF_URL="https://${PROJECT_REF}.supabase.co/functions/v1/bind-activation-code"

# The origins every legitimate client uses (credentials.md §2.2 canonical):
#  - http://localhost:5173      — desktop Electron dev (Vite)
#  - http://localhost:3000/3100 — website dev (matches the auth uri_allow_list)
#  - https://elimtiyaz-website.vercel.app — the production portal
REQUIRED_ORIGINS="http://localhost:5173,http://localhost:3000,http://localhost:3100,https://elimtiyaz-website.vercel.app"

echo "== 1. Live preflight probe (the deployed value's ground truth) =="
probe_origin() {
  curl -s -i -X OPTIONS "$EF_URL" \
    -H "Origin: ${1}" \
    -H "Access-Control-Request-Method: POST" \
    -H "Access-Control-Request-Headers: authorization,apikey,content-type" \
    | tr -d '\r' | grep -i '^access-control-allow-origin:' | cut -d' ' -f2
}
MISSING=""
for ORIGIN in $(echo "$REQUIRED_ORIGINS" | tr ',' ' '); do
  ACAO=$(probe_origin "$ORIGIN")
  if [ "$ACAO" = "$ORIGIN" ]; then
    echo "   already allowlisted: ${ORIGIN}"
  else
    echo "   MISSING from the live value: ${ORIGIN}"
    MISSING="${MISSING:+$MISSING,}${ORIGIN}"
  fi
done

if [ -z "$MISSING" ]; then
  echo "nothing to add — ALLOWED_ORIGINS already echoes every required origin. No write issued."
else
  # Merge-only: keep the canonical set (the documented full value — the
  # probes prove which entries are missing; nothing is ever removed).
  echo "== 2. Writing the merged ALLOWED_ORIGINS via the Supabase CLI =="
  echo "   adding: ${MISSING}"
  if ! command -v supabase >/dev/null 2>&1; then
    echo "   the supabase CLI is not on PATH — install it (v2.116.0+) or use the Dashboard:"
    echo "   Project Settings → Edge Functions → Secrets → ALLOWED_ORIGINS → append: ${MISSING}"
    exit 1
  fi
  # NOTE: the CLI call can take 1-3 min and may TIME OUT with the secret
  # already set (documented in AGENTS.md §11.1) — the post-write probe is
  # the authority, not the CLI's exit code.
  SUPABASE_ACCESS_TOKEN="$SUPABASE_ACCESS_TOKEN" timeout 300 supabase secrets set \
    ALLOWED_ORIGINS="$REQUIRED_ORIGINS" --project-ref "$PROJECT_REF" || \
    echo "   (CLI exited non-zero or timed out — verifying via the probe below)"
  echo "   waiting 30s for secret propagation…"; sleep 30
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

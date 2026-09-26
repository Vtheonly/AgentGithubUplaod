#!/bin/bash
# Live Supabase smoke test for T-418 branch-consolidation verification
# Uses the Management API SQL endpoint per AGENTS.md §11.1 conventions.
# Read-only queries ONLY.
#
# Credentials are NEVER hardcoded (AGENTS.md §15.12 — the SEC-100 class;
# GitHub push protection enforces it too). Provide via environment:
#   SUPABASE_ACCESS_TOKEN=...  (the owner-supplied sbp_ management token)
#   SUPABASE_PROJECT_REF=...   (defaults to the documented live project)
#   SUPABASE_ANON_KEY=...      (the publishable key, for the RLS probe)
ACCESS_TOKEN="${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN must be provided via environment}"
PROJECT_REF="${SUPABASE_PROJECT_REF:-vebfehrpzajhstyhinnw}"
ANON_KEY="${SUPABASE_ANON_KEY:?SUPABASE_ANON_KEY must be provided via environment}"
BASE="https://api.supabase.com/v1/projects/$PROJECT_REF"

echo "=== 1. Live migration chain head (read-only) ==="
cat > /tmp/t418-smoke-1.json <<'EOF'
{"query": "select max(version) as chain_head, count(*) as applied from supabase_migrations.schema_migrations;"}
EOF
curl -s -X POST "$BASE/database/query" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  --data @/tmp/t418-smoke-1.json | python3 -m json.tool 2>/dev/null | head -12

echo ""
echo "=== 2. Auth health (GoTrue) ==="
curl -s -o /dev/null -w "auth health HTTP %{http_code}\n" "https://$PROJECT_REF.supabase.co/auth/v1/health"

echo ""
echo "=== 3. RLS enforcement — anon key on parents (expect 0 rows or 401/permission) ==="
curl -s "https://$PROJECT_REF.supabase.co/rest/v1/parents?select=id&limit=5" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $ANON_KEY" | head -c 300
echo ""

echo ""
echo "=== 4. Core table censuses (read-only, service role) ==="
cat > /tmp/t418-smoke-4.json <<'EOF'
{"query": "select (select count(*) from parents) as parents, (select count(*) from students) as students, (select count(*) from personnel) as personnel, (select count(*) from payment_allocations) as payment_allocations, (select count(*) from classes) as classes;"}
EOF
curl -s -X POST "$BASE/database/query" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  --data @/tmp/t418-smoke-4.json | python3 -m json.tool 2>/dev/null | head -14

echo ""
echo "=== 5. Edge Functions deployed (read-only census) ==="
curl -s "$BASE/functions" -H "Authorization: Bearer $ACCESS_TOKEN" | python3 -c "
import json,sys
try:
    fns = json.load(sys.stdin)
    for f in fns: print(' -', f.get('slug'), '| status:', f.get('status'))
except Exception as e:
    print('parse error:', e)
" 2>/dev/null | head -15

#!/bin/bash
# t-448-live-e2e.sh — T-448 (UI-326): the CLIENT-path end-to-end live probe
# for the dedicated dashboard-layout store (migration 0134) — the exact
# wire calls the desktop makes (verify_t-445's data-gateway discipline:
# everything through PostgREST + the auth gateway, zero Management API).
#
# The owner's acceptance contract, proven on the LIVE project:
#   E1  sign-in (the documented owner-pinned credential, credentials.md §1)
#   E2  LOAD before any save → the row set is EMPTY (fresh view)
#   E3  SAVE (the explicit save — the save_dashboard_layout RPC) → a
#       saved-at timestamp
#   E4  LOAD after the save → ONE row, the layout jsonb VERBATIM (the
#       editor's exact load path — "reuse the exact same saved layout")
#   E5  LOAD AGAIN with NO intervening save → byte-identical row incl.
#       updated_at (reads NEVER write — "only update when I explicitly
#       change and save it")
#   E6  SAVE a DIFFERENT layout (the intentional change) → LOAD → updated,
#       still ONE row (never a duplicate)
#   E7  RESET (the editor's DELETE) → 2xx
#   E8  LOAD after the reset → EMPTY (zero residue — re-runnable)
#   E9  the ANON/publishable key alone sees NOTHING (RLS: the policies are
#       `to authenticated` own-rows only)
#
# Usage: bash scripts/t-448-live-e2e.sh   (no secrets in argv; the values
# below are the PUBLIC client identifiers + the owner-pinned probe
# credential documented in docs/operations/credentials.md §1)
set -uo pipefail

BASE="https://vebfehrpzajhstyhinnw.supabase.co"
PUBLISHABLE="sb_publishable_IPUtQMYQzr1wNnfGTcl5MA_wuz3RUdg"
ADMIN_EMAIL="admin@elimtiyaz.dz"
ADMIN_PW="elimtiyaz@admin2026"
VIEW_KEY="t448-e2e-probe"

LAYOUT_V1='{"kpi":{"x":2,"y":3,"w":6,"h":6},"chart":{"x":8,"y":3,"w":4,"h":6}}'
LAYOUT_V2='{"kpi":{"x":0,"y":0,"w":12,"h":4}}'

PASS=0
FAIL=0
check() {
  if [ "$2" = "true" ]; then PASS=$((PASS+1)); echo "  PASS  $1";
  else FAIL=$((FAIL+1)); echo "  FAIL  $1 — $3"; fi
}

# python helpers: canonical JSON (sorted keys) for order-independent compare.
canon() { python3 -c "import json,sys; print(json.dumps(json.loads(sys.stdin.read()), sort_keys=True))"; }
jlen()  { python3 -c "import json,sys; print(len(json.loads(sys.stdin.read())))"; }

echo "== T-448 live E2E: the dedicated dashboard-layout store =="

# ── E1: sign-in ──────────────────────────────────────────────────────────
TOKEN=$(curl -s --max-time 30 -X POST "$BASE/auth/v1/token?grant_type=password" \
  -H "apikey: $PUBLISHABLE" -H "Content-Type: application/json" \
  -A "curl/8.5.0" \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PW\"}" \
  | python3 -c "import json,sys; print(json.loads(sys.stdin.read())['access_token'])")
if [ -n "${TOKEN:-}" ]; then
  PASS=$((PASS+1)); echo "  PASS  E1 admin sign-in (staff JWT acquired)"
else
  FAIL=$((FAIL+1)); echo "  FAIL  E1 admin sign-in — no access_token (STOP; owner-pinned credential per credentials.md §1)"; exit 1
fi

rest() { # rest <METHOD> <path> [data]
  if [ $# -ge 3 ]; then
    curl -s --max-time 30 -X "$1" "$BASE/rest/v1$2" \
      -H "apikey: $PUBLISHABLE" -H "Authorization: Bearer $TOKEN" \
      -H "Content-Type: application/json" -A "curl/8.5.0" -d "$3"
  else
    curl -s --max-time 30 -X "$1" "$BASE/rest/v1$2" \
      -H "apikey: $PUBLISHABLE" -H "Authorization: Bearer $TOKEN" \
      -A "curl/8.5.0"
  fi
}

# ── E2: load before any save → empty ────────────────────────────────────
ROWS=$(rest GET "/dashboard_layouts?select=layout,updated_at&view_key=eq.$VIEW_KEY")
check "E2 load before save is empty" "$([ "$(echo "$ROWS" | jlen)" = "0" ] && echo true)" "got: $ROWS"

# ── E3: the explicit save (the RPC) ─────────────────────────────────────
SAVED_AT=$(rest POST "/rpc/save_dashboard_layout" "{\"p_view_key\":\"$VIEW_KEY\",\"p_layout\":$LAYOUT_V1}")
check "E3 explicit save via RPC returns saved-at" \
  "$(echo "$SAVED_AT" | python3 -c "import json,sys
v = json.loads(sys.stdin.read())
print('true' if isinstance(v, str) and 'T' in v else 'false')")" "got: $SAVED_AT"

# ── E4: load after save → the layout VERBATIM ───────────────────────────
ROW1=$(rest GET "/dashboard_layouts?select=layout,updated_at&view_key=eq.$VIEW_KEY")
check "E4 load returns the saved layout verbatim" \
  "$(python3 -c "import json,sys
r = json.loads('''$ROW1''')
want = json.loads('''$LAYOUT_V1''')
print('true' if len(r) == 1 and r[0]['layout'] == want else 'false')")" "got: $ROW1"

# ── E5: load again with NO save → byte-identical (reads never write) ────
sleep 1
ROW2=$(rest GET "/dashboard_layouts?select=layout,updated_at&view_key=eq.$VIEW_KEY")
check "E5 read-only reload is unchanged (incl. updated_at)" "$([ "$ROW1" = "$ROW2" ] && echo true)" "row1=$ROW1 row2=$ROW2"

# ── E6: the intentional change → updated, never duplicated ──────────────
rest POST "/rpc/save_dashboard_layout" "{\"p_view_key\":\"$VIEW_KEY\",\"p_layout\":$LAYOUT_V2}" > /dev/null
ROW3=$(rest GET "/dashboard_layouts?select=layout,updated_at&view_key=eq.$VIEW_KEY")
check "E6 explicit change updates the row (never duplicates)" \
  "$(python3 -c "import json,sys
r = json.loads('''$ROW3''')
r1 = json.loads('''$ROW1''')
want = json.loads('''$LAYOUT_V2''')
print('true' if len(r) == 1 and r[0]['layout'] == want and r[0]['updated_at'] != r1[0]['updated_at'] else 'false')")" "got: $ROW3"

# ── E7: the reset (the editor's DELETE) ─────────────────────────────────
HTTP=$(curl -s -o /dev/null -w "%{http_code}" --max-time 30 -X DELETE \
  "$BASE/rest/v1/dashboard_layouts?view_key=eq.$VIEW_KEY" \
  -H "apikey: $PUBLISHABLE" -H "Authorization: Bearer $TOKEN" \
  -A "curl/8.5.0")
check "E7 reset DELETE succeeds" "$([ "${HTTP:0:1}" = "2" ] && echo true)" "HTTP $HTTP"

# ── E8: zero residue ────────────────────────────────────────────────────
ROWS_AFTER=$(rest GET "/dashboard_layouts?select=layout&view_key=eq.$VIEW_KEY")
check "E8 zero residue after reset" "$([ "$(echo "$ROWS_AFTER" | jlen)" = "0" ] && echo true)" "got: $ROWS_AFTER"

# ── E9: the publishable key alone sees nothing (RLS) ────────────────────
ANON=$(curl -s --max-time 30 "$BASE/rest/v1/dashboard_layouts?select=layout" \
  -H "apikey: $PUBLISHABLE" -A "curl/8.5.0")
check "E9 anon key sees nothing (RLS own-rows)" "$([ "$(echo "$ANON" | jlen)" = "0" ] && echo true)" "got: $ANON"

echo ""
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" = "0" ] && echo "T-448 LIVE E2E: ALL GREEN" || exit 1

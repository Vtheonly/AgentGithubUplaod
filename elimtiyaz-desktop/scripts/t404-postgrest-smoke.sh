#!/bin/bash
# ============================================================================
# t404-postgrest-smoke.sh — SCHED-103 live PostgREST embed smoke (T-404)
# ============================================================================
# WHY THIS SCRIPT EXISTS (SCHED-103, 2026-09-22): the desktop app's Emploi
# du temps tab 400'd in live use — every class_subjects curriculum load
# failed with PGRST200 ("Could not find a relationship between
# 'class_subjects' and 'personnel' in the schema cache"). Root cause:
# class_subjects.teacher_id has been a BARE uuid since migration 0004 (its
# "FK to personnel(id), filled in 0009" comment was never honoured), and a
# PostgREST `personnel!left(...)` embed REQUIRES a real FK constraint.
# The mock-twin repository tests (9/9) and the SQL-level live matrix (27/27)
# never exercised the PostgREST embed — this script closes that gap forever
# by probing the EXACT query shapes the repository sends.
#
# Proves, against the LIVE backend (vebfehrpzajhstyhinnw), no sbp_ token
# needed (auth via the documented admin account):
#   P1. Admin sign-in (JWT acquisition).
#   P2. The user-reported production URL (verbatim from the console log)
#       — pre-0113: expected HTTP 400 PGRST200 (the defect, PINNED).
#         post-0113 (`--expect-fk`): must flip to HTTP 200.
#   P3. The FIXED loadProblem curriculum query (no personnel embed — the
#       SCHED-103 app-side fix) → HTTP 200 + REAL row count (authenticated).
#   P4. The other loadProblem queries: timetable_configurations, rooms,
#       timetable_constraints, classes, personnel(.in teacher ids).
#   P5. Every OTHER embed in the app (expenses→categories,
#       personnel→salary_*, workflow_runs→workflows, classes→academic_years)
#       → all HTTP 200 (regression net for the same defect class).
#
# OWNER RUNBOOK (the one gated step — same pattern as the T-277 runbook):
#   SUPABASE_ACCESS_TOKEN=sbp_… bash scripts/apply_0113_live.sh
#   then re-run with:  bash scripts/t404-postgrest-smoke.sh --expect-fk
#   (P2 flips 400 → 200 and the FK state check reports landed.)
#
# Usage: bash scripts/t404-postgrest-smoke.sh [--expect-fk]
# Evidence: printed to stdout (captured into t-404-live-verification.md).
# ============================================================================
set -uo pipefail

PROJECT_REF="vebfehrpzajhstyhinnw"
SB_URL="https://${PROJECT_REF}.supabase.co"
REST="${SB_URL}/rest/v1"
ANON_KEY="sb_publishable_IPUtQMYQzr1wNnfGTcl5MA_wuz3RUdg"

ADMIN_EMAIL="admin@elimtiyaz.dz"
ADMIN_PW="elimtiyaz@admin2026"

# The academic year id from the user's production console log (kept verbatim
# for evidence parity with the reported 400s).
REPORTED_YEAR_ID="e90b43f6-17d7-47f6-bd80-25a93b553d8a"

EXPECT_FK=0
if [[ "${1:-}" == "--expect-fk" ]]; then EXPECT_FK=1; fi

PASS=0; FAIL=0
jqget() { python3 -c "import json,sys; d=json.load(sys.stdin); print(d$1)" 2>/dev/null; }
rowcount() { python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d) if isinstance(d, list) else '?')" 2>/dev/null; }

note() { # note <PASS|FAIL|INFO> <label> <detail>
  local tag="$1"; local label="$2"; local detail="${3:-}"
  if [ "$tag" = "PASS" ]; then PASS=$((PASS+1)); elif [ "$tag" = "FAIL" ]; then FAIL=$((FAIL+1)); fi
  printf "  [%s] %-52s %s\n" "$tag" "$label" "$detail"
}

check() { # check <label> <expected> <actual> <detail>
  if [ "$2" = "$3" ]; then note PASS "$1" "($3) ${4:-}"; else note FAIL "$1" "expected $2, got $3 ${4:-}"; fi
}

probe() { # probe <url> <jwt> → prints "HTTP_CODE BODY"
  local url="$1"; local jwt="$2"
  if [ -n "$jwt" ]; then
    curl -s -w "\n%{http_code}" "$url" -H "apikey: ${ANON_KEY}" -H "Authorization: Bearer ${jwt}"
  else
    curl -s -w "\n%{http_code}" "$url" -H "apikey: ${ANON_KEY}" -H "Authorization: Bearer ${ANON_KEY}"
  fi
}

echo "==================================================================="
echo "T-404 / SCHED-103 POSTGREST EMBED SMOKE — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "expect-fk mode: ${EXPECT_FK} (1 = migration 0113 asserted landed)"
echo "==================================================================="

# ---------------------------------------------------------------------------
echo ""
echo "[P1] Admin sign-in (${ADMIN_EMAIL})…"
ADMIN_RESP=$(curl -s -X POST "${SB_URL}/auth/v1/token?grant_type=password" \
  -H "apikey: ${ANON_KEY}" -H "Content-Type: application/json" \
  -d "{\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${ADMIN_PW}\"}")
ADMIN_JWT=$(echo "$ADMIN_RESP" | jqget "['access_token']")
if [ -z "$ADMIN_JWT" ] || [ "$ADMIN_JWT" = "None" ]; then
  echo "  FAILED to acquire admin JWT:"; echo "$ADMIN_RESP" | head -c 400; exit 1
fi
note INFO "admin JWT acquired" "${#ADMIN_JWT} chars"

# ---------------------------------------------------------------------------
echo ""
echo "[P2] The USER-REPORTED production URL (verbatim)…"
OLD_URL="${REST}/class_subjects?select=class_id%2Csubject_id%2Cteacher_id%2Cweekly_hours%2Cconsecutive_periods%2Crequired_room_type%2Csubjects%28code%2Cname_fr%29%2Cclasses%21inner%28code%2Cname%2Ccapacity%2Cacademic_year_id%29%2Cpersonnel%21left%28first_name%2Clast_name%29&classes.academic_year_id=eq.${REPORTED_YEAR_ID}&is_active=eq.true"
OLD_PROBE=$(probe "$OLD_URL" "$ADMIN_JWT")
OLD_CODE=$(echo "$OLD_PROBE" | tail -1); OLD_BODY=$(echo "$OLD_PROBE" | head -n -1)
if [ "$EXPECT_FK" = "1" ]; then
  check "class_subjects + personnel!left embed" "200" "$OLD_CODE" "(post-0113: FK resolves the embed)"
else
  check "class_subjects + personnel!left embed" "400" "$OLD_CODE" "(pre-0113: PGRST200 pinned as the defect)"
  echo "$OLD_BODY" | head -c 300; echo ""
fi

# ---------------------------------------------------------------------------
echo ""
echo "[P3] The FIXED curriculum query (no personnel embed)…"
NEW_URL="${REST}/class_subjects?select=class_id%2Csubject_id%2Cteacher_id%2Cweekly_hours%2Cconsecutive_periods%2Crequired_room_type%2Csubjects%28code%2Cname_fr%29%2Cclasses%21inner%28code%2Cname%2Ccapacity%2Cacademic_year_id%29&classes.academic_year_id=eq.${REPORTED_YEAR_ID}&is_active=eq.true"
NEW_PROBE=$(probe "$NEW_URL" "$ADMIN_JWT")
NEW_CODE=$(echo "$NEW_PROBE" | tail -1); NEW_ROWS=$(echo "$NEW_PROBE" | head -n -1 | rowcount)
check "fixed loadProblem curriculum query" "200" "$NEW_CODE" "rows=${NEW_ROWS}"
if [ "$NEW_CODE" != "200" ]; then echo "$NEW_PROBE" | head -c 400; echo ""; fi

# ---------------------------------------------------------------------------
echo ""
echo "[P4] The other loadProblem queries (authenticated)…"
for entry in \
  "timetable_configurations|academic_year_id=eq.${REPORTED_YEAR_ID}&is_active=eq.true" \
  "rooms|is_active=eq.true&order=code" \
  "timetable_constraints|academic_year_id=eq.${REPORTED_YEAR_ID}&is_active=eq.true" \
  "classes|academic_year_id=eq.${REPORTED_YEAR_ID}&is_active=eq.true&order=code" \
; do
  TBL="${entry%%|*}"; Q="${entry#*|}"
  P=$(probe "${REST}/${TBL}?select=*&${Q}" "$ADMIN_JWT")
  C=$(echo "$P" | tail -1); R=$(echo "$P" | head -n -1 | rowcount)
  check "${TBL}" "200" "$C" "rows=${R}"
done

# personnel .in(teacher ids) — resolve a real teacher_id from the curriculum
TEACHER_ID=$(echo "$NEW_PROBE" | head -n -1 | python3 -c "
import json,sys
rows=json.load(sys.stdin)
ids=[r['teacher_id'] for r in rows if r.get('teacher_id')]
print(ids[0] if ids else '')" 2>/dev/null)
if [ -n "$TEACHER_ID" ]; then
  P=$(probe "${REST}/personnel?select=id%2Cfirst_name%2Clast_name&id=in.(${TEACHER_ID})" "$ADMIN_JWT")
  C=$(echo "$P" | tail -1); R=$(echo "$P" | head -n -1 | rowcount)
  check "personnel .in(teacher_ids)" "200" "$C" "rows=${R}"
else
  note INFO "personnel .in(teacher_ids)" "(skipped — no teacher assigned in this year's curriculum yet)"
fi

# ---------------------------------------------------------------------------
echo ""
echo "[P5] Every other embed in the app (defect-class regression net)…"
for entry in \
  "expense_tickets?select=*,expense_categories(code)&limit=1|expense_tickets → expense_categories" \
  "personnel?select=*,salary_adjustments(*),salary_payments(*)&limit=1|personnel → salary_*" \
  "workflow_runs?select=*,workflows(name)&limit=1|workflow_runs → workflows" \
  "classes?select=*,academic_years!inner(code,label)&limit=1|classes → academic_years" \
; do
  URL_PATH="${entry%%|*}"; LABEL="${entry#*|}"
  P=$(probe "${REST}/${URL_PATH}" "$ADMIN_JWT")
  C=$(echo "$P" | tail -1)
  check "$LABEL" "200" "$C"
done

# ---------------------------------------------------------------------------
echo ""
echo "==================================================================="
echo "RESULT: ${PASS} pass / ${FAIL} fail"
if [ "$EXPECT_FK" = "0" ]; then
  echo "Pre-0113 expectations: P2 = 400 is the PINNED DEFECT (evidence, not a"
  echo "test failure IF it is the only non-200). After the owner applies 0113"
  echo "(runbook above), re-run with --expect-fk — P2 must be 200."
fi
echo "==================================================================="
[ "$FAIL" = "0" ] && exit 0 || exit 1

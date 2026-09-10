#!/bin/bash
# ============================================================================
# t269-live-matrix.sh — T-269 (41st session) live verification round
# ============================================================================
# Proves, through the LIVE ai-proxy Edge Function (v18, hardened this
# session), with the owner-supplied GROQ_API_KEY secret (set this session):
#   P1. Admin sign-in (JWT acquisition) — the documented account.
#   P2. Anonymous probe: no Authorization → 401 unauthorized.
#   P3. Anon-key-as-Bearer probe → 401.
#   P4. Agent-mode input hardening: invalid model id → 400 invalid_model.
#   P5. Agent-mode input hardening: invalid role → 400 invalid_role.
#   P6. AGENT-STREAM ROUND-TRIP: authenticated POST with a real
#       conversation → 200 + text/event-stream + SSE data chunks from
#       Groq (proves the GROQ_API_KEY secret works from the EF's egress —
#       the sandbox itself is geo-blocked, but Supabase eu-west-1 is not).
#   P7. SINGLE-SHOT feature path: narrative → 200 + content + tokens
#       (rate-limit row + audit entry written server-side).
#   P8. EF census: ai-proxy ACTIVE, version bumped past v17.
#
# Usage: SUPABASE_ACCESS_TOKEN=... bash t269-live-matrix.sh
# Evidence: printed to stdout (captured into docs/recovery/t-269-live-verification.md).
# ============================================================================
set -uo pipefail

SUPABASE_ACCESS_TOKEN="${SUPABASE_ACCESS_TOKEN:?Set SUPABASE_ACCESS_TOKEN}"
PROJECT_REF="hkvkefubghbbotgnteir"
SB_URL="https://${PROJECT_REF}.supabase.co"
ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhrdmtlZnViZ2hiYm90Z250ZWlyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUwMDQ2ODQsImV4cCI6MjEwMDU4MDY4NH0.GDQiKjp4YBbCpsgoJXeSUqUT8Ag67He2fmngy6NNPmk"
EF="${SB_URL}/functions/v1/ai-proxy"

ADMIN_EMAIL="admin@elimtiyaz.dz"
ADMIN_PW="elimtiyaz@admin2026"

jqget() { python3 -c "import json,sys; d=json.load(sys.stdin); print(d$1)" 2>/dev/null; }

echo "==================================================================="
echo "T-269 LIVE MATRIX — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
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

# ---------------------------------------------------------------------------
echo ""
echo "[P2] Anonymous probe (no Authorization) → expect 401…"
P2=$(curl -s -o /tmp/t269_p2.json -w "%{http_code}" -X POST "$EF" \
  -H "Content-Type: application/json" \
  -d '{"feature":"narrative","prompt":"test"}')
echo "  HTTP $P2 — $(head -c 200 /tmp/t269_p2.json)"

# ---------------------------------------------------------------------------
echo ""
echo "[P3] Anon-key-as-Bearer probe → expect 401…"
P3=$(curl -s -o /tmp/t269_p3.json -w "%{http_code}" -X POST "$EF" \
  -H "Authorization: Bearer ${ANON_KEY}" -H "Content-Type: application/json" \
  -d '{"feature":"narrative","prompt":"test"}')
echo "  HTTP $P3 — $(head -c 200 /tmp/t269_p3.json)"

# ---------------------------------------------------------------------------
echo ""
echo "[P4] Agent-mode hardening: invalid model id → expect 400 invalid_model…"
P4=$(curl -s -o /tmp/t269_p4.json -w "%{http_code}" -X POST "$EF" \
  -H "Authorization: Bearer ${ADMIN_JWT}" -H "Content-Type: application/json" \
  -d '{"stream":true,"model":"DROP TABLE users; --","messages":[{"role":"user","content":"hi"}]}')
echo "  HTTP $P4 — $(head -c 200 /tmp/t269_p4.json)"

# ---------------------------------------------------------------------------
echo ""
echo "[P5] Agent-mode hardening: invalid role → expect 400 invalid_role…"
P5=$(curl -s -o /tmp/t269_p5.json -w "%{http_code}" -X POST "$EF" \
  -H "Authorization: Bearer ${ADMIN_JWT}" -H "Content-Type: application/json" \
  -d '{"stream":true,"messages":[{"role":"hacker","content":"hi"}]}')
echo "  HTTP $P5 — $(head -c 200 /tmp/t269_p5.json)"

# ---------------------------------------------------------------------------
echo ""
echo "[P6] AGENT-STREAM ROUND-TRIP (live Groq through the EF) → expect 200 + SSE…"
# NOTE (T-269 live discovery): gpt-oss models spend REASONING tokens from
# the SAME max_tokens budget (first probe with max_tokens=60 finished
# reason=length with 58 reasoning tokens and ZERO content) and stream a
# hidden `delta.reasoning` + `channel:"analysis"` trace the desktop
# parser correctly ignores (only `delta.content` accumulates). A realistic
# budget is required for a content-bearing completion.
curl -s -N -o /tmp/t269_p6.sse -w "HTTP %{http_code} content-type=%{content_type}\n" -X POST "$EF" \
  -H "Authorization: Bearer ${ADMIN_JWT}" -H "Content-Type: application/json" \
  -m 120 \
  -d '{"stream":true,"model":"openai/gpt-oss-20b","messages":[{"role":"system","content":"Vous êtes un assistant bref."},{"role":"user","content":"Répondez en exactement une phrase : quel temps fait-il à Alger en été ?"}],"max_tokens":800,"temperature":0.3}'
SSE_LINES=$(wc -l < /tmp/t269_p6.sse)
SSE_ANALYSIS=$(python3 - <<'PYEOF'
import json
content = ""
reasoning = 0
finish = None
with open("/tmp/t269_p6.sse") as f:
    for line in f:
        line = line.strip()
        if not line.startswith("data:") or line == "data: [DONE]":
            continue
        try:
            chunk = json.loads(line[5:].strip())
            choice = chunk.get("choices", [{}])[0]
            delta = choice.get("delta", {})
            if delta.get("content"):
                content += delta["content"]
            if delta.get("reasoning"):
                reasoning += len(delta["reasoning"])
            if choice.get("finish_reason"):
                finish = choice["finish_reason"]
        except Exception:
            pass
print(f"finish_reason={finish} reasoning_chars={reasoning} (hidden channel, ignored by the desktop parser)")
print(f"CONTENT: {content[:250] if content else '(NO CONTENT — BUDGET OR MODEL ISSUE)'}")
PYEOF
)
echo "  SSE lines: ${SSE_LINES}"
echo "  ${SSE_ANALYSIS}"

# ---------------------------------------------------------------------------
echo ""
echo "[P6b] AGENT-STREAM TOOL-CALL PASSTHROUGH → expect a tool_calls delta…"
curl -s -N -o /tmp/t269_p6b.sse -w "HTTP %{http_code} content-type=%{content_type}\n" -X POST "$EF" \
  -H "Authorization: Bearer ${ADMIN_JWT}" -H "Content-Type: application/json" \
  -m 120 \
  -d '{"stream":true,"model":"openai/gpt-oss-20b","messages":[{"role":"system","content":"Tu dois TOUJOURS utiliser l outil fourni."},{"role":"user","content":"Cherche le parent Benali."}],"max_tokens":800,"temperature":0.2,"tools":[{"type":"function","function":{"name":"search_entities","description":"Rechercher des parents par mot-clé","parameters":{"type":"object","properties":{"query":{"type":"string"}},"required":["query"]}}}],"tool_choice":"auto"}'
python3 - <<'PYEOF'
import json
tool_calls = {}
finish = None
with open("/tmp/t269_p6b.sse") as f:
    for line in f:
        line = line.strip()
        if not line.startswith("data:") or line == "data: [DONE]":
            continue
        try:
            chunk = json.loads(line[5:].strip())
            choice = chunk.get("choices", [{}])[0]
            delta = choice.get("delta", {})
            for tc in delta.get("tool_calls", []) or []:
                idx = tc.get("index", 0)
                cur = tool_calls.setdefault(idx, {"id": "", "name": "", "args": ""})
                if tc.get("id"):
                    cur["id"] = tc["id"]
                fn = tc.get("function", {})
                if fn.get("name"):
                    cur["name"] = fn["name"]
                if fn.get("arguments"):
                    cur["args"] += fn["arguments"]
            if choice.get("finish_reason"):
                finish = choice["finish_reason"]
        except Exception:
            pass
print(f"  finish_reason={finish}")
for idx, tc in sorted(tool_calls.items()):
    print(f"  tool_call[{idx}]: {tc['name']}({tc['args'][:120]})")
if not tool_calls:
    print("  (NO TOOL CALL — check model/tool_choice)")
PYEOF

# ---------------------------------------------------------------------------
echo ""
echo "[P7] SINGLE-SHOT narrative path → expect 200 + content…"
P7=$(curl -s -o /tmp/t269_p7.json -w "%{http_code}" -X POST "$EF" \
  -H "Authorization: Bearer ${ADMIN_JWT}" -H "Content-Type: application/json" \
  -m 90 \
  -d '{"feature":"narrative","prompt":"Élève anonyme, moyenne 14/20, assidu. Rédige un très court commentaire."}')
echo "  HTTP $P7"
python3 - <<'PYEOF'
import json
try:
    with open("/tmp/t269_p7.json") as f:
        d = json.load(f)
    data = d.get("data", d)
    print(f"  feature={data.get('feature')} provider={data.get('provider')} model={data.get('model')} tokens={data.get('tokens_used')} latency={data.get('latency_ms')}ms")
    print(f"  content: {str(data.get('content'))[:200]}")
except Exception as e:
    print(f"  (parse failed: {e}) raw: ", end="")
    print(open("/tmp/t269_p7.json").read()[:200])
PYEOF

# ---------------------------------------------------------------------------
echo ""
echo "[P8] EF census (ai-proxy status + version)…"
timeout 100 /home/z/my-project/bin/supabase functions list --project-ref "$PROJECT_REF" 2>/dev/null | rg "ai-proxy" || echo "  (functions list unavailable from sandbox — check dashboard)"

echo ""
echo "==================================================================="
echo "T-269 LIVE MATRIX COMPLETE"
echo "==================================================================="

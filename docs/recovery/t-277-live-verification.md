# T-277 — Live Verification (42nd session, 2026-09-10)

**Task:** T-277 — ai-proxy tool-cap raise (20 → 40) + live matrix.
**Script:** `elimtiyaz-desktop/scripts/t277-live-matrix.sh` (persisted, re-runnable, token-free — probes only).
**Context:** the 42nd session grew the copilot registry to 27 tool schemas (AI-311); the deployed EF's agent-mode validation capped `tools` at 20 → every edge-mode agent-stream call with the new registry would 400 `invalid_tools`. The fix (cap 40) is COMMITTED; the DEPLOY is owner-gated (the sbp_ access token was not re-supplied this session — it was never persisted, correctly).

## The matrix (2026-09-10T00:56:28Z, live against hkvkefubghbbotgnteir)

| Probe | Expectation | Result |
|---|---|---|
| P1 — admin sign-in (`admin@elimtiyaz.dz`) | JWT acquired | ✅ 796-char access token |
| P2 — 27-schema agent-stream | pre-deploy: 400 `invalid_tools`; post-deploy: 200 | **HTTP 400 — `tools must be an array of at most 20 schemas`** → the live cap is STILL 20; the cap-40 deploy is the one gated step. This is EVIDENCE of the exact dependency, not a failure of the committed fix. |
| P3 — 20-schema agent-stream (openai/gpt-oss-20b) | 200 + SSE from Groq | ✅ **HTTP 200, 77 SSE data lines, content chunks present** (first chunk: `chatcmpl-3d19e36c…`, model `openai/gpt-oss-20b`) — the GROQ_API_KEY secret is still live through the EF's eu-west-1 egress; the full agent-stream pipeline works within the current cap. |
| P4 — invalid model id | 400 `invalid_model` | ✅ HTTP 400 — hardening intact |
| P5 — invalid role | 400 `invalid_role` | ✅ HTTP 400 — hardening intact |

## The owner runbook (the one gated step)

```bash
SUPABASE_ACCESS_TOKEN=sbp_… supabase functions deploy ai-proxy \
  --project-ref hkvkefubghbbotgnteir --no-verify-jwt
```

Then re-run `bash scripts/t277-live-matrix.sh`: **P2 flips from HTTP 400 to HTTP 200** — that flip is the post-deploy acceptance criterion (no other probe changes; P3 already proves the Groq path).

## Impact scope until the deploy

- **Edge mode** (server-side key through the EF): agent-stream calls carry 27 schemas → 400 `invalid_tools`. The single-shot feature paths (narrative/drafting/anomaly) are UNAFFECTED (they send no `tools`).
- **BYOK mode** (owner's own key in Settings): direct Groq connection — no EF in the path, no cap — the full 27-tool copilot works TODAY in BYOK mode.
- **Mock/dev mode:** unaffected (local).
- No database change this session (chain 0001–0084 stands; zero drift at the 41st close, no new migrations to verify).

## Suite evidence (the code half of T-277)

- `tsc --noEmit` → 0 errors; `eslint` → 0 errors (warnings only); `vite build` → green (18.6 s).
- Full desktop suite: **120 files / 2875 tests / 0 failures** (was 119/2824 at the 41st close; +1 file, +51 tests — the AI-311 capability suite).
- The EF-cap source guard: `ai-311-capability-suite.test.tsx` asserts the EF's "at most N schemas" cap ≥ `SYSTEM_TOOLS_DEFINITIONS.length` — the 400-trap can never silently return (the registry and the cap must move together).

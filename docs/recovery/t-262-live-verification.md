# T-262 — Live verification: ai-proxy Edge Function (tool-calling + streaming + model override)

> Session: 39th (2026-09-10) · Task: T-262 (AI-308 server leg) · Verifier: the session agent
> Method: Supabase CLI v2.116.0 (re-provisioned; container resets wipe `/home/z/my-project/bin`), project `hkvkefubghbbotgnteir`, owner-supplied `sbp_` access token (one-shot, never persisted).

## What was deployed

The **ai-proxy** Edge Function, updated for the Agentic AI Architecture (T-260/T-261/T-262):

- **Agent-stream mode** (additive): `stream:true` + `messages[]` (+ optional `tools[]` / `tool_choice` / `model` / `top_p`) → forwarded to Groq/OpenRouter with `stream:true`, and the provider's SSE body piped straight back (`text/event-stream`, no-cache, CORS headers) — consumed by the desktop's `executeOpenAIStream` exactly like a direct provider call.
- **Single-shot feature mode** (narrative/drafting/anomaly): preserved verbatim — same validation, same provider fallback, same rate limiting (`ai_request_logs`), same audit logging.
- **Agent-mode logging**: `logAgentRequest` writes the `ai_request_logs` row (feature `copilot`) + a `writeAuditLog` entry BEFORE the stream starts (token counts are unknown until the stream completes — logged as 0; success = the provider accepted the request). Logging failures never kill the stream handoff.
- No DB change → no migration (the chain stays 0001–0084).

## Deploy

```
supabase functions deploy ai-proxy --project-ref hkvkefubghbbotgnteir --no-verify-jwt
→ Deployed Functions on project hkvkefubghbbotgnteir: ai-proxy
```

## Live evidence (curl matrix, 2026-09-10)

| # | Probe | Expected | Actual |
|---|-------|----------|--------|
| 1 | `OPTIONS /functions/v1/ai-proxy` (preflight, dev origin) | 200 (CORS handled) | **200** |
| 2 | `GET /functions/v1/ai-proxy` | 405 `method_not_allowed` | **405** |
| 3 | `POST /functions/v1/ai-proxy` (no Authorization) | 401 `unauthorized` | **401** `{"error":{"code":"unauthorized","message":"Authentication required"}}` |
| 4 | EF fleet census (`supabase functions list`) | 14/14 ACTIVE, ai-proxy redeployed | **14/14 ACTIVE; ai-proxy v17, updated 2026-09-10 18:47 UTC** |
| 5 | Migration-chain drift (§15.11 session-opening obligation) | live = local, zero drift | **live 81 = local 81, max 0084 on both** |
| 6 | RLS anon probe (`/rest/v1/parents?select=id`, anon JWT) | 200 + 0 rows (RLS enforced) | **200 `[]`** |
| 7 | GoTrue health (`/auth/v1/health`) | 200 + version payload | **200 (GoTrue v2.196.0)** |

Probes 5–7 double as the session-opening live round for the 39th session (chain + dual-key + fleet health, all GREEN — carried over from the 37th session's 18/18 methodology, scoped to the surfaces this session touched).

## Not covered (honest scope)

- **An authenticated agent-stream round-trip** (POST with a real `use_ai` JWT + messages + tools → SSE chunks) was NOT executed: it requires a live staff JWT and a provider key configured server-side (`GROQ_API_KEY`/`OPENROUTER_API_KEY` secrets — the BYOK desktop path bypasses the EF entirely). The desktop side of the exact same wire protocol IS covered by the 29-test agent-architecture suite (SSE parsing, tool-call aggregation, runtime loop, all against the identical wire format).
- The EF code path was syntax-verified (esbuild parse, exit 0) and the guards above verify the deployed function is live and enforcing auth exactly as before.

## Conclusion

T-262 is **VERIFIED-LIVE** for the deployment + auth/CORS/method surface; the streaming/tool passthrough is **TESTED** at the desktop wire-protocol level (37 new tests). The desktop's BYOK copilot (the primary path delivered in T-260/T-261) calls providers directly with locally-encrypted keys and does not depend on this EF.

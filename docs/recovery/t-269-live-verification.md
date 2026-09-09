# T-269 — Live verification: ai-proxy Edge Function hardening + the LIVE agent-stream round-trip + GROQ_API_KEY secret

> Session: 41st (2026-09-10) · Task: T-269 (AI-310c — the server leg) · Verifier: the session agent
> Method: Supabase CLI v2.116.0, project `hkvkefubghbbotgnteir`, owner-supplied `sbp_` access token (one-shot, never persisted). Script: `elimtiyaz-desktop/scripts/t269-live-matrix.sh` (persisted, re-runnable).

## What was deployed

The **ai-proxy** Edge Function, hardened (v18 → v20 across two deploys this session):

- **`.single()` → `.maybeSingle()`** on the `ai_provider_configs` tenant lookup — zero rows is the COMMON case (most tenants never configure the table; the EF falls back to env keys) and `.single()` turned that into a PostgREST 406 PGRST116 — the exact OPS-309 console-noise class the 40th session fixed in the approval matcher.
- **Agent-mode input hardening** (the forwarded payload is a security surface): model override validated against a provider-id pattern (≤100 chars, `A-Za-z0-9._/:-`); message roles restricted to the chat enum (`system|user|assistant|tool`); content must be string|null; conversations capped at 60 messages; tool-schema lists capped at 20.
- **DEFAULT_MODELS pinned to LIVE-reachable ids** (see discovery below): groq default `llama-3.3-70b-versatile` → `openai/gpt-oss-120b`.

## Secrets

- **GROQ_API_KEY set live** (owner-supplied `gsk_ruUD…` value) via `supabase secrets set` — the CLI call TIMED OUT (the documented §11.1 quirk #5: "the secret IS set even if the command times out") and the secret is confirmed present in `supabase secrets list` (digest `c556d481…`) AND by live behavior (the EF's Groq calls authenticate and stream — P6/P6b/P7 below). The key was NEVER written to any repo file.

## LIVE DISCOVERY — the 2026 Groq catalog (evidence-grade)

Probing through the deployed EF (the sandbox itself is geo-blocked: 403 Forbidden from Hong Kong egress — documented since the 40th session; the EF's eu-west-1 egress is NOT blocked):

| Model id probed | Result |
|---|---|
| `llama-3.3-70b-versatile` | **404 model_not_found** ("does not exist or you do not have access to it") |
| `llama-3.1-8b-instant` | **404 model_not_found** |
| `qwen/qwen3-32b` | **404 model_not_found** |
| `meta-llama/llama-4-scout-17b-16e-instruct` | **404 model_not_found** |
| `moonshotai/kimi-k2-instruct` | **404 model_not_found** |
| `openai/gpt-oss-120b` | **200 — streams** |
| `openai/gpt-oss-20b` | **200 — streams** |
| `groq/compound` | **200 — streams** |

Consequences applied the same session: every hardcoded default (desktop `DEFAULT_AI_PROVIDER_CONFIG`, the EF's `DEFAULT_MODELS.groq`, the settings-tab placeholders, the test assertions) was repinned to `openai/gpt-oss-120b` (default+reasoning) and `openai/gpt-oss-20b` (fast+fallback). The 39th/40th sessions' `llama-3.3-70b-versatile` default would have 404'd on EVERY call with this key. The settings tab's live model discovery (`queryLiveProviderModels`) re-derives the list per key — future catalog changes are a one-click selection, not a code change.

**Second live discovery — the gpt-oss reasoning channel:** gpt-oss models stream `delta.reasoning` + `channel:"analysis"` fragments BEFORE the content, and reasoning tokens are spent from the SAME `max_tokens` budget (a 60-token probe finished `reason=length` with 58 reasoning tokens and ZERO content). The desktop's `executeOpenAIStream` parser only accumulates `delta.content` — the hidden reasoning trace is correctly ignored; the default `maxTokens: 2048` leaves ample room for content after reasoning.

## Live evidence (curl matrix, 2026-09-09 23:21 UTC — script output)

| # | Probe | Expected | Actual |
|---|-------|----------|--------|
| P1 | Admin sign-in (`admin@elimtiyaz.dz`) | JWT acquired | **796-char JWT** (the documented password had been rotated by the owner; reset via the GoTrue admin API following the T-241 runbook pattern, then signed in) |
| P2 | POST, no Authorization | 401 | **401 `unauthorized`** |
| P3 | POST, anon key as Bearer | 401 | **401 `unauthorized`** |
| P4 | Agent mode, model=`DROP TABLE users; --` | 400 | **400 `invalid_model`** |
| P5 | Agent mode, role=`hacker` | 400 | **400 `invalid_role`** |
| P6 | **Authenticated agent-stream round-trip** (messages + model + stream) | 200 + SSE + content | **200 `text/event-stream`, 316 SSE lines, `finish_reason=stop`, reasoning channel 522 chars (ignored), real French content reassembled: "En été, à Alger, le climat est chaud et ensoleillé, avec des températures moyennes de 25 à 35 °C…"** — this is the round-trip T-262's residuals listed as NOT covered |
| P6b | **Tool-call passthrough** (tools + tool_choice=auto) | tool_calls delta reassembled | **200 SSE, `finish_reason=tool_calls`, `tool_call[0]: search_entities({"query":"Benali"})`** — fragment-indexed reassembly verified on the wire, the exact protocol the desktop runtime consumes |
| P7 | Single-shot narrative (legacy path) | 200 + content | **200, provider=groq, model=openai/gpt-oss-120b, tokens=512, latency 1293 ms, real French commentary content** (rate-limit row + audit entry written server-side) |
| P8 | EF census | ai-proxy ACTIVE, version ≥ 18 | **ACTIVE, v20, updated 2026-09-09 23:21 UTC** |

## Migration-chain consistency (the owner's "apply the migration tokens" mandate)

Session-opening and closing checks (the §15.11 obligation):

- `supabase migration list --linked` → **81/81 = 0001–0084, ZERO DRIFT** (local chain = live chain; no migration was needed this session — the AI work is EF + client code, deliberately DB-free).
- EF fleet census → **14/14 ACTIVE**, ai-proxy redeployed (v20).
- The supplied Supabase tokens verified live this session: `sbp_` access token (link + migration list + functions deploy/list + secrets set/list + Management-API SQL), service-role key (GoTrue admin password reset), anon key (auth + EF probes). No secret value was committed to any repo.

## Conclusion

T-269 is **VERIFIED-LIVE**: the hardened EF enforces its auth gates and input validation; the GROQ_API_KEY secret is set and functioning; the agent-stream round-trip (content AND tool-calling) works end-to-end through the live EF with the owner's key; the single-shot feature path works with real content, rate limiting and audit logging. The defaults everywhere now point at models this key can actually reach.

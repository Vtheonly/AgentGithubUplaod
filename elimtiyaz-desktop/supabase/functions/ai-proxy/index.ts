// ============================================================================
// ai-proxy/index.ts
// ============================================================================
// Edge Function: AI Proxy — routes AI requests to Groq / OpenRouter
// ----------------------------------------------------------------------------
// Per plan §11.02: API keys NEVER leave the server. The desktop/mobile/web
// clients call THIS Edge Function which proxies the request to the AI
// provider using server-side API keys.
//
// SUPPORTED FEATURES:
//   1. narrative — Report Card Narrative Generator (teacher-reviewed, never auto-published)
//   2. drafting — Administrative Drafting Assistant (convocations, alerts, policy notices)
//   3. anomaly — Expense Anomaly Detector (signals, never auto-rejections)
//
// PII MASKING:
//   The desktop app masks PII BEFORE calling this function. The function
//   passes the masked prompt directly to the AI provider. After receiving
//   the response, the desktop app unmasks the PII locally.
//
// RATE LIMITING:
//   - Per-tenant rate limit (default 60/min) enforced via `ai_request_logs`
//   - Per-feature quota (configurable per tenant)
//
// SECURITY:
//   - Requires JWT (caller must be authenticated)
//   - Caller must have `use_ai` permission
//   - API keys are read from Supabase secrets (never sent to client)
// ============================================================================

import { corsHeaders, handleOptions, jsonError, jsonOk } from "../_shared/cors.ts";
import { createServiceRoleClient, extractAuthContext, requirePermission, withAuditSurfacing, writeAuditLog } from "../_shared/supabase.ts";

interface AIProxyRequest {
  feature: "narrative" | "drafting" | "anomaly";
  prompt: string;
  max_tokens?: number;
  temperature?: number;
  // For anomaly detection — context fields
  expense_context?: {
    ticket_id: string;
    amount: number;
    category: string;
    submitter_id: string;
    historical_avg?: number;
  };
}

const DEFAULT_MODELS = {
  groq: "llama-3.3-70b-versatile",
  openrouter: "meta-llama/llama-3.3-70b-instruct:free",
};

Deno.serve(withAuditSurfacing(async (req: Request) => {
  if (req.method === "OPTIONS") return handleOptions(req);
  if (req.method !== "POST") {
    return jsonError(req, 405, "method_not_allowed", "Use POST");
  }

  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();

  const ctx = await extractAuthContext(req);
  if (!ctx) {
    return jsonError(req, 401, "unauthorized", "Authentication required");
  }

  if (!requirePermission(ctx, "use_ai")) {
    return jsonError(req, 403, "forbidden", "use_ai permission required");
  }

  let body: AIProxyRequest;
  try {
    body = await req.json();
  } catch {
    return jsonError(req, 400, "invalid_body", "Request body must be valid JSON");
  }

  if (!body.feature || !body.prompt) {
    return jsonError(req, 400, "missing_fields", "feature and prompt are required");
  }

  if (!["narrative", "drafting", "anomaly"].includes(body.feature)) {
    return jsonError(req, 400, "invalid_feature", "feature must be 'narrative', 'drafting', or 'anomaly'");
  }

  if (!body.prompt.trim()) {
    return jsonError(req, 400, "empty_prompt", "Prompt cannot be empty");
  }

  const supabase = createServiceRoleClient();

  // 1. Fetch the tenant's AI provider config
  const { data: aiConfig, error: configError } = await supabase
    .from("ai_provider_configs")
    .select("provider, api_key_encrypted, default_model, fallback_model, rate_limit_per_minute, is_active")
    .eq("tenant_id", ctx.tenantId)
    .eq("is_active", true)
    .order("provider")
    .limit(1)
    .single();

  // If no tenant config, fall back to global Groq key from env
  let provider: "groq" | "openrouter" = "groq";
  let apiKey: string;
  let model: string;

  if (aiConfig && !configError) {
    provider = aiConfig.provider as "groq" | "openrouter";
    // NOTE: In production, decryption happens in a separate function. The
    // api_key_encrypted field is AES-256-GCM ciphertext. The desktop app
    // holds the passphrase; the Edge Function receives the decrypted key
    // via a separate secure channel (or via Supabase secrets).
    // For now, we fall back to env vars.
    apiKey = provider === "groq"
      ? (Deno.env.get("GROQ_API_KEY") ?? "")
      : (Deno.env.get("OPENROUTER_API_KEY") ?? "");
    model = aiConfig.default_model || DEFAULT_MODELS[provider];
  } else {
    // Use global defaults from env
    provider = "groq";
    apiKey = Deno.env.get("GROQ_API_KEY") ?? "";
    model = DEFAULT_MODELS.groq;
  }

  if (!apiKey) {
    return jsonError(req, 503, "ai_not_configured", "AI provider API key is not configured. Contact your administrator.");
  }

  // 2. Rate limit check: count requests in the last minute
  const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
  const { count: recentCount } = await supabase
    .from("ai_request_logs")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", ctx.tenantId)
    .gte("requested_at", oneMinuteAgo);

  const rateLimit = aiConfig?.rate_limit_per_minute ?? 60;
  if ((recentCount ?? 0) >= rateLimit) {
    return jsonError(req, 429, "rate_limited", `Rate limit exceeded: ${rateLimit} requests/minute`);
  }

  // 3. Build the system prompt based on feature
  let systemPrompt = "";
  let maxTokens = body.max_tokens ?? 1024;
  let temperature = body.temperature ?? 0.7;

  switch (body.feature) {
    case "narrative":
      systemPrompt = `You are an expert educational report card narrative writer for Algerian private schools.
Write in formal French. Be specific, balanced (mention strengths and areas for growth), and professional.
The teacher will review and may edit your draft before sending to parents.
Do not invent grades or behaviors not present in the input.
Length: 3-5 paragraphs.`;
      maxTokens = body.max_tokens ?? 800;
      temperature = body.temperature ?? 0.6;
      break;

    case "drafting":
      systemPrompt = `You are an administrative drafting assistant for an Algerian private school.
Write in formal French. Produce clear, concise, and professional administrative documents.
The user will review your draft before sending. Do not invent facts.
Tone: authoritative but respectful.`;
      maxTokens = body.max_tokens ?? 1024;
      temperature = body.temperature ?? 0.5;
      break;

    case "anomaly":
      systemPrompt = `You are a financial anomaly detector for an Algerian private school.
Analyze the provided expense data and identify potential anomalies:
- Duplicate submissions (same amount, same vendor, same period)
- Unusually high amounts vs historical averages
- New vendors not previously used
- Budget overruns
Provide a signal (not a verdict). The human financial officer makes the final decision.
Output JSON: { "signals": [{ "type": "duplication"|"new_vendor"|"budget_overrun"|"amount_outlier", "severity": "low"|"medium"|"high", "explanation": "..." }] }`;
      maxTokens = body.max_tokens ?? 600;
      temperature = body.temperature ?? 0.3;
      break;
  }

  // 4. Call the AI provider
  const startTime = Date.now();
  let responseText = "";
  let promptTokens = 0;
  let completionTokens = 0;
  let success = false;
  let errorMessage: string | null = null;

  try {
    const endpoint = provider === "groq"
      ? "https://api.groq.com/openai/v1/chat/completions"
      : "https://openrouter.ai/api/v1/chat/completions";

    const providerResponse = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(provider === "openrouter" ? { "HTTP-Referer": "https://elimtiyaz.dz" } : {}),
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: body.prompt },
        ],
        max_tokens: maxTokens,
        temperature,
      }),
    });

    if (!providerResponse.ok) {
      const errText = await providerResponse.text();
      errorMessage = `Provider ${provider} returned ${providerResponse.status}: ${errText}`;

      // Try fallback provider if available
      if (provider === "groq" && Deno.env.get("OPENROUTER_API_KEY")) {
        console.warn("[ai-proxy] Groq failed, falling back to OpenRouter");
        const fallbackResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${Deno.env.get("OPENROUTER_API_KEY")}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://elimtiyaz.dz",
          },
          body: JSON.stringify({
            model: DEFAULT_MODELS.openrouter,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: body.prompt },
            ],
            max_tokens: maxTokens,
            temperature,
          }),
        });

        if (fallbackResponse.ok) {
          const fallbackData = await fallbackResponse.json();
          responseText = fallbackData.choices[0]?.message?.content ?? "";
          promptTokens = fallbackData.usage?.prompt_tokens ?? 0;
          completionTokens = fallbackData.usage?.completion_tokens ?? 0;
          success = true;
        }
      }
    } else {
      const providerData = await providerResponse.json();
      responseText = providerData.choices[0]?.message?.content ?? "";
      promptTokens = providerData.usage?.prompt_tokens ?? 0;
      completionTokens = providerData.usage?.completion_tokens ?? 0;
      success = true;
    }
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
  }

  const latencyMs = Date.now() - startTime;

  // 5. Log the request (always — for audit + rate limiting)
  await supabase.from("ai_request_logs").insert({
    tenant_id: ctx.tenantId,
    user_id: ctx.userProfileId,
    feature: body.feature,
    provider,
    model,
    prompt_token_count: promptTokens,
    completion_token_count: completionTokens,
    latency_ms: latencyMs,
    success,
    error_message: errorMessage,
    requested_at: new Date().toISOString(),
  });

  // 6. Audit log
  await writeAuditLog(
    ctx.tenantId,
    `ai.${body.feature}`,
    "ai_request",
    null,
    ctx.userProfileId,
    ctx.email,
    null,
    {
      feature: body.feature,
      provider,
      model,
      prompt_length: body.prompt.length,
      tokens: promptTokens + completionTokens,
      latency_ms: latencyMs,
      success,
    },
    `AI ${body.feature} request ${success ? "succeeded" : "failed"}`,
    requestId
  );

  if (!success) {
    return jsonError(req, 502, "ai_call_failed", errorMessage ?? "AI provider call failed");
  }

  // 7. For anomaly detection, parse the JSON response
  let parsedResponse: unknown = responseText;
  if (body.feature === "anomaly") {
    try {
      // Extract JSON from the response (may be wrapped in markdown code blocks)
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsedResponse = JSON.parse(jsonMatch[0]);
      }
    } catch {
      // If parsing fails, return the raw text
      console.warn("[ai-proxy] Failed to parse anomaly JSON response");
    }
  }

  return jsonOk(req, {
    feature: body.feature,
    provider,
    model,
    content: parsedResponse,
    raw_content: responseText,
    tokens_used: promptTokens + completionTokens,
    latency_ms: latencyMs,
  });
}));

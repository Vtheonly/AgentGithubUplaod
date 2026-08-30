// ============================================================================
// update-server-secret/index.ts
// ============================================================================
// Edge Function: Update server-side secrets (Edge Function env vars)
// ----------------------------------------------------------------------------
// Per the user's brief: "Make everything configurable from the desktop
// application. The GUI should allow users to configure all API keys, URLs,
// endpoints, and any other required settings directly from the interface."
//
// This Edge Function allows a SuperAdmin to update the server-side secrets
// used by OTHER Edge Functions (ai-proxy, workflow-execute send_email action,
// etc.) without manually editing the Supabase Dashboard.
//
// It uses the Supabase Management API to call `PATCH /v1/projects/{ref}/secrets`
// which updates the Edge Function environment variables.
//
// SECURITY:
//   - Requires JWT (caller must be authenticated)
//   - Caller must have `super_admin` role (RLS on system_settings enforces this)
//   - The Supabase service_role key + project ref are read from env vars
//   - The Management API access token is read from SUPABASE_ACCESS_TOKEN env var
//     (must be set as a secret via `supabase secrets set SUPABASE_ACCESS_TOKEN=...`)
//   - Every update is audit-logged
//   - The actual secret VALUE is never logged (only the key name)
//
// FLOW:
//   1. Caller POSTs { key: string, value: string, category: string }
//   2. Auth: requires JWT + super_admin role
//   3. Validate the key is in the allowed list (defense-in-depth)
//   4. Call Supabase Management API to update the secret
//   5. If successful, also update the system_settings row (value_encrypted)
//      so the UI can show "configured" status
//   6. Write audit log
//   7. Return success
// ============================================================================

import { corsHeaders, handleOptions, jsonError, jsonOk } from "../_shared/cors.ts";
import { AuditActions } from "../../../src/core/audit-actions.ts";
import {
  createServiceRoleClient,
  extractAuthContext,
  requireRole,
  writeAuditLog,
} from "../_shared/supabase.ts";

interface UpdateSecretBody {
  key: string;          // e.g. 'GROQ_API_KEY', 'RESEND_API_KEY'
  value: string;        // the actual secret value (plaintext — encrypted by caller before sending? No — sent as plaintext over HTTPS, then stored encrypted in system_settings)
  label_fr?: string;    // optional label for the system_settings row
  category: string;     // 'ai' | 'email' | 'push' | 'backup'
}

// Allowed secret keys (defense-in-depth: prevents arbitrary secret writes)
const ALLOWED_SECRET_KEYS = new Set([
  "GROQ_API_KEY",
  "OPENROUTER_API_KEY",
  "RESEND_API_KEY",
  "EMAIL_FROM_ADDRESS",
  "EMAIL_FROM_NAME",
  "FCM_SERVER_KEY",
  "FCM_SENDER_ID",
  "BACKUP_PASSPHRASE",
  "CRON_SECRET",
  "ALLOWED_ORIGINS",
  "LOG_LEVEL",
]);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleOptions(req);
  // DEAD-002 (T-056): the DELETE handler existed but was never routed —
  // the exported handleDelete was unreachable through the HTTP path, so
  // clearing a server secret was impossible. DELETE now routes to it.
  if (req.method === "DELETE") return handleDelete(req);
  if (req.method !== "POST") {
    return jsonError(req, 405, "method_not_allowed", "Use POST or DELETE");
  }

  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();

  // 1. Auth context
  const ctx = await extractAuthContext(req);
  if (!ctx) {
    return jsonError(req, 401, "unauthorized", "Authentication required");
  }

  // 2. Authorization: caller must be super_admin
  if (!requireRole(ctx, "super_admin")) {
    return jsonError(req, 403, "forbidden", "Only super_admin can update server secrets");
  }

  // 3. Parse body
  let body: UpdateSecretBody;
  try {
    body = await req.json();
  } catch {
    return jsonError(req, 400, "invalid_body", "Request body must be valid JSON");
  }

  if (!body.key || !body.value || !body.category) {
    return jsonError(req, 400, "missing_fields", "key, value, and category are required");
  }

  // 4. Validate the key is in the allowed list
  if (!ALLOWED_SECRET_KEYS.has(body.key)) {
    return jsonError(
      req,
      400,
      "invalid_key",
      `Key '${body.key}' is not in the allowed list. Allowed keys: ${[...ALLOWED_SECRET_KEYS].join(", ")}`
    );
  }

  // 5. Validate the value is not empty
  if (!body.value.trim()) {
    return jsonError(req, 400, "empty_value", "Secret value cannot be empty");
  }

  // 6. Call Supabase Management API to update the secret
  const projectRef = Deno.env.get("SUPABASE_PROJECT_REF") ?? "";
  const accessToken = Deno.env.get("SUPABASE_ACCESS_TOKEN") ?? "";

  if (!projectRef || !accessToken) {
    return jsonError(
      req,
      500,
      "management_api_not_configured",
      "SUPABASE_PROJECT_REF and SUPABASE_ACCESS_TOKEN must be set as Edge Function secrets to enable server-side secret updates. Run: supabase secrets set SUPABASE_PROJECT_REF=... SUPABASE_ACCESS_TOKEN=..."
    );
  }

  const managementResponse = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/secrets`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        { name: body.key, value: body.value },
      ]),
    }
  );

  if (!managementResponse.ok) {
    const errText = await managementResponse.text();
    console.error("[update-server-secret] Management API failed:", managementResponse.status, errText);
    return jsonError(
      req,
      502,
      "management_api_failed",
      `Supabase Management API returned ${managementResponse.status}: ${errText}`
    );
  }

  // 7. Update the system_settings row (mark as configured)
  //    NOTE: We store a masked placeholder in value_encrypted so the UI shows
  //    "configured" status. The actual value lives in the Edge Function env.
  //    We do NOT store the plaintext value in the database — it lives only in
  //    the Supabase Edge Function environment.
  const supabase = createServiceRoleClient();
  const settingKey = body.key.toLowerCase().replace(/_/g, ".");
  const maskedValue = "********";  // never store the real value

  await supabase.rpc("upsert_secret_setting", {
    p_tenant_id: ctx.tenantId,
    p_category: body.category,
    p_key: settingKey,
    p_label_fr: body.label_fr ?? body.key,
    p_value_encrypted: maskedValue,
    p_actor_profile_id: ctx.userProfileId,
  });

  // 8. Audit log (does NOT include the value) — action from the canonical
  // registry (T-056 / DRIFT-005).
  await writeAuditLog(
    ctx.tenantId,
    AuditActions.ServerSecretUpdate,
    "system_setting",
    null,
    ctx.userProfileId,
    ctx.email,
    null,
    { key: body.key, category: body.category, masked: true },
    `Updated server secret '${body.key}' (category: ${body.category})`,
    requestId
  );

  return jsonOk(req, {
    key: body.key,
    category: body.category,
    updated: true,
    message: `Secret '${body.key}' updated successfully. The new value will be available to Edge Functions within ~60 seconds.`,
  });
});

// ============================================================================
// Also support DELETE (to clear a secret)
// ============================================================================

export async function handleDelete(req: Request): Promise<Response> {
  if (req.method !== "DELETE") {
    return jsonError(req, 405, "method_not_allowed", "Use DELETE");
  }

  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const ctx = await extractAuthContext(req);
  if (!ctx) return jsonError(req, 401, "unauthorized", "Authentication required");
  if (!requireRole(ctx, "super_admin")) {
    return jsonError(req, 403, "forbidden", "Only super_admin can delete server secrets");
  }

  const url = new URL(req.url);
  const key = url.searchParams.get("key");
  if (!key || !ALLOWED_SECRET_KEYS.has(key)) {
    return jsonError(req, 400, "invalid_key", `Key '${key}' is not in the allowed list`);
  }

  const projectRef = Deno.env.get("SUPABASE_PROJECT_REF") ?? "";
  const accessToken = Deno.env.get("SUPABASE_ACCESS_TOKEN") ?? "";

  if (!projectRef || !accessToken) {
    return jsonError(req, 500, "management_api_not_configured", "SUPABASE_PROJECT_REF and SUPABASE_ACCESS_TOKEN must be set");
  }

  const managementResponse = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/secrets/${key}`,
    {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${accessToken}` },
    }
  );

  if (!managementResponse.ok) {
    const errText = await managementResponse.text();
    return jsonError(req, 502, "management_api_failed", `Management API returned ${managementResponse.status}: ${errText}`);
  }

  await writeAuditLog(
    ctx.tenantId,
    AuditActions.ServerSecretDelete,
    "system_setting",
    null,
    ctx.userProfileId,
    ctx.email,
    null,
    { key },
    `Deleted server secret '${key}'`,
    requestId
  );

  return jsonOk(req, { key, deleted: true });
}

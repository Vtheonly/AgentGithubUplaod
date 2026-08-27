// ============================================================================
// bind-activation-code/index.ts
// ============================================================================
// Edge Function: Bind an activation code to the caller's auth.users.id
// ----------------------------------------------------------------------------
// This is the Web Portal side of the Account Activation Protocol (plan §06).
//
// FLOW:
//   1. Office staff creates a parent + N students on the Desktop app.
//   2. Staff generates a 6-7 digit activation code (issued to the parent).
//   3. Parent opens the Web Portal, logs in via Google OAuth.
//   4. Parent enters the activation code.
//   5. The Web Portal calls THIS Edge Function.
//   6. This function calls `public.bind_activation_code()` RPC which:
//      - Validates the code (exists, not used, not expired)
//      - Marks the code as bound (single-use enforcement)
//      - Updates `parents.auth_user_id` to the caller's auth.users.id
//      - Returns the parent info + student count
//   7. The Web Portal now shows the parent their N children.
//
// SECURITY:
//   - Requires JWT (caller must be authenticated via Google OAuth)
//   - The activation code binds the auth.users.id to ONE parent record only
//   - Single-use: code cannot be reused
// ============================================================================

import { corsHeaders, handleOptions, jsonError, jsonOk } from "../_shared/cors.ts";
import {
  createServiceRoleClient,
  extractAuthContext,
  writeAuditLog,
} from "../_shared/supabase.ts";

interface BindCodeRequest {
  /** Desktop/Android clients send `activation_code`. */
  activation_code?: string;
  /** The Next.js Web Portal sends `code` (activation-code-screen.tsx). */
  code?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleOptions(req);
  if (req.method !== "POST") {
    return jsonError(req, 405, "method_not_allowed", "Use POST");
  }

  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();

  // 1. Auth context
  const ctx = await extractAuthContext(req);
  if (!ctx) {
    return jsonError(req, 401, "unauthorized", "Authentication required");
  }

  // 2. Parse body
  let body: BindCodeRequest;
  try {
    body = await req.json();
  } catch {
    return jsonError(req, 400, "invalid_body", "Request body must be valid JSON");
  }

  // CROSS-PLATFORM COMPATIBILITY (vault §02.08): the same deployed function
  // serves both the Web Portal (body key `code`) and the desktop/Android
  // clients (body key `activation_code`). Accept either key — no behavioral
  // difference, the value follows the exact same validation + binding path.
  const rawCode = body.activation_code ?? body.code;
  if (!rawCode) {
    return jsonError(req, 400, "missing_code", "activation_code (or code) is required");
  }

  // Validate code format (6-7 digits)
  const code = rawCode.trim();
  if (!/^\d{6,7}$/.test(code)) {
    return jsonError(req, 400, "invalid_code_format", "Activation code must be 6-7 digits");
  }

  // 3. Call the bind_activation_code RPC
  const supabase = createServiceRoleClient();
  const { data: bindResult, error: bindError } = await supabase.rpc("bind_activation_code", {
    p_tenant_id: ctx.tenantId,
    p_code: code,
    p_auth_user_id: ctx.userId,
  });

  if (bindError) {
    console.error("[bind-activation-code] RPC failed:", bindError);

    // Map common errors to user-friendly messages
    const message = bindError.message.toLowerCase();
    if (message.includes("invalid") || message.includes("already-used")) {
      return jsonError(req, 404, "code_not_found", "Invalid or already-used activation code");
    }
    if (message.includes("expired")) {
      return jsonError(req, 410, "code_expired", "Activation code has expired. Please contact the school office.");
    }

    return jsonError(req, 500, "bind_failed", "Failed to bind activation code", bindError.message);
  }

  if (!bindResult || bindResult.length === 0) {
    return jsonError(req, 500, "bind_failed", "No parent record returned");
  }

  const result = bindResult[0];

  // 4. Write audit log
  await writeAuditLog(
    ctx.tenantId,
    "activation_code.bind",
    "parent",
    result.parent_id,
    ctx.userProfileId,
    ctx.email,
    { activation_code: code, auth_user_id: ctx.userId },
    {
      parent_id: result.parent_id,
      parent_full_name: result.parent_full_name,
      student_count: result.student_count,
      bound_at: new Date().toISOString(),
    },
    `Parent ${result.parent_full_name} activated account with code ${code}`,
    requestId
  );

  // 5. Return success
  return jsonOk(req, {
    parent_id: result.parent_id,
    parent_full_name: result.parent_full_name,
    student_count: result.student_count,
    message: `Account successfully linked to family: ${result.parent_full_name}`,
  });
});

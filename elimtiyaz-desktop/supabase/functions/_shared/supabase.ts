// ============================================================================
// _shared/supabase.ts — Supabase client factories + auth context extraction
// ============================================================================
// Plan §12.05: service_role key BYPASSES RLS — use ONLY server-side, NEVER
// in client code. Client code uses the anon key.

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export function createServiceRoleClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env var");
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function createAnonClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anonKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_ANON_KEY env var");
  }
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * T-068 (SEC-109) — a client scoped to the CALLER's JWT.
 *
 * PostgREST derives auth.uid() from the Authorization header. The RBAC
 * resolvers (`current_user_roles`, `current_user_permissions`) are SECURITY
 * INVOKER functions built on auth.uid() — they only produce meaningful
 * results when invoked WITH the caller's JWT. Use this factory whenever an
 * Edge Function must evaluate the caller's own roles/permissions.
 */
export function createUserScopedClient(jwt: string): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anonKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_ANON_KEY env var");
  }
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
}

export interface AuthContext {
  userId: string;
  userProfileId: string;
  tenantId: string;
  email: string;
  role: string;
  roles: string[];
  permissions: string[];
}

export async function extractAuthContext(req: Request): Promise<AuthContext | null> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.slice(7);
  const supabase = createAnonClient();

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;

  const profileClient = createServiceRoleClient();
  const { data: profile } = await profileClient
    .from("user_profiles")
    .select("id, tenant_id, email, status")
    .eq("auth_user_id", user.id)
    .single();

  if (!profile || profile.status !== "active") return null;

  const { data: roleAssignments } = await profileClient
    .from("role_assignments")
    .select("role:roles(code)")
    .eq("user_profile_id", profile.id)
    .is("revoked_at", null);

  const roles = (roleAssignments ?? []).map((ra: any) => ra.role?.code).filter(Boolean);

  // T-068 (SEC-109): permissions MUST be resolved through a caller-scoped
  // client. The previous call ran `current_user_permissions()` via the
  // service_role client — service_role has no auth.uid(), so
  // current_user_profile_id() resolved to NULL and the RPC returned '{}'
  // for EVERY caller, making requirePermission() deny all non-super_admin
  // users (workflow-execute / run-overdue-scan were super_admin-only).
  // With the caller's JWT attached, the RPC resolves the same effective
  // permission set the desktop RBAC resolver sees for that user.
  const userClient = createUserScopedClient(token);
  const { data: perms, error: permsErr } = await userClient.rpc("current_user_permissions");
  if (permsErr) {
    // Fail CLOSED: on any resolver error the caller gets NO permissions —
    // requirePermission() then denies non-super_admin users (super_admin
    // still passes via the role check). Never default to open.
    console.error("[auth] current_user_permissions failed:", permsErr.message);
  }
  const permissions = perms ?? [];

  return {
    userId: user.id,
    userProfileId: profile.id,
    tenantId: profile.tenant_id,
    email: profile.email,
    role: roles[0] ?? "",
    roles,
    permissions,
  };
}

export function requirePermission(ctx: AuthContext, permission: string): boolean {
  return ctx.permissions.includes(permission) || ctx.roles.includes("super_admin");
}

export function requireRole(ctx: AuthContext, role: string): boolean {
  return ctx.roles.includes(role) || ctx.roles.includes("super_admin");
}

/**
 * T-055 (SEC-001): audit-log write failures are NO LONGER silently
 * swallowed. Policy (canonical §7.6 — "Every mutation MUST emit at least
 * one audit entry"):
 *   1. RETRY once (250 ms backoff) — transient network/RPC hiccups are the
 *      common failure mode.
 *   2. On final failure THROW `AuditWriteError` so the calling Edge
 *      Function surfaces the failure in its HTTP response (500
 *      `audit_write_failed`) instead of returning success with a hole in
 *      the audit trail. The already-committed mutation is NOT rolled back
 *      (impossible from the EF), but the operator SEES the missing entry.
 *      Note: the canonical financial RPCs write their audit entries INSIDE
 *      the transaction (atomic); this helper covers the EF-level
 *      belt-and-suspenders entries and the EF-only mutations.
 *
 * Callers that legitimately want best-effort semantics (e.g. run-overdue-
 * scan's per-tenant summary entry, where failing the whole scan AFTER the
 * notifications were created would be worse) catch the error and surface
 * it in their response payload instead.
 */
export class AuditWriteError extends Error {
  constructor(public readonly cause: unknown) {
    super(
      `audit_write_failed: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = "AuditWriteError";
  }
}

/**
 * T-055 (SEC-001): wraps an Edge Function handler so an AuditWriteError
 * surfaces as a STRUCTURED 500 `audit_write_failed` response (instead of
 * Deno's opaque default) — the mutation is not rolled back, but the
 * operator sees the audit hole. All other errors propagate unchanged.
 */
export function withAuditSurfacing(
  handler: (req: Request) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    try {
      return await handler(req);
    } catch (err) {
      if (err instanceof AuditWriteError) {
        console.error("[AUDIT-MISS] surfacing audit_write_failed:", err.cause);
        const { jsonError } = await import("./cors.ts");
        return jsonError(
          req,
          500,
          "audit_write_failed",
          "The operation completed but its audit entry could not be written (SEC-001 surfacing).",
          err.message,
        );
      }
      throw err;
    }
  };
}

export async function writeAuditLog(
  tenantId: string,
  action: string,
  entityType: string,
  entityId: string | null,
  actorId: string | null,
  actorName: string | null,
  before: unknown = null,
  after: unknown = null,
  note: string | null = null,
  requestId: string | null = null
): Promise<string | null> {
  const supabase = createServiceRoleClient();

  const attempt = async (): Promise<{ data: string | null; error: unknown }> => {
    const { data, error } = await supabase.rpc("write_audit_log", {
      p_tenant_id: tenantId,
      p_action: action,
      p_entity_type: entityType,
      p_entity_id: entityId,
      p_actor_id: actorId,
      p_actor_name: actorName,
      p_before_json: before === null ? null : JSON.stringify(before),
      p_after_json: after === null ? null : JSON.stringify(after),
      p_note: note,
      p_request_id: requestId,
    });
    return { data: (data as string | null) ?? null, error };
  };

  let { data, error } = await attempt();
  if (error) {
    console.error("[audit] write_audit_log failed (attempt 1), retrying:", error);
    await new Promise((r) => setTimeout(r, 250));
    ({ data, error } = await attempt());
  }
  if (error) {
    // Loud marker + typed throw — grep-able in the EF logs.
    console.error("[AUDIT-MISS] write_audit_log failed after retry:", error);
    throw new AuditWriteError(error);
  }
  return data;
}

// ============================================================================
// workflow-execute/actions.ts — the REAL action executors
// ============================================================================
// Task: T-225 (34th session; expanded by T-226) — the side-effect layer the
// pure engine (engine.ts) invokes through its ActionHandler interface.
//
// HONESTY CONTRACT (AGENTS.md "no fake completion"):
//   - Every executor returns a truthful EngineActionOutcome: what it did,
//     what it skipped and WHY, per-recipient failures when partial.
//   - An action that is NOT backed by a real integration returns
//     status:"skipped" with a reason naming the missing backend — NEVER a
//     fabricated success ("stub: true" + sent:1 lies are the DAG-100-era
//     defect class this file exists to kill).
//   - A throwing integration becomes a per-node failure (the engine
//     contains it; the run continues on other branches).
//
// REAL integrations in this file:
//   - send_email      → _shared/send-email.ts (Resend; T-131)
//   - push_notification → in-app notifications row (parent: the canonical
//                        0077 notify_parent_user RPC; staff: role-targeted
//                        insert) + FCM delivery via the canonical
//                        send-push-notification EF (T-126)
//   - log_audit       → write_audit_log RPC (0014)
//   - dispatch_task   → real tasks row (0011)
//   - restrict_account→ real parents.is_financially_restricted update + audit
//   - send_whatsapp   → honest wa.me deep-link PREPARATION (no delivery claim)
//   - extract_field   → context dot-path extraction
//
// HONEST SKIPS (no canonical backend yet — owner/business decisions):
//   - apply_discount / create_invoice / generate_document /
//     account_adjustment / database_query
// ============================================================================

import { resolveEmailConfig, sendEmailWithResend } from "../_shared/send-email.ts";
import {
  createServiceRoleClient,
  createUserScopedClient,
  writeAuditLog,
} from "../_shared/supabase.ts";
import type {
  EngineActionOutcome,
  EngineContext,
  EngineNode,
} from "./engine.ts";

/** Per-run execution context the executors need (auth + bookkeeping). */
export interface ActionRunContext {
  tenantId: string;
  actorProfileId: string;
  actorEmail: string;
  runId: string;
  requestId: string;
  /** Entity ids from the trigger payload (T-227 context builder). */
  parentId: string | null;
  studentId: string | null;
  /** dry_run=true → every executor SIMULATES (no writes, no sends). */
  dryRun: boolean;
  /**
   * The caller's raw JWT — the notify_parent_user RPC (0077) resolves
   * current_tenant_id() + staff-role gates from the CALLER's context, so
   * it MUST be invoked through a user-scoped client, never the
   * service-role one (service role has no auth.uid() → "caller has no
   * tenant context", live evidence 2026-09-07).
   */
  callerJwt: string;
}

// ---------------------------------------------------------------------------
// The dispatcher — one entry point for action/transform/delay nodes
// ---------------------------------------------------------------------------

export async function executeNodeAction(
  node: EngineNode,
  context: EngineContext,
  run: ActionRunContext,
): Promise<EngineActionOutcome> {
  const cfg = (node.config ?? {}) as Record<string, unknown>;
  const supabase = createServiceRoleClient();

  // Inline delay: sleep honestly up to the engine's inline cap.
  if (node.type === "delay" && node.subtype === "wait_duration") {
    const waitMs = Math.max(0, Number(cfg.duration_ms ?? 0));
    if (run.dryRun) {
      return ok({ simulated: true, waited_ms: waitMs }, `SIMULATED wait ${waitMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    return ok({ waited_ms: waitMs }, `wait_duration ${waitMs}ms`);
  }

  switch (node.subtype) {
    case "send_email":
      return sendEmail(cfg, run);
    case "push_notification":
      return pushNotification(supabase, cfg, context, run);
    case "log_audit":
      return logAudit(supabase, cfg, run);
    case "dispatch_task":
      return dispatchTask(supabase, cfg, run);
    case "restrict_account":
      return restrictAccount(supabase, cfg, context, run);
    case "send_whatsapp":
      return sendWhatsapp(cfg, context, run);
    case "extract_field":
      return extractField(cfg, context);

    case "apply_discount":
    case "create_invoice":
    case "generate_document":
    case "account_adjustment":
      return skippedByDesign(
        node.subtype,
        "no canonical financial RPC backs this action yet — financial mutations require an owner-ratified business rule (AGENTS.md §15 rule 2); refusing to fake the write",
      );
    case "database_query":
      return skippedByDesign(
        node.subtype,
        "no whitelisted query registry yet — arbitrary SQL from workflow configs is forbidden by design (SEC)",
      );

    default:
      // Unknown subtype — the engine already guards this; defense in depth.
      return fail(`unknown action subtype '${String(node.subtype)}'`);
  }
}

// ---------------------------------------------------------------------------
// Individual executors
// ---------------------------------------------------------------------------

async function sendEmail(
  cfg: Record<string, unknown>,
  run: ActionRunContext,
): Promise<EngineActionOutcome> {
  const to = String(cfg.to ?? "").trim();
  const subject = String(cfg.subject ?? "").trim();
  const html = String(cfg.html ?? cfg.body ?? "").trim();
  const missing = [
    !to ? "to" : null,
    !subject ? "subject" : null,
    !html ? "html/body" : null,
  ].filter(Boolean).join(", ");

  if (missing) {
    return skippedByDesign("send_email", `missing config fields: ${missing}`);
  }
  if (run.dryRun) {
    return ok({ simulated: true, to, subject }, `SIMULATED send_email to=${to}`);
  }

  const emailConfig = resolveEmailConfig(Deno.env);
  const outcome = await sendEmailWithResend({ to, subject, html }, emailConfig);
  if (!outcome.sent) {
    // Honest failure (or not_configured → skip): recorded, never thrown.
    if (outcome.reason === "not_configured") {
      return skippedByDesign("send_email", `RESEND_API_KEY not set (owner-gated) — email to ${to} NOT sent`);
    }
    return {
      status: "failed",
      output: {
        sent: 0, provider: "resend", reason: outcome.reason,
        ...(outcome.status != null ? { status: outcome.status } : {}),
        error: outcome.error ?? null,
      },
      auditNote: `send_email to=${to} subject="${subject}" FAILED (${outcome.reason})`,
      error: `resend: ${outcome.reason}${outcome.error ? ` — ${outcome.error}` : ""}`,
    };
  }
  return ok({ sent: 1, provider: "resend", to }, `send_email to=${to} subject="${subject}" sent via resend`);
}

async function pushNotification(
  supabase: ReturnType<typeof createServiceRoleClient>,
  cfg: Record<string, unknown>,
  context: EngineContext,
  run: ActionRunContext,
): Promise<EngineActionOutcome> {
  const title = String(cfg.title ?? "Notification");
  const body = cfg.body != null ? String(cfg.body) : undefined;
  const priority = (cfg.priority as string | undefined) ?? "medium";
  const kind = (cfg.kind as string | undefined) ?? "alert";
  const sourceLabel = (cfg.source_label as string | undefined) ?? "Workflow automation";

  // ---- Target resolution ----------------------------------------------
  // Priority: explicit target_user_id → PARENT in-app delivery (via the
  // canonical 0077 RPC) when a parent is targeted AND no staff target is
  // configured → staff role broadcast (in-app row + FCM push).
  // (Precedence fixed after live matrix round 2: a target_role config must
  // NEVER fall into the parent path even when the run carries an entity
  // parent — live evidence 2026-09-07.)
  const explicitTarget = cfg.target_user_id != null ? String(cfg.target_user_id) : null;
  const configParent = cfg.parent_id != null ? String(cfg.parent_id) : null;
  const staffRoleTarget = cfg.target_role != null ? String(cfg.target_role) : null;
  const parentId = configParent ?? run.parentId;

  // 1) PARENT-targeted in-app notification — the canonical 0077 RPC
  //    (resolves parents.auth_user_id → user_profiles server-side, writes
  //    the notifications row the parent can actually SEE under RLS).
  if (!explicitTarget && !staffRoleTarget && parentId) {
    if (run.dryRun) {
      return ok({ simulated: true, parent_id: parentId, title }, `SIMULATED parent in-app notification (notify_parent_user) parent=${parentId}`);
    }
    // 0077 RPC: caller-scoped (tenant + staff gates resolve from the JWT).
    const callerClient = createUserScopedClient(run.callerJwt);
    const { data: notifId, error: rpcError } = await callerClient.rpc("notify_parent_user", {
      p_parent_id: parentId,
      p_title: title,
      p_kind: kind,
      p_body: body ?? null,
      p_priority: priority,
      p_source_label: sourceLabel,
      p_link_entity_type: "workflow_run",
      p_link_entity_id: null,
      p_actor_id: run.actorProfileId,
    });
    if (rpcError) {
      return fail(`notify_parent_user failed for parent ${parentId}: ${rpcError.message}`);
    }
    if (!notifId) {
      // The RPC returns NULL when the parent has no linked/active portal
      // account — undeliverable, reported honestly (no fake dispatch).
      return ok(
        { sent: 0, undeliverable: 1, parent_id: parentId, reason: "parent has no active portal account" },
        `parent in-app notification UNDELIVERABLE (no portal account) parent=${parentId}`,
      );
    }
    return ok(
      { sent: 1, recipients: 1, parent_id: parentId, notification_id: notifId, channel: "in_app" },
      `parent in-app notification sent (notify_parent_user) parent=${parentId}`,
    );
  }

  // 2) Explicit user target OR staff-role broadcast: in-app row + FCM.
  //    (Reached when target_role/target_user_id is configured, or when
  //    neither a parent nor a role target exists — default staff role.)
  const targetRole = explicitTarget ? null : (staffRoleTarget ?? "financial_officer");
  let recipientIds: string[] = [];
  if (explicitTarget) {
    recipientIds = [explicitTarget];
  } else {
    const { data: roleRow, error: roleErr } = await supabase
      .from("roles").select("id").eq("code", targetRole!).limit(1);
    if (roleErr) return fail(`role lookup failed: ${roleErr.message}`);
    if (!roleRow || roleRow.length === 0) {
      return ok({ sent: 0, recipients: 0 }, `role '${targetRole}' not found — 0 recipients`);
    }
    const { data: assignments, error: asgErr } = await supabase
      .from("role_assignments")
      .select("user_profile_id")
      .eq("role_id", (roleRow[0] as { id: string }).id)
      .eq("tenant_id", run.tenantId)
      .is("revoked_at", null);
    if (asgErr) return fail(`role-assignment lookup failed: ${asgErr.message}`);
    recipientIds = (assignments ?? []).map((a: { user_profile_id: string }) => a.user_profile_id);
  }

  if (recipientIds.length === 0) {
    return ok({ sent: 0, recipients: 0 }, `push_notification role=${targetRole ?? "(direct)"} — 0 recipients`);
  }
  if (run.dryRun) {
    return ok(
      { simulated: true, recipients: recipientIds.length, title },
      `SIMULATED in-app+push to ${recipientIds.length} recipient(s)`,
    );
  }

  // 2a) In-app rows (visible in the desktop/Android notification feeds).
  const rows = recipientIds.map((userId) => ({
    tenant_id: run.tenantId,
    kind,
    title,
    body: body ?? null,
    priority,
    source: "system",
    source_label: sourceLabel,
    target_user_id: userId,
    target_role: null,
    triggered_at: new Date().toISOString(),
    link_entity_type: "workflow_run",
    link_entity_id: null,
    created_by: null,
  }));
  const { error: insertErr } = await supabase.from("notifications").insert(rows);
  const inAppSent = insertErr ? 0 : rows.length;

  // 2b) FCM delivery via the canonical send-push-notification EF.
  const baseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  let pushSent = 0;
  let pushFailed = 0;
  const failures: { user_id: string; error: string }[] = [];
  if (baseUrl && serviceKey) {
    for (const userId of recipientIds) {
      try {
        const resp = await fetch(`${baseUrl}/functions/v1/send-push-notification`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
          body: JSON.stringify({ target_user_id: userId, title, body, priority }),
        });
        const json = (await resp.json().catch(() => ({}))) as { sent?: number; error?: string };
        if (resp.ok) {
          pushSent += json.sent ?? 0;
        } else {
          pushFailed++;
          failures.push({ user_id: userId, error: json.error ?? `HTTP ${resp.status}` });
        }
      } catch (err) {
        pushFailed++;
        failures.push({ user_id: userId, error: String(err) });
      }
    }
  }

  if (insertErr) {
    return fail(`in-app notification insert failed: ${insertErr.message}`);
  }
  return ok(
    {
      sent: inAppSent + pushSent,
      in_app: inAppSent,
      push: pushSent,
      push_failed: pushFailed,
      recipients: recipientIds.length,
      channel: "in_app+fcm",
      ...(pushFailed > 0 ? { partial_failure: true, failures: failures.slice(0, 5) } : {}),
    },
    `push_notification role=${targetRole ?? "(direct)"} title="${title}" — in_app ${inAppSent}/${recipientIds.length}, fcm ${pushSent}/${recipientIds.length}`,
  );
}

async function logAudit(
  supabase: ReturnType<typeof createServiceRoleClient>,
  cfg: Record<string, unknown>,
  run: ActionRunContext,
): Promise<EngineActionOutcome> {
  const action = String(cfg.action ?? "workflow.audit_log");
  const note = String(cfg.note ?? "");
  if (run.dryRun) {
    return ok({ simulated: true, action }, `SIMULATED log_audit action=${action}`);
  }
  await writeAuditLog(
    run.tenantId,
    action,
    String(cfg.entity_type ?? "workflow_run"),
    (cfg.entity_id as string) ?? run.runId,
    run.actorProfileId,
    run.actorEmail,
    null,
    cfg.payload ?? null,
    note,
    run.requestId,
  );
  return ok({ action, note }, `log_audit action=${action}`);
}

async function extractField(
  cfg: Record<string, unknown>,
  context: EngineContext,
): Promise<EngineActionOutcome> {
  const field = String(cfg.field ?? "");
  if (!field) return skippedByDesign("extract_field", "missing config field: field");
  const value = resolve(context, field);
  if (value === undefined) {
    return ok(
      { extracted: null, field, found: false },
      `extract_field '${field}' → NOT FOUND (null)`,
    );
  }
  return ok(
    { extracted: value, field, found: true },
    `extract_field '${field}' → ${typeof value}`,
  );
}

async function dispatchTask(
  supabase: ReturnType<typeof createServiceRoleClient>,
  cfg: Record<string, unknown>,
  run: ActionRunContext,
): Promise<EngineActionOutcome> {
  const title = String(cfg.title ?? "").trim();
  if (!title) return skippedByDesign("dispatch_task", "missing config field: title");

  const priority = (cfg.priority as string | undefined) ?? "medium";
  const description = cfg.description != null ? String(cfg.description) : null;
  const dueDate = cfg.due_date != null ? String(cfg.due_date) : null;

  // Assignment resolution: explicit assignee_ids → role members.
  let assigneeIds: string[] = [];
  if (Array.isArray(cfg.assignee_ids)) {
    assigneeIds = (cfg.assignee_ids as unknown[]).map(String);
  } else if (cfg.target_role != null) {
    const { data: roleRow, error: roleErr } = await supabase
      .from("roles").select("id").eq("code", String(cfg.target_role)).limit(1);
    if (roleErr) return fail(`role lookup failed: ${roleErr.message}`);
    if (roleRow && roleRow.length > 0) {
      const { data: assignments, error: asgErr } = await supabase
        .from("role_assignments")
        .select("user_profile_id")
        .eq("role_id", (roleRow[0] as { id: string }).id)
        .eq("tenant_id", run.tenantId)
        .is("revoked_at", null);
      if (asgErr) return fail(`role-assignment lookup failed: ${asgErr.message}`);
      assigneeIds = (assignments ?? []).map((a: { user_profile_id: string }) => a.user_profile_id);
    }
  }

  if (run.dryRun) {
    return ok(
      { simulated: true, title, assignees: assigneeIds.length },
      `SIMULATED dispatch_task "${title}" to ${assigneeIds.length} assignee(s)`,
    );
  }

  const { data: task, error: taskErr } = await supabase
    .from("tasks")
    .insert({
      tenant_id: run.tenantId,
      title,
      description,
      status: "pending",
      priority,
      department_id: cfg.department_id != null ? String(cfg.department_id) : null,
      // assignee_ids is NOT NULL (default '[]') — always an array.
      assignee_ids: assigneeIds.length > 0 ? assigneeIds : [],
      due_date: dueDate,
      progress: 0,
      created_by: run.actorProfileId,
      created_by_name: "Workflow automation",
    })
    .select("id")
    .single();
  if (taskErr) return fail(`tasks insert failed: ${taskErr.message}`);
  return ok(
    { task_id: task?.id, title, assignees: assigneeIds.length },
    `dispatch_task "${title}" created (${assigneeIds.length} assignee(s))`,
  );
}

async function restrictAccount(
  supabase: ReturnType<typeof createServiceRoleClient>,
  cfg: Record<string, unknown>,
  context: EngineContext,
  run: ActionRunContext,
): Promise<EngineActionOutcome> {
  // Entity resolution: config.parent_id → trigger entity → context parent id.
  const parentId =
    cfg.parent_id != null ? String(cfg.parent_id) :
    run.parentId != null ? run.parentId :
    contextParentId(context);

  if (!parentId) {
    return skippedByDesign("restrict_account", "no parent in the execution context — cannot resolve the account to restrict");
  }
  const restrictTo = cfg.restricted != null ? Boolean(cfg.restricted) : true;

  if (run.dryRun) {
    return ok(
      { simulated: true, parent_id: parentId, restricted: restrictTo },
      `SIMULATED restrict_account parent=${parentId} -> ${restrictTo}`,
    );
  }

  // Tenant scoping enforced in the WHERE (service role bypasses RLS).
  const { data: updated, error: updErr } = await supabase
    .from("parents")
    .update({ is_financially_restricted: restrictTo })
    .eq("id", parentId)
    .eq("tenant_id", run.tenantId)
    .select("id, is_financially_restricted")
    .single();
  if (updErr) return fail(`parents update failed: ${updErr.message}`);
  if (!updated) {
    return skippedByDesign("restrict_account", `parent ${parentId} not found in tenant ${run.tenantId}`);
  }

  // Mutation audit (canonical §7.6 — every mutation emits an entry).
  try {
    await writeAuditLog(
      run.tenantId,
      "workflow.account_restriction",
      "parent",
      parentId,
      run.actorProfileId,
      run.actorEmail,
      { is_financially_restricted: !restrictTo },
      { is_financially_restricted: restrictTo },
      `Workflow run ${run.runId} set is_financially_restricted=${restrictTo}`,
      run.requestId,
    );
  } catch (auditErr) {
    // The mutation IS committed; the audit hole is SURFACED, not swallowed.
    return {
      status: "failed",
      output: { parent_id: parentId, restricted: restrictTo, audit_write: "failed" },
      auditNote: `restrict_account parent=${parentId} -> ${restrictTo} COMMITTED but the audit entry failed: ${String(auditErr)}`,
      error: `audit_write_failed: ${String(auditErr)}`,
    };
  }
  return ok(
    { parent_id: parentId, restricted: restrictTo },
    `restrict_account parent=${parentId} -> is_financially_restricted=${restrictTo}`,
  );
}

async function sendWhatsapp(
  cfg: Record<string, unknown>,
  context: EngineContext,
  run: ActionRunContext,
): Promise<EngineActionOutcome> {
  // HONEST by design: there is NO WhatsApp Business API integration (no
  // provider credentials, no sending contract). What the platform CAN do
  // truthfully is prepare the wa.me deep link for a human to send. We NEVER
  // claim delivery.
  const phoneRaw =
    (cfg.phone as string | undefined) ??
    (contextPhone(context) ?? null);
  const message = String(cfg.message ?? cfg.body ?? "");
  const phone = phoneRaw != null ? String(phoneRaw).replace(/[^0-9]/g, "") : null;

  if (!phone || phone.length < 8) {
    return skippedByDesign("send_whatsapp", "no usable phone number in the execution context (wa.me link not prepared)");
  }
  const link = `https://wa.me/${phone}${message ? `?text=${encodeURIComponent(message)}` : ""}`;
  return ok(
    {
      prepared: 1,
      link,
      phone,
      delivered: 0,
      note: "link prepared for a human operator — no WhatsApp API integration exists, no delivery claimed",
      ...(run.dryRun ? { simulated: true } : {}),
    },
    `send_whatsapp prepared wa.me link for ${phone} (delivery NOT claimed — no provider integration)`,
  );
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function contextParentId(context: EngineContext): string | null {
  const parent = (context as Record<string, unknown>).parent as Record<string, unknown> | undefined;
  if (parent && typeof parent.id === "string") return parent.id;
  return null;
}

function contextPhone(context: EngineContext): string | null {
  const parent = (context as Record<string, unknown>).parent as Record<string, unknown> | undefined;
  if (parent && typeof parent.phone === "string") return parent.phone;
  return null;
}

function resolve(source: Record<string, unknown>, path: string): unknown {
  let current: unknown = source;
  for (const part of path.split(".")) {
    if (current === null || current === undefined || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function ok(output: Record<string, unknown>, auditNote: string): EngineActionOutcome {
  return { status: "succeeded", output, auditNote };
}

function skippedByDesign(subtype: string, reason: string): EngineActionOutcome {
  return {
    status: "skipped",
    output: { skipped: true, reason, subtype },
    auditNote: `${subtype} SKIPPED — ${reason}`,
  };
}

function fail(message: string): EngineActionOutcome {
  return {
    status: "failed",
    output: { error: message },
    auditNote: `FAILED — ${message}`,
    error: message,
  };
}

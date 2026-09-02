// ============================================================================
// _shared/send-email.ts — the ONE Resend transactional-email integration
// ============================================================================
// PUSH-104 fix (task T-131, 22nd session): before this module there were
// two broken email paths —
//   1. workflow-execute's `send_email` action was a STUB (the Resend call
//      was a commented-out TODO; every workflow email "succeeded" as
//      `{ stub: true }` and nothing was ever sent);
//   2. approve-signup-request had an INLINE best-effort fetch that never
//      checked `resp.ok` (a Resend 4xx "succeeded" silently), swallowed
//      all errors, and linked a dead legacy portal origin instead of the
//      production one (see PORTAL_URL below).
// This module is the extraction of (2) hardened into the single canonical
// integration (Existing-Implementation-First: reuse, do not fork), consumed
// by BOTH Edge Functions.
//
// CONTRACT (see the t-131-email-ef regression suite):
//   - `resolveEmailConfig(env)` — pure: RESEND_API_KEY absent/blank →
//     resendKey null (honest not-configured); EMAIL_FROM_ADDRESS optional
//     with the documented default.
//   - `sendEmailWithResend(input, config)` — pure core (global fetch only,
//     works identically under Deno Edge Runtime and Node/vitest): NEVER
//     throws. Outcomes: { sent: true } | { sent:false, reason:
//     "not_configured" | "http_error" | "network_error", status?, error? }.
//     `resp.ok` IS checked; the response body excerpt lands in `error`.
//   - `sendEmailFromEnv(input)` — the Deno-env wrapper used by the EFs.
//
// SECRETS: RESEND_API_KEY is a server-side secret (supabase secrets set
// RESEND_API_KEY=…). It is NOT set on this project as of 2026-09-03 (T-130
// secrets census) — every send honestly reports not_configured until the
// owner sets it; that outcome is RECORDED, never silently swallowed.
//
// The core is intentionally Deno-free so the desktop's vitest suite can
// import it directly; only `sendEmailFromEnv` touches the Deno global.

/** Ambient declaration so tsc (which type-checks this file because the
 * regression test imports it) accepts the Deno global. Type-only: erased
 * at runtime, where the real Deno global of the Edge Runtime is used. */
declare const Deno: { env: { get(key: string): string | undefined } };

/** The Resend transactional-email endpoint (the provider PUSH-104 names). */
export const RESEND_ENDPOINT = "https://api.resend.com/emails";

/** Verified sender used when EMAIL_FROM_ADDRESS is not configured.
 *  NOTE: Resend requires the `from` domain to be verified in the owner's
 *  Resend account — the owner must either verify elimtiyaz.dz or set
 *  EMAIL_FROM_ADDRESS to their verified domain (documented in the
 *  credentials sheet §3 and the T-131 task entry). */
export const DEFAULT_EMAIL_FROM = "noreply@elimtiyaz.dz";

/** The production parent-portal origin (credentials.md §2.2). Used by
 *  email templates that link the portal — never the dead legacy origin
 *  the old inline code linked (T-131 guards this with a source scan). */
export const PORTAL_URL = "https://elimtiyaz-website.vercel.app";

/** A single transactional email to send. */
export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  /** Optional Reply-To header value. */
  replyTo?: string;
}

/** Resolved email-sending configuration (pure — testable without Deno). */
export interface EmailConfig {
  /** null when RESEND_API_KEY is absent/blank — the honest not-configured state. */
  resendKey: string | null;
  from: string;
}

/** The outcome of one send attempt. NEVER an exception. */
export interface SendEmailOutcome {
  sent: boolean;
  provider: "resend";
  to: string;
  /** Why it was not sent (absent when sent). */
  reason?: "not_configured" | "http_error" | "network_error";
  /** HTTP status for reason="http_error". */
  status?: number;
  /** Human-readable detail: the missing-secret instruction, the provider's
   *  error body excerpt, or the network error text. */
  error?: string;
}

/** Pure: resolve the email configuration from an env-like accessor. */
export function resolveEmailConfig(env: { get(key: string): string | undefined }): EmailConfig {
  const resendKey = env.get("RESEND_API_KEY")?.trim() || null;
  const from = env.get("EMAIL_FROM_ADDRESS")?.trim() || DEFAULT_EMAIL_FROM;
  return { resendKey, from };
}

/**
 * Pure core: send ONE email via Resend. Never throws — every failure mode
 * is a structured outcome (the PUSH-104 lesson: resp.ok must be checked and
 * failures must be visible to the caller, never swallowed).
 */
export async function sendEmailWithResend(input: SendEmailInput, config: EmailConfig): Promise<SendEmailOutcome> {
  const base: SendEmailOutcome = { sent: false, provider: "resend", to: input.to };
  if (!config.resendKey) {
    return {
      ...base,
      reason: "not_configured",
      error: "RESEND_API_KEY secret is not set — email skipped (set it with: supabase secrets set RESEND_API_KEY=…)",
    };
  }
  try {
    const resp = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.resendKey}`,
        "Content-Type": "application/json",
        ...(input.replyTo ? { "Reply-To": input.replyTo } : {}),
      },
      body: JSON.stringify({
        from: config.from,
        to: input.to,
        subject: input.subject,
        html: input.html,
      }),
    });
    if (!resp.ok) {
      const body = (await resp.text().catch(() => "")).slice(0, 200);
      return {
        ...base,
        reason: "http_error",
        status: resp.status,
        error: body || `HTTP ${resp.status} from ${RESEND_ENDPOINT}`,
      };
    }
    return { ...base, sent: true };
  } catch (err) {
    return {
      ...base,
      reason: "network_error",
      error: String(err),
    };
  }
}

/** Edge-Runtime wrapper: resolve the config from the Deno environment. */
export function sendEmailFromEnv(input: SendEmailInput): Promise<SendEmailOutcome> {
  return sendEmailWithResend(input, resolveEmailConfig(Deno.env));
}

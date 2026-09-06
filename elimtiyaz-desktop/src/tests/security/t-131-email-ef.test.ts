/**
 * Regression tests for PUSH-104 (task T-131, 22nd session) — the email half.
 *
 * Two defects are pinned here:
 *  1. The workflow-execute EF's `send_email` action was a STUB (returned
 *     `{ stub: true }` with an audit note "STUB send_email …"; the Resend
 *     call was commented out) — no workflow email ever sent.
 *  2. The approve-signup-request EF's confirmation email never checked
 *     `resp.ok` (a Resend 4xx "succeeded" silently), swallowed all errors,
 *     and linked the dead `https://portal.elimtiyaz.dz` origin instead of
 *     the production portal (`https://elimtiyaz-website.vercel.app` —
 *     credentials sheet §2.2).
 *
 * Fix (T-131): ONE shared Resend integration, `_shared/send-email.ts`
 * (extracted from approve-signup-request per the Existing-Implementation-First
 * rule, hardened): a Deno-free core importable by this vitest suite + a thin
 * env wrapper for the Edge Runtime. Both EFs consume it.
 *
 * Coverage:
 *  1. Unit tests of the pure core (config resolution + send outcomes incl.
 *     the not-configured / HTTP-error / network-error paths).
 *  2. Source scans: the shared helper is wired into BOTH EFs, the stub
 *     patterns are gone, the dead portal URL is gone, and api.resend.com
 *     appears in exactly ONE file (the shared helper — no parallel
 *     implementations).
 */
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_EMAIL_FROM,
  RESEND_ENDPOINT,
  resolveEmailConfig,
  sendEmailWithResend,
} from "../../../supabase/functions/_shared/send-email.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Repository root (…/elimtiyaz-desktop) — this file lives in src/tests/security/. */
const DESKTOP_ROOT = join(__dirname, "..", "..", "..");

const APPROVE_EF = "supabase/functions/approve-signup-request/index.ts";
const SHARED = "supabase/functions/_shared/send-email.ts";
// T-225 (34th session): the workflow-execute send_email wiring moved from
// index.ts into the action-executor module (actions.ts) — the guard reads
// BOTH files so the pinned invariants keep covering the wiring wherever
// it lives.
const WORKFLOW_EF = "supabase/functions/workflow-execute/index.ts";
const WORKFLOW_ACTIONS = "supabase/functions/workflow-execute/actions.ts";

const PRODUCTION_PORTAL = "https://elimtiyaz-website.vercel.app";
const DEAD_PORTAL = "portal.elimtiyaz.dz";

function source(rel: string): string {
  return readFileSync(join(DESKTOP_ROOT, rel), "utf8");
}

function workflowSource(): string {
  return source(WORKFLOW_EF) + "\n" + source(WORKFLOW_ACTIONS);
}

/** List every *.ts under functions/ that mentions the Resend endpoint. */
function filesMentioningResend(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSyncSync(join(DESKTOP_ROOT, "supabase/functions", dir))) {
      const rel = join("supabase/functions", dir, entry);
      const abs = join(DESKTOP_ROOT, rel);
      if (statSyncSync(abs).isDirectory()) {
        walk(join(dir, entry));
      } else if (entry.endsWith(".ts")) {
        if (source(rel).includes("api.resend.com")) out.push(rel);
      }
    }
  };
  walk(".");
  return out;
}

// Minimal fs helpers to keep the walker readable (node:fs sync API).
import { readdirSync, statSync } from "node:fs";
function readdirSyncSync(p: string): string[] {
  return readdirSync(p);
}
function statSyncSync(p: string) {
  return statSync(p);
}

/* ------------------------------------------------------------------ */
/* 1. Unit behaviour of the shared helper                              */
/* ------------------------------------------------------------------ */

const env = (map: Record<string, string | undefined>) => ({
  get: (k: string): string | undefined => map[k],
});

describe("PUSH-104 — shared email helper: config resolution", () => {
  it("returns a NULL key (honest not-configured) when RESEND_API_KEY is absent or blank", () => {
    expect(resolveEmailConfig(env({})).resendKey).toBeNull();
    expect(resolveEmailConfig(env({ RESEND_API_KEY: "" })).resendKey).toBeNull();
    expect(resolveEmailConfig(env({ RESEND_API_KEY: "   " })).resendKey).toBeNull();
  });

  it("honours the configured key and EMAIL_FROM_ADDRESS, with the documented default", () => {
    expect(resolveEmailConfig(env({ RESEND_API_KEY: "re_123" })).resendKey).toBe("re_123");
    expect(resolveEmailConfig(env({ RESEND_API_KEY: "re_123" })).from).toBe(DEFAULT_EMAIL_FROM);
    expect(resolveEmailConfig(env({ RESEND_API_KEY: "re_123", EMAIL_FROM_ADDRESS: "no-reply@school.dz" })).from).toBe(
      "no-reply@school.dz",
    );
  });
});

describe("PUSH-104 — shared email helper: send outcomes", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("does NOT call Resend and reports an honest not_configured skip when the key is unset", async () => {
    let called = 0;
    globalThis.fetch = (async () => {
      called += 1;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    const out = await sendEmailWithResend(
      { to: "parent@example.dz", subject: "Relance", html: "<p>…</p>" },
      { resendKey: null, from: DEFAULT_EMAIL_FROM },
    );
    expect(out.sent).toBe(false);
    expect(out.reason).toBe("not_configured");
    expect(out.error).toContain("RESEND_API_KEY");
    expect(called).toBe(0);
  });

  it("sends when Resend returns 2xx (request carries Bearer key, from, to, subject, html)", async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      captured = { url: String(url), init: init ?? {} };
      return new Response(JSON.stringify({ id: "email-1" }), { status: 200 });
    }) as typeof fetch;
    const out = await sendEmailWithResend(
      { to: "parent@example.dz", subject: "Relance", html: "<p>Bonjour</p>" },
      { resendKey: "re_123", from: "noreply@elimtiyaz.dz" },
    );
    expect(out.sent).toBe(true);
    expect(out.reason).toBeUndefined();
    expect(captured).not.toBeNull();
    expect(captured!.url).toBe(RESEND_ENDPOINT);
    const headers = new Headers(captured!.init.headers as HeadersInit);
    expect(headers.get("authorization")).toBe("Bearer re_123");
    const body = JSON.parse(String(captured!.init.body)) as Record<string, string>;
    expect(body.from).toBe("noreply@elimtiyaz.dz");
    expect(body.to).toBe("parent@example.dz");
    expect(body.subject).toBe("Relance");
    expect(body.html).toBe("<p>Bonjour</p>");
  });

  it("reports http_error with the status + body excerpt when Resend returns 4xx (the PUSH-104 defect: resp.ok was never checked)", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ message: "Unverified domain" }), { status: 402 })) as typeof fetch;
    const out = await sendEmailWithResend(
      { to: "parent@example.dz", subject: "Relance", html: "<p>…</p>" },
      { resendKey: "re_bad", from: DEFAULT_EMAIL_FROM },
    );
    expect(out.sent).toBe(false);
    expect(out.reason).toBe("http_error");
    expect(out.status).toBe(402);
    expect(out.error).toContain("Unverified domain");
  });

  it("reports network_error and NEVER throws when fetch rejects", async () => {
    globalThis.fetch = (async () => {
      throw new Error("connect ECONNREFUSED");
    }) as typeof fetch;
    const out = await sendEmailWithResend(
      { to: "parent@example.dz", subject: "Relance", html: "<p>…</p>" },
      { resendKey: "re_123", from: DEFAULT_EMAIL_FROM },
    );
    expect(out.sent).toBe(false);
    expect(out.reason).toBe("network_error");
    expect(out.error).toContain("ECONNREFUSED");
  });
});

/* ------------------------------------------------------------------ */
/* 2. Source scans — both EFs wired, stubs and dead URLs gone          */
/* ------------------------------------------------------------------ */

describe("PUSH-104 — source scans", () => {
  it("the shared helper exists and is the ONLY Resend implementation under functions/", () => {
    const mentioning = filesMentioningResend();
    expect(mentioning).toEqual([SHARED]);
  });

  it("workflow-execute: imports the shared helper and the send_email STUB is gone", () => {
    const ef = workflowSource();
    expect(ef).toContain('from "../_shared/send-email.ts"');
    expect(ef).not.toContain("STUB send_email");
    expect(ef).not.toContain('output: { stub: true, to, subject, provider: "resend" }');
    // The commented-out TODO integration pattern is gone too.
    expect(ef).not.toContain('// await fetch("https://api.resend.com/emails"');
  });

  it("workflow-execute: the send_email action resolves its config through the shared helper and records honest outcomes", () => {
    const ef = workflowSource();
    // The action must resolve env config and call the shared sender.
    expect(ef).toMatch(/resolveEmailConfig/);
    expect(ef).toMatch(/sendEmailWithResend|sendEmailFromEnv/);
  });

  it("approve-signup-request: consumes the shared helper, no inline Resend fetch, resp.ok is the helper's job", () => {
    const ef = source(APPROVE_EF);
    expect(ef).toContain('from "../_shared/send-email.ts"');
    expect(ef).not.toContain('fetch("https://api.resend.com/emails"');
    expect(ef).not.toContain("api.resend.com");
  });

  it("approve-signup-request: the confirmation email links the PRODUCTION portal, not the dead origin", () => {
    const ef = source(APPROVE_EF);
    const shared = source(SHARED);
    // The EF imports the URL constant from the shared module (single source
    // of truth); the shared module carries the production origin.
    expect(ef).toContain("PORTAL_URL");
    expect(shared).toContain(PRODUCTION_PORTAL);
    expect(shared).not.toContain(DEAD_PORTAL);
    expect(ef).not.toContain(DEAD_PORTAL);
    expect(shared).toMatch(/PORTAL_URL = "https:\/\/elimtiyaz-website\.vercel\.app"/);
  });

  it("approve-signup-request: the email outcome is surfaced (response payload or log), not silently swallowed", () => {
    const ef = source(APPROVE_EF);
    // The structured outcome (sent/reason/error) must appear in the EF's
    // post-approval handling — either in the JSON response or a logged warning.
    expect(ef).toMatch(/email\s*[:=]/);
    expect(ef).toMatch(/emailOutcome|email_outcome|\.sent|\.reason/);
  });
});

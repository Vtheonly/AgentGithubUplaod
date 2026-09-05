/**
 * DESK-CSP-202 (T-108) — Electron renderer Content-Security-Policy.
 *
 * The owner-pasted console evidence showed the Electron security warning:
 *   "This renderer process has either no Content-Security-Policy set or a
 *    policy with 'unsafe-eval' enabled."
 * index.html shipped with NO CSP meta at all since the first commit.
 *
 * The CSP now lives in index.html (meta http-equiv) — applied in BOTH dev
 * (vite dev server) and packaged (loadFile) modes. These guards pin the
 * policy's security-critical properties so a future edit cannot silently
 * reintroduce the warning or weaken the policy.
 *
 * T-186 (SEC-114) update: frame-ancestors is REMOVED from the meta policy —
 * the CSP spec ignores it there, so Chromium logged "The Content-Security-
 * Policy directive 'frame-ancestors' is ignored when delivered via a <meta>
 * element" on every launch (the owner's 2026-09-05 paste) while the
 * directive enforced nothing. The guard below now pins its ABSENCE so the
 * warning cannot regress. A meta CSP is the only channel for the local
 * file:// document (no response headers to amend); a packaged Electron
 * window is a top-level frame that cannot be embedded, so nothing is lost.
 *
 * Verified live (17th session): production launch under Xvfb and dev-mode
 * launch — zero "Insecure Content-Security-Policy" warnings, zero CSP
 * violation errors, window loads and stays alive.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, "../../../index.html"), "utf8");

function metaContent(): string {
  const match = html.match(
    /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/,
  );
  expect(match, "index.html must carry a Content-Security-Policy meta tag").toBeTruthy();
  return match![1];
}

describe("DESK-CSP-202 — renderer CSP policy", () => {
  it("a CSP meta tag exists in index.html", () => {
    expect(metaContent().length).toBeGreaterThan(0);
  });

  it("script-src is 'self' only — no unsafe-eval, no unsafe-inline", () => {
    const scriptSrc = metaContent().match(/script-src ([^;]+);/)?.[1] ?? "";
    expect(scriptSrc).toContain("'self'");
    expect(scriptSrc).not.toContain("unsafe-eval");
    expect(scriptSrc).not.toContain("unsafe-inline");
  });

  it("hardening directives present: object-src 'none', base-uri 'self' — and frame-ancestors ABSENT (T-186/SEC-114: the spec ignores it in a meta policy → Chromium warning, zero enforcement)", () => {
    const csp = metaContent();
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    // frame-ancestors delivered via <meta> is IGNORED by the spec and logs
    // a console warning on every launch — it must NOT come back.
    expect(csp).not.toContain("frame-ancestors");
  });

  it("functional allowances kept: Google Fonts, inline style attributes, blob/img/connect needs", () => {
    const csp = metaContent();
    // Design system renders inline style ATTRIBUTES (style-src 'unsafe-inline').
    expect(csp).toContain("style-src 'self' 'unsafe-inline' https://fonts.googleapis.com");
    // Google Fonts (fonts.gstatic.com) for Inter / JetBrains Mono / Noto Sans Arabic.
    expect(csp).toContain("https://fonts.gstatic.com");
    // Media vault previews / excel+pdf export downloads (blob:), Supabase storage images.
    expect(csp).toContain("img-src 'self' data: blob: https:");
    expect(csp).toContain("worker-src 'self' blob:");
    // The app connects to a USER-CONFIGURED Supabase project (arbitrary host, TLS-only).
    expect(csp).toContain("connect-src 'self' https: wss:");
  });
});

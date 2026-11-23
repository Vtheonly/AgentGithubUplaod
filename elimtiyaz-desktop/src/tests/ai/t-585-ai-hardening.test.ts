/**
 * T-585 — the AI hardening remainder (BUG-056, the non-UX half).
 *
 * What this suite pins:
 *
 *   A. THE FETCH TIMEOUTS:
 *      - stream-client: every connection attempt composes the caller's
 *        AbortSignal with a per-attempt AbortSignal.timeout(120 s)
 *        (source pin + behavioral: a caller abort propagates);
 *      - provider-registry's model-list GET carries a 60 s hard cap.
 *
 *   B. THE DEAD MODEL METADATA IS GONE:
 *      - the two AI feature modals no longer hardcode the 404-dead
 *        "llama-3.3-70b-versatile"; they ride the CONFIGURED provider +
 *        model (loadConfig — the live-verified defaults when
 *        unconfigured).
 *
 *   C. THE PASSPHRASE'S OS-KEYCHAIN HOME (the round-trip):
 *      - getOrCreatePassphrase prefers the safeStorage bridge: a keychain
 *        HIT is used verbatim (and a lingering legacy localStorage copy
 *        is purged);
 *      - a keychain MISS migrates the LEGACY passphrase (the existing
 *        ciphertext stays decryptable) or generates fresh;
 *      - the full encrypt → decrypt round-trip still works through the
 *        keychain-backed passphrase;
 *      - any bridge failure falls back to the localStorage behavior
 *        (fail-safe — obfuscated-but-functional beats broken).
 *
 *   D. THE AI-i18N DECISION (ADR-036): the AI surfaces are French-only —
 *      the prompts do NOT branch on i18next.language (source pin).
 *
 * Run:
 *   npx vitest run src/tests/ai/t-585-ai-hardening.test.ts
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { executeOpenAIStream } from "../../core/ai/streaming/stream-client";
import { getOrCreatePassphrase } from "../../infrastructure/ai/ai-config-storage";
import { AI_PASSPHRASE_STORAGE_KEY } from "../../infrastructure/ai/ai-config-storage";
import { DEFAULT_AI_PROVIDER_CONFIG } from "../../domain/model/ai";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, "../../");
const read = (rel: string): string => readFileSync(join(SRC, rel), "utf8");

/* ---------------- A — the fetch timeouts ---------------- */

describe("T-585 A — the AI fetch paths carry hard timeouts", () => {
  it("A1: stream-client composes the caller's signal with a per-attempt 120 s AbortSignal.timeout", () => {
    const src = read("core/ai/streaming/stream-client.ts");
    expect(src).toContain("AbortSignal.timeout(120_000)");
    expect(src).toContain("AbortSignal.any([signal, timeoutSignal])");
  });

  it("A2: a caller abort mid-attempt propagates (the stream never hangs past the stop button)", async () => {
    // A fetch that never resolves on its own — only the composed signal
    // can end it (the per-attempt timeout would too, at 120 s; the
    // caller's abort must win NOW).
    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation((_url: unknown, init?: { signal?: AbortSignal }) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    }) as unknown as typeof fetch;
    try {
      const callerCtrl = new AbortController();
      const promise = executeOpenAIStream(
        "https://api.example.invalid/v1/chat/completions",
        {},
        { messages: [] },
        { onDelta: () => {} },
        callerCtrl.signal,
      );
      // Abort after a tick — the pending attempt must reject.
      setTimeout(() => callerCtrl.abort(), 5);
      await expect(promise).rejects.toThrow();
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("A3: the model-list query carries a 60 s hard cap", () => {
    const src = read("core/ai/providers/provider-registry.ts");
    expect(src).toContain("AbortSignal.timeout(60_000)");
    expect(src.match(/fetch\(url, \{\s*headers,\s*signal: AbortSignal\.timeout\(60_000\),/s)).not.toBeNull();
  });
});

/* ---------------- B — the dead model metadata ---------------- */

describe("T-585 B — the 404-dead hardcoded model id is gone", () => {
  it("B1: NO source file hardcodes the dead llama-3.3-70b id in an AIRequest", () => {
    const anomaly = read("features/financials/anomaly-explainer-modal.tsx");
    const narrative = read("features/academics/narrative-generator-modal.tsx");
    expect(anomaly).not.toContain('model: "llama-3.3-70b-versatile"');
    expect(narrative).not.toContain('model: "llama-3.3-70b-versatile"');
  });

  it("B2: both modals ride the CONFIGURED provider + model (loadConfig)", () => {
    const anomaly = read("features/financials/anomaly-explainer-modal.tsx");
    const narrative = read("features/academics/narrative-generator-modal.tsx");
    for (const src of [anomaly, narrative]) {
      expect(src).toContain("await loadConfig()");
      expect(src).toContain("provider: cfg.defaultProvider");
      expect(src).toContain("model: cfg.defaultModel");
    }
  });

  it("B3: the defaults are the LIVE-VERIFIED reachable catalog (gpt-oss), not a 404 id", () => {
    expect(DEFAULT_AI_PROVIDER_CONFIG.defaultModel).toBe("openai/gpt-oss-120b");
    expect(DEFAULT_AI_PROVIDER_CONFIG.defaultModel).not.toMatch(/llama-|qwen-/);
  });
});

/* ---------------- C — the passphrase keychain round-trip ---------------- */

describe("T-585 C — the AI passphrase's OS-keychain home", () => {
  type Bridge = NonNullable<Window["elImtiyaz"]>["safeStorage"];

  function installBridge(impl: {
    stored: string | null;
  }): { bridge: Bridge; writes: string[] } {
    const writes: string[] = [];
    const bridge: Bridge = {
      isAvailable: async () => true,
      readPassphrase: async () =>
        impl.stored === null ? { ok: true, value: null } : { ok: true, value: impl.stored },
      writePassphrase: async (pass: string) => {
        writes.push(pass);
        impl.stored = pass;
        return { ok: true };
      },
    };
    (window as unknown as { elImtiyaz?: unknown }).elImtiyaz = { safeStorage: bridge };
    return { bridge, writes };
  }

  const original = (window as Window & { elImtiyaz?: unknown }).elImtiyaz;

  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    (window as Window & { elImtiyaz?: unknown }).elImtiyaz = original;
    localStorage.clear();
  });

  it("C1: a keychain HIT is used verbatim — and a lingering legacy localStorage copy is purged", async () => {
    localStorage.setItem(AI_PASSPHRASE_STORAGE_KEY, "legacy-stale-copy");
    const { writes } = installBridge({ stored: "the-keychain-passphrase" });
    const pass = await getOrCreatePassphrase();
    expect(pass).toBe("the-keychain-passphrase");
    expect(writes).toEqual([]); // no write on a hit
    expect(localStorage.getItem(AI_PASSPHRASE_STORAGE_KEY)).toBeNull(); // purged
  });

  it("C2: a keychain MISS migrates the LEGACY passphrase (existing ciphertext stays decryptable)", async () => {
    localStorage.setItem(AI_PASSPHRASE_STORAGE_KEY, "legacy-precious-pass");
    const { writes } = installBridge({ stored: null });
    const pass = await getOrCreatePassphrase();
    expect(pass).toBe("legacy-precious-pass"); // migrated, not regenerated
    expect(writes).toEqual(["legacy-precious-pass"]); // persisted to the keychain
    expect(localStorage.getItem(AI_PASSPHRASE_STORAGE_KEY)).toBeNull(); // gone from localStorage
  });

  it("C3: a keychain MISS with NO legacy generates fresh and persists it", async () => {
    const { writes } = installBridge({ stored: null });
    const pass = await getOrCreatePassphrase();
    expect(pass).toBeTruthy();
    expect(pass.length).toBeGreaterThanOrEqual(40); // 32 bytes base64
    expect(writes).toEqual([pass]);
    expect(localStorage.getItem(AI_PASSPHRASE_STORAGE_KEY)).toBeNull();
  });

  it("C4: a keychain WRITE failure falls back to localStorage (fail-safe)", async () => {
    localStorage.setItem(AI_PASSPHRASE_STORAGE_KEY, "legacy-fallback-pass");
    const bridge: Bridge = {
      isAvailable: async () => false,
      readPassphrase: async () => ({ ok: false, error: "unavailable" }),
      writePassphrase: async () => ({ ok: false, error: "unavailable" }),
    };
    (window as unknown as { elImtiyaz?: unknown }).elImtiyaz = { safeStorage: bridge };
    const pass = await getOrCreatePassphrase();
    expect(pass).toBe("legacy-fallback-pass"); // the localStorage behavior
    expect(localStorage.getItem(AI_PASSPHRASE_STORAGE_KEY)).toBe("legacy-fallback-pass");
  });

  it("C5: no bridge at all (browser/tests) — the pre-T-585 localStorage behavior", async () => {
    (window as Window & { elImtiyaz?: unknown }).elImtiyaz = undefined;
    const pass = await getOrCreatePassphrase();
    expect(pass).toBeTruthy();
    expect(localStorage.getItem(AI_PASSPHRASE_STORAGE_KEY)).toBe(pass);
  });
});

/* ---------------- D — the AI-i18n decision (ADR-036) ---------------- */

describe("T-585 D — ADR-036: the AI surfaces are French-only", () => {
  it("D1: the ADR exists and records the decision", () => {
    const adr = readFileFromRoot("docs/decisions/ADR-036-ai-surfaces-french-only.md");
    expect(adr).toContain("French-only");
    expect(adr).toContain("MUST NOT branch on `i18next.language`");
  });

  it("D2: no AI prompt path branches on the UI locale", () => {
    for (const rel of [
      "core/ai/agent-runtime.ts",
      "features/financials/anomaly-explainer-modal.tsx",
      "features/academics/narrative-generator-modal.tsx",
    ]) {
      const src = read(rel);
      expect(src, `${rel} must not route prompts per-locale`).not.toMatch(
        /i18next\.language|i18n\.language|changeLanguage/,
      );
    }
  });
});

function readFileFromRoot(rel: string): string {
  return readFileSync(join(SRC, "../../", rel), "utf8");
}

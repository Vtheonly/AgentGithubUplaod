/**
 * T-055 — audit robustness + PII masking regression suite (SEC-001, SEC-002).
 *
 * SEC-002: the network LLM transports (edge ai-proxy + BYOK Groq/OpenRouter)
 * used `request.maskedContent || request.userPrompt` — an EMPTY masked
 * string silently shipped the RAW prompt (PII: student names, parent
 * phones, financial details) over the network. Fixed: both network paths
 * REFUSE (Err) when maskedContent is empty; only the local mock may use
 * the raw prompt (it never leaves the machine).
 *
 * SEC-001 (backend half, source-scan): writeAuditLog retries once then
 * THROWS AuditWriteError; the 8 EFs calling it are wrapped in
 * withAuditSurfacing (structured 500 audit_write_failed); run-overdue-scan
 * catches per-tenant and counts audit_failures (surfaced, not swallowed).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AIRequest } from "../../domain/model/ai";
import { byokLLMAdapter, edgeLLMAdapter, defaultLLMAdapter } from "../../infrastructure/ai/llm-adapter";

const SRC = join(__dirname, "../../");
const FUNCS = join(SRC, "../supabase/functions");

function request(overrides: Partial<AIRequest> = {}): AIRequest {
  return {
    id: "ai-1",
    provider: "groq",
    model: "llama-3.3-70b-versatile",
    systemPrompt: "You are a helpful school assistant.",
    userPrompt: "Élève Karim Benali (0555123456) — 3 absences non justifiées ce trimestre.",
    maskedContent: "Élève [ÉTUDIANT_1] ([TÉLÉPHONE]) — 3 absences non justifiées ce trimestre.",
    maxTokens: 512,
    temperature: 0.2,
    createdAt: new Date().toISOString(),
    ...overrides,
  } as AIRequest;
}

describe("T-055 — SEC-002: network LLM paths refuse empty maskedContent", () => {
  it("BYOK adapter returns Err when maskedContent is empty (raw prompt NEVER leaves)", async () => {
    const result = await byokLLMAdapter.generate(request({ maskedContent: "" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("SEC-002");
  });

  it("BYOK adapter returns Err when maskedContent is whitespace-only", async () => {
    const result = await byokLLMAdapter.generate(request({ maskedContent: "   " }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("SEC-002");
  });

  it("edge adapter returns Err when maskedContent is empty (before any invoke)", async () => {
    const result = await edgeLLMAdapter.generate(request({ maskedContent: "" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("SEC-002");
  });

  it("the default routing degrades to the LOCAL mock when masking is missing — no network leak", async () => {
    // With Supabase unconfigured in the test env: edge is skipped, BYOK
    // refuses (empty mask) → mock answers locally with the raw prompt.
    const result = await defaultLLMAdapter.generate(request({ maskedContent: "" }));
    expect(result.ok).toBe(true);
  });

  it("source-scan: no `maskedContent || userPrompt` CODE fallback remains", () => {
    const text = readFileSync(join(SRC, "infrastructure/ai/llm-adapter.ts"), "utf8");
    // comments may document the OLD behaviour — only code lines count
    const codeLines = text.split("\n").filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//"));
    for (const l of codeLines) expect(l).not.toContain("maskedContent || request.userPrompt");
    expect(text).toContain("function hasMaskedContent(request: AIRequest): boolean");
  });
});

describe("T-055 — SEC-001: EF audit failures are surfaced (source-scan)", () => {
  it("writeAuditLog retries once then throws the typed AuditWriteError", () => {
    const text = readFileSync(join(FUNCS, "_shared/supabase.ts"), "utf8");
    expect(text).toContain("export class AuditWriteError");
    expect(text).toContain("[AUDIT-MISS]");
    // retry: two attempt() invocations
    expect(text).toContain("attempt 1");
    expect(text).toContain("throw new AuditWriteError(error)");
  });

  it("withAuditSurfacing converts AuditWriteError into a structured 500", () => {
    const text = readFileSync(join(FUNCS, "_shared/supabase.ts"), "utf8");
    expect(text).toContain("export function withAuditSurfacing");
    expect(text).toContain('"audit_write_failed"');
  });

  it("every EF that calls writeAuditLog is wrapped in withAuditSurfacing", () => {
    const efs = [
      "update-server-secret",
      "approve-signup-request",
      "ai-proxy",
      "purge-expired-backups",
      "bind-activation-code",
      "workflow-execute",
      "create-user-account",
      "run-overdue-scan",
    ];
    for (const ef of efs) {
      const text = readFileSync(join(FUNCS, ef, "index.ts"), "utf8");
      expect(text, ef).toContain("withAuditSurfacing(async (req: Request) => {");
      expect(text, ef).toContain("writeAuditLog(");
    }
  });

  it("run-overdue-scan counts audit_failures instead of swallowing them", () => {
    const text = readFileSync(join(FUNCS, "run-overdue-scan/index.ts"), "utf8");
    expect(text).toContain("audit_failures: 0");
    expect(text).toContain("summary.audit_failures++");
  });
});

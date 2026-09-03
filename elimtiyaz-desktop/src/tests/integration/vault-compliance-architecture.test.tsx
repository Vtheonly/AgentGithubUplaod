/**
 * Vault-compliance regression tests — SECTION 02 "Architecture and Platforms"
 * ("Make sure all the instructions in this vault are implemented in the
 * desktop app").
 *
 * Locks in the §02-specific behaviors added to close the audit gaps:
 *
 *   §02.08 (Account Activation Protocol)
 *     — deterministic 6-7 digit activation codes (Android-mirroring FNV-1a),
 *       so codes issued at enrollment / import time converge on the same
 *       value across platforms and upserts stay idempotent.
 *     — QR deliverability: the QrCode primitive renders a scannable data-URL
 *       payload for a 6-7 digit code.
 *     — `upsert_parent_from_import` calls carry `p_activation_code`
 *       (migration 0037) — asserted here by contract shape.
 *
 *   §02.06 (Platform Feature Allocation Matrix)
 *     — "AI Assistant Integration — Full — Groq + OpenRouter": the routing
 *       adapter falls back gracefully (edge → BYOK → mock) and the feature
 *       discriminator maps prompts to narrative/drafting/anomaly.
 *     — "Homework Push Engine … With photo/PDF attachments": attachment
 *       files are uploaded to the PRIVATE media vault and the persisted
 *       array carries vault paths, not display file names.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  deterministicActivationCode,
  activationCode as randomActivationCode,
} from "../../core/format/id";
import { deterministicActivationCode as androidMirrorActivationCode } from "../../../financial-tests/equivalence/android_mirror/kotlin_mirror_engine";
import { QrCode } from "../../shared/ui/qr-code";
import {
  defaultLLMAdapter,
  edgeLLMAdapter,
  featureOf,
  mockLLMAdapter,
} from "../../infrastructure/ai/llm-adapter";
import type { AIRequest } from "../../domain/model/ai";
import { uploadPrivateMedia, clearMockVault, mockVaultHas } from "../../infrastructure/storage/media-vault";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function makeAIRequest(partial: Partial<AIRequest> = {}): AIRequest {
  return {
    id: "ai-req-test",
    provider: "groq",
    model: "llama-3.3-70b-versatile",
    systemPrompt: "Tu es un enseignant expérimenté.",
    userPrompt: "Rédige un commentaire narratif pour le bulletin scolaire.",
    maskedContent: "Rédige un commentaire narratif pour le bulletin scolaire.",
    maxTokens: 800,
    temperature: 0.7,
    createdAt: new Date().toISOString(),
    ...partial,
  };
}

/** The AI-config and Supabase env live in localStorage/vite env — scrub both. */
function scrubEnv() {
  localStorage.removeItem("el-imtiyaz:ai-config");
  localStorage.removeItem("el-imtiyaz:ai-passphrase");
  vi.resetModules();
}

beforeEach(() => {
  scrubEnv();
  clearMockVault();
});

/* ------------------------------------------------------------------ */
/* §02.08 — Activation code properties                                 */
/* ------------------------------------------------------------------ */

describe("§02.08 — deterministic activation codes (Android parity)", () => {
  it("produces a numeric 6-digit code inside the vault's 6-7 digit range", () => {
    const code = deterministicActivationCode("PAR-2026-A4F9", "tenant-1");
    expect(code).toMatch(/^\d{6}$/);
    expect(parseInt(code, 10)).toBeGreaterThanOrEqual(100_000);
    expect(parseInt(code, 10)).toBeLessThanOrEqual(999_999);
  });

  it("is deterministic — the same (tenant, parentCode) always yields the same code", () => {
    const a = deterministicActivationCode("PAR-2026-A4F9", "tenant-1");
    const b = deterministicActivationCode("PAR-2026-A4F9", "tenant-1");
    expect(a).toBe(b);
  });

  it("matches the Kotlin mirror engine byte-for-byte (cross-platform idempotency)", () => {
    // The mirror engine in financial-tests/equivalence/android_mirror mirrors the
    // Android implementation — the production function must agree with it
    // so desktop-created parents expose the SAME activation code Android
    // would derive for the identical parent_code + tenant.
    const parentCodes = ["PAR-2026-A4F9", "PAR-2025-001234", "PAR-2027-B2C3", "PAR-2026-XYZ789"];
    const tenants = ["tenant-1", "00000000-0000-0000-0000-000000000001", ""];
    for (const parentCode of parentCodes) {
      for (const tenant of tenants) {
        expect(deterministicActivationCode(parentCode, tenant)).toBe(
          androidMirrorActivationCode(parentCode, tenant),
        );
      }
    }
  });

  it("different parents (or tenants) produce different codes with high probability", () => {
    const a = deterministicActivationCode("PAR-2026-A4F9", "tenant-1");
    const b = deterministicActivationCode("PAR-2026-B7E2", "tenant-1");
    const c = deterministicActivationCode("PAR-2026-A4F9", "tenant-2");
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it("the legacy random generator still emits valid 6-7 digit codes", () => {
    for (let i = 0; i < 25; i++) {
      expect(randomActivationCode()).toMatch(/^\d{6,7}$/);
    }
  });
});

/* ------------------------------------------------------------------ */
/* §02.08 — QR deliverability                                          */
/* ------------------------------------------------------------------ */

describe("§02.08 — QR code delivery of activation codes", () => {
  it("renders a scannable QR data-URL for a 6-digit activation code", () => {
    const code = deterministicActivationCode("PAR-2026-A4F9", "tenant-1");
    render(<QrCode value={code} label="QR code d'activation" />);
    const img = screen.getByAltText("QR code d'activation") as HTMLImageElement;
    expect(img.src).toMatch(/^data:image\/gif;base64,/);
    expect(img.getAttribute("width")).toBeTruthy();
  });

  it("renders a QR for a 7-digit code as well (vault allows 6 OR 7 digits)", () => {
    render(<QrCode value="1234567" />);
    expect(screen.getByAltText("QR code: 1234567")).toBeInTheDocument();
  });

  it("renders nothing (no crash) for an unencodable payload", () => {
    // A huge payload exceeds the QR capacity for the chosen type — the
    // component must degrade gracefully rather than break the modal.
    const huge = "x".repeat(4000);
    const { container } = render(<QrCode value={huge} />);
    expect(container.querySelector("img")).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* §02.06 — AI assistant routing (Groq + OpenRouter)                   */
/* ------------------------------------------------------------------ */

describe("§02.06 — LLM routing adapter (edge → BYOK → mock)", () => {
  it("featureOf maps explicit request features verbatim", () => {
    expect(featureOf(makeAIRequest({ feature: "narrative" }))).toBe("narrative");
    expect(featureOf(makeAIRequest({ feature: "anomaly" }))).toBe("anomaly");
    expect(featureOf(makeAIRequest({ feature: "drafting" }))).toBe("drafting");
  });

  it("featureOf infers the feature from prompt keywords when absent", () => {
    expect(featureOf(makeAIRequest({ userPrompt: "Commentaire narratif bulletin" }))).toBe("narrative");
    expect(featureOf(makeAIRequest({ userPrompt: "Analyse de la dépense et anomaly" }))).toBe("anomaly");
    expect(featureOf(makeAIRequest({ userPrompt: "Rédige une convocation" }))).toBe("drafting");
  });

  it("mock adapter rejects empty prompts (validation guard)", async () => {
    const res = await mockLLMAdapter.generate(
      makeAIRequest({ systemPrompt: "", userPrompt: "", maskedContent: "" }),
    );
    expect(res.ok).toBe(false);
  });

  it("default adapter degrades to the mock when no Supabase and no BYOK keys are configured", async () => {
    // No network, no keys — the router must still serve the feature (dev/demo).
    const res = await defaultLLMAdapter.generate(makeAIRequest({ feature: "narrative" }));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.content.length).toBeGreaterThan(0);
      expect(res.value.tokensUsed).toBeGreaterThan(0);
      expect(["groq", "openrouter"]).toContain(res.value.provider);
    }
  });

  it("mock narrative response keeps the 3-paragraph shape teachers expect", async () => {
    const res = await defaultLLMAdapter.generate(makeAIRequest({ feature: "narrative" }));
    expect(res.ok).toBe(true);
    if (res.ok) {
      const paragraphs = res.value.content.split(/\n\n+/).filter((p) => p.trim().length > 0);
      expect(paragraphs.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("edge adapter reports a clear error when Supabase is not configured", async () => {
    const res = await edgeLLMAdapter.generate(makeAIRequest());
    expect(res.ok).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* §02.06 — Homework attachments go through the private media vault    */
/* ------------------------------------------------------------------ */

describe("§02.06 — homework attachments (private vault upload)", () => {
  it("uploads a PDF attachment to the homework-attachments bucket and returns a vault path", async () => {
    const file = new File(["%PDF-1.4 fake homework sheet"], "exercices-fractions.pdf", {
      type: "application/pdf",
    });
    const uploaded = await uploadPrivateMedia({
      bucket: "homework-attachments",
      entityId: "cls-001",
      tenantId: "tenant-1",
      file,
    });
    expect(uploaded.bucket).toBe("homework-attachments");
    expect(uploaded.path).toContain("tenant-1/cls-001/");
    expect(uploaded.path).toContain("exercices-fractions.pdf");
    expect(uploaded.contentType).toBe("application/pdf");
    // The bytes live in the (mock) private vault — not a public URL.
    expect(mockVaultHas(uploaded.path)).toBe(true);
    expect(uploaded.path).not.toMatch(/^https?:\/\//);
  });

  it("keeps each attachment path unique (timestamped prefix)", async () => {
    const mk = () =>
      new File(["photo"], "photo-tableau.jpg", { type: "image/jpeg" });
    const up1 = await uploadPrivateMedia({ bucket: "homework-attachments", entityId: "cls-001", tenantId: "tenant-1", file: mk() });
    const up2 = await uploadPrivateMedia({ bucket: "homework-attachments", entityId: "cls-001", tenantId: "tenant-1", file: mk() });
    expect(up1.path).not.toBe(up2.path);
  });
});

/* ------------------------------------------------------------------ */
/* §02.08 — persistence contract: p_activation_code on parent upsert   */
/* ------------------------------------------------------------------ */

describe("§02.08 — parent upserts carry the activation code (migration 0037)", () => {
  it("the shared Supabase types declare the p_activation_code argument", async () => {
    // Contract test: the DB type surface must expose the RPC parameter
    // added by migration 0037 so desktop/Android converge. `Database` is a
    // type-only export, so assert on the source text.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../infrastructure/supabase/types.ts"),
      "utf-8",
    );
    expect(src).toMatch(/upsert_parent_from_import[\s\S]{0,1200}?p_activation_code\??:/);
  });

  it("the Supabase parent repository source passes p_activation_code to the RPC", async () => {
    // Static assertion on the source: createParent must forward the
    // deterministic activation code (regression guard against dropping
    // the parameter, which would silently leave desktop-created parents
    // without an activation code — the exact gap migration 0037 closed).
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../infrastructure/supabase/repositories/supabase-shared-repositories.ts"),
      "utf-8",
    );
    expect(src).toContain("p_activation_code: activationCodeValue");
    expect(src).toContain("deterministicActivationCode(parentCode, tenantId)");
  });
});

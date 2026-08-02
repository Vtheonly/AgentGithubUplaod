/**
 * Unit tests for the mock LLM adapter — plan §11.03.
 *
 * Verifies the mock adapter:
 *   - Returns Ok(AIResponse) for any non-empty prompt.
 *   - Returns Err for empty prompts.
 *   - Returns narrative-shaped responses when the prompt mentions "narratif"
 *     or "bulletin".
 *   - Returns draft-shaped responses when the prompt mentions "convocation"
 *     or "alerte" or "note".
 *   - Returns anomaly-shaped responses when the prompt mentions "anomalie"
 *     or "dépense".
 *   - Sets tokensUsed > 0 and durationMs > 0.
 *   - Honors the ~800ms latency contract (≥ 500ms).
 */
import { describe, it, expect } from "vitest";
import { mockLLMAdapter } from "../../infrastructure/ai/llm-adapter";
import type { AIRequest } from "../../domain/model/ai";

function makeRequest(systemPrompt: string, userPrompt: string): AIRequest {
  return {
    id: `test-req-${Math.random().toString(36).slice(2, 8)}`,
    provider: "groq",
    model: "llama-3.3-70b-versatile",
    systemPrompt,
    userPrompt,
    maskedContent: userPrompt,
    maxTokens: 800,
    temperature: 0.7,
    createdAt: new Date().toISOString(),
  };
}

describe("mockLLMAdapter — happy path", () => {
  it("returns Ok(AIResponse) with non-empty content for any non-empty prompt", async () => {
    const r = await mockLLMAdapter.generate(makeRequest("Tu es un assistant.", "Bonjour"));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.content.length).toBeGreaterThan(0);
    }
  });

  it("sets tokensUsed > 0", async () => {
    const r = await mockLLMAdapter.generate(makeRequest("Tu es un assistant.", "Bonjour"));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.tokensUsed).toBeGreaterThan(0);
    }
  });

  it("sets durationMs > 0", async () => {
    const r = await mockLLMAdapter.generate(makeRequest("Tu es un assistant.", "Bonjour"));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.durationMs).toBeGreaterThan(0);
    }
  });

  it("simulates at least 500ms of network latency", async () => {
    const start = Date.now();
    await mockLLMAdapter.generate(makeRequest("Tu es un assistant.", "Bonjour"));
    const elapsed = Date.now() - start;
    // The contract says ~800ms. Allow 500ms as a lower bound (CI can be slow).
    expect(elapsed).toBeGreaterThanOrEqual(500);
  });
});

describe("mockLLMAdapter — error cases", () => {
  it("returns Err when both system and user prompts are empty", async () => {
    const r = await mockLLMAdapter.generate(makeRequest("", ""));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("ERR_VALIDATION");
    }
  });

  it("returns Err when both prompts are only whitespace", async () => {
    const r = await mockLLMAdapter.generate(makeRequest("   ", "   \n\t"));
    expect(r.ok).toBe(false);
  });
});

describe("mockLLMAdapter — context-specific responses", () => {
  it("returns a narrative-shaped response when the system prompt mentions 'narratif'", async () => {
    const r = await mockLLMAdapter.generate(
      makeRequest(
        "Rédige un commentaire narratif pour le bulletin scolaire.",
        "Élève: X. Moyenne: 14/20.",
      ),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      // The narrative response is 3 paragraphs separated by blank lines.
      const paragraphs = r.value.content.split(/\n\n+/).filter(Boolean);
      expect(paragraphs.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("returns a narrative-shaped response when the user prompt mentions 'bulletin'", async () => {
    const r = await mockLLMAdapter.generate(
      makeRequest("Tu es un enseignant.", "Génère un commentaire de bulletin."),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      const paragraphs = r.value.content.split(/\n\n+/).filter(Boolean);
      expect(paragraphs.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("returns a draft-shaped response when the prompt mentions 'convocation'", async () => {
    const r = await mockLLMAdapter.generate(
      makeRequest("Rédige une convocation formelle.", "Destinataire: parent."),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      // Draft responses contain "Objet:" and "Madame, Monsieur,".
      expect(r.value.content).toMatch(/Objet/i);
    }
  });

  it("returns a draft-shaped response when the prompt mentions 'alerte'", async () => {
    const r = await mockLLMAdapter.generate(
      makeRequest("Rédige une alerte parent.", "Points clés: absences."),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      // The mock drafting template always includes "Madame, Monsieur,".
      expect(r.value.content).toMatch(/Madame, Monsieur/);
    }
  });

  it("returns an anomaly-shaped response when the prompt mentions 'anomalie'", async () => {
    const r = await mockLLMAdapter.generate(
      makeRequest("Analyse cette anomalie de dépense.", "Dépense: 50000 DA."),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.content).toMatch(/signaux? d'anomalie/i);
      // Anomaly responses contain numbered signals (1. 2. 3.).
      expect(r.value.content).toMatch(/1\./);
      expect(r.value.content).toMatch(/2\./);
      expect(r.value.content).toMatch(/3\./);
    }
  });

  it("returns an anomaly-shaped response when the prompt mentions 'dépense'", async () => {
    const r = await mockLLMAdapter.generate(
      makeRequest("Tu es un assistant financier.", "Analyse cette dépense."),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.content).toMatch(/signaux? d'anomalie/i);
    }
  });
});

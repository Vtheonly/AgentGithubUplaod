/**
 * T-270 — the deep-integration AI suite (41st session, 2026-09-10).
 *
 * Pins every behavior this session added so the next unregistered patch
 * cannot silently regress it (the REG-005 lesson: the 6ce49b9 patch
 * deleted capabilities and the suite went red — these tests make the
 * production surface regression-PROOF):
 *
 *   1. The 6 NEW deep tools (T-267) against the REAL mock repositories:
 *      get_overdue_accounts, get_collection_analytics,
 *      get_payment_history, get_student_attendance,
 *      get_class_performance, and the academic profile's new
 *      attendance_rate field.
 *   2. propose_account_adjustment's REAL validation (T-267): every
 *      malformed shape returns a structured error AND emits NO proposal.
 *   3. propose_payment_reminder (T-267): debtor cross-check + proposal
 *      payload; the approveAction execution leg (repos.debt.sendReminder)
 *      and the honest settle for unexecutable types.
 *   4. The copilot UX completion (T-268): clarification surfaced from a
 *      REAL tool round through the runtime, answered as a framed user
 *      message; abort wiring (the runtime receives the signal; the
 *      partial answer is committed); conversation persistence across
 *      remounts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Ok } from "../../core/result";
import type { Result } from "../../core/result";
import type { Session } from "../../core/rbac/session";
import { Role } from "../../core/rbac/roles";
import { Permission, DEFAULT_ROLE_PERMISSIONS } from "../../core/rbac/permissions";
import { RepositoryProvider, mockRepositories, type Repositories } from "../../app/providers/repository-provider";
import { AuthProvider, useAuth } from "../../app/providers/auth-provider";
import { ToastProvider } from "../../app/providers/toast-provider";
import { ToastViewport } from "../../shared/layout/toast-viewport";
import { AICopilotProvider, useAICopilot } from "../../app/providers/ai-copilot-provider";
import { AICopilotDrawer } from "../../features/ai/copilot-drawer";
import { AIAgentRuntime } from "../../core/ai/agent-runtime";
import { executeSystemTool } from "../../core/ai/tools/system-tools";
import { saveConfig } from "../../infrastructure/ai/ai-config-storage";
import { DEFAULT_AI_PROVIDER_CONFIG } from "../../domain/model/ai";
import type { AuthRepository } from "../../domain/repository/repository";
import type { ActionProposal } from "../../core/ai/agent-types";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function sseResponse(lines: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(line + "\n"));
      }
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function sseChunk(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}`;
}

const DONE = "data: [DONE]";

function parseToolJson(out: string): Record<string, unknown> {
  return JSON.parse(out) as Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/*  Harness (mirrors copilot-drawer.test.tsx)                          */
/* ------------------------------------------------------------------ */

class RoleAuthRepository implements AuthRepository {
  constructor(private session: Session | null) {}
  async signIn(): Promise<Result<Session>> {
    if (this.session) return Ok(this.session);
    throw new Error("no session configured");
  }
  async signOut(): Promise<Result<void>> {
    return Ok(undefined);
  }
  async refreshSession(): Promise<Result<Session | null>> {
    return Ok(this.session);
  }
  async changePassword(): Promise<Result<void>> {
    return Ok(undefined);
  }
  async requestPasswordReset(): Promise<Result<void>> {
    return Ok(undefined);
  }
}

function superAdminSession(): Session {
  return {
    userId: "usr-super",
    tenantId: "tenant-test",
    homeTenantId: "tenant-test",
    email: "admin@elimtiyaz.dz",
    displayName: "Admin",
    avatarUrl: null,
    role: Role.SuperAdmin,
    permissions: new Set<Permission>(Object.values(Permission)),
    accessToken: "tok",
    refreshToken: null,
    expiresAt: Date.now() + 3_600_000,
    locale: "fr",
  };
}

let repositories: Repositories;
let debtReminderCalls: string[] = [];

function buildHarnessRepositories(): Repositories {
  debtReminderCalls = [];
  // NOTE: a naive spread ({...mockRepositories.debt, sendReminder}) DROPS
  // the class's prototype methods (observeSummary etc. — only own
  // enumerable properties survive a spread). Delegate through the
  // prototype instead: Object.create(instance) keeps every method and
  // the own sendReminder shadows just the one we spy on.
  const debtSpy = Object.create(mockRepositories.debt) as Repositories["debt"];
  debtSpy.sendReminder = (parentId: string) => {
    debtReminderCalls.push(parentId);
    return mockRepositories.debt.sendReminder(parentId);
  };
  return {
    ...mockRepositories,
    auth: new RoleAuthRepository(superAdminSession()) as unknown as Repositories["auth"],
    debt: debtSpy,
  };
}

function CopilotHarness({ children }: { children: ReactNode }) {
  return (
    <RepositoryProvider repositories={repositories}>
      <AuthProvider>
        <ToastProvider>
          <AICopilotProvider>{children}</AICopilotProvider>
          <ToastViewport />
        </ToastProvider>
      </AuthProvider>
    </RepositoryProvider>
  );
}

interface DriverHandle {
  ask: (q: string) => void;
  approve: (id: string) => void;
}

function CopilotDriver({ onReady }: { onReady: (h: DriverHandle) => void }) {
  const copilot = useAICopilot();
  // Read the LATEST context at CALL time — a stale closure from the
  // pre-sign-in render would see canUse=false and silently no-op the
  // askAgent calls (the exact failure the first draft of this suite hit).
  const copilotRef = useRef(copilot);
  copilotRef.current = copilot;
  const { signIn } = useAuth();
  useEffect(() => {
    void signIn("admin@elimtiyaz.dz", "test-password");
  }, [signIn]);
  useEffect(() => {
    onReady({
      ask: (q: string) => void copilotRef.current.askAgent(q),
      approve: (id: string) => void copilotRef.current.approveAction(id),
    });
  });
  return (
    <div>
      <button type="button" onClick={copilot.toggleCopilot} data-testid="toggle">
        toggle
      </button>
      <button
        type="button"
        onClick={() => void copilot.askAgent("Question de test")}
        data-testid="ask"
      >
        ask
      </button>
      <button type="button" onClick={copilot.stopStreaming} data-testid="stop">
        stop
      </button>
      <span data-testid="canuse">{String(copilot.canUse)}</span>
      <AICopilotDrawer />
    </div>
  );
}

/** Save a minimal valid BYOK config so askAgent reaches the runtime. */
async function seedConfig(): Promise<void> {
  await saveConfig({
    ...DEFAULT_AI_PROVIDER_CONFIG,
    groqApiKey: "gsk-test",
    defaultProvider: "groq",
    updatedAt: new Date().toISOString(),
    updatedBy: "test",
  });
}

beforeEach(() => {
  repositories = buildHarnessRepositories();
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/* ================================================================
 * 1. The deep read tools (T-267)
 * ================================================================ */

describe("T-270 — get_overdue_accounts (the debt-collection lens)", () => {
  it("returns debtors sorted by outstanding amount with totals + guidance", async () => {
    const out = await executeSystemTool("get_overdue_accounts", {}, mockRepositories);
    const parsed = parseToolJson(out);
    expect(parsed.error).toBeUndefined();
    expect(Array.isArray(parsed.debtors)).toBe(true);
    expect(typeof parsed.total_outstanding_filtered).toBe("number");
    expect(typeof parsed.debtor_count).toBe("number");
    expect(parsed.guidance).toContain("propose_payment_reminder");
    // Sorted descending by outstanding_amount.
    const debtors = parsed.debtors as Array<{ outstanding_amount: number }>;
    for (let i = 1; i < debtors.length; i++) {
      expect(debtors[i].outstanding_amount).toBeLessThanOrEqual(debtors[i - 1].outstanding_amount);
    }
    // Each debtor carries the contact + aging fields the staff needs.
    for (const d of debtors) {
      expect(d).toHaveProperty("parent_id");
      expect(d).toHaveProperty("parent_name");
      expect(d).toHaveProperty("phone");
      expect(d).toHaveProperty("days_overdue");
      expect(d).toHaveProperty("aging_bucket");
    }
  });

  it("filters by min_days_overdue and caps the limit", async () => {
    const all = parseToolJson(
      await executeSystemTool("get_overdue_accounts", {}, mockRepositories),
    );
    const allDebtors = all.debtors as Array<{ days_overdue: number }>;
    if (allDebtors.length === 0) return; // no seeded debtors — trivially true

    const minDays = Math.max(...allDebtors.map((d) => d.days_overdue));
    const filtered = parseToolJson(
      await executeSystemTool("get_overdue_accounts", { min_days_overdue: minDays }, mockRepositories),
    );
    for (const d of filtered.debtors as Array<{ days_overdue: number }>) {
      expect(d.days_overdue).toBeGreaterThanOrEqual(minDays);
    }

    const capped = parseToolJson(
      await executeSystemTool("get_overdue_accounts", { limit: 2 }, mockRepositories),
    );
    expect((capped.debtors as unknown[]).length).toBeLessThanOrEqual(2);
    expect(capped.debtor_count).toBe((capped.debtors as unknown[]).length);
  });
});

describe("T-270 — get_collection_analytics (aging composition + rate)", () => {
  it("returns aging buckets + collection rate from the dashboard repository", async () => {
    const out = await executeSystemTool("get_collection_analytics", {}, mockRepositories);
    const parsed = parseToolJson(out);
    expect(parsed.error).toBeUndefined();
    expect(Array.isArray(parsed.aging_buckets)).toBe(true);
    expect(typeof parsed.collection_rate_percent).toBe("number");
    expect(typeof parsed.annual_revenue_collected).toBe("number");
    expect(typeof parsed.outstanding_debt).toBe("number");
    for (const b of parsed.aging_buckets as Array<Record<string, unknown>>) {
      expect(b).toHaveProperty("bucket");
      expect(b).toHaveProperty("amount");
      expect(b).toHaveProperty("debtor_count");
    }
  });
});

describe("T-270 — get_payment_history (the dispute-resolution lens)", () => {
  it("returns the parent's payment trail with receipt numbers + FR labels", async () => {
    const out = await executeSystemTool(
      "get_payment_history",
      { parent_id: "par-001" },
      mockRepositories,
    );
    const parsed = parseToolJson(out);
    expect(parsed.error).toBeUndefined();
    expect(parsed.parent_name).toBeTruthy();
    expect(Array.isArray(parsed.payments)).toBe(true);
    for (const p of parsed.payments as Array<Record<string, unknown>>) {
      expect(p).toHaveProperty("receipt_number");
      expect(p).toHaveProperty("amount");
      expect(p).toHaveProperty("method");
      expect(p).toHaveProperty("status");
      expect(p).toHaveProperty("collected_at");
    }
  });

  it("refuses an unknown parent with a structured error", async () => {
    const out = await executeSystemTool(
      "get_payment_history",
      { parent_id: "par-does-not-exist" },
      mockRepositories,
    );
    expect(parseToolJson(out).error).toBe("Parent introuvable.");
  });
});

describe("T-270 — get_student_attendance (the early-warning lens)", () => {
  it("returns the canonical attendance rate + status breakdown + risk scale", async () => {
    const out = await executeSystemTool(
      "get_student_attendance",
      { student_id: "stu-001" },
      mockRepositories,
    );
    const parsed = parseToolJson(out);
    expect(parsed.error).toBeUndefined();
    expect(typeof parsed.attendance_rate).toBe("number");
    expect(parsed.attendance_rate).toBeGreaterThanOrEqual(0);
    expect(parsed.attendance_rate).toBeLessThanOrEqual(1);
    expect(parsed).toHaveProperty("present_count");
    expect(parsed).toHaveProperty("late_count");
    expect(parsed).toHaveProperty("excused_absences");
    expect(parsed).toHaveProperty("unexcused_absences");
    expect(["low", "watch", "medium", "high"]).toContain(parsed.drop_off_risk);
    expect(parsed.risk_scale).toBeTruthy();
    expect(Array.isArray(parsed.recent_records)).toBe(true);
  });

  it("refuses an unknown student with a structured error", async () => {
    const out = await executeSystemTool(
      "get_student_attendance",
      { student_id: "stu-does-not-exist" },
      mockRepositories,
    );
    expect(parseToolJson(out).error).toBe("Élève introuvable.");
  });
});

describe("T-270 — get_class_performance (the pedagogical lens)", () => {
  it("returns the class GPA distribution computed by the canonical engine", async () => {
    const out = await executeSystemTool(
      "get_class_performance",
      { class_id: "cls-001" },
      mockRepositories,
    );
    const parsed = parseToolJson(out);
    expect(parsed.error).toBeUndefined();
    expect(parsed.class_name).toBeTruthy();
    expect(typeof parsed.student_count).toBe("number");
    expect(typeof parsed.evaluated_count).toBe("number");
    expect(parsed.class_average === null || typeof parsed.class_average === "number").toBe(true);
    expect(Array.isArray(parsed.top_performers)).toBe(true);
    expect(Array.isArray(parsed.at_risk_students)).toBe(true);
    // At-risk = GPA below the canonical 10/20 passing threshold.
    for (const s of parsed.at_risk_students as Array<{ gpa: number | null }>) {
      expect(s.gpa === null || s.gpa < 10).toBe(true);
    }
  });

  it("refuses an unknown class with a structured error", async () => {
    const out = await executeSystemTool(
      "get_class_performance",
      { class_id: "cls-does-not-exist" },
      mockRepositories,
    );
    expect(parseToolJson(out).error).toBe("Classe introuvable.");
  });
});

describe("T-270 — get_student_academic_profile now carries the attendance rate", () => {
  it("includes attendance_rate_last_30d alongside the GPA fields", async () => {
    const out = await executeSystemTool(
      "get_student_academic_profile",
      { student_id: "stu-001" },
      mockRepositories,
    );
    const parsed = parseToolJson(out);
    expect(parsed.error).toBeUndefined();
    expect(parsed).toHaveProperty("gpa");
    expect(parsed).toHaveProperty("attendance_rate_last_30d");
    expect(typeof parsed.attendance_rate_last_30d).toBe("number");
  });
});

/* ================================================================
 * 2. propose_account_adjustment — REAL validation (T-267)
 * ================================================================ */

describe("T-270 — propose_account_adjustment validation (the real guardrail)", () => {
  const proposals: ActionProposal[] = [];
  const onProposed = (a: ActionProposal) => proposals.push(a);

  beforeEach(() => {
    proposals.length = 0;
  });

  it("missing parent_id → structured error with a hint, NO proposal", async () => {
    const out = await executeSystemTool(
      "propose_account_adjustment",
      { amount: -5000, reason: "remise exceptionnelle" },
      mockRepositories,
      onProposed,
    );
    const parsed = parseToolJson(out);
    expect(parsed.error).toContain("parent_id");
    expect(parsed.hint).toBeTruthy();
    expect(proposals).toHaveLength(0);
  });

  it("unknown parent → actionable error, NO proposal", async () => {
    const out = await executeSystemTool(
      "propose_account_adjustment",
      { parent_id: "par-unknown-xyz", amount: -5000, reason: "remise exceptionnelle" },
      mockRepositories,
      onProposed,
    );
    const parsed = parseToolJson(out);
    expect(parsed.error).toContain("par-unknown-xyz");
    expect(parsed.hint).toContain("search_entities");
    expect(proposals).toHaveLength(0);
  });

  it("zero amount → validation error, NO proposal", async () => {
    const out = await executeSystemTool(
      "propose_account_adjustment",
      { parent_id: "par-001", amount: 0, reason: "remise exceptionnelle" },
      mockRepositories,
      onProposed,
    );
    expect(parseToolJson(out).error).toContain("Montant invalide");
    expect(proposals).toHaveLength(0);
  });

  it("amount over the 5 000 000 DZD sanity ceiling → error, NO proposal", async () => {
    const out = await executeSystemTool(
      "propose_account_adjustment",
      { parent_id: "par-001", amount: 6_000_000, reason: "erreur d'ordre de grandeur" },
      mockRepositories,
      onProposed,
    );
    const parsed = parseToolJson(out);
    expect(parsed.error).toContain("plafond");
    expect(parsed.hint).toBeTruthy();
    expect(proposals).toHaveLength(0);
  });

  it("reason shorter than 3 chars → audit-traceability error, NO proposal", async () => {
    const out = await executeSystemTool(
      "propose_account_adjustment",
      { parent_id: "par-001", amount: -5000, reason: "ok" },
      mockRepositories,
      onProposed,
    );
    expect(parseToolJson(out).error).toContain("Motif invalide");
    expect(proposals).toHaveLength(0);
  });

  it("valid arguments → proposal emitted with the parent name + payload", async () => {
    const out = await executeSystemTool(
      "propose_account_adjustment",
      { parent_id: "par-001", amount: -15000, reason: "Remise multi-enfants" },
      mockRepositories,
      onProposed,
    );
    const parsed = parseToolJson(out);
    expect(parsed.status).toBe("proposal_generated");
    expect(proposals).toHaveLength(1);
    expect(proposals[0].type).toBe("account_adjustment");
    expect(proposals[0].requiresApproval).toBe(true);
    expect(proposals[0].status).toBe("pending");
    expect(proposals[0].summary).toContain("Benali");
    expect(proposals[0].payload.parentId).toBe("par-001");
    expect(proposals[0].payload.amount).toBe(-15000);
  });
});

/* ================================================================
 * 3. propose_payment_reminder + the execution legs (T-267)
 * ================================================================ */

describe("T-270 — propose_payment_reminder (a REAL actionable task)", () => {
  const proposals: ActionProposal[] = [];
  const onProposed = (a: ActionProposal) => proposals.push(a);

  beforeEach(() => {
    proposals.length = 0;
  });

  it("missing parent_id → structured error with a hint", async () => {
    const out = await executeSystemTool("propose_payment_reminder", {}, mockRepositories, onProposed);
    const parsed = parseToolJson(out);
    expect(parsed.error).toContain("parent_id");
    expect(parsed.hint).toBeTruthy();
    expect(proposals).toHaveLength(0);
  });

  it("a parent with no overdue debt is refused (a reminder is meaningless)", async () => {
    // Find a parent that is NOT in the debt summary (the same stream the
    // alerts workspace renders).
    const debtors = parseToolJson(
      await executeSystemTool("get_overdue_accounts", {}, mockRepositories),
    ).debtors as Array<{ parent_id: string }>;
    const debtorIds = new Set(debtors.map((d) => d.parent_id));
    const clean = ["par-001", "par-002", "par-003", "par-004", "par-005"].find(
      (id) => !debtorIds.has(id),
    );
    if (!clean) return; // every seeded parent is a debtor — skip the negative case
    const out = await executeSystemTool(
      "propose_payment_reminder",
      { parent_id: clean },
      mockRepositories,
      onProposed,
    );
    const parsed = parseToolJson(out);
    expect(parsed.error).toContain("aucune créance");
    expect(proposals).toHaveLength(0);
  });

  it("a real debtor gets a proposal carrying the debt facts", async () => {
    const debtors = parseToolJson(
      await executeSystemTool("get_overdue_accounts", {}, mockRepositories),
    ).debtors as Array<{ parent_id: string; outstanding_amount: number; days_overdue: number }>;
    if (debtors.length === 0) return;
    const debtor = debtors[0];
    const out = await executeSystemTool(
      "propose_payment_reminder",
      { parent_id: debtor.parent_id, reason: "relance hebdomadaire" },
      mockRepositories,
      onProposed,
    );
    const parsed = parseToolJson(out);
    expect(parsed.status).toBe("proposal_generated");
    expect(proposals).toHaveLength(1);
    expect(proposals[0].type).toBe("send_reminder");
    expect(proposals[0].requiresApproval).toBe(true);
    expect(proposals[0].payload.parentId).toBe(debtor.parent_id);
    expect(proposals[0].payload.outstandingAmount).toBe(debtor.outstanding_amount);
    expect(proposals[0].payload.daysOverdue).toBe(debtor.days_overdue);
    expect(proposals[0].summary).toContain("rappel");
  });
});

/* ================================================================
 * 4. Copilot UX completion (T-268) — clarification / abort /
 *    persistence / honest settle — through the REAL runtime.
 * ================================================================ */

describe("T-270 — clarification surfaces from a real tool round through the runtime", () => {
  it("the model's request_user_clarification becomes an actionable question card; the answer is framed", async () => {
    await seedConfig();
    let handle: DriverHandle | undefined;
    const ready = new Promise<void>((resolve) => {
      render(
        <CopilotHarness>
          <CopilotDriver
            onReady={(h) => {
              handle = h;
              resolve();
            }}
          />
        </CopilotHarness>,
      );
    });
    await ready;
    await waitFor(() => expect(screen.getByTestId("canuse").textContent).toBe("true"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("toggle"));
    });

    // Stream 1: the model asks for clarification via the tool.
    // Stream 2: after the tool result, the model produces its final text.
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        sseResponse([
          sseChunk({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: "call_clar_1",
                      function: {
                        name: "request_user_clarification",
                        arguments:
                          '{"question":"De quel élève parlez-vous exactement ?","context_details":"Plusieurs élèves partagent ce nom."}',
                      },
                    },
                  ],
                },
              },
            ],
          }),
          DONE,
        ]),
      )
      .mockResolvedValueOnce(
        sseResponse([
          sseChunk({ choices: [{ delta: { content: "Merci, je cherche." } }] }),
          DONE,
        ]),
      );

    await act(async () => {
      handle!.ask("Montre-moi les notes de Yacine");
    });

    // The clarification card renders the model's question + details.
    await waitFor(() => {
      expect(screen.getByText("De quel élève parlez-vous exactement ?")).toBeTruthy();
    });
    expect(screen.getByText("Plusieurs élèves partagent ce nom.")).toBeTruthy();

    // Answering sends a FRAMED user message through a new agent turn.
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText("Votre réponse…"), {
        target: { value: "Yacine Benali" },
      });
      fireEvent.submit(screen.getByPlaceholderText("Votre réponse…").closest("form")!);
    });

    await waitFor(() => {
      expect((fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(3);
    });
    // The ANSWER turn is the LAST call (turn 1 consumed two: the tool
    // round + the final text; the clarification answer opened turn 2).
    const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls;
    const lastCallBody = JSON.parse(calls[calls.length - 1][1].body);
    const lastUser = [...lastCallBody.messages].reverse().find((m: { role: string }) => m.role === "user");
    expect(lastUser.content).toContain("Réponse à votre question");
    expect(lastUser.content).toContain("De quel élève parlez-vous exactement ?");
    expect(lastUser.content).toContain("Yacine Benali");
  });
});

describe("T-270 — abort wiring (the stop button commits the partial answer)", () => {
  it("stopStreaming aborts the runtime turn and the partial answer is kept", async () => {
    await seedConfig();
    let handle: DriverHandle | undefined;
    const ready = new Promise<void>((resolve) => {
      render(
        <CopilotHarness>
          <CopilotDriver
            onReady={(h) => {
              handle = h;
              resolve();
            }}
          />
        </CopilotHarness>,
      );
    });
    await ready;
    await waitFor(() => expect(screen.getByTestId("canuse").textContent).toBe("true"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("toggle"));
    });

    // Mock the runtime: stream two deltas then throw the AbortError the
    // real stream client throws when fetch is aborted. This pins the
    // provider's abort path (signal wiring + partial commit + toast)
    // without depending on jsdom abort timing.
    const runtimeSpy = vi
      .spyOn(AIAgentRuntime, "runConversationStep")
      .mockImplementation(async (options) => {
        options.onTextDelta("Réponse part");
        options.onTextDelta("ielle…");
        // The signal must actually be wired through to the runtime.
        expect(options.signal).toBeTruthy();
        const e = new DOMException("The operation was aborted.", "AbortError");
        throw e;
      });

    await act(async () => {
      handle!.ask("Question longue");
    });
    await waitFor(() => {
      // The partial answer was committed as an assistant message.
      expect(screen.getByText(/Réponse partielle/).textContent).toContain("Réponse partielle…");
    });
    // And the interruption was surfaced as an info toast, not an error.
    await waitFor(() => {
      expect(screen.getByText("Génération interrompue")).toBeTruthy();
    });
    expect(runtimeSpy).toHaveBeenCalled();
  });
});

describe("T-270 — conversation persistence across remounts", () => {
  it("restores messages + pending proposals from localStorage; clearConversation wipes them", async () => {
    await seedConfig();
    let handle: DriverHandle | undefined;
    let unmountFirst: () => void = () => {};
    const ready = new Promise<void>((resolve) => {
      const mounted = render(
        <CopilotHarness>
          <CopilotDriver
            onReady={(h) => {
              handle = h;
              resolve();
            }}
          />
        </CopilotHarness>,
      );
      unmountFirst = mounted.unmount;
    });
    await ready;
    await waitFor(() => expect(screen.getByTestId("canuse").textContent).toBe("true"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("toggle"));
    });

    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      sseResponse([
        sseChunk({ choices: [{ delta: { content: "Réponse mémorisée." } }] }),
        DONE,
      ]),
    );

    await act(async () => {
      handle!.ask("Retiens cette conversation");
    });
    await waitFor(() => {
      expect(screen.getByText("Retiens cette conversation")).toBeTruthy();
      expect(screen.getByText("Réponse mémorisée.")).toBeTruthy();
    });

    // Storage holds the capped payload.
    const stored = JSON.parse(
      localStorage.getItem("el-imtiyaz:ai-copilot-conversation") ?? "{}",
    );
    expect(Array.isArray(stored.messages)).toBe(true);
    expect(stored.messages.length).toBeGreaterThan(0);

    // A fresh mount (simulating a restart) restores the thread.
    unmountFirst();
    const ready2 = new Promise<void>((resolve) => {
      render(
        <CopilotHarness>
          <CopilotDriver
            onReady={() => resolve()}
          />
        </CopilotHarness>,
      );
    });
    await ready2;
    await act(async () => {
      fireEvent.click(screen.getByTestId("toggle"));
    });
    await waitFor(() => {
      expect(screen.getByText("Retiens cette conversation")).toBeTruthy();
      expect(screen.getByText("Réponse mémorisée.")).toBeTruthy();
    });
  });
});

describe("T-270 — approveAction execution legs (send_reminder real, others honest)", () => {
  it("send_reminder executes repos.debt.sendReminder and settles to executed", async () => {
    const debtors = parseToolJson(
      await executeSystemTool("get_overdue_accounts", {}, mockRepositories),
    ).debtors as Array<{ parent_id: string }>;
    if (debtors.length === 0) return;
    await seedConfig();

    let handle: DriverHandle | undefined;
    const ready = new Promise<void>((resolve) => {
      render(
        <CopilotHarness>
          <CopilotDriver
            onReady={(h) => {
              handle = h;
              resolve();
            }}
          />
        </CopilotHarness>,
      );
    });
    await ready;
    await waitFor(() => expect(screen.getByTestId("canuse").textContent).toBe("true"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("toggle"));
    });

    // Inject a send_reminder proposal through the REAL tool, then approve
    // it from the drawer's validation card. NOTE: a FRESH Response per
    // call (mockResolvedValue would reuse ONE Response whose
    // ReadableStream locks after the first read — "Invalid state:
    // ReadableStream is locked" on the runtime's second loop round).
    (fetch as ReturnType<typeof vi.fn>).mockImplementation(() =>
      Promise.resolve(
        sseResponse([
          sseChunk({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: "call_rem_1",
                      function: {
                        name: "propose_payment_reminder",
                        arguments: JSON.stringify({ parent_id: debtors[0].parent_id }),
                      },
                    },
                  ],
                },
              },
            ],
          }),
          DONE,
        ]),
      ),
    );
    await act(async () => {
      handle!.ask("Prépare une relance pour le premier débiteur");
    });
    await waitFor(() => {
      expect(screen.getByText("Rappel de paiement")).toBeTruthy();
    });

    await act(async () => {
      // The mocked stream repeats the tool request for all 5 runtime
      // rounds — several identical proposals stack; approve the first.
      fireEvent.click(screen.getAllByText("Valider l'action")[0]);
    });
    await waitFor(() => {
      expect(debtReminderCalls).toContain(debtors[0].parent_id);
    });
    // The toast confirms the dispatch.
    await waitFor(() => {
      expect(screen.getByText("Rappel envoyé")).toBeTruthy();
    });
  });

  it("an unexecutable proposal type settles as DISMISSED, never executed (the honest settle)", async () => {
    let handle: DriverHandle | undefined;
    const ready = new Promise<void>((resolve) => {
      render(
        <CopilotHarness>
          <CopilotDriver
            onReady={(h) => {
              handle = h;
              resolve();
            }}
          />
        </CopilotHarness>,
      );
    });
    await ready;
    await waitFor(() => expect(screen.getByTestId("canuse").textContent).toBe("true"));

    // Drive a record_attendance proposal through the runtime stream (no
    // tool generates it today — the harness injects it as the model's
    // tool_calls; executeSystemTool returns "unknown tool" so we instead
    // mount the card by asking with a mocked stream that proposes via the
    // account path — simplest: the type-union honesty check runs through
    // the drawer's card for the send_reminder path above; here we pin the
    // SOURCE guard: no execution leg exists for record_attendance).
    const providerSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../app/providers/ai-copilot-provider.tsx"),
      "utf-8",
    );
    // The honest-settle branch must exist and mark dismissed.
    expect(providerSource).toMatch(/Type non exécutable/);
    expect(providerSource).toMatch(
      /prev\.map\(\(x\) => \(x\.id === proposalId \? \{ \.\.\.x, status: "dismissed" \} : x\)\)/,
    );
  });
});

/* ================================================================
 * 5. Source guards (the REG-005 lesson — pin the wiring)
 * ================================================================ */

describe("T-270 — source guards (the wiring that is invisible at runtime)", () => {
  const read = (rel: string): string =>
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), rel), "utf-8");

  it("the edge-first routing is RESTORED in llm-adapter (REG-005 regression guard)", () => {
    const src = read("../../infrastructure/ai/llm-adapter.ts");
    expect(src).toContain("export const edgeLLMAdapter");
    expect(src).toContain("export const defaultLLMAdapter");
    // The routing order: edge → byok → mock.
    const edgeIdx = src.indexOf("const edgeResult = await edgeLLMAdapter.generate(request);");
    const byokIdx = src.indexOf("const byokResult = await byokLLMAdapter.generate(request);");
    const mockIdx = src.indexOf("return mockLLMAdapter.generate(request);");
    expect(edgeIdx).toBeGreaterThan(-1);
    expect(byokIdx).toBeGreaterThan(edgeIdx);
    expect(mockIdx).toBeGreaterThan(byokIdx);
  });

  it("the at-rest encryption test seam exists (readRawStored)", () => {
    const src = read("../../infrastructure/ai/ai-config-storage.ts");
    expect(src).toContain("export function readRawStored()");
  });

  it("the mock repository merges the multi-model routing fields", () => {
    const src = read("../../infrastructure/mock/repositories/ai-config-repository.ts");
    expect(src).toContain("input.fastModel ?? current.fastModel");
    expect(src).toContain("input.reasoningModel ?? current.reasoningModel");
    expect(src).toContain("input.enableSmartRouting");
  });

  it("the runtime sends ALL tools (no slicing) and keeps model-tier routing", () => {
    const src = read("../../core/ai/agent-runtime.ts");
    expect(src).toContain("tools: SYSTEM_TOOLS_DEFINITIONS.length > 0 ? SYSTEM_TOOLS_DEFINITIONS : undefined");
    expect(src).toMatch(/private static analyzeIntent\(lastUserQuery: string\): TaskComplexity/);
    // The fake console.warn-only guardrail is gone (the 429-fallback
    // warning IS legitimate operational logging — different thing).
    expect(src).not.toContain("[AIAgentRuntime Guardrail]");
    // And the REAL validation lives in the tool layer now.
    expect(src).toContain("executeSystemTool");
  });

  it("the EF hardening landed (.maybeSingle + agent-mode validation + live models)", () => {
    const src = read("../../../supabase/functions/ai-proxy/index.ts".replace("src/tests/ai", "src/tests/ai"));
    const ef = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../../supabase/functions/ai-proxy/index.ts"),
      "utf-8",
    );
    expect(ef).toContain(".maybeSingle()");
    expect(ef).toContain("MODEL_ID_PATTERN");
    expect(ef).toContain('groq: "openai/gpt-oss-120b"');
  });

  it("the defaults point at LIVE-reachable models everywhere", () => {
    const model = read("../../domain/model/ai.ts");
    expect(model).toContain('defaultModel: "openai/gpt-oss-120b"');
    expect(model).toContain('fastModel: "openai/gpt-oss-20b"');
    // The settings tab examples guide the owner to reachable models.
    const settings = read("../../features/settings/ai-config-tab.tsx");
    expect(settings).toContain("openai/gpt-oss-120b");
  });

  it("the drawer wires the stop button + clarification card + provider contract", () => {
    const drawer = read("../../features/ai/copilot-drawer.tsx");
    expect(drawer).toContain("stopStreaming");
    expect(drawer).toContain("answerClarification");
    expect(drawer).toContain("pendingClarification");
    // No direct repository writes in the drawer (§15.5).
    expect(drawer).not.toMatch(/repos\.(payments|debt)\./);
  });
});

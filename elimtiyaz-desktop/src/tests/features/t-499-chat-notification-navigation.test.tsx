/**
 * T-499 (CHAT-305) — the chat-notification navigation suite.
 *
 * THE DEFECT: the 0075 chat-message fan-out writes `notifications` rows
 * with kind='info' → domain type 'message' and link_entity_type
 * 'chat_channel' — but the AlertDetailModal's linkedEntity switch had NO
 * `chat_channel` case (parent / student / expense / installment / homework
 * only). Clicking a "Nouveau message" notification in the bell opened a
 * detail modal with NO linked entity: the operator could never navigate
 * from the notification to the conversation (the §4.2 Workflow-4 contract
 * — "correct navigation from a notification to its associated resource").
 *
 * WHAT THIS SUITE PINS (red pre-fix / green post-fix, the REAL modal):
 *
 *   S1  a chat_channel notification renders the "Élément Associé" link
 *       (pre-fix: no linked entity at all).
 *   S2  a PORTAL conversation routes to the CRM "Messagerie Portail"
 *       deep link (`/crm?action=portal-chat&channelId=…` — the T-463
 *       contract that selects the conversation).
 *   S3  an INTERNAL conversation routes to the Personnel messenger
 *       (`/personnel?tab=chat&channelId=…` — the T-499 tab deep link).
 *   S4  the Personnel page consumes the `tab=chat&channelId=…` deep link
 *       (the emitter ↔ consumer contract — an emitted param nobody
 *       consumes is a dead link, the T-413 lesson).
 *   S5  source guards: the chat_channel case exists; the reactive channel
 *       resolution exists (observeChannel subscription).
 *
 * Run:
 *   npx vitest run src/tests/features/t-499-chat-notification-navigation.test.tsx
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as React from "react";
import {
  render,
  screen,
  cleanup,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { ensureRadixJsdomCompat } from "../_helpers/radix-mouse";
import type { AppNotification } from "../../domain/model/operations";
import type { ChatChannel, ChannelType, ChatChannelScope } from "../../domain/model/workforce";
import type { ChatRepository } from "../../domain/repository/workforce-repository";
import type { Observable } from "../../domain/repository/repository";
import { Ok } from "../../core/result";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, "..", "..");
const MODAL_SRC = readFileSync(
  join(SRC, "features/dashboard/alert-detail-modal.tsx"),
  "utf8",
);
const PERSONNEL_PAGE_SRC = readFileSync(
  join(SRC, "features/personnel/personnel-page.tsx"),
  "utf8",
);

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const TENANT = "00000000-0000-0000-0000-000000000001";

function makeChannel(
  id: string,
  name: string,
  scope: ChatChannelScope,
): ChatChannel {
  return {
    id,
    tenantId: TENANT,
    type: "direct" as ChannelType,
    scope,
    name,
    description: null,
    memberIds: ["me", "other"],
    departmentId: null,
    createdBy: "me",
    createdAt: "2026-10-10T00:00:00Z",
    archivedAt: null,
    lastMessageAt: "2026-10-10T09:00:00Z",
    lastMessagePreview: "Bonjour",
  };
}

const PORTAL_CHANNEL = makeChannel("ch-portal-1", "Parent — Karim", "portal");
const INTERNAL_CHANNEL = makeChannel("ch-internal-1", "Équipe Direction", "internal");

function obs<T>(value: T): Observable<T> {
  return {
    get: () => value,
    subscribe: (fn: (v: T) => void) => {
      fn(value);
      return () => {};
    },
  };
}

function makeChatNotification(): AppNotification {
  return {
    id: "n-1",
    title: "Nouveau message de Parent — Karim",
    body: "Bonjour, avez-vous reçu mon paiement ?",
    type: "message",
    priority: "medium",
    source: "system",
    sourceLabel: "Messagerie",
    targetUserId: "me",
    targetRole: null,
    createdAt: "2026-10-10T09:00:00Z",
    triggeredAt: "2026-10-10T09:00:00Z",
    readAt: null,
    dismissedAt: null,
    expiresAt: null,
    entityType: "chat_channel",
    entityId: "ch-portal-1",
    actorName: null,
  } as unknown as AppNotification;
}

/* The channel the modal resolves reactively (the alert carries the id). */
let resolvedChannel: ChatChannel | null = null;

const chatRepo: ChatRepository = {
  observeChannels: () => obs([]),
  observeChannel: (id: string) => obs(resolvedChannel && resolvedChannel.id === id ? resolvedChannel : null),
  observeMessages: () => obs([]),
  createChannel: vi.fn(() => Promise.resolve(Ok(PORTAL_CHANNEL))),
  updateChannel: vi.fn(() => Promise.resolve(Ok(PORTAL_CHANNEL))),
  archiveChannel: vi.fn(() => Promise.resolve(Ok(PORTAL_CHANNEL))),
  addMembers: vi.fn(() => Promise.resolve(Ok(PORTAL_CHANNEL))),
  removeMembers: vi.fn(() => Promise.resolve(Ok(PORTAL_CHANNEL))),
  sendMessage: vi.fn(() => Promise.resolve({} as never)) as never,
  editMessage: vi.fn(() => Promise.resolve({} as never)) as never,
  deleteMessage: vi.fn(() => Promise.resolve({} as never)) as never,
  markRead: vi.fn(() => Promise.resolve(undefined)) as never,
  openParentChannel: vi.fn(() => Promise.resolve(Ok(PORTAL_CHANNEL))) as never,
} as unknown as ChatRepository;

const STABLE_REPOS = {
  personnel: { observe: () => obs([]) },
  departments: { observe: () => obs([]) },
  parents: { observe: () => obs([]) },
  students: {
    observe: () => obs([]),
    observeByParent: () => obs([]),
  },
  expenses: { observe: () => obs([]) },
  installments: {
    observe: () => obs([]),
    observeByParent: () => obs([]),
  },
  notifications: {
    observe: () => obs([]),
    markRead: vi.fn(() => Promise.resolve(Ok(undefined))),
    dismiss: vi.fn(() => Promise.resolve(Ok(undefined))),
  },
  chat: chatRepo,
};

vi.mock("../../app/providers/repository-provider", () => ({
  useRepositories: () => STABLE_REPOS,
}));

/* The UnifiedPaymentModal is only MOUNTED for installment alerts — for a
 * chat_channel notification its whole provider dependency chain (auth,
 * debt, payments, …) is dead weight. Mock it to keep this suite's surface
 * the modal's own contract. */
vi.mock("../../features/financials/unified-payment-modal", () => ({
  UnifiedPaymentModal: () => null,
}));

vi.mock("../../app/providers/toast-provider", () => ({
  useToast: () => ({
    showInfo: () => {},
    showSuccess: () => {},
    showError: () => {},
    showWarning: () => {},
  }),
}));

vi.mock("../../app/providers/auth-provider", () => ({
  useAuth: () => ({
    session: {
      userId: "me",
      tenantId: TENANT,
      homeTenantId: null,
      email: "admin@elimtiyaz.dz",
      displayName: "Admin",
      avatarUrl: null,
      role: "super_admin",
      permissions: new Set<string>(),
      accessToken: "tok",
      refreshToken: null,
      expiresAt: Date.now() + 3600_000,
      locale: "fr" as const,
    },
  }),
}));

import { AlertDetailModal } from "../../features/dashboard/alert-detail-modal";

/** Captures the route the modal navigates to. */
let navigatedRoute: string | null = null;
function RouteProbe({ children }: { children: React.ReactNode }) {
  return (
    <MemoryRouter initialEntries={["/dashboard"]}>
      {children}
      <RouteListener />
    </MemoryRouter>
  );
}
function RouteListener() {
  // The modal's navigate() lands on a route we render as text.
  const loc = (window as { __loc?: string }).__loc;
  return null;
}
// Simplest: spy on useNavigate via a wrapper that records pushes.
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return {
    ...actual,
    useNavigate: () => (to: string) => {
      navigatedRoute = String(to);
    },
  };
});

/* ------------------------------------------------------------------ */
/* The suite                                                           */
/* ------------------------------------------------------------------ */

describe("T-499 / CHAT-305 — the chat-notification navigation", () => {
  beforeEach(() => {
    ensureRadixJsdomCompat();
    resolvedChannel = null;
    navigatedRoute = null;
  });

  afterEach(() => {
    cleanup();
    navigatedRoute = null;
  });

  it("S1: a chat_channel notification renders the linked conversation (pre-fix: no link at all)", async () => {
    resolvedChannel = PORTAL_CHANNEL;
    render(
      <MemoryRouter>
        <AlertDetailModal
          alert={makeChatNotification()}
          open
          onOpenChange={() => {}}
        />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByText("Élément Associé")).toBeTruthy();
    });
    // The link shows the resolved channel's name — exact match (the modal's
    // TITLE also contains the channel name).
    expect(screen.getByText("Parent — Karim")).toBeTruthy();
    expect(screen.getByText("Conversation portail")).toBeTruthy();
  });

  it("S2: a PORTAL conversation routes to the CRM portal-chat deep link (channel selected)", async () => {
    resolvedChannel = PORTAL_CHANNEL;
    render(
      <MemoryRouter>
        <AlertDetailModal
          alert={makeChatNotification()}
          open
          onOpenChange={() => {}}
        />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByText("Élément Associé")).toBeTruthy();
    });
    // The link itself is the button carrying the exact channel-name label
    // (the modal title also contains the name — exact match disambiguates).
    const link = screen.getByText("Parent — Karim").closest("button")!;
    expect(link).not.toBeNull();
    fireEvent.click(link);
    expect(navigatedRoute).toBe(
      "/crm?action=portal-chat&channelId=ch-portal-1",
    );
  });

  it("S3: an INTERNAL conversation routes to the Personnel messenger deep link", async () => {
    resolvedChannel = INTERNAL_CHANNEL;
    const alert = { ...makeChatNotification(), entityId: "ch-internal-1" };
    render(
      <MemoryRouter>
        <AlertDetailModal alert={alert} open onOpenChange={() => {}} />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByText("Élément Associé")).toBeTruthy();
    });
    const link = screen.getByText(/Équipe Direction/).closest("button")!;
    fireEvent.click(link);
    expect(navigatedRoute).toBe(
      "/personnel?tab=chat&channelId=ch-internal-1",
    );
  });

  it("S4: the Personnel page CONSUMES the tab=chat&channelId deep link (the emitter↔consumer contract)", () => {
    // The consumer side (T-413's FA-16 lesson: an emitted param nobody
    // consumes is a dead link).
    expect(
      /searchParams\.get\("tab"\)/.test(PERSONNEL_PAGE_SRC),
      "the Personnel page must read the tab search param",
    ).toBe(true);
    expect(
      /searchParams\.get\("channelId"\)/.test(PERSONNEL_PAGE_SRC),
      "the Personnel page must read the channelId search param",
    ).toBe(true);
    expect(
      /initialChannelId=\{chatChannelId\}/.test(PERSONNEL_PAGE_SRC),
      "the internal ChatPanel must receive the deep-linked channel",
    ).toBe(true);
  });

  it("S5-source-guard: the chat_channel case + the reactive channel resolution exist", () => {
    expect(
      /case "chat_channel"/.test(MODAL_SRC),
      "the AlertDetailModal must handle the chat_channel entity type",
    ).toBe(true);
    expect(
      /observeChannel\(/.test(MODAL_SRC),
      "the modal must resolve the channel (reactively) to pick the surface",
    ).toBe(true);
    expect(
      /action=portal-chat&channelId=/.test(MODAL_SRC),
      "the portal route must select the conversation (the T-463 contract)",
    ).toBe(true);
    expect(
      /\/personnel\?tab=chat/.test(MODAL_SRC),
      "the internal route must open the Personnel messenger",
    ).toBe(true);
  });
});

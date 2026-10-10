/**
 * T-499 (CHAT-304) — the channel-list unread badges suite.
 *
 * THE DEFECT: the ChatPanel's `unreadCount()` computed the unread badge
 * ONLY for the open channel — the unselected-channel branch was the dead
 * ternary `channel.lastMessageAt ? 0 : 0`, which returns 0 either way. The
 * list badge therefore NEVER appeared on any unselected channel: a parent's
 * (or a colleague's) reply in another conversation was invisible until the
 * operator happened to open that conversation — the unread-indicator half
 * of the §4.2 Workflow-3 contract ("relevant notification counts update at
 * the correct time").
 *
 * WHAT THIS SUITE PINS (red pre-fix / green post-fix, the REAL panel):
 *
 *   S1  the reported defect: an UNSELECTED channel carrying unread
 *       messages renders its unread badge — pre-fix never (0 always).
 *   S2  the badge count is EXACT: the number of messages authored by
 *       another member and not yet carrying the session's read receipt.
 *   S3  the session's own messages never count toward a channel badge
 *       (an own message with zero read receipts must not badge it).
 *   S4  the loop: opening the conversation fires markRead; when the
 *       repository refreshes the message stream with the read receipts
 *       (the real repository's post-markRead refresh), the badge clears.
 *   S5  the same fix serves BOTH chat systems — the portal scope's list
 *       (the client-facing surface) badges its conversations too.
 *   S6  source guard: the dead `? 0 : 0` ternary pattern is gone from
 *       chat-panel.tsx, and the per-channel unread subscription exists.
 *
 * Run:
 *   npx vitest run src/tests/features/t-499-chat-unread-badges.test.tsx
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as React from "react";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { ensureRadixJsdomCompat, mouseClick } from "../_helpers/radix-mouse";
import type {
  ChatChannel,
  ChatMessage,
  ChannelType,
  ChatChannelScope,
} from "../../domain/model/workforce";
import type { ChatRepository } from "../../domain/repository/workforce-repository";
import type { Observable } from "../../domain/repository/repository";
import type { Result } from "../../core/result";
import { Ok } from "../../core/result";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, "..", "..");
const CHAT_PANEL_SRC = readFileSync(
  join(SRC, "features/personnel/management/chat-panel.tsx"),
  "utf8",
);

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const TENANT = "00000000-0000-0000-0000-000000000001";
const ME = "11111111-1111-4111-8111-111111111111"; // the session's profile id
const COLLEAGUE = "22222222-2222-4222-8222-222222222222"; // the other member

const SESSION = {
  userId: ME,
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
};

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
    memberIds: [ME, COLLEAGUE],
    departmentId: null,
    createdBy: ME,
    createdAt: "2026-10-04T00:00:00Z",
    archivedAt: null,
    lastMessageAt: "2026-10-10T09:00:00Z",
    lastMessagePreview: null,
  };
}

function makeMessage(
  id: string,
  channelId: string,
  authorId: string,
  readBy: string[],
): ChatMessage {
  return {
    id,
    channelId,
    authorId,
    authorName: authorId === ME ? "Admin" : "Collègue",
    body: `message ${id}`,
    createdAt: "2026-10-10T09:00:00Z",
    editedAt: null,
    attachments: [],
    readBy,
    voiceNoteSeconds: null,
  };
}

const CHANNEL_A = makeChannel("ch-a", "Canal A", "internal");
const CHANNEL_B = makeChannel("ch-b", "Canal B", "internal");
// Two portal channels: P1 (auto-selected, read) + P2 (unselected, unread) —
// the same structure as the internal pair so the badge test isn't defeated
// by the panel's auto-select + auto-mark-read on the only channel.
const CHANNEL_P1 = makeChannel("ch-p1", "Parent Lu", "portal");
const CHANNEL_P2 = makeChannel("ch-p2", "Parent Portail", "portal");

/** A live subject: get() + subscribe(fn) + set() — the repository-side
 *  contract the Supabase implementation models (one CACHED subject per
 *  channel id; every subscriber re-emitted on refresh). */
function liveSubject<T>(initial: T) {
  const listeners = new Set<(v: T) => void>();
  let current = initial;
  return {
    get: (): T => current,
    subscribe: (fn: (v: T) => void) => {
      listeners.add(fn);
      fn(current);
      return () => {
        listeners.delete(fn);
      };
    },
    set: (v: T) => {
      current = v;
      for (const l of listeners) l(v);
    },
    observable: (): Observable<T> => ({
      get: () => current,
      subscribe: (fn: (v: T) => void) => {
        listeners.add(fn);
        fn(current);
        return () => {
          listeners.delete(fn);
        };
      },
    }),
  };
}

/* The per-channel message subjects — the exact caching the real
 * repositories implement (mock + Supabase both). */
let subjects: Map<string, ReturnType<typeof liveSubject<ChatMessage[]>>>;

function resetSubjects(): void {
  subjects = new Map();
  // Channel A: one message from the colleague, ALREADY read by the session.
  subjects.set("ch-a", liveSubject<ChatMessage[]>([
    makeMessage("m-a1", "ch-a", COLLEAGUE, [ME]),
  ]));
  // Channel B: TWO unread messages from the colleague + one own message
  // (own messages never count toward the badge).
  subjects.set("ch-b", liveSubject<ChatMessage[]>([
    makeMessage("m-b1", "ch-b", COLLEAGUE, []),
    makeMessage("m-b2", "ch-b", COLLEAGUE, []),
    makeMessage("m-b3", "ch-b", ME, []),
  ]));
  // The portal channels: P1 read, P2 with ONE unread message from the parent.
  subjects.set("ch-p1", liveSubject<ChatMessage[]>([
    makeMessage("m-p1a", "ch-p1", COLLEAGUE, [ME]),
  ]));
  subjects.set("ch-p2", liveSubject<ChatMessage[]>([
    makeMessage("m-p2a", "ch-p2", COLLEAGUE, []),
  ]));
}

const markRead = vi.fn(
  (channelId: string): Promise<Result<void>> => {
    // The REAL repository's post-markRead behavior: the read receipts land
    // and the message stream refreshes (refreshMessages).
    const subject = subjects.get(channelId);
    if (subject) {
      subject.set(
        subject.get().map((m) =>
          m.authorId === ME ? m : { ...m, readBy: [...m.readBy, ME] },
        ),
      );
    }
    return Promise.resolve(Ok(undefined));
  },
);

let channelList: ChatChannel[];

const chatRepo: ChatRepository = {
  observeChannels: () => ({
    get: () => channelList,
    subscribe: (fn: (v: ChatChannel[]) => void) => {
      fn(channelList);
      return () => {};
    },
  }),
  observeChannel: () => ({
    get: () => null,
    subscribe: (fn: (v: ChatChannel | null) => void) => {
      fn(null);
      return () => {};
    },
  }),
  observeMessages: (channelId: string) => {
    const subject = subjects.get(channelId);
    if (subject) return subject.observable();
    return liveSubject<ChatMessage[]>([]).observable();
  },
  createChannel: vi.fn(() =>
    Promise.resolve(Ok(makeChannel("ch-new", "x", "internal"))),
  ),
  updateChannel: vi.fn(() => Promise.resolve(Ok(CHANNEL_A))),
  archiveChannel: vi.fn(() => Promise.resolve(Ok(CHANNEL_A))),
  addMembers: vi.fn(() => Promise.resolve(Ok(CHANNEL_A))),
  removeMembers: vi.fn(() => Promise.resolve(Ok(CHANNEL_A))),
  sendMessage: vi.fn(() => Promise.resolve({} as never)) as never,
  editMessage: vi.fn(() => Promise.resolve({} as never)) as never,
  deleteMessage: vi.fn(() => Promise.resolve({} as never)) as never,
  markRead: markRead as never,
  openParentChannel: vi.fn(() => Promise.resolve(Ok(CHANNEL_A))) as never,
} as unknown as ChatRepository;

/* ------------------------------------------------------------------ */
/* Module mocks (hoisted)                                              */
/* ------------------------------------------------------------------ */

/* The production provider's contract: ONE stable Repositories object
 * (context value — never re-created per render). A fresh object per
 * render would churn the markRead effect's `repos` dependency into an
 * infinite markRead → subject-refresh → re-render loop — a harness
 * artifact, not a production behavior. */
const EMPTY_OBS = {
  get: () => [],
  subscribe: () => () => {},
};
const STABLE_REPOS = {
  personnel: { observe: () => EMPTY_OBS },
  departments: { observe: () => EMPTY_OBS },
  chat: chatRepo,
};

vi.mock("../../app/providers/repository-provider", () => ({
  useRepositories: () => STABLE_REPOS,
}));

vi.mock("../../app/providers/auth-provider", () => ({
  useAuth: () => ({ session: SESSION }),
}));

vi.mock("../../app/providers/toast-provider", () => ({
  useToast: () => ({
    showInfo: () => {},
    showSuccess: () => {},
    showError: () => {},
    showWarning: () => {},
  }),
}));

import { ChatPanel } from "../../features/personnel/management/chat-panel";

/* ------------------------------------------------------------------ */
/* Driving helpers                                                     */
/* ------------------------------------------------------------------ */

async function channelRow(name: RegExp): Promise<HTMLElement> {
  await waitFor(() => {
    expect(screen.getAllByText(name).length).toBeGreaterThan(0);
  });
  // The channel name can ALSO appear in the messages-pane header (the
  // selected channel's title) — the ROW is the one inside a <button>.
  const inRow = screen
    .getAllByText(name)
    .find((el) => el.closest("button"));
  if (!inRow) throw new Error(`no channel-list row matches ${name}`);
  return inRow.closest("button")!;
}

async function badgeOf(row: HTMLElement): Promise<string | null> {
  const badge = row.querySelector("span.bg-status-danger");
  return badge ? (badge.textContent ?? null) : null;
}

/* ------------------------------------------------------------------ */
/* The suite                                                           */
/* ------------------------------------------------------------------ */

describe("T-499 / CHAT-304 — the channel-list unread badges", () => {
  beforeEach(() => {
    ensureRadixJsdomCompat();
    resetSubjects();
    markRead.mockClear();
    // Two internal channels: A (auto-selected as the first), B (unselected,
    // unread) — the EXACT defect scenario.
    channelList = [CHANNEL_A, CHANNEL_B];
  });

  afterEach(() => {
    cleanup();
  });

  it("S1 (the reported defect): an UNSELECTED channel with unread messages shows its unread badge", async () => {
    render(<ChatPanel scope="internal" />);
    // A is the auto-selected first channel.
    await waitFor(() => {
      expect(markRead).toHaveBeenCalledWith("ch-a", ME);
    });
    const rowB = await channelRow(/Canal B/);
    // Pre-fix: the badge never rendered (the dead `? 0 : 0` ternary).
    expect(
      await badgeOf(rowB),
      "the unselected channel B (2 unread) must render its badge",
    ).toBe("2");
  });

  it("S2: the badge count is exact (other-authored, not-yet-read messages only)", async () => {
    render(<ChatPanel scope="internal" />);
    const rowB = await channelRow(/Canal B/);
    expect(await badgeOf(rowB)).toBe("2");
    // The OPEN channel (A) has one READ colleague message → no badge.
    const rowA = await channelRow(/Canal A/);
    await waitFor(async () => {
      expect(await badgeOf(rowA)).toBe(null);
    });
  });

  it("S3: the session's own unread-to-others messages never badge the channel", async () => {
    render(<ChatPanel scope="internal" />);
    const rowB = await channelRow(/Canal B/);
    // ch-b carries m-b3 (own, zero read receipts) + 2 unread colleague
    // messages → the badge is 2, not 3.
    expect(await badgeOf(rowB)).toBe("2");
  });

  it("S4 (the loop): opening the conversation fires markRead and the refreshed receipts clear the badge", async () => {
    render(<ChatPanel scope="internal" />);
    const rowB = await channelRow(/Canal B/);
    expect(await badgeOf(rowB)).toBe("2");

    // Open channel B — the auto-mark-read effect fires.
    mouseClick(rowB);
    await waitFor(() => {
      expect(markRead).toHaveBeenCalledWith("ch-b", ME);
    });
    // The repository's post-markRead refresh updates the stream → the
    // badge clears (the pre-fix panel never cleared what it never showed).
    await waitFor(
      async () => {
        expect(await badgeOf(rowB)).toBe(null);
      },
      { timeout: 2000 },
    );
  });

  it("S5: the portal scope (the client-facing surface) badges its conversations too", async () => {
    channelList = [CHANNEL_P1, CHANNEL_P2];
    render(<ChatPanel scope="portal" />);
    const rowP = await channelRow(/Parent Portail/);
    expect(
      await badgeOf(rowP),
      "the unselected portal conversation with 1 unread message must badge",
    ).toBe("1");
  });

  it("S6-source-guard: the dead unreadCount ternary is gone and the per-channel subscription exists", () => {
    // The pre-fix CODE shape: a return statement whose ternary yields 0 on
    // BOTH branches (the doc comments may still DESCRIBE the old bug).
    expect(
      /return\s+\S+\s*\?\s*0\s*:\s*0\s*;/.test(CHAT_PANEL_SRC),
      "the dead unread-count return ternary (`return channel.lastMessageAt ? 0 : 0;`) must be gone",
    ).toBe(false);
    // The fix: the per-channel unread subscription hook.
    expect(
      /useUnreadCounts/.test(CHAT_PANEL_SRC),
      "the per-channel unread subscription (useUnreadCounts) must exist",
    ).toBe(true);
    // And the channel list row consumes it.
    expect(
      /unreadByChannel\.get\(c\.id\)/.test(CHAT_PANEL_SRC),
      "the channel-list row must read its badge from unreadByChannel",
    ).toBe(true);
  });
});

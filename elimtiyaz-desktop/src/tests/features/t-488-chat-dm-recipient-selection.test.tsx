/**
 * T-488 (CHAT-303) — the Staff DM recipient-selection suite.
 *
 * THE BUG (the owner's 144th-session report): "The in-between messaging/DM
 * functionality in the Staff section is not working. It says that at least
 * one recipient is required, even when a recipient should already be
 * selected."
 *
 * Root cause (two coupled defects in chat-panel.tsx's "Nouveau canal"
 * modal): (a) the direct-type picker renders RADIO inputs driven by
 * `toggleMember` — an APPEND-ONLY toggle: clicking a second recipient
 * leaves BOTH radios checked and `memberIds` holding TWO ids, so the
 * submit is rejected with "Un message direct nécessite exactement 1
 * destinataire." while the user visibly HAS a recipient selected; the
 * group→direct type switch keeps every picked member (same rejection);
 * (b) when no staff record carries a bound account (the live DB's exact
 * census state: 18 personnel rows, zero user_id bindings) the picker
 * renders a BARE empty box — no hint, no path to the account-binding
 * flow — and the submit surfaces the same opaque recipient-required
 * error.
 *
 * WHAT THIS SUITE PINS (red pre-fix / green post-fix, the REAL modal):
 *
 *   S1  the reported reproduction: recipient A then recipient B →
 *       pre-fix BOTH radios render checked and the submit REJECTS with
 *       the exact reported string while createChannel is NEVER called;
 *       post-fix B REPLACES A (exactly one radio checked) and the submit
 *       creates the DM with the REPLACED recipient.
 *   S2  the group→direct type switch trims the carried-over selection to
 *       one member (post-fix) instead of rejecting it.
 *   S3  the unbound-recipient deep link toasts the CHAT-302 honest
 *       message (the T-485 contract preserved).
 *   S4  the SELF-DM deep link (the recipient's account IS the session's
 *       own) surfaces an honest toast and never calls createChannel —
 *       pre-fix it dies in the repository's opaque `others.length !== 1`
 *       validation with the SAME "1 destinataire" string.
 *   S5  the bound-recipient deep link still creates the DM through the
 *       canonical path (the T-480 contract preserved).
 *   S6  the empty picker (no bound-account staff) renders the honest
 *       empty state pointing at the account-binding flow — pre-fix a
 *       bare box with no explanation.
 *
 * Run:
 *   npx vitest run src/tests/features/t-488-chat-dm-recipient-selection.test.tsx
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as React from "react";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ensureRadixJsdomCompat,
  pickRadixOption,
  mouseClick,
  outsideAct,
} from "../_helpers/radix-mouse";
import type { Personnel } from "../../domain/model/personnel";
import type {
  ChatChannel,
  ChatMessage,
  ChannelType,
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
const STAFF_A_ID = "22222222-2222-4222-8222-222222222222"; // personnel ids
const STAFF_B_ID = "33333333-3333-4333-8333-333333333333";
const STAFF_A_PROFILE = "aaaaaaa1-1111-4111-8111-111111111111";
const STAFF_B_PROFILE = "bbbbbbb2-2222-4222-8222-222222222222";

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

function makePersonnel(
  id: string,
  name: string,
  userId: string | null,
): Personnel {
  return {
    id,
    tenantId: TENANT,
    userId,
    firstName: name.split(" ")[0],
    lastName: name.split(" ")[1] ?? "X",
    staffCategory: "administratif" as never,
    roleId: "manager" as never,
    departmentId: null,
    supervisorId: null,
    position: "Poste",
    phone: "0000000000",
    email: null,
    address: null,
    hireDate: "2026-01-01",
    terminationDate: null,
    salary: null,
    paymentMethod: null,
    bankAccount: null,
    weeklyHoursTarget: 40,
    weeklyHoursLogged: 0,
    avatarUrl: null,
    status: "active" as never,
    documents: [],
    notes: [],
    emergencyContact: null,
    dateOfBirth: null,
    nationalId: null,
  };
}

const STAFF_A = makePersonnel(STAFF_A_ID, "Alice Martin", STAFF_A_PROFILE);
const STAFF_B = makePersonnel(STAFF_B_ID, "Bob Belaid", STAFF_B_PROFILE);
const UNBOUND_STAFF = makePersonnel(
  "44444444-4444-4444-8444-444444444444",
  "Un Bound",
  null,
);
const SELF_PERSONNEL = makePersonnel(
  "55555555-5555-4555-8555-555555555555",
  "Moi Meme",
  ME,
);

/** A useObservable-compatible observable: get() + subscribe(fn). */
function obs<T>(value: T): Observable<T> {
  const listeners = new Set<(v: T) => void>();
  return {
    get: () => value,
    subscribe: (fn: (v: T) => void) => {
      listeners.add(fn);
      fn(value);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

/* ------------------------------------------------------------------ */
/* The chat repository fake — createChannel is the spy under test.     */
/* ------------------------------------------------------------------ */

function makeChannel(id: string, name: string, members: string[]): ChatChannel {
  return {
    id,
    tenantId: TENANT,
    type: "direct" as ChannelType,
    scope: "internal",
    name,
    description: null,
    memberIds: members,
    departmentId: null,
    createdBy: ME,
    createdAt: "2026-10-04T00:00:00Z",
    archivedAt: null,
    lastMessageAt: null,
    lastMessagePreview: null,
  };
}

const createChannel = vi.fn(
  (input: {
    type: ChannelType;
    name: string;
    description: string | null;
    memberIds: readonly string[];
    departmentId: string | null;
    createdBy: string;
  }): Promise<Result<ChatChannel>> =>
    Promise.resolve(
      Ok(makeChannel("ch-new", input.name, [...input.memberIds])),
    ),
);

// STABLE empty arrays — a fresh [] per factory() call would identity-churn
// every useObservable subscription and re-render the panel on mount.
const EMPTY_CHANNELS: ChatChannel[] = [];
const EMPTY_MESSAGES: ChatMessage[] = [];
const EMPTY_DEPARTMENTS: unknown[] = [];

const chatRepo: ChatRepository = {
  observeChannels: () => obs(EMPTY_CHANNELS),
  observeChannel: () => obs<ChatChannel | null>(null),
  observeMessages: () => obs(EMPTY_MESSAGES),
  createChannel,
  updateChannel: vi.fn(() => Promise.resolve(Ok(makeChannel("ch", "x", [])))),
  archiveChannel: vi.fn(() => Promise.resolve(Ok(makeChannel("ch", "x", [])))),
  addMembers: vi.fn(() => Promise.resolve(Ok(makeChannel("ch", "x", [])))),
  removeMembers: vi.fn(() => Promise.resolve(Ok(makeChannel("ch", "x", [])))),
  sendMessage: vi.fn(() => Promise.resolve({} as never)) as never,
  editMessage: vi.fn(() => Promise.resolve({} as never)) as never,
  deleteMessage: vi.fn(() => Promise.resolve({} as never)) as never,
  markRead: vi.fn(() => Promise.resolve(undefined)) as never,
  openParentChannel: vi.fn(() =>
    Promise.resolve(Ok(makeChannel("ch", "p", []))),
  ) as never,
} as unknown as ChatRepository;

/* ------------------------------------------------------------------ */
/* Module mocks (hoisted)                                              */
/* ------------------------------------------------------------------ */

let personnelList: Personnel[] = [STAFF_A, STAFF_B, UNBOUND_STAFF];
const toasts: { kind: string; title: string; description: string }[] = [];

vi.mock("../../app/providers/repository-provider", () => ({
  useRepositories: () => ({
    personnel: { observe: () => obs(personnelList) },
    departments: { observe: () => obs(EMPTY_DEPARTMENTS) },
    chat: chatRepo,
  }),
}));

vi.mock("../../app/providers/auth-provider", () => ({
  useAuth: () => ({ session: SESSION }),
}));

vi.mock("../../app/providers/toast-provider", () => ({
  useToast: () => ({
    showInfo: (t: string, d: string) => toasts.push({ kind: "info", title: t, description: d }),
    showSuccess: (t: string, d: string) => toasts.push({ kind: "success", title: t, description: d }),
    showError: (t: string, d: string) => toasts.push({ kind: "error", title: t, description: d }),
    showWarning: (t: string, d: string) => toasts.push({ kind: "warning", title: t, description: d }),
  }),
}));

/* A STABLE deep-link handler — an inline arrow would identity-churn every
 * render and re-fire the deep-link effect (a harness artifact, not the
 * production idempotence question). */
const handled = vi.fn();

/** The production personnel-page contract: the deep-link prop is STATE that
 *  the handled-callback CLEARS (chatRecipientPersonnelId → null). The
 *  handler itself is STABLE (useCallback) — an inline arrow would
 *  identity-churn on every mount re-render and re-fire the effect. */
function DeepLinkHarness({ personnelId }: { personnelId: string }) {
  const [openWith, setOpenWith] = React.useState<string | null>(personnelId);
  const onHandled = React.useCallback(() => {
    handled();
    setOpenWith(null);
  }, []);
  return (
    <ChatPanel
      scope="internal"
      openWithPersonnelId={openWith}
      onOpenWithPersonnelHandled={onHandled}
    />
  );
}

import { ChatPanel } from "../../features/personnel/management/chat-panel";

/* ------------------------------------------------------------------ */
/* Driving helpers                                                     */
/* ------------------------------------------------------------------ */

async function openNewChannelModal(): Promise<void> {
  mouseClick(screen.getByRole("button", { name: /Nouveau canal/i }));
  await waitFor(() => {
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
  await waitFor(() => {
    expect(screen.getByRole("combobox")).toBeTruthy();
  });
}

async function switchTypeToDirect(): Promise<void> {
  // The modal's type Select (Radix) — pick "Message direct". The pick must
  // run OUTSIDE act (§15.40a — the Radix portal mount defers otherwise).
  await outsideAct(async () => {
    const trigger = screen.getByRole("combobox");
    await pickRadixOption(trigger, "Message direct");
  });
  await waitFor(() => {
    // The direct-type picker renders radios.
    expect(screen.getAllByRole("radio").length).toBeGreaterThan(0);
  });
}

async function clickStaffRow(name: RegExp): Promise<void> {
  await waitFor(() => {
    expect(screen.getByText(name)).toBeTruthy();
  });
  const row = screen.getByText(name).closest("label");
  expect(row, `the ${name} row must render`).not.toBeNull();
  const input = row!.querySelector("input");
  expect(input, `the ${name} row must carry an input`).not.toBeNull();
  await outsideAct(async () => {
    mouseClick(input!);
    await new Promise((r) => setTimeout(r, 20));
  });
}

function checkedRadios(): HTMLElement[] {
  return screen
    .getAllByRole("radio")
    .filter((r) => (r as HTMLInputElement).checked);
}

async function submitModal(): Promise<void> {
  // The UnifiedModal's submit button ("Créer").
  const submit = screen.getByRole("button", { name: /^Créer$/i });
  await outsideAct(async () => {
    mouseClick(submit);
    await new Promise((r) => setTimeout(r, 30));
  });
}

/** Fill the (type-conditional) required name field. */
function fillChannelName(name: string): void {
  const nameInput = screen.getByPlaceholderText(/Nom affiché|Ex\. Projet/i);
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(nameInput as HTMLInputElement, name);
  (nameInput as HTMLInputElement).dispatchEvent(
    new Event("input", { bubbles: true }),
  );
}

/* ------------------------------------------------------------------ */
/* The suite                                                           */
/* ------------------------------------------------------------------ */

describe("T-488 / CHAT-303 — the direct-DM recipient selection state machine", () => {
  beforeEach(() => {
    ensureRadixJsdomCompat();
    personnelList = [STAFF_A, STAFF_B, UNBOUND_STAFF, SELF_PERSONNEL];
    toasts.length = 0;
    createChannel.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it("S1 (the reported bug): a second recipient click REPLACES the first — exactly one radio stays checked and the DM is created with the replaced recipient", async () => {
    render(<ChatPanel scope="internal" />);
    await openNewChannelModal();
    await switchTypeToDirect();
    fillChannelName("DM test");

    // Pick Alice, then change the mind to Bob (the natural radio interaction).
    await clickStaffRow(/Alice Martin/);
    expect(checkedRadios().length, "one radio checked after the first pick").toBe(1);

    await clickStaffRow(/Bob Belaid/);

    // THE BUG: the append-toggle leaves BOTH checked pre-fix.
    expect(
      checkedRadios().length,
      "the second pick must REPLACE the first (radio semantics), not append",
    ).toBe(1);

    await submitModal();
    await waitFor(() => {
      expect(createChannel).toHaveBeenCalledTimes(1);
    });
    // The DM carries [caller, THE REPLACED recipient] — Bob, not Alice+Bob.
    expect(createChannel.mock.calls[0][0].memberIds).toEqual([
      ME,
      STAFF_B_ID,
    ]);
    // And no validation rejection surfaced.
    expect(
      screen.queryByText(/Un message direct nécessite exactement 1 destinataire/),
    ).toBeNull();
  });

  it("S1-pre-fix evidence (source guard): the direct picker must not ride the append-only toggle", () => {
    // The SELECTION HANDLER block only (toggleMember up to the next function)
    // — the fix must land THERE, not in the submit validation.
    const start = CHAT_PANEL_SRC.indexOf("function toggleMember");
    const end = CHAT_PANEL_SRC.indexOf("async function handleCreateChannel");
    const selectionHandler = CHAT_PANEL_SRC.slice(start, end);
    expect(start, "the selection handler must exist").toBeGreaterThan(-1);
    expect(end, "the submit handler must exist").toBeGreaterThan(-1);
    const hasReplaceSemantics = /memberIds:\s*\[id\]/.test(selectionHandler);
    // Radio semantics, either spelling: a type-aware branch (s.type /
    // form.type / state.type === "direct") or the replace-on-select
    // memberIds assignment itself.
    const hasDirectAwareBranch =
      /\b(?:s|form|state)\.type\s*===?\s*"direct"/.test(selectionHandler);
    expect(
      hasReplaceSemantics || hasDirectAwareBranch,
      "the member-selection handler must implement radio semantics for the direct type (replace-on-select), not the append-only toggle",
    ).toBe(true);
  });

  it("S2: switching the type group→direct trims the carried-over selection to one member", async () => {
    render(<ChatPanel scope="internal" />);
    await openNewChannelModal();

    // Group type (the default): pick BOTH staff members (checkboxes).
    await clickStaffRow(/Alice Martin/);
    await clickStaffRow(/Bob Belaid/);
    fillChannelName("Équipe");

    // Switch to direct — the two-member selection must trim to one.
    await switchTypeToDirect();
    await submitModal();

    await waitFor(() => {
      expect(createChannel).toHaveBeenCalledTimes(1);
    });
    expect(createChannel.mock.calls[0][0].memberIds).toEqual([
      ME,
      expect.any(String),
    ]);
    expect(createChannel.mock.calls[0][0].memberIds).toHaveLength(2);
  });

  it("S3 (CHAT-302 preserved): the unbound-recipient deep link toasts the honest message and never calls createChannel", async () => {
    handled.mockClear();
    createChannel.mockClear();
    render(<DeepLinkHarness personnelId={UNBOUND_STAFF.id} />);
    await waitFor(() => {
      expect(toasts.some((t) => /Messagerie indisponible/i.test(t.title))).toBe(
        true,
      );
    });
    expect(createChannel).not.toHaveBeenCalled();
  });

  it("S4: the SELF-DM deep link (the recipient IS the session's own account) surfaces an honest toast, not the repository's opaque validation", async () => {
    handled.mockClear();
    createChannel.mockClear();
    render(<DeepLinkHarness personnelId={SELF_PERSONNEL.id} />);
    await waitFor(() => {
      expect(toasts.some((t) => /Messagerie indisponible/i.test(t.title))).toBe(
        true,
      );
    });
    // The honest branch must explain WHY (self-DM), and never reach the RPC.
    expect(createChannel).not.toHaveBeenCalled();
  });

  it("S5 (T-480 preserved): the bound-recipient deep link creates the DM through the canonical path", async () => {
    handled.mockClear();
    createChannel.mockClear();
    render(<DeepLinkHarness personnelId={STAFF_A.id} />);
    await waitFor(() => {
      expect(createChannel).toHaveBeenCalledTimes(1);
    });
    expect(createChannel.mock.calls[0][0].type).toBe("direct");
    expect(createChannel.mock.calls[0][0].memberIds).toEqual([
      ME,
      STAFF_A_ID,
    ]);
  });

  it("S6: the empty picker (no bound-account staff) renders the honest empty state pointing at the account-binding flow", async () => {
    // The live DB's exact census state: staff exist, NONE carries an account.
    personnelList = [UNBOUND_STAFF];
    render(<ChatPanel scope="internal" />);
    await openNewChannelModal();

    // The honest empty state must EXPLAIN itself (not a bare box).
    expect(
      screen.getByText(/Aucun collaborateur n'a de compte de messagerie/i),
    ).not.toBeNull();
  });

  it("S6-source-guard: the picker's radios form a real radio group (the shared name)", () => {
    const pickerBlock = CHAT_PANEL_SRC.slice(
      CHAT_PANEL_SRC.indexOf('type={form.type === "direct" ? "radio" : "checkbox"}'),
      CHAT_PANEL_SRC.indexOf('type={form.type === "direct" ? "radio" : "checkbox"}') + 400,
    );
    expect(/name=/.test(pickerBlock)).toBe(true);
  });
});

/**
 * T-371 (ACAD-501) — the empty-id REST fetch guards.
 *
 * Live console evidence (2026-09-14 05:56 UTC): the app fired
 *   GET /rest/v1/chat_messages?…&channel_id=eq.&deleted_at=is.null…  → 400
 *   GET /rest/v1/homework?select=*&class_id=eq.&order=…              → 400
 * both with `{"code":"22P02","message":"invalid input syntax for type
 * uuid: \"\""}` — the "nothing selected yet" render state passes "" into
 * uuid-column filters (chat-panel `selectedId ?? ""`, homework-history-tab
 * `classId || ""`).
 *
 * The guards (this task): the three affected repository seams return a
 * stable EMPTY stream without ANY server round-trip when the id is empty —
 * identical semantics to the mock layer's in-memory filter (which matches
 * nothing), and no 400 noise in the console.
 *
 * Pinned here:
 *   1. SupabaseChatRepository.observeMessages("") — no from("chat_messages"),
 *      empty stream.
 *   2. SupabaseHomeworkRepository.observeForClass("") — no from("homework").
 *   3. SupabaseHomeworkRepository.observeByTeacher("") — same (teacher_id
 *      is a UUID column, the same failure class).
 *   4. Source guards: the guards stay (the wrong-key fallback never returns).
 */
import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SupabaseChatRepository } from "../../infrastructure/supabase/repositories/supabase-chat-repository";
import { SupabaseHomeworkRepository } from "../../infrastructure/supabase/repositories/supabase-academic-repository";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, "..", "..");

/** Records every from() call; every query chain resolves empty. */
function makeSpyClient() {
  const emptyQuery: Record<string, unknown> = {
    select: () => emptyQuery,
    eq: () => emptyQuery,
    is: () => emptyQuery,
    not: () => emptyQuery,
    in: () => emptyQuery,
    order: () => emptyQuery,
    limit: () => emptyQuery,
    range: () => emptyQuery,
    maybeSingle: async () => ({ data: null, error: null }),
    single: async () => ({ data: null, error: null }),
    then: (resolve: (v: unknown) => void) =>
      resolve({ data: [], error: null }),
  };
  const from = vi.fn(() => emptyQuery);
  const client = { from, rpc: vi.fn(async () => ({ data: null, error: null })) };
  return { client: client as unknown as SupabaseClient, from };
}

describe("T-371 — the empty-id fetch guards (ACAD-501)", () => {
  it("observeMessages(\"\") returns an empty stream with NO server round-trip", () => {
    const { client, from } = makeSpyClient();
    const repo = new SupabaseChatRepository(client);

    const stream = repo.observeMessages("");

    expect(stream.get()).toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });

  it("observeForClass(\"\") returns an empty stream with NO server round-trip", () => {
    const { client, from } = makeSpyClient();
    const repo = new SupabaseHomeworkRepository(client);

    const stream = repo.observeForClass("");

    expect(stream.get()).toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });

  it("observeByTeacher(\"\") returns an empty stream with NO server round-trip", () => {
    const { client, from } = makeSpyClient();
    const repo = new SupabaseHomeworkRepository(client);

    const stream = repo.observeByTeacher("");

    expect(stream.get()).toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });

  it("a NON-empty id still queries (the guard never swallows real reads)", async () => {
    const { client, from } = makeSpyClient();
    const repo = new SupabaseHomeworkRepository(client);

    repo.observeForClass("b3a11a4a-7a67-4933-a3f3-00a09cce7034");
    // The fetch is async fire-and-forget; the from() call is synchronous.
    expect(from).toHaveBeenCalledWith("homework");

    const chat = new SupabaseChatRepository(client);
    chat.observeMessages("ccf2a038-adb8-4e2c-b0ff-62e0729d422e");
    expect(from).toHaveBeenCalledWith("chat_messages");
  });
});

describe("T-371 — source guards", () => {
  const CHAT_REPO = readFileSync(
    join(
      SRC,
      "infrastructure/supabase/repositories/supabase-chat-repository.ts",
    ),
    "utf8",
  );
  const ACAD_REPO = readFileSync(
    join(
      SRC,
      "infrastructure/supabase/repositories/supabase-academic-repository.ts",
    ),
    "utf8",
  );

  it("the chat observeMessages guard stays", () => {
    expect(CHAT_REPO.includes("if (!channelId)")).toBe(true);
  });

  it("the homework observeForClass + observeByTeacher guards stay", () => {
    expect(ACAD_REPO.includes("if (!classId) return sub;")).toBe(true);
    expect(ACAD_REPO.includes("if (!teacherId) return sub;")).toBe(true);
  });
});

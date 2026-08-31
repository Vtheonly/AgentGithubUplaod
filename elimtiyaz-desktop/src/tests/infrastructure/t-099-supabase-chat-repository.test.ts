/**
 * SupabaseChatRepository unit tests (T-099 / CHAT-103, CHAT-105).
 *
 * Verifies the canonical contract of the chat port against the REAL DB shape
 * (chat_channels / chat_messages, migrations 0010 + 0051 + 0061):
 *
 *   1. createChannel(type=direct) routes through the canonical idempotent
 *      create_direct_channel RPC (migration 0061) with the OTHER member id.
 *   2. ID-SPACE TRANSLATION: personnel ids picked in the UI are translated
 *      to user_profiles.id via personnel.user_id before any write; ids that
 *      are already profile ids pass through unchanged; a personnel with NO
 *      linked account yields a clear validation error (no silent member).
 *   3. createChannel(type=group/announcement) inserts a channel row with
 *      translated member_ids and a 'CH-' internal code.
 *   4. sendMessage inserts with the author's own read receipt seeding
 *      read_by and DB-shaped attachments.
 *   5. markRead re-fetches the RAW read_by and appends EXACTLY ONE new
 *      entry, preserving existing entries byte-identically (the 0051
 *      append-only guard rejects anything else).
 *   6. deleteMessage soft-deletes (deleted_at) — never a hard DELETE.
 *   7. editMessage updates body + edited_at.
 *   8. observeChannels filters archived + non-member channels and orders by
 *      last activity (CHAT-104), and observeMessages filters soft-deleted.
 *
 * The Supabase client is faked with the minimal PostgREST builder surface
 * (from/in/eq/is/order/select/insert/update/single/then + rpc + channel).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseChatRepository } from "../../infrastructure/supabase/repositories/supabase-chat-repository";

// ============================================================================
// Fake Supabase client — minimal PostgREST builder surface
// ============================================================================

type Row = Record<string, unknown>;

class FakeQuery {
  private filters: ((row: Row) => boolean)[] = [];
  private mode: "select" | "insert" | "update" = "select";
  private payload: Row | Row[] | null = null;
  private wantSingle = false;
  private ordered = false;
  private orderCol = "";
  private orderAsc = true;

  constructor(
    private readonly table: Row[],
    private readonly tableName: string,
  ) {}

  eq(col: string, val: unknown): this {
    this.filters.push((r) => r[col] === val);
    return this;
  }

  in(col: string, values: unknown[]): this {
    const set = new Set(values);
    this.filters.push((r) => set.has(r[col]));
    return this;
  }

  is(col: string, val: unknown): this {
    if (val === null) {
      this.filters.push((r) => r[col] == null);
    } else {
      this.filters.push((r) => r[col] === val);
    }
    return this;
  }

  order(col: string, opts?: { ascending?: boolean }): this {
    this.ordered = true;
    this.orderCol = col;
    this.orderAsc = opts?.ascending !== false;
    return this;
  }

  limit(n: number): this {
    this.limitN = n;
    return this;
  }

  private limitN: number | null = null;

  select(_cols?: string): this {
    return this;
  }

  insert(row: Row): this {
    this.mode = "insert";
    this.payload = row;
    return this;
  }

  update(patch: Row): this {
    this.mode = "update";
    this.payload = patch;
    return this;
  }

  single(): this {
    this.wantSingle = true;
    return this;
  }

  private run(): { data: Row | Row[] | null; error: { message: string } | null } {
    if (this.mode === "insert") {
      const rows = Array.isArray(this.payload) ? this.payload : [this.payload ?? {}];
      for (const r of rows) this.table.push({ ...r });
      const first = (rows[0] ?? {}) as Row;
      return { data: this.wantSingle ? { ...first, id: first.id ?? `gen-${this.table.length}` } : rows, error: null };
    }
    if (this.mode === "update") {
      const patched: Row[] = [];
      const patch = Array.isArray(this.payload) ? {} : (this.payload ?? {});
      for (const row of this.table) {
        if (this.filters.every((f) => f(row))) {
          Object.assign(row, patch);
          patched.push(row);
        }
      }
      return {
        data: this.wantSingle
          ? patched.length > 0
            ? patched[0]
            : null
          : patched,
        error: this.wantSingle && patched.length === 0 ? { message: "no rows (PGRST116)" } : null,
      };
    }
    let rows = this.table.filter((r) => this.filters.every((f) => f(r)));
    if (this.limitN !== null) rows = rows.slice(0, this.limitN);
    if (this.ordered) {
      rows = [...rows].sort((a, b) => {
        const av = String(a[this.orderCol] ?? "");
        const bv = String(b[this.orderCol] ?? "");
        return this.orderAsc ? av.localeCompare(bv) : bv.localeCompare(av);
      });
    }
    return { data: rows, error: null };
  }

  then<TResult1>(
    onFulfilled:
      | ((value: { data: Row | Row[] | null; error: { message: string } | null }) => TResult1 | PromiseLike<TResult1>)
      | null,
  ): Promise<TResult1> {
    const result = this.run();
    if (this.wantSingle && Array.isArray(result.data)) {
      const arr = result.data;
      if (arr.length === 0) {
        return Promise.resolve(
          (onFulfilled as unknown as (v: unknown) => TResult1)({
            data: null,
            error: { message: "no rows (PGRST116)" },
          }),
        );
      }
      return Promise.resolve(
        (onFulfilled as unknown as (v: unknown) => TResult1)({ data: arr[0], error: null }),
      );
    }
    return Promise.resolve((onFulfilled as unknown as (v: unknown) => TResult1)(result as never));
  }
}

class FakeClient {
  tables: Record<string, Row[]> = {};
  rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
  rpcMocks: Record<string, (args: Record<string, unknown>) => unknown> = {};
  realtimeChannels: string[] = [];

  from(tableName: string): FakeQuery {
    if (!this.tables[tableName]) this.tables[tableName] = [];
    return new FakeQuery(this.tables[tableName], tableName);
  }

  async rpc(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    this.rpcCalls.push({ name, args });
    const mock = this.rpcMocks[name];
    return mock ? mock(args) : { data: null, error: null };
  }

  channel(name: string): { on: () => { subscribe: () => void }; subscribe: () => void } {
    this.realtimeChannels.push(name);
    const tail = { subscribe: (): void => undefined };
    const builder: { on: () => { subscribe: () => void }; subscribe: () => void } = {
      on: () => builder,
      subscribe: tail.subscribe,
    };
    return builder;
  }
}

// ============================================================================
// Fixtures — UUIDs, tenant, profiles, personnel
// ============================================================================

const TENANT = "00000000-0000-0000-0000-000000000001";
const ME = "11111111-1111-4111-8111-111111111111"; // session profile id
const OTHER_PROFILE = "22222222-2222-4222-8222-222222222222"; // second staff profile
const OTHER_PERSONNEL = "33333333-3333-4333-8333-333333333333"; // personnel row id

const PARENT_ID = "55555555-5555-4555-8555-555555555555";
const PARENT_AUTH = "66666666-6666-4666-8666-666666666666";
const PARENT_PROFILE = "77777777-7777-4777-8777-777777777777";

function makeClient(): FakeClient {
  const c = new FakeClient();
  c.tables["personnel"] = [
    { id: OTHER_PERSONNEL, tenant_id: TENANT, user_id: OTHER_PROFILE, first_name: "Amine", last_name: "Kaci" },
  ];
  c.tables["user_profiles"] = [
    { id: ME, tenant_id: TENANT, display_name: "Admin Test", email: "admin@test.dz" },
    { id: OTHER_PROFILE, tenant_id: TENANT, display_name: "Amine Kaci", email: "amine@test.dz" },
    { id: PARENT_PROFILE, tenant_id: TENANT, auth_user_id: PARENT_AUTH, display_name: "Karim Benali", email: "karim@test.dz" },
  ];
  c.tables["parents"] = [
    {
      id: PARENT_ID,
      tenant_id: TENANT,
      code: "PAR-2026-0001",
      first_name: "Karim",
      last_name: "Benali",
      display_name: "Karim Benali",
      auth_user_id: PARENT_AUTH,
    },
    {
      id: "88888888-8888-4888-8888-888888888888",
      tenant_id: TENANT,
      code: "PAR-2026-0002",
      first_name: "Sans",
      last_name: "Compte",
      display_name: null,
      auth_user_id: null,
    },
  ];
  c.tables["chat_channels"] = [];
  c.tables["chat_messages"] = [];
  return c;
}

function clientAsSupabase(c: FakeClient): SupabaseClient {
  return c as unknown as SupabaseClient;
}

async function tick(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
}

// ============================================================================
// Tests
// ============================================================================

describe("T-099 — SupabaseChatRepository (CHAT-103/105)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("createChannel(direct) routes through the canonical create_direct_channel RPC with the translated target", async () => {
    const fake = makeClient();
    const repo = new SupabaseChatRepository(clientAsSupabase(fake));
    fake.rpcMocks["create_direct_channel"] = (args) => ({
      data: {
      id: "ch-dm-1",
      tenant_id: TENANT,
      code: "DM-x-y",
      name: String(args.p_name ?? "Direct"),
      channel_type: "direct",
      member_ids: [ME, args.p_other_profile_id],
      created_by: ME,
      description: null,
      department_id: null,
      archived_at: null,
      last_message_at: null,
      last_message_preview: null,
      created_at: "2026-08-31T00:00:00Z",
      updated_at: "2026-08-31T00:00:00Z",
      },
      error: null,
    });

    // The UI passes the personnel ID (not the profile id) as the recipient.
    const r = await repo.createChannel({
      type: "direct",
      name: "DM",
      description: null,
      memberIds: [ME, OTHER_PERSONNEL],
      departmentId: null,
      createdBy: ME,
    });

    expect(r.ok).toBe(true);
    expect(fake.rpcCalls).toEqual([
      {
        name: "create_direct_channel",
        args: { p_other_profile_id: OTHER_PROFILE, p_name: "DM" },
      },
    ]);
    expect(fake.tables["chat_channels"].length).toBe(0); // RPC path, no local insert
  });

  it("translateToProfileIds: personnel id → user_profiles.id; profile ids pass through; unlinked personnel → clear error", async () => {
    const fake = makeClient();
    const repo = new SupabaseChatRepository(clientAsSupabase(fake));

    // Personnel id gets translated
    const r1 = await repo.createChannel({
      type: "group",
      name: "Groupe test",
      description: null,
      memberIds: [ME, OTHER_PERSONNEL],
      departmentId: null,
      createdBy: ME,
    });
    expect(r1.ok).toBe(true);
    const inserted = fake.tables["chat_channels"][0] as { member_ids: string[] };
    expect(inserted.member_ids).toEqual([ME, OTHER_PROFILE]);

    // Unlinked personnel (user_id NULL) → validation error, nothing written
    fake.tables["personnel"].push({ id: "44444444-4444-4444-8444-444444444444", tenant_id: TENANT, user_id: null });
    const before = fake.tables["chat_channels"].length;
    const r2 = await repo.createChannel({
      type: "group",
      name: "Broken",
      description: null,
      memberIds: ["44444444-4444-4444-8444-444444444444"],
      departmentId: null,
      createdBy: ME,
    });
    expect(r2.ok).toBe(false);
    expect(fake.tables["chat_channels"].length).toBe(before);
  });

  it("createChannel(group) inserts with the DB channel_type, 'CH-' internal code and translated members", async () => {
    const fake = makeClient();
    const repo = new SupabaseChatRepository(clientAsSupabase(fake));
    const r = await repo.createChannel({
      type: "group",
      name: "Direction",
      description: "Canal de la direction",
      memberIds: [OTHER_PERSONNEL],
      departmentId: null,
      createdBy: ME,
    });
    expect(r.ok).toBe(true);
    const row = fake.tables["chat_channels"][0] as Record<string, unknown>;
    expect(row.channel_type).toBe("group");
    expect(row.name).toBe("Direction");
    expect(row.member_ids).toEqual([OTHER_PROFILE]);
    expect(row.created_by).toBe(ME);
    expect(String(row.code)).toMatch(/^CH-/);
  });

  it("sendMessage seeds read_by with the author's own receipt and maps attachments to the DB shape", async () => {
    const fake = makeClient();
    fake.tables["chat_channels"].push({
      id: "ch-1",
      tenant_id: TENANT,
      code: "CH-x",
      name: "G",
      channel_type: "group",
      member_ids: [ME, OTHER_PROFILE],
      created_by: ME,
      description: null,
      department_id: null,
      archived_at: null,
      last_message_at: null,
      last_message_preview: null,
      created_at: "2026-08-31T00:00:00Z",
      updated_at: "2026-08-31T00:00:00Z",
    });
    const repo = new SupabaseChatRepository(clientAsSupabase(fake));
    const r = await repo.sendMessage({
      channelId: "ch-1",
      authorId: ME,
      authorName: "Admin Test",
      body: "Bonjour",
      attachments: [{ id: "a1", filename: "note.pdf", mimeType: "application/pdf", sizeBytes: 12, url: "storage://note.pdf" }],
    });
    expect(r.ok).toBe(true);
    const row = fake.tables["chat_messages"][0] as Record<string, unknown>;
    expect(row.channel_id).toBe("ch-1");
    expect(row.author_id).toBe(ME);
    expect(row.read_by).toEqual([{ user_id: ME, read_at: expect.any(String) }]);
    expect(row.attachments).toEqual([
      { file_name: "note.pdf", storage_path: "storage://note.pdf", mime_type: "application/pdf", size_bytes: 12 },
    ]);
  });

  it("markRead appends EXACTLY ONE entry and preserves existing entries byte-identically (0051 guard contract)", async () => {
    const fake = makeClient();
    // The author's own receipt (seeded by sendMessage) — ME has NOT read it.
    const existingReadBy = [{ user_id: OTHER_PROFILE, read_at: "2026-08-30T10:00:00.000Z" }];
    fake.tables["chat_messages"].push({
      id: "m-1",
      tenant_id: TENANT,
      channel_id: "ch-1",
      author_id: OTHER_PROFILE,
      body: "salut",
      edited_at: null,
      edited_by: null,
      deleted_at: null,
      parent_message_id: null,
      read_by: existingReadBy,
      attachments: [],
      sent_at: "2026-08-30T10:00:00Z",
      created_at: "2026-08-30T10:00:00Z",
    });
    const repo = new SupabaseChatRepository(clientAsSupabase(fake));
    const r = await repo.markRead("ch-1", ME);
    expect(r.ok).toBe(true);
    const row = fake.tables["chat_messages"][0] as { read_by: Array<{ user_id: string; read_at: string }> };
    expect(row.read_by.length).toBe(2);
    // The FIRST entry must be untouched (same object content — the 0051
    // containment check v_new @> v_old fails if read_at is regenerated).
    expect(row.read_by[0]).toEqual(existingReadBy[0]);
    expect(row.read_by[1].user_id).toBe(ME);
  });

  it("deleteMessage soft-deletes (deleted_at) — never a hard DELETE", async () => {
    const fake = makeClient();
    fake.tables["chat_messages"].push({
      id: "m-1",
      tenant_id: TENANT,
      channel_id: "ch-1",
      author_id: ME,
      body: "à supprimer",
      edited_at: null,
      edited_by: null,
      deleted_at: null,
      parent_message_id: null,
      read_by: [],
      attachments: [],
      sent_at: "2026-08-30T10:00:00Z",
      created_at: "2026-08-30T10:00:00Z",
    });
    const repo = new SupabaseChatRepository(clientAsSupabase(fake));
    const r = await repo.deleteMessage("m-1");
    expect(r.ok).toBe(true);
    expect(fake.tables["chat_messages"].length).toBe(1); // row still there
    expect((fake.tables["chat_messages"][0] as { deleted_at: string | null }).deleted_at).toBeTruthy();
  });

  it("editMessage updates body + edited_at", async () => {
    const fake = makeClient();
    fake.tables["chat_messages"].push({
      id: "m-1",
      tenant_id: TENANT,
      channel_id: "ch-1",
      author_id: ME,
      body: "old",
      edited_at: null,
      edited_by: null,
      deleted_at: null,
      parent_message_id: null,
      read_by: [],
      attachments: [],
      sent_at: "2026-08-30T10:00:00Z",
      created_at: "2026-08-30T10:00:00Z",
    });
    const repo = new SupabaseChatRepository(clientAsSupabase(fake));
    const r = await repo.editMessage("m-1", "new body");
    expect(r.ok).toBe(true);
    const row = fake.tables["chat_messages"][0] as { body: string; edited_at: string | null };
    expect(row.body).toBe("new body");
    expect(row.edited_at).toBeTruthy();
  });

  it("observeChannels filters archived + non-member channels and orders by last activity (CHAT-104)", async () => {
    const fake = makeClient();
    fake.tables["chat_channels"].push(
      {
        id: "ch-old",
        tenant_id: TENANT,
        code: "CH-1",
        name: "Ancien",
        channel_type: "group",
        member_ids: [ME],
        created_by: ME,
        description: null,
        department_id: null,
        archived_at: null,
        last_message_at: "2026-08-01T00:00:00Z",
        last_message_preview: "vieux",
        created_at: "2026-08-01T00:00:00Z",
        updated_at: "2026-08-01T00:00:00Z",
      },
      {
        id: "ch-recent",
        tenant_id: TENANT,
        code: "CH-2",
        name: "Récent",
        channel_type: "group",
        member_ids: [ME],
        created_by: ME,
        description: null,
        department_id: null,
        archived_at: null,
        last_message_at: "2026-08-31T00:00:00Z",
        last_message_preview: "neuf",
        created_at: "2026-08-02T00:00:00Z",
        updated_at: "2026-08-31T00:00:00Z",
      },
      {
        id: "ch-foreign",
        tenant_id: TENANT,
        code: "CH-3",
        name: "Pas membre",
        channel_type: "group",
        member_ids: [OTHER_PROFILE],
        created_by: OTHER_PROFILE,
        description: null,
        department_id: null,
        archived_at: null,
        last_message_at: "2026-08-30T00:00:00Z",
        last_message_preview: "x",
        created_at: "2026-08-03T00:00:00Z",
        updated_at: "2026-08-30T00:00:00Z",
      },
      {
        id: "ch-archived",
        tenant_id: TENANT,
        code: "CH-4",
        name: "Archivé",
        channel_type: "group",
        member_ids: [ME],
        created_by: ME,
        description: null,
        department_id: null,
        archived_at: "2026-08-15T00:00:00Z",
        last_message_at: null,
        last_message_preview: null,
        created_at: "2026-08-04T00:00:00Z",
        updated_at: "2026-08-15T00:00:00Z",
      },
    );
    const repo = new SupabaseChatRepository(clientAsSupabase(fake));
    const obs = repo.observeChannels(ME);
    const seen: string[][] = [];
    obs.subscribe((chs) => seen.push(chs.map((c) => c.id)));
    await tick();
    await tick();
    // The final emission is the filtered + sorted list.
    const last = seen[seen.length - 1];
    expect(last).toEqual(["ch-recent", "ch-old"]);
  });

  it("T-100: openParentChannel resolves parents.auth_user_id → user_profiles.id and calls the canonical RPC", async () => {
    const fake = makeClient();
    const repo = new SupabaseChatRepository(clientAsSupabase(fake));
    fake.rpcMocks["create_direct_channel"] = (args) => ({
      data: {
        id: "ch-parent-1",
        tenant_id: TENANT,
        code: "DM-pair",
        name: String(args.p_name ?? "Direct"),
        channel_type: "direct",
        member_ids: [ME, args.p_other_profile_id],
        created_by: ME,
        description: null,
        department_id: null,
        archived_at: null,
        last_message_at: null,
        last_message_preview: null,
        created_at: "2026-08-31T00:00:00Z",
        updated_at: "2026-08-31T00:00:00Z",
      },
      error: null,
    });

    const r = await repo.openParentChannel(PARENT_ID, "Karim Benali");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.name).toBe("Parent — Karim Benali");
    expect(fake.rpcCalls).toEqual([
      {
        name: "create_direct_channel",
        args: { p_other_profile_id: PARENT_PROFILE, p_name: "Parent — Karim Benali" },
      },
    ]);
  });

  it("T-100: openParentChannel on a parent WITHOUT a linked account → clear validation error, no RPC", async () => {
    const fake = makeClient();
    const repo = new SupabaseChatRepository(clientAsSupabase(fake));
    const r = await repo.openParentChannel("88888888-8888-4888-8888-888888888888", "Sans Compte");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.userMessage).toMatch(/code d'activation/i);
    }
    expect(fake.rpcCalls.length).toBe(0);
  });

  it("T-100: openParentChannel with an unknown parent id → not-found error", async () => {
    const fake = makeClient();
    const repo = new SupabaseChatRepository(clientAsSupabase(fake));
    const r = await repo.openParentChannel("99999999-9999-4999-8999-999999999999", "X");
    expect(r.ok).toBe(false);
    expect(fake.rpcCalls.length).toBe(0);
  });

  it("observeMessages filters soft-deleted messages and resolves authorName from user_profiles", async () => {
    const fake = makeClient();
    fake.tables["chat_messages"].push(
      {
        id: "m-live",
        tenant_id: TENANT,
        channel_id: "ch-1",
        author_id: OTHER_PROFILE,
        body: "visible",
        edited_at: null,
        edited_by: null,
        deleted_at: null,
        parent_message_id: null,
        read_by: [{ user_id: OTHER_PROFILE, read_at: "2026-08-30T10:00:00.000Z" }],
        attachments: [],
        sent_at: "2026-08-30T10:00:00Z",
        created_at: "2026-08-30T10:00:00Z",
      },
      {
        id: "m-deleted",
        tenant_id: TENANT,
        channel_id: "ch-1",
        author_id: OTHER_PROFILE,
        body: "supprimé",
        edited_at: null,
        edited_by: null,
        deleted_at: "2026-08-30T11:00:00Z",
        parent_message_id: null,
        read_by: [],
        attachments: [],
        sent_at: "2026-08-30T11:00:00Z",
        created_at: "2026-08-30T11:00:00Z",
      },
    );
    const repo = new SupabaseChatRepository(clientAsSupabase(fake));
    const obs = repo.observeMessages("ch-1");
    const seen: number[] = [];
    obs.subscribe((msgs) => seen.push(msgs.length));
    await tick();
    await tick();
    const messages = obs.get();
    expect(messages.map((m) => m.id)).toEqual(["m-live"]);
    expect(messages[0].authorName).toBe("Amine Kaci"); // from user_profiles.display_name
    expect(messages[0].readBy).toEqual([OTHER_PROFILE]); // read_by → string[] ids
  });
});

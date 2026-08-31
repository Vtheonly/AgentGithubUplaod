/**
 * SupabaseChatRepository — Supabase-backed implementation of the workforce
 * chat contract (CHAT-103 / CHAT-105 / T-099, 14th session).
 *
 * Tables (source of truth = `supabase/migrations/`):
 *   - `chat_channels`  — migration 0010 (+ completion columns in 0061)
 *   - `chat_messages`  — migration 0010 (+ read-receipt guard in 0051)
 *   - `create_direct_channel` RPC — migration 0061 (idempotent DM creation)
 *
 * WHAT THIS REPLACES: the chat slot in `getSupabaseRepositories()` used to
 * fall through to `mockRepositories.chat` (the in-memory mock from
 * `mock/workforce/index.ts`) — chat data was wiped on every app restart and
 * invisible to every other platform (CHAT-105). This repository persists to
 * the shared backend so the PARENT PORTAL sees the same conversations.
 *
 * ID-SPACE NOTE (critical): `chat_channels.member_ids` / `chat_messages.author_id`
 * are user_profiles.id values (migration 0010 convention), but the desktop UI
 * passes TWO kinds of ids through the ChatRepository contract:
 *   - `session.userId` (a user_profiles.id — used for currentUserId and
 *     createdBy), and
 *   - personnel ids picked from `repos.personnel.observe()` in the
     * "new channel" form.
 * The repository translates personnel ids → user_profiles.id via
 * `personnel.user_id` before any write (`translateToProfileIds` below) and is
 * idempotent for ids that are already profile ids. `observeChannels`'s
 * `personnelId` parameter receives the session's PROFILE id (the interface
 * name is a legacy mock artifact).
 *
 * MAPPING NOTES (DB schema is the source of truth):
 *   - `ChatMessage.authorName` has NO DB column; it is resolved at read time
 *     from `user_profiles.display_name`/`email` and, failing that (RLS hides
 *     other tenants'/parents' profiles from non-staff), from
 *     `personnel.first_name/last_name` via `personnel.user_id`. Unresolved
 *     authors render as "Membre". The `authorName` argument of sendMessage is
 *     therefore accepted-but-not-persisted (mock parity input).
 *   - `read_by` is a jsonb array of `{user_id, read_at}` in the DB but the
 *     domain models it as `readBy: string[]` (profile ids) — mapped both ways.
 *   - `deleteMessage` soft-deletes (`deleted_at`) per the canonical schema
 *     comment; soft-deleted messages are filtered from reads (website parity).
 *   - `editMessage` sets `edited_at` (author-only — RLS chat_messages_update_own).
 *   - `markRead` appends `{user_id, read_at}` per unread message — the exact
 *     shape the 0051 append-only guard trigger requires (one entry per update).
 *   - Channel ordering: by `last_message_at ?? created_at` DESC (CHAT-104 —
 *     the 0061 trigger keeps `last_message_at` fresh; the website orders by
 *     `updated_at`, also touched by the same trigger).
 *   - Channel `code` for non-direct channels: `'CH-' + crypto.randomUUID()`
 *     — an internal stable identifier (NOT a business identity code; ADR-003
 *     applies to PAR-/ELV-/receipt numbers, not to internal row identifiers;
 *     direct channels use the canonical deterministic DM code from the RPC).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChatRepository } from "../../../domain/repository/workforce-repository";
import type { Observable } from "../../../domain/repository/repository";
import type {
  ChannelType,
  ChatChannel,
  ChatMessage,
} from "../../../domain/model/workforce";
import type { TaskAttachment } from "../../../domain/model/workforce";
import type { Result } from "../../../core/result";
import { Ok, Err } from "../../../core/result";
import { Errors } from "../../../core/app-error";
import { supabaseErrorToAppError } from "../supabase-client";
import { SubjectBehavior, derived } from "../../mock/subject-behavior";
import { getTenantId, isUuid } from "./supabase-shared-repositories";

type Row = Record<string, unknown>;

interface ChannelRow {
  id: string;
  tenant_id: string;
  code: string;
  name: string;
  channel_type: string;
  member_ids: string[];
  created_by: string | null;
  description: string | null;
  department_id: string | null;
  archived_at: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  id: string;
  tenant_id: string;
  channel_id: string;
  author_id: string;
  body: string;
  edited_at: string | null;
  edited_by: string | null;
  deleted_at: string | null;
  parent_message_id: string | null;
  read_by: Array<{ user_id: string; read_at: string }> | null;
  attachments: Array<Record<string, unknown>> | null;
  sent_at: string;
  created_at: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function mapChannelRow(row: ChannelRow): ChatChannel {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    type: row.channel_type as ChatChannel["type"],
    name: row.name,
    description: row.description ?? null,
    memberIds: row.member_ids ?? [],
    departmentId: row.department_id ?? null,
    createdBy: row.created_by ?? "",
    createdAt: row.created_at,
    archivedAt: row.archived_at ?? null,
    lastMessageAt: row.last_message_at ?? null,
    lastMessagePreview: row.last_message_preview ?? null,
  };
}

const CHANNEL_TYPE_TO_DB: Record<ChannelType, string> = {
  direct: "direct",
  group: "group",
  department: "department",
  announcement: "announcement",
};

export class SupabaseChatRepository implements ChatRepository {
  private readonly channelsCache = new SubjectBehavior<ChatChannel[]>([]);
  private readonly channelSubjects = new Map<string, SubjectBehavior<ChatChannel | null>>();
  private readonly messageSubjects = new Map<string, SubjectBehavior<ChatMessage[]>>();
  private readonly nameCache = new Map<string, string>();
  private channelsSeeded = false;
  private realtimeStarted = false;
  private currentProfileId: string | null = null;

  constructor(private readonly client: SupabaseClient) {}

  // ------------------------------------------------------------------
  // Realtime: refresh caches when the shared tables change (other clients,
  // the parent portal, other staff members).
  // ------------------------------------------------------------------
  private startRealtime(): void {
    if (this.realtimeStarted) return;
    this.realtimeStarted = true;
    try {
      const channel = this.client.channel("desktop-chat-realtime");
      channel
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "chat_channels" },
          () => {
            void this.refreshChannels();
          },
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "chat_messages" },
          (payload: { new: Record<string, unknown> | null; old: Record<string, unknown> | null }) => {
            const row = (payload.new ?? payload.old ?? {}) as Row;
            const channelId = row.channel_id;
            if (typeof channelId === "string" && channelId) {
              void this.refreshMessages(channelId);
            }
            void this.refreshChannels();
          },
        )
        .subscribe();
    } catch {
      // Realtime is an enhancement — the caches still refresh after every
      // local mutation. (Same degrade-gracefully stance as the other ports.)
    }
  }

  // ------------------------------------------------------------------
  // Reads
  // ------------------------------------------------------------------
  private async refreshChannels(): Promise<void> {
    try {
      const { data, error } = await this.client
        .from("chat_channels")
        .select("*")
        .order("last_message_at", { ascending: false, nullsFirst: false });
      if (error) throw error;
      this.channelsCache.set(((data ?? []) as unknown as ChannelRow[]).map(mapChannelRow));
    } catch {
      // Silently degrade to the current cache (repository convention).
    }
  }

  private seedChannels(): void {
    if (this.channelsSeeded) return;
    this.channelsSeeded = true;
    this.startRealtime();
    void this.refreshChannels();
  }

  observeChannels(personnelId: string): Observable<ChatChannel[]> {
    // personnelId is the session's user_profiles.id (see header note).
    this.currentProfileId = personnelId;
    this.seedChannels();
    return derived(
      [this.channelsCache],
      () =>
        this.channelsCache
          .get()
          .filter(
            (c) =>
              c.archivedAt === null &&
              (c.memberIds.includes(personnelId) ||
                (c.type === "announcement" && c.memberIds.length === 0)),
          )
          .sort(
            (a, b) =>
              (b.lastMessageAt ?? b.createdAt).localeCompare(a.lastMessageAt ?? a.createdAt),
          ),
    );
  }

  observeChannel(channelId: string): Observable<ChatChannel | null> {
    this.seedChannels();
    let subject = this.channelSubjects.get(channelId);
    if (!subject) {
      subject = new SubjectBehavior<ChatChannel | null>(null);
      this.channelSubjects.set(channelId, subject);
      const sync = (): void => {
        subject!.set(this.channelsCache.get().find((c) => c.id === channelId) ?? null);
      };
      this.channelsCache.subscribe(() => sync());
      sync();
    }
    return subject;
  }

  private async resolveAuthorNames(authorIds: readonly string[]): Promise<void> {
    const missing = [...new Set(authorIds)].filter(
      (id) => isUuid(id) && !this.nameCache.has(id),
    );
    if (missing.length === 0) return;
    // user_profiles first (own profile + staff-visible profiles).
    try {
      const { data } = await this.client
        .from("user_profiles")
        .select("id, display_name, email")
        .in("id", missing);
      for (const row of (data ?? []) as Array<{ id: string; display_name: string | null; email: string | null }>) {
        this.nameCache.set(row.id, row.display_name || row.email || "Membre");
      }
    } catch {
      // RLS may hide foreign profiles — fall through to the personnel table.
    }
    const stillMissing = missing.filter((id) => !this.nameCache.has(id));
    if (stillMissing.length === 0) return;
    try {
      const { data } = await this.client
        .from("personnel")
        .select("user_id, first_name, last_name")
        .in("user_id", stillMissing);
      for (const row of (data ?? []) as Array<{ user_id: string | null; first_name: string; last_name: string }>) {
        if (row.user_id) this.nameCache.set(row.user_id, `${row.first_name} ${row.last_name}`.trim() || "Membre");
      }
    } catch {
      // Ignore — unresolved names fall back below.
    }
    for (const id of stillMissing) {
      if (!this.nameCache.has(id)) this.nameCache.set(id, "Membre");
    }
  }

  private async refreshMessages(channelId: string): Promise<void> {
    const subject = this.messageSubjects.get(channelId);
    if (!subject) return;
    try {
      const { data, error } = await this.client
        .from("chat_messages")
        .select("*")
        .eq("channel_id", channelId)
        .is("deleted_at", null)
        .order("sent_at", { ascending: true });
      if (error) throw error;
      const rows = (data ?? []) as unknown as MessageRow[];
      const authorIds = [...new Set(rows.map((r) => r.author_id))];
      await this.resolveAuthorNames(authorIds);
      const messages: ChatMessage[] = rows.map((r) =>
        this.mapMessageRow(r, this.nameCache.get(r.author_id)),
      );
      subject.set(messages);
    } catch {
      // Degrade to the current cache.
    }
  }

  private mapMessageRow(r: MessageRow, resolvedName?: string): ChatMessage {
    const reads = Array.isArray(r.read_by) ? r.read_by : [];
    return {
      id: r.id,
      channelId: r.channel_id,
      authorId: r.author_id,
      authorName: resolvedName ?? "Membre", // resolved by fetchAuthorNames
      body: r.body,
      createdAt: r.sent_at ?? r.created_at,
      editedAt: r.edited_at ?? null,
      attachments: (Array.isArray(r.attachments) ? r.attachments : []).map((a) => ({
        id: String(a.id ?? a.storage_path ?? ""),
        filename: String(a.file_name ?? ""),
        mimeType: String(a.mime_type ?? ""),
        sizeBytes: Number(a.size_bytes ?? 0),
        url: String(a.storage_path ?? ""),
      })) as TaskAttachment[],
      readBy: reads.map((e) => e.user_id),
      voiceNoteSeconds: null,
    };
  }

  observeMessages(channelId: string): Observable<ChatMessage[]> {
    let subject = this.messageSubjects.get(channelId);
    if (!subject) {
      subject = new SubjectBehavior<ChatMessage[]>([]);
      this.messageSubjects.set(channelId, subject);
      void this.refreshMessages(channelId);
    }
    return subject;
  }

  // ------------------------------------------------------------------
  // ID translation: personnel.id → user_profiles.id (see header note)
  // ------------------------------------------------------------------
  private async translateToProfileIds(ids: readonly string[]): Promise<Result<string[]>> {
    const unique = [...new Set(ids.filter((id) => isUuid(id)))];
    if (unique.length === 0) return Ok([]);
    const { data, error } = await this.client
      .from("personnel")
      .select("id, user_id")
      .in("id", unique);
    if (error) return Err(supabaseErrorToAppError(error));
    const personnelToProfile = new Map<string, string | null>();
    for (const row of (data ?? []) as Array<{ id: string; user_id: string | null }>) {
      personnelToProfile.set(row.id, row.user_id);
    }
    const translated: string[] = [];
    for (const id of unique) {
      if (personnelToProfile.has(id)) {
        const profileId = personnelToProfile.get(id);
        if (!profileId) {
          return Err(
            Errors.validation(
              `Le membre sélectionné n'a pas de compte utilisateur lié (personnel ${id}) — impossible de l'ajouter à la conversation.`,
              "Le membre sélectionné n'a pas de compte utilisateur lié — impossible de l'ajouter à la conversation.",
            ),
          );
        }
        translated.push(profileId);
      } else {
        // Already a user_profiles.id (e.g. session.userId) — pass through.
        translated.push(id);
      }
    }
    return Ok(translated);
  }

  // ------------------------------------------------------------------
  // Channel mutations
  // ------------------------------------------------------------------
  async createChannel(input: {
    type: ChannelType;
    name: string;
    description: string | null;
    memberIds: readonly string[];
    departmentId: string | null;
    createdBy: string;
  }): Promise<Result<ChatChannel>> {
    const members = await this.translateToProfileIds(input.memberIds);
    if (!members.ok) return Err(members.error);
    const profileIds = members.value;

    if (input.type === "direct") {
      // Canonical idempotent path (migration 0061) — the RPC resolves the
      // caller itself, so the target is the OTHER member.
      const others = profileIds.filter((id) => id !== input.createdBy);
      if (others.length !== 1) {
        return Err(
          Errors.validation(
            "Un message direct nécessite exactement 1 destinataire.",
            "Un message direct nécessite exactement 1 destinataire.",
          ),
        );
      }
      const { data, error } = await this.client.rpc("create_direct_channel", {
        p_other_profile_id: others[0],
        p_name: input.name || null,
      });
      if (error) return Err(supabaseErrorToAppError(error));
      const channel = mapChannelRow(data as unknown as ChannelRow);
      await this.refreshChannels();
      return Ok(channel);
    }

    const code = `CH-${crypto.randomUUID()}`;
    const { data, error } = await this.client
      .from("chat_channels")
      .insert({
        tenant_id: getTenantId(),
        code,
        name: input.name,
        channel_type: CHANNEL_TYPE_TO_DB[input.type],
        member_ids: profileIds,
        created_by: input.createdBy,
        description: input.description ?? null,
        department_id: isUuid(input.departmentId ?? "") ? input.departmentId : null,
      })
      .select()
      .single();
    if (error) return Err(supabaseErrorToAppError(error));
    await this.refreshChannels();
    return Ok(mapChannelRow(data as unknown as ChannelRow));
  }

  async updateChannel(id: string, updates: Partial<ChatChannel>): Promise<Result<ChatChannel>> {
    const patch: Row = {};
    if (updates.name !== undefined) patch.name = updates.name;
    if (updates.description !== undefined) patch.description = updates.description ?? null;
    if (updates.archivedAt !== undefined) patch.archived_at = updates.archivedAt ?? null;
    if (updates.departmentId !== undefined) {
      patch.department_id = isUuid(updates.departmentId ?? "") ? updates.departmentId : null;
    }
    if (updates.memberIds !== undefined) {
      const translated = await this.translateToProfileIds(updates.memberIds);
      if (!translated.ok) return Err(translated.error);
      patch.member_ids = translated.value;
    }
    if (Object.keys(patch).length === 0) {
      const existing = this.channelsCache.get().find((c) => c.id === id) ?? null;
      if (!existing) return Err(Errors.notFound("chat_channel", id));
      return Ok(existing);
    }
    const { data, error } = await this.client
      .from("chat_channels")
      .update(patch)
      .eq("id", id)
      .select()
      .single();
    if (error) return Err(supabaseErrorToAppError(error));
    await this.refreshChannels();
    return Ok(mapChannelRow(data as unknown as ChannelRow));
  }

  async archiveChannel(id: string): Promise<Result<ChatChannel>> {
    return this.updateChannel(id, { archivedAt: nowIso() });
  }

  async addMembers(id: string, memberIds: readonly string[]): Promise<Result<ChatChannel>> {
    const ch = this.channelsCache.get().find((c) => c.id === id) ?? null;
    if (!ch) return Err(Errors.notFound("chat_channel", id));
    const merged = [...new Set([...ch.memberIds, ...memberIds])];
    return this.updateChannel(id, { memberIds: merged });
  }

  async removeMembers(id: string, memberIds: readonly string[]): Promise<Result<ChatChannel>> {
    const ch = this.channelsCache.get().find((c) => c.id === id) ?? null;
    if (!ch) return Err(Errors.notFound("chat_channel", id));
    const filtered = ch.memberIds.filter((m) => !memberIds.includes(m));
    return this.updateChannel(id, { memberIds: filtered });
  }

  // ------------------------------------------------------------------
  // Message mutations
  // ------------------------------------------------------------------
  async sendMessage(input: {
    channelId: string;
    authorId: string;
    authorName: string;
    body: string;
    attachments?: readonly TaskAttachment[];
    voiceNoteSeconds?: number | null;
  }): Promise<Result<ChatMessage>> {
    const { data, error } = await this.client
      .from("chat_messages")
      .insert({
        tenant_id: getTenantId(),
        channel_id: input.channelId,
        author_id: input.authorId,
        body: input.body,
        // authorName has no DB column (header note) — the author's own
        // receipt seeds read_by, matching the website's insert contract.
        read_by: [{ user_id: input.authorId, read_at: nowIso() }],
        attachments: (input.attachments ?? []).map((a) => ({
          file_name: a.filename,
          storage_path: a.url,
          mime_type: a.mimeType,
          size_bytes: a.sizeBytes,
        })),
      })
      .select()
      .single();
    if (error) return Err(supabaseErrorToAppError(error));
    await this.resolveAuthorNames([input.authorId]);
    const message = this.mapMessageRow(
      data as unknown as MessageRow,
      this.nameCache.get(input.authorId) ?? input.authorName,
    );
    await Promise.all([this.refreshChannels(), this.refreshMessages(input.channelId)]);
    return Ok(message);
  }

  async editMessage(id: string, body: string): Promise<Result<ChatMessage>> {
    const { data, error } = await this.client
      .from("chat_messages")
      .update({ body, edited_at: nowIso() })
      .eq("id", id)
      .select()
      .single();
    if (error) return Err(supabaseErrorToAppError(error));
    const message = this.mapMessageRow(data as unknown as MessageRow);
    await this.refreshMessages(message.channelId);
    return Ok(message);
  }

  async deleteMessage(id: string): Promise<Result<void>> {
    const { error } = await this.client
      .from("chat_messages")
      .update({ deleted_at: nowIso() })
      .eq("id", id);
    if (error) return Err(supabaseErrorToAppError(error));
    // The channel of the deleted message is unknown from the update alone —
    // refresh all live message subjects (there are only a handful).
    await Promise.all([
      ...[...this.messageSubjects.keys()].map((channelId) => this.refreshMessages(channelId)),
      this.refreshChannels(),
    ]);
    return Ok(undefined);
  }

  async markRead(channelId: string, personnelId: string): Promise<Result<void>> {
    // Re-fetch the RAW read_by arrays: the 0051 append-only guard checks
    // jsonb set-containment (v_new @> v_old) — existing entries must be
    // re-sent BYTE-IDENTICAL (rebuilding them with a fresh read_at would
    // fail the containment check and the update would be rejected).
    const { data, error } = await this.client
      .from("chat_messages")
      .select("id, read_by, author_id")
      .eq("channel_id", channelId)
      .is("deleted_at", null);
    if (error) return Err(supabaseErrorToAppError(error));
    const rows = (data ?? []) as Array<{
      id: string;
      read_by: Array<{ user_id: string; read_at: string }> | null;
      author_id: string;
    }>;
    const incoming = rows.filter(
      (m) => m.author_id !== personnelId && !(m.read_by ?? []).some((e) => e.user_id === personnelId),
    );
    if (incoming.length === 0) return Ok(undefined);
    // One update per message — the guard requires read_by to grow by exactly
    // one entry per update (append-only, own entry only).
    const results = await Promise.all(
      incoming.map((m) =>
        this.client
          .from("chat_messages")
          .update({
            read_by: [...(m.read_by ?? []), { user_id: personnelId, read_at: nowIso() }],
          })
          .eq("id", m.id),
      ),
    );
    const failure = results.find((r) => r.error);
    if (failure && failure.error) return Err(supabaseErrorToAppError(failure.error));
    await this.refreshMessages(channelId);
    return Ok(undefined);
  }

  // ------------------------------------------------------------------
  // Staff↔parent channel creation (T-100, CHAT-103)
  // ------------------------------------------------------------------
  async openParentChannel(parentId: string, displayName: string): Promise<Result<ChatChannel>> {
    // Resolve the parent's user_profiles.id via parents.auth_user_id.
    if (!isUuid(parentId)) {
      return Err(Errors.validation("Identifiant parent invalide.", "Identifiant parent invalide."));
    }
    const { data: parentRows, error: parentError } = await this.client
      .from("parents")
      .select("id, auth_user_id, first_name, last_name, display_name")
      .eq("id", parentId)
      .limit(1);
    if (parentError) return Err(supabaseErrorToAppError(parentError));
    const parent = (parentRows ?? [])[0] as
      | { id: string; auth_user_id: string | null; first_name: string; last_name: string; display_name: string | null }
      | undefined;
    if (!parent) return Err(Errors.notFound("parent", parentId));
    if (!parent.auth_user_id) {
      return Err(
        Errors.validation(
          "parents.auth_user_id is null — the parent has no portal account",
          "Ce parent n'a pas encore de compte portail. Émettez d'abord un code d'activation, puis attendez la liaison.",
        ),
      );
    }
    const { data: profileRows, error: profileError } = await this.client
      .from("user_profiles")
      .select("id")
      .eq("auth_user_id", parent.auth_user_id)
      .limit(1);
    if (profileError) return Err(supabaseErrorToAppError(profileError));
    const profile = (profileRows ?? [])[0] as { id: string } | undefined;
    if (!profile) {
      return Err(
        Errors.validation(
          "no user_profiles row for parents.auth_user_id (pending approval?)",
          "Le compte de ce parent n'a pas encore de profil actif (en attente d'approbation).",
        ),
      );
    }
    const name =
      displayName?.trim() ||
      parent.display_name ||
      `${parent.first_name} ${parent.last_name}`.trim() ||
      "Parent";
    // Canonical idempotent DM creation — the RPC resolves the CALLER (the
    // signed-in staff member) server-side via current_user_profile_id(); we
    // only pass the parent's profile as the other member.
    const { data, error } = await this.client.rpc("create_direct_channel", {
      p_other_profile_id: profile.id,
      p_name: `Parent — ${name}`,
    });
    if (error) return Err(supabaseErrorToAppError(error));
    const channel = mapChannelRow(data as unknown as ChannelRow);
    await this.refreshChannels();
    return Ok(channel);
  }
}

/**
 * SupabaseTaskRepository — Supabase-backed implementation of the
 * `TaskRepository` domain contract (plan §10.05).
 *
 * Task: T-180 (28th session, 2026-09-05) — the T-047 `tasks` port (the last
 * of the T-160 scoping's priority-3 trio "tasks / workforceAttendance /
 * leaveRequests — the dashboards"). Pre-T-180 the slot stayed on
 * mockRepositories even in Supabase mode: the worker/manager/buyer
 * dashboards' task lists, the management screens and every status change
 * lived in memory only (wiped on restart) while the canonical `tasks` /
 * `task_comments` / `task_attachments` tables (migration 0010) sat empty.
 *
 * Tables (migration 0010 + 0074):
 *   `tasks` — title / description / status (the domain union verbatim) /
 *   priority (domain union) / department_id (FK) / assignee_ids (jsonb array
 *   of user_profiles.id strings) / due_date / completed_at / progress (0–100)
 *   / tags / created_by + created_by_name (0074) / timestamps.
 *   `task_comments` — task_id (FK cascade) / author_id + author_name (0074) /
 *   body / timestamps.
 *   `task_attachments` — task_id (FK cascade) / file_name / storage_path /
 *   mime_type / size_bytes / uploaded_by / timestamps.
 *
 * MAPPING NOTES (documented):
 *   1. `status` and `priority` are the domain unions VERBATIM (0010 CHECKs
 *      match) — no fold needed.
 *   2. `assigneeIds` ↔ `assignee_ids` (jsonb string array) — direct.
 *   3. `createdByName` / TaskComment.authorName — persisted via the 0074
 *      columns (no FK to join; the 0070/0072 precedent).
 *   4. Comments + attachments are read via the PostgREST embeds
 *      `task_comments(*)` / `task_attachments(*)` (FKs exist on task_id) and
 *      mapped into the domain aggregates.
 *   5. createTask: status = assigneeIds.length ? 'assigned' : 'pending'
 *      (mock parity); progress 0; completedAt null.
 *   6. updateTaskStatus: completed → completed_at=now + progress=100;
 *      in_progress with progress 0 → 10 (mock parity).
 *   7. reassign: assignee_ids + status assigned/pending (mock parity).
 *   8. addComment: INSERT into task_comments (author verified by the 0019
 *      policy) + cache refresh; returns the mapped comment.
 *   9. addAttachment: INSERT into task_attachments with storage_path =
 *      attachment.url (the contract's url field; a REAL object-storage
 *      upload is a future EF/UI feature — no UI caller today).
 *  10. deleteTask: HARD delete (mock parity) — task_comments and
 *      task_attachments cascade.
 *
 * Reactive reads follow the shared Supabase pattern: SubjectBehavior cache +
 * T-034/CROSS-104 freshness policy + refresh after every successful write.
 *
 * Wiring: `getSupabaseRepositories()` (supabase-repositories.ts) overrides
 * the mock `tasks` entry with this class.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Observable } from "../../../domain/repository/repository";
import type { TaskRepository } from "../../../domain/repository/workforce-repository";
import type { Result } from "../../../core/result";
import { Ok, Err } from "../../../core/result";
import { Errors } from "../../../core/app-error";
import { supabaseErrorToAppError } from "../supabase-client";
import { SubjectBehavior, derived } from "../../mock/subject-behavior";
import type {
  Task,
  TaskAttachment,
  TaskComment,
  TaskPriority,
  TaskStatus,
} from "../../../domain/model/workforce";
import { getTenantId, isUuid } from "./supabase-shared-repositories";
import { CacheFreshness } from "../cache-freshness";

// ============================================================================
// Row types
// ============================================================================

interface CommentRow {
  id: string;
  tenant_id: string;
  task_id: string;
  author_id: string;
  author_name: string | null;
  body: string;
  created_at: string;
  updated_at: string;
}

interface AttachmentRow {
  id: string;
  tenant_id: string;
  task_id: string;
  file_name: string;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  uploaded_by: string;
  uploaded_at: string;
  created_at: string;
}

interface TaskTableRow {
  id: string;
  tenant_id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  department_id: string | null;
  assignee_ids: string[] | null;
  due_date: string | null;
  completed_at: string | null;
  progress: number;
  tags: string[] | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
  task_comments?: CommentRow[] | null;
  task_attachments?: AttachmentRow[] | null;
}

const SELECT = "*, task_comments(*), task_attachments(*)";

function mapComment(row: CommentRow): TaskComment {
  return {
    id: row.id,
    taskId: row.task_id,
    authorId: row.author_id,
    authorName: row.author_name ?? "",
    body: row.body,
    createdAt: row.created_at,
  };
}

function mapAttachment(row: AttachmentRow): TaskAttachment {
  return {
    id: row.id,
    filename: row.file_name,
    mimeType: row.mime_type ?? "",
    sizeBytes: row.size_bytes ?? 0,
    url: row.storage_path,
  };
}

function mapRow(row: TaskTableRow): Task {
  const comments = (row.task_comments ?? [])
    .slice()
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map(mapComment);
  const attachments = (row.task_attachments ?? [])
    .slice()
    .sort((a, b) => a.uploaded_at.localeCompare(b.uploaded_at))
    .map(mapAttachment);
  return {
    id: row.id,
    tenantId: row.tenant_id,
    title: row.title,
    description: row.description ?? "",
    priority: row.priority as TaskPriority,
    status: row.status as TaskStatus,
    departmentId: row.department_id,
    assigneeIds: row.assignee_ids ?? [],
    createdBy: row.created_by ?? "system",
    createdByName: row.created_by_name ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    dueDate: row.due_date,
    completedAt: row.completed_at,
    attachments,
    comments,
    progress: row.progress ?? 0,
    tags: row.tags ?? [],
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

// ============================================================================
// Repository
// ============================================================================

export class SupabaseTaskRepository implements TaskRepository {
  private readonly cache = new SubjectBehavior<Task[]>([]);
  private readonly freshness = new CacheFreshness();

  constructor(private readonly client: SupabaseClient) {}

  observe(): Observable<Task[]> {
    this.seed();
    return this.cache;
  }

  observeByAssignee(personnelId: string): Observable<Task[]> {
    this.seed();
    return derived([this.cache], () =>
      this.cache.get().filter((t) => t.assigneeIds.includes(personnelId)),
    );
  }

  observeByDepartment(departmentId: string): Observable<Task[]> {
    this.seed();
    return derived([this.cache], () =>
      this.cache.get().filter((t) => t.departmentId === departmentId),
    );
  }

  observeById(id: string): Observable<Task | null> {
    this.seed();
    return derived([this.cache], () => this.cache.get().find((t) => t.id === id) ?? null);
  }

  async createTask(input: {
    title: string;
    description: string;
    priority: TaskPriority;
    departmentId: string | null;
    assigneeIds: readonly string[];
    dueDate: string | null;
    createdBy: string;
    createdByName: string;
    attachments?: readonly TaskAttachment[];
    tags?: readonly string[];
  }): Promise<Result<Task>> {
    if (!input.title.trim()) {
      return Err(Errors.validation("Le titre de la tâche est requis"));
    }
    // Mock-era ids ("per-001") cannot be stored in uuid-typed columns /
    // jsonb uuid arrays — guard BEFORE the round-trip.
    const badAssignee = input.assigneeIds.find((id) => !isUuid(id));
    if (badAssignee !== undefined) {
      return Err(Errors.validation(
        `Task assignee id is not a valid UUID (${badAssignee}) — reconnect the session or re-pick assignees.`,
      ));
    }
    const { data, error } = await this.client
      .from("tasks")
      .insert({
        tenant_id: getTenantId(),
        title: input.title.trim(),
        description: input.description.trim() || null,
        // Mock parity: assigned when at least one assignee, else pending.
        status: input.assigneeIds.length > 0 ? "assigned" : "pending",
        priority: input.priority,
        department_id: isUuid(input.departmentId ?? "") ? input.departmentId : null,
        assignee_ids: [...input.assigneeIds],
        due_date: input.dueDate || null,
        progress: 0,
        tags: [...(input.tags ?? [])],
        created_by: isUuid(input.createdBy) ? input.createdBy : null,
        created_by_name: input.createdByName,
      })
      .select(SELECT)
      .single();
    if (error) return Err(supabaseErrorToAppError(error));
    // Optional attachments at creation time (no UI caller today) — inserted
    // after the task row exists (task_id FK).
    for (const att of input.attachments ?? []) {
      const attErr = await this.insertAttachmentRow(data.id as string, att, input.createdBy);
      if (attErr) return Err(supabaseErrorToAppError(attErr));
    }
    await this.refresh();
    const row = (await this.fetchRow(data.id as string)) ?? data;
    return Ok(mapRow(row as unknown as TaskTableRow));
  }

  async updateTask(id: string, updates: Partial<Task>): Promise<Result<Task>> {
    const existing = await this.fetchRow(id);
    if (!existing) return Err(Errors.notFound("Task", id));
    const patch: Record<string, unknown> = { updated_at: nowIso() };
    if (updates.title !== undefined) patch.title = updates.title.trim();
    if (updates.description !== undefined) patch.description = updates.description.trim() || null;
    if (updates.priority !== undefined) patch.priority = updates.priority;
    if (updates.status !== undefined) {
      patch.status = updates.status;
      if (updates.status === "completed" && !existing.completed_at) {
        patch.completed_at = nowIso();
        patch.progress = 100;
      }
    }
    if (updates.departmentId !== undefined) {
      patch.department_id = isUuid(updates.departmentId ?? "") ? updates.departmentId : null;
    }
    if (updates.assigneeIds !== undefined) patch.assignee_ids = [...updates.assigneeIds];
    if (updates.dueDate !== undefined) patch.due_date = updates.dueDate || null;
    if (updates.completedAt !== undefined) patch.completed_at = updates.completedAt;
    if (updates.progress !== undefined) {
      patch.progress = Math.min(100, Math.max(0, Math.round(updates.progress)));
    }
    if (updates.tags !== undefined) patch.tags = [...updates.tags];

    const { data, error } = await this.client
      .from("tasks")
      .update(patch)
      .eq("id", id)
      .eq("tenant_id", getTenantId())
      .select(SELECT)
      .single();
    if (error) return Err(supabaseErrorToAppError(error));
    await this.refresh();
    return Ok(mapRow(data as unknown as TaskTableRow));
  }

  async updateTaskStatus(id: string, status: TaskStatus, actorId: string): Promise<Result<Task>> {
    // Mock parity: completed stamps completed_at + progress 100; in_progress
    // bumps a 0 progress to 10.
    const existing = await this.fetchRow(id);
    if (!existing) return Err(Errors.notFound("Task", id));
    let updates: Partial<Task> = { status, updatedAt: nowIso() };
    if (status === "completed") {
      updates = { ...updates, completedAt: nowIso(), progress: 100 };
    } else if (status === "in_progress" && (existing.progress ?? 0) === 0) {
      updates = { ...updates, progress: 10 };
    }
    void actorId; // audit trail is server-side (0014); the actor reaches the DB through the session JWT.
    return this.updateTask(id, updates);
  }

  async reassign(id: string, assigneeIds: readonly string[], actorId: string): Promise<Result<Task>> {
    const bad = assigneeIds.find((a) => !isUuid(a));
    if (bad !== undefined) {
      return Err(Errors.validation(`Task assignee id is not a valid UUID (${bad})`));
    }
    void actorId;
    return this.updateTask(id, {
      assigneeIds,
      status: assigneeIds.length > 0 ? "assigned" : "pending",
      updatedAt: nowIso(),
    });
  }

  async addComment(
    id: string,
    comment: Omit<TaskComment, "id" | "taskId" | "createdAt">,
  ): Promise<Result<TaskComment>> {
    if (!comment.body.trim()) {
      return Err(Errors.validation("Le commentaire ne peut pas être vide"));
    }
    if (!isUuid(comment.authorId)) {
      return Err(Errors.validation("Task comment author is not a valid UUID"));
    }
    const { data, error } = await this.client
      .from("task_comments")
      .insert({
        tenant_id: getTenantId(),
        task_id: id,
        author_id: comment.authorId,
        author_name: comment.authorName, // 0074
        body: comment.body.trim(),
      })
      .select("*")
      .single();
    if (error) return Err(supabaseErrorToAppError(error));
    await this.refresh();
    return Ok(mapComment(data as unknown as CommentRow));
  }

  async addAttachment(id: string, attachment: TaskAttachment): Promise<Result<Task>> {
    const existing = await this.fetchRow(id);
    if (!existing) return Err(Errors.notFound("Task", id));
    const err = await this.insertAttachmentRow(id, attachment, existing.created_by ?? "system");
    if (err) return Err(supabaseErrorToAppError(err));
    await this.refresh();
    const row = await this.fetchRow(id);
    if (!row) return Err(Errors.notFound("Task", id));
    return Ok(mapRow(row));
  }

  async deleteTask(id: string): Promise<Result<void>> {
    // HARD delete (mock parity) — task_comments + task_attachments cascade.
    const { error } = await this.client
      .from("tasks")
      .delete()
      .eq("id", id)
      .eq("tenant_id", getTenantId());
    if (error) return Err(supabaseErrorToAppError(error));
    await this.refresh();
    return Ok(undefined);
  }

  // --------------------------------------------------------------------------
  // Internals
  // --------------------------------------------------------------------------

  private async insertAttachmentRow(
    taskId: string,
    attachment: TaskAttachment,
    uploadedBy: string,
  ): Promise<{ code?: string; message: string } | null> {
    const { error } = await this.client.from("task_attachments").insert({
      tenant_id: getTenantId(),
      task_id: taskId,
      file_name: attachment.filename,
      // NOTE: the domain contract's url carries a data URL / relative path
      // (the mock convention). A REAL object-storage upload (bucket
      // 'task-attachments') is a future EF/UI feature — no UI caller today.
      storage_path: attachment.url,
      mime_type: attachment.mimeType || null,
      size_bytes: attachment.sizeBytes,
      uploaded_by: isUuid(uploadedBy) ? uploadedBy : "00000000-0000-0000-0000-000000000000",
    });
    return error ? (error as { code?: string; message: string }) : null;
  }

  private seed(): void {
    if (!this.freshness.shouldReseed()) return;
    this.freshness.markSeeded();
    void this.refresh();
  }

  private async refresh(): Promise<void> {
    try {
      const { data, error } = await this.client
        .from("tasks")
        .select(SELECT)
        .eq("tenant_id", getTenantId())
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      this.cache.set((data ?? []).map((row: Record<string, unknown>) => mapRow(row as unknown as TaskTableRow)));
    } catch {
      // Silently degrade to the current cache.
    }
  }

  private async fetchRow(id: string): Promise<TaskTableRow | null> {
    const { data, error } = await this.client
      .from("tasks")
      .select(SELECT)
      .eq("id", id)
      .eq("tenant_id", getTenantId())
      .maybeSingle();
    if (error) return null;
    return (data ?? null) as TaskTableRow | null;
  }
}

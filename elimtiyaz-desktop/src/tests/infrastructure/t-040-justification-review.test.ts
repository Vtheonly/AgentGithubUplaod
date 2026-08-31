/**
 * T-040 — staff-side justification review regression suite (ATT-101).
 *
 * Problem: the 4-state justification workflow (none → submitted →
 * accepted/rejected, migration 0043) was a one-way valve — the website let
 * parents submit, but the desktop had ZERO code reading/writing the
 * justification_* columns, so 'accepted'/'rejected' were unreachable.
 *
 * Fixed: AttendanceRecord carries the justification fields;
 * mapAttendanceRow reads them; AttendanceRepository gains
 * observeJustifications + reviewJustification (Supabase + Mock); the
 * Academics hub gains a "Justificatifs" review tab (accept/reject).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseAttendanceRepository } from "../../infrastructure/supabase/repositories/supabase-academic-repository";

const SRC = join(__dirname, "../../");

beforeAll(() => {
  localStorage.setItem(
    "el-imtiyaz.session",
    JSON.stringify({ tenantId: "00000000-0000-0000-0000-000000000001", userId: "staff-1" }),
  );
});

type Row = Record<string, any>;

function makeClient() {
  const calls: { table: string; op: string; filters: Row[]; payload: unknown }[] = [];
  const client = {
    from(table: string) {
      const rec = { table, op: "", filters: [] as Row[], payload: null as unknown };
      calls.push(rec);
      const q: Record<string, unknown> = {};
      const chain = () => q;
      q.select = () => {
        rec.op = rec.op || "select";
        return q;
      };
      q.update = (payload: unknown) => {
        rec.op = "update";
        rec.payload = payload;
        return q;
      };
      q.insert = (payload: unknown) => {
        rec.op = "insert";
        rec.payload = payload;
        return q;
      };
      q.eq = (col: string, value: unknown) => {
        rec.filters.push({ col, value });
        return q;
      };
      q.neq = (col: string, value: unknown) => {
        rec.filters.push({ col, op: "neq", value });
        return q;
      };
      q.order = chain;
      q.limit = chain;
      q.maybeSingle = () =>
        Promise.resolve({
          data: {
            id: "att-1",
            student_id: "s-1",
            class_id: "c-1",
            record_date: "2026-09-01",
            session: "morning",
            status: "absent_unexcused",
            arrival_time: null,
            note: null,
            recorded_by: "staff-1",
            recorded_at: "2026-09-01T08:00:00Z",
            synced_at: null,
            justification_status: "submitted",
            justification_note: "Certificat médical",
            justification_path: null,
            justification_drive_link: "https://drive.example/x",
            justification_reviewed_by: null,
            justification_reviewed_at: null,
          },
          error: null,
        });
      q.then = (resolve: unknown) =>
        Promise.resolve({ data: [], error: null }).then(resolve as never);
      return q;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

describe("T-040 — the justification workflow is closed (ATT-101)", () => {
  it("mapAttendanceRow reads the justification_* columns (via reviewJustification's returned row)", async () => {
    const { client } = makeClient();
    const repo = new SupabaseAttendanceRepository(client);
    const result = await repo.reviewJustification({
      recordId: "11111111-1111-1111-1111-111111111111",
      decision: "accepted",
      reviewedBy: "staff-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.justificationStatus).toBe("submitted"); // pre-update read-back
      expect(result.value.justificationNote).toBe("Certificat médical");
      expect(result.value.justificationDriveLink).toBe("https://drive.example/x");
    }
  });

  it("reviewJustification UPDATEs status + reviewer + timestamp, guarded by status <> 'none'", async () => {
    const { client, calls } = makeClient();
    const repo = new SupabaseAttendanceRepository(client);
    await repo.reviewJustification({
      recordId: "11111111-1111-1111-1111-111111111111",
      decision: "rejected",
      reviewedBy: "staff-9",
    });
    const upd = calls.find((c) => c.op === "update" && c.table === "attendance_records");
    expect(upd).toBeDefined();
    const payload = upd!.payload as Record<string, unknown>;
    expect(payload.justification_status).toBe("rejected");
    expect(payload.justification_reviewed_by).toBe("staff-9");
    expect(payload.justification_reviewed_at).toBeTruthy();
    // the guard: only records WITH a justification can be reviewed
    const guard = upd!.filters.find((f) => f.col === "justification_status");
    expect(guard).toEqual({ col: "justification_status", op: "neq", value: "none" });
  });

  it("reviewJustification rejects a non-UUID record id (validation)", async () => {
    const { client } = makeClient();
    const repo = new SupabaseAttendanceRepository(client);
    const result = await repo.reviewJustification({
      recordId: "not-a-uuid",
      decision: "accepted",
      reviewedBy: "staff-1",
    });
    expect(result.ok).toBe(false);
  });

  it("observeJustifications queries by tenant + status (default submitted)", async () => {
    const { client, calls } = makeClient();
    const repo = new SupabaseAttendanceRepository(client);
    const sub = repo.observeJustifications();
    await new Promise((r) => setTimeout(r, 10));
    sub.unsubscribe?.();
    const sel = calls.find((c) => c.op === "select" && c.table === "attendance_records");
    expect(sel).toBeDefined();
    const tenant = sel!.filters.find((f) => f.col === "tenant_id");
    const status = sel!.filters.find((f) => f.col === "justification_status");
    expect(tenant?.value).toBe("00000000-0000-0000-0000-000000000001");
    expect(status?.value).toBe("submitted");
  });
});

describe("T-040 — the review UI exists (source-scan)", () => {
  it("the Academics hub wires the Justificatifs tab with the pending count", () => {
    const page = readFileSync(join(SRC, "features/academics/academics-page.tsx"), "utf8");
    expect(page).toContain('value: "justifications"');
    expect(page).toContain("<JustificationsTab />");
    expect(page).toContain('observeJustifications("submitted")');
    expect(page).toContain("viewAttendance");
  });

  it("the tab renders Accept/Reject wired to reviewJustification", () => {
    const tab = readFileSync(join(SRC, "features/academics/justifications-tab.tsx"), "utf8");
    expect(tab).toContain("repos.attendance.reviewJustification");
    expect(tab).toContain('review(r, "accepted")');
    expect(tab).toContain('review(r, "rejected")');
    expect(tab).toContain("reviewedBy: session.userId");
  });

  it("the domain model + repository contract carry the justification fields", () => {
    const model = readFileSync(join(SRC, "domain/model/academic.ts"), "utf8");
    expect(model).toContain("justificationStatus?: JustificationStatus");
    expect(model).toContain('export type JustificationStatus = "none" | "submitted" | "accepted" | "rejected"');
    const iface = readFileSync(join(SRC, "domain/repository/repository.ts"), "utf8");
    expect(iface).toContain("observeJustifications");
    expect(iface).toContain("reviewJustification");
  });

  it("the mock mirrors the workflow (demo mode parity)", () => {
    const mock = readFileSync(
      join(SRC, "infrastructure/mock/repositories/academic-repository.ts"),
      "utf8",
    );
    expect(mock).toContain("observeJustifications");
    expect(mock).toContain("reviewJustification");
  });
});

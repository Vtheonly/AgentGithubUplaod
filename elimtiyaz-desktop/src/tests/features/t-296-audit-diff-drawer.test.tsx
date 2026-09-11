/**
 * T-296 (OFFLINE-400) — the desktop AuditDiffDrawer upgrade regression suite.
 *
 * Pins three things:
 *   1. Mapper parity: actor_role now round-trips through BOTH the Supabase
 *      mapper (mapAuditRow) and the mock appendAudit/log path — the role was
 *      silently dropped before (the drawer could never show it).
 *   2. Drawer rendering: the field-level red/green rows computed by the
 *      T-295 engine render per-field (old value red, new value green), with
 *      the actor attribution block (Name + Account ID + Role).
 *   3. Honest empty state: an entry with a structurally-equal diff renders
 *      the "aucune différence" panel, not fabricated rows.
 *
 * Run:
 *   npx vitest run src/tests/features/t-296-audit-diff-drawer.test.tsx
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
// Initialize i18n FIRST — useTranslation() will otherwise throw.
import "../../i18n/i18n";
import { AuditLogTab } from "../../features/settings/audit-log-tab";
import type { AuditEntry } from "../../domain/model/audit";
import { flattenDiffRows, computeFieldDiff } from "../../domain/calc/diff/field-diff";
import { appendAudit } from "../../infrastructure/mock/repositories/mock-store";

// ---------------------------------------------------------------------------
// The repositories the tab reads from (audit-only stub is enough).
// ---------------------------------------------------------------------------

function makeEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: "aud-001",
    tenantId: "tenant-1",
    action: "payment.collect",
    entityType: "payment",
    entityId: "pay-001",
    actorId: "usr-123",
    actorName: "Yacine Benali",
    actorRole: "financial_officer",
    diff: JSON.stringify({
      before: { id: "pay-001", status: "pending", amount: 2500000, note: null },
      after: { id: "pay-001", status: "paid", amount: 2500000, note: "Reçu comptoir" },
    }),
    note: "Encaissement comptoir",
    ipAddress: "10.0.1.42",
    userAgent: "El-Imtiyaz-Desktop/0.1.0",
    at: "2026-09-11T09:30:00Z",
    ...overrides,
  };
}

const entries: AuditEntry[] = [makeEntry()];

// STABLE identity across renders — the tab's useEffect depends on
// [filter, repos.audit]; a fresh object per render loops the effect forever.
const auditStub = {
  query: vi.fn(async () => ({
    ok: true,
    value: { entries: [...entries], total: entries.length, hasMore: false },
  })),
  log: vi.fn(async () => ({ ok: true })),
};

vi.mock("../../app/providers/repository-provider", () => ({
  useRepositories: () => ({ audit: auditStub }),
}));

vi.mock("../../app/providers/toast-provider", () => ({
  useToast: () => ({ showSuccess: vi.fn(), showError: vi.fn() }),
}));

vi.mock("../../infrastructure/excel/reports", () => ({
  exportAuditLog: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mapper parity — the actorRole field round-trips.
// ---------------------------------------------------------------------------

describe("T-296 — audit mapper parity (actorRole)", () => {
  it("mapAuditRow carries actor_role — source-level guarantee", async () => {
    // Read the mapper source and assert it maps the column (a regression of
    // the dropped-role bug would delete this line).
    const fs = await import("node:fs");
    const src = fs.readFileSync(
      "src/infrastructure/supabase/repositories/supabase-audit-log-repository.ts",
      "utf-8",
    );
    expect(src).toMatch(/actorRole:\s*row\.actor_role\s*\?\?\s*null/);
    // The RPC write path passes the role too (p_actor_role since 0014).
    expect(src).toMatch(/p_actor_role:\s*input\.actorRole\s*\?\?\s*null/);
    // The fallback INSERT stamps the column.
    expect(src).toMatch(/actor_role:\s*input\.actorRole\s*\?\?\s*null/);
  });

  it("the domain model carries actorRole (model-level guarantee)", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("src/domain/model/audit.ts", "utf-8");
    expect(src).toMatch(/actorRole\?:\s*string\s*\|\s*null/);
  });

  it("mock appendAudit sets actorRole on the entry", async () => {
    appendAudit({
      action: "test.t296",
      entityType: "test",
      entityId: "t-1",
      actorId: "usr-1",
      actorName: "Agent Test",
      actorRole: "super_admin",
    });
    const { mockAuditRepository } = await import(
      "../../infrastructure/mock/repositories/personnel-audit-repository"
    );
    const result = await mockAuditRepository.query({ action: "test.t296" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.entries.length).toBeGreaterThanOrEqual(1);
      const entry = result.value.entries[0];
      expect(entry.actorRole).toBe("super_admin");
      expect(entry.actorName).toBe("Agent Test");
    }
  });

  it("mock log() accepts actorRole and stores it", async () => {
    const { mockAuditRepository } = await import(
      "../../infrastructure/mock/repositories/personnel-audit-repository"
    );
    const result = await mockAuditRepository.log({
      action: "test.t296b",
      entityType: "test",
      entityId: "t-2",
      actorId: "usr-2",
      actorName: "Agent Deux",
      actorRole: "clerk",
      tenantId: "tenant-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.actorRole).toBe("clerk");
  });
});

// ---------------------------------------------------------------------------
// Drawer rendering — the field-level red/green rows + attribution.
// ---------------------------------------------------------------------------

describe("T-296 — AuditDiffDrawer field-level rendering", () => {
  beforeEach(() => {
    cleanup();
  });

  function renderTab() {
    return render(<AuditLogTab />);
  }

  it("clicking an audit entry opens the drawer with the actor attribution block", async () => {
    // The stub returns a SNAPSHOT of entries at call time — refresh it so the
    // mutated entries[0] variants are visible to the current test.
    auditStub.query.mockImplementation(async () => ({
      ok: true,
      value: { entries: [...entries], total: entries.length, hasMore: false },
    }));
    renderTab();
    // Wait for the list to load.
    const row = await screen.findByText("payment.collect");
    row.closest("li")!.click();

    // The attribution block: Name + Account ID + Role badge.
    expect(await screen.findByText("Yacine Benali")).toBeTruthy();
    expect(screen.getByText("usr-123")).toBeTruthy();
    // The role appears BOTH in the list row's chip AND the drawer's
    // attribution badge — assert at least the drawer one (the badge with
    // the ShieldCheck icon renders inside the modal).
    expect(screen.getAllByText("financial_officer").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Opérateur")).toBeTruthy();
  });

  it("renders field-level red/green rows: status pending → paid + note null → value", async () => {
    auditStub.query.mockImplementation(async () => ({
      ok: true,
      value: { entries: [...entries], total: entries.length, hasMore: false },
    }));
    renderTab();
    const row = await screen.findByText("payment.collect");
    row.closest("li")!.click();

    // Field rows render per-field with the engine's display strings.
    expect(await screen.findByText("pending")).toBeTruthy();
    expect(screen.getByText("paid")).toBeTruthy();
    expect(screen.getByText("Reçu comptoir")).toBeTruthy();
    // The "null" old value of the note field renders as the literal null.
    expect(screen.getAllByText("null").length).toBeGreaterThanOrEqual(1);
  });

  it("shows the change-kind summary badges (2 modifiés — status + note)", async () => {
    auditStub.query.mockImplementation(async () => ({
      ok: true,
      value: { entries: [...entries], total: entries.length, hasMore: false },
    }));
    renderTab();
    const row = await screen.findByText("payment.collect");
    row.closest("li")!.click();
    // status pending→paid AND note null→"Reçu comptoir" are both CHANGED
    // (null is a present value — the engine's boundary semantics).
    expect(await screen.findByText("2 modifiés")).toBeTruthy();
    expect(screen.getByText("0 ajoutés")).toBeTruthy();
    expect(screen.getByText("0 supprimés")).toBeTruthy();
  });

  it("an entry with a structurally-equal diff renders the honest empty panel", async () => {
    entries[0] = makeEntry({
      diff: JSON.stringify({
        before: { a: 1, b: { c: 2 } },
        after: { b: { c: 2 }, a: 1 }, // same content, different key order
      }),
    });
    renderTab();
    const row = await screen.findByText("payment.collect");
    row.closest("li")!.click();
    expect(await screen.findByText(/aucune différence structurelle/i)).toBeTruthy();
    // Reset for other tests.
    entries[0] = makeEntry();
  });

  it("an INSERT-only entry (before null) renders all-green added fields", async () => {
    entries[0] = makeEntry({
      action: "parent.create",
      diff: JSON.stringify({
        before: null,
        after: { id: "par-001", firstName: "Ahmed", lastName: "Benali" },
      }),
    });
    auditStub.query.mockImplementation(async () => ({
      ok: true,
      value: { entries: [...entries], total: entries.length, hasMore: false },
    }));
    renderTab();
    const row = await screen.findByText("parent.create");
    row.closest("li")!.click();
    expect(await screen.findByText("Ahmed")).toBeTruthy();
    expect(screen.getByText("Benali")).toBeTruthy();
    // 3 added fields, 0 changed.
    expect(screen.getByText(/3 ajoutés/)).toBeTruthy();
    entries[0] = makeEntry();
  });

  it("a DELETE-only entry (after null) renders all-red removed fields", async () => {
    entries[0] = makeEntry({
      action: "expense.delete",
      diff: JSON.stringify({
        before: { id: "exp-9", amount: 12000 },
        after: null,
      }),
    });
    auditStub.query.mockImplementation(async () => ({
      ok: true,
      value: { entries: [...entries], total: entries.length, hasMore: false },
    }));
    renderTab();
    const row = await screen.findByText("expense.delete");
    row.closest("li")!.click();
    expect(await screen.findByText(/2 supprimés/)).toBeTruthy();
    entries[0] = makeEntry();
  });
});

// ---------------------------------------------------------------------------
// Engine integration sanity — the drawer's data path end to end.
// ---------------------------------------------------------------------------

describe("T-296 — drawer data path (diff string → engine rows)", () => {
  it("the exact drawer computation over a realistic audit diff", () => {
    const entry = makeEntry();
    const parsed = JSON.parse(entry.diff!) as { before: unknown; after: unknown };
    const rows = flattenDiffRows(computeFieldDiff(parsed.before, parsed.after));
    expect(rows.map((r) => `${r.path}:${r.kind}`).sort()).toEqual([
      "note:changed",
      "status:changed",
    ]);
    const statusRow = rows.find((r) => r.path === "status")!;
    expect(statusRow.oldDisplay).toBe("pending");
    expect(statusRow.newDisplay).toBe("paid");
  });
});

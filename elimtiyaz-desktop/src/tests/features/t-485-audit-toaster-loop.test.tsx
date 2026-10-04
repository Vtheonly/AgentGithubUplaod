/**
 * T-485 (REALTIME-105) — the AuditActivityToaster amplification-loop suite.
 *
 * THE BUG (registered live by the 141st session's eyeball pass): the
 * toaster's effect depended on the toast CONTEXT VALUE, whose useMemo
 * re-runs on every toasts-state change. One realtime audit event → one
 * toast → new context identity → effect teardown + RESUBSCRIBE → the
 * Supabase repository's SubjectBehavior REPLAYS its stored last event to
 * the fresh subscriber → another toast → React's "Maximum update depth
 * exceeded" — an unbounded toast stack and a frozen session. The live
 * evidence: the W2 worker session's 9+ duplicate
 * "Activité — admin@elimtiyaz.dz — user_account.create" toasts with an
 * empty main content area.
 *
 * WHAT THIS SUITE PINS (the fix + its blast radius):
 *
 *   A. THE LOOP KILL (behavioural, the real components): the toaster
 *      armed against a REPLAYING stream (the real SubjectBehavior —
 *      the repository's exact semantics: subscribe() re-emits the stored
 *      last value) inside the REAL ToastProvider (whose context value
 *      identity-churns on every toast, by design) —
 *      - one event → one toast on screen, and the subscribe count stays
 *        EXACTLY 1 (the old code resubscribed with every toast — the
 *        count is the loop's pulse);
 *      - a second event → a second toast, the count STILL 1;
 *      - the store's replay reaches the ONE subscriber it should (the
 *        stream contract itself is unchanged — subscribe-only).
 *
 *   B. THE SOURCE GUARD: the effect's dependency array is the repository
 *      singleton ONLY (`[repos.audit]`), the toast is read through a ref
 *      (the sessionRef pattern), and the self-suppression comparison
 *      survives.
 *
 * Run:
 *   npx vitest run src/tests/features/t-485-audit-toaster-loop.test.tsx
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import * as React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { SubjectBehavior } from "../../infrastructure/mock/subject-behavior";
import { AuditActivityToaster } from "../../shared/layout/audit-activity-toaster";
import {
  RepositoryProvider,
  type Repositories,
} from "../../app/providers/repository-provider";
import { AuthProvider } from "../../app/providers/auth-provider";
import { ToastProvider } from "../../app/providers/toast-provider";
import { ToastViewport } from "../../shared/layout/toast-viewport";
import type { AttributedActivityEvent } from "../../domain/model/audit";
import type { Observable } from "../../domain/repository/repository";
import type { AuditRepository } from "../../domain/repository/repository";

const ROOT = join(__dirname, "../../..");
const SESSION_KEY = "el-imtiyaz.session";

/* ------------------------------------------------------------------ */
/* The replaying audit repository — the Supabase repository's exact    */
/* stream semantics (SubjectBehavior: subscribe() re-emits the stored  */
/* last value), with the subscription COUNT the loop's pulse.          */
/* ------------------------------------------------------------------ */

class ReplayingAuditRepository implements Pick<AuditRepository, "observeActivity"> {
  readonly activity = new SubjectBehavior<AttributedActivityEvent | null>(null);
  subscribeCount = 0;

  observeActivity(): { subscribe: (fn: (e: AttributedActivityEvent) => void) => () => void } {
    this.subscribeCount += 1;
    return {
      subscribe: (fn) =>
        this.activity.subscribe((v) => {
          if (v !== null) fn(v);
        }),
    };
  }
}

function makeEvent(actorId: string, action: string): AttributedActivityEvent {
  return {
    actorName: "Admin Test",
    actorRole: "super_admin",
    actorId,
    action,
    entityType: "user_profile",
    entityId: "11111111-1111-4111-8111-111111111111",
    occurredAt: new Date().toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/* The harness — the REAL ToastProvider (identity churn by design)     */
/* over the REAL AuthProvider (seeded session — NOT the event's actor, */
/* so the self-suppression never fires and the toast surfaces).        */
/* ------------------------------------------------------------------ */

function seedSession(): void {
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      userId: "user-t485",
      tenantId: "tenant-1",
      email: "agent@elimtiyaz.dz",
      displayName: "Agent T485",
      avatarUrl: null,
      role: "super_admin",
      permissions: [],
      accessToken: "test-access-token",
      refreshToken: null,
      expiresAt: Date.now() + 3600_000,
      locale: "fr",
    }),
  );
}

function harness(repo: ReplayingAuditRepository) {
  return (
    <RepositoryProvider repositories={{ audit: repo } as unknown as Repositories}>
      <AuthProvider>
        <ToastProvider>
          <AuditActivityToaster />
          <ToastViewport />
        </ToastProvider>
      </AuthProvider>
    </RepositoryProvider>
  );
}

/* ------------------------------------------------------------------ */
/* A. THE LOOP KILL — behavioural, the real components.                */
/* ------------------------------------------------------------------ */

describe("T-485 (REALTIME-105) — the toaster's amplification loop is dead", () => {
  beforeEach(() => {
    localStorage.clear();
    seedSession();
  });
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("one event → one toast; the subscribe count stays 1 (the old code resubscribed per toast)", async () => {
    const repo = new ReplayingAuditRepository();
    render(harness(repo));

    // The mount subscription: exactly one, and the initial replay is the
    // null sentinel (filtered — no toast).
    expect(repo.subscribeCount).toBe(1);
    expect(screen.queryByText(/Activité/)).toBeNull();

    // The event lands (actor ≠ the local session → no self-suppression).
    repo.activity.set(makeEvent("actor-admin-uuid", "user_account.create"));
    await waitFor(() => {
      expect(screen.getByText("Activité — Admin Test (super_admin)")).toBeTruthy();
    });

    // THE LOOP KILL: the toast changed the toasts state (a new context
    // value identity), but the subscription was NOT re-armed. With the
    // pre-fix deps [repos.audit, toast] every toast resubscribed and the
    // SubjectBehavior replayed the stored event → the next toast → the
    // unbounded loop ("Maximum update depth exceeded").
    await new Promise((r) => setTimeout(r, 50));
    expect(repo.subscribeCount).toBe(1);
  });

  it("a second event → a second toast; the count STILL 1 (churn cannot re-arm)", async () => {
    const repo = new ReplayingAuditRepository();
    render(harness(repo));

    repo.activity.set(makeEvent("actor-admin-uuid", "user_account.create"));
    await waitFor(() => {
      expect(screen.getByText("Activité — Admin Test (super_admin)")).toBeTruthy();
    });

    repo.activity.set(makeEvent("actor-admin-uuid", "personnel.update"));
    await waitFor(() => {
      expect(screen.getByText(/personnel\.update/)).toBeTruthy();
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(repo.subscribeCount).toBe(1);
  });

  it("the stream contract itself is unchanged — a LATE subscriber still receives the replayed store value", () => {
    const repo = new ReplayingAuditRepository();
    repo.activity.set(makeEvent("actor-admin-uuid", "user_account.create"));

    const seen: AttributedActivityEvent[] = [];
    const late = (repo.observeActivity() as Observable<AttributedActivityEvent>).subscribe(
      (e) => seen.push(e),
    );
    // The SubjectBehavior's documented semantics: a fresh subscriber gets
    // the stored last value. The repository must KEEP this (late UIs rely
    // on it); the toaster must SURVIVE it — which the suite above proves.
    expect(seen).toHaveLength(1);
    expect(seen[0].action).toBe("user_account.create");
    late();
  });
});

/* ------------------------------------------------------------------ */
/* B. THE SOURCE GUARD — the exact wiring the fix installed.           */
/* ------------------------------------------------------------------ */

describe("T-485 (REALTIME-105) — the source guard", () => {
  it("the effect depends on the repository singleton ONLY — the toast is read through a ref", () => {
    const src = readFileSync(
      join(ROOT, "src/shared/layout/audit-activity-toaster.tsx"),
      "utf8",
    );
    // The stable dependency array (the loop's cause was `toast` in it).
    expect(src).toContain("}, [repos.audit]);");
    expect(src).not.toContain("[repos.audit, toast]");
    // The churny context value is held in a ref, read inside the handler.
    expect(src).toContain("const toastRef = useRef(toast);");
    expect(src).toContain("toastRef.current.showInfo(title, body);");
    // The self-suppression comparison survives the fix.
    expect(src).toContain("event.actorId === sessionRef.current.userId");
  });
});

/* ------------------------------------------------------------------ */
/* C. THE EYEBALL PASS's two sibling fixes — source guards.            */
/* ------------------------------------------------------------------ */

describe("T-485 (WORKFORCE-511 / CHAT-302) — the eyeball siblings", () => {
  it("WORKFORCE-511: both warehouse list cards carry the honest empty state (the stock-activity card's pattern)", () => {
    const src = readFileSync(
      join(ROOT, "src/features/personnel/dashboards/warehouse-worker-dashboard.tsx"),
      "utf8",
    );
    expect(src).toContain("Aucune réception en attente.");
    expect(src).toContain("Aucune expédition à préparer.");
    // Both branches exist (the populated list path is preserved).
    expect(src).toContain("Réceptions attendues");
    expect(src).toContain("Expéditions à préparer");
    expect(src).toContain("Aucune activité récente.");
  });

  it("CHAT-302: the unbound-recipient branch surfaces a warning toast instead of the silent return", () => {
    const src = readFileSync(
      join(ROOT, "src/features/personnel/management/chat-panel.tsx"),
      "utf8",
    );
    expect(src).toContain("Ce collaborateur n'a pas de compte de messagerie rattaché.");
    expect(src).toContain("toast.showWarning(");
    // The silent composite guard is gone.
    expect(src).not.toContain("if (!recipient || !recipient.userId) return;");
    // The data guard itself survives (an unbound record is never DM-able).
    expect(src).toContain("if (!recipient) return;");
    expect(src).toContain("if (!recipient.userId) {");
  });
});

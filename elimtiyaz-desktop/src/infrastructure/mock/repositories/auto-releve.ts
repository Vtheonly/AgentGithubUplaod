/**
 * Auto-populated Relevé entries — vault §09.06.
 *
 * The Teacher Activity Ledger is "an AUTOMATED operational activity ledger
 * per teacher", tracking: grades entered, homework assignments issued,
 * attendance submission records, and classes taught + hours logged. Manual
 * clock-in/out entries remain; these helpers ADD append-only entries
 * automatically when teachers perform classroom operations.
 *
 * Rules preserved:
 *   - Append-only — no update/delete path exists for auto entries either.
 *   - Audit-logged (a `releve.auto_log` audit entry accompanies each write).
 *   - Teachers cannot edit their own Relevé — enforced by construction
 *     (auto entries are system-generated).
 */
import type { ReleveEntry, ReleveActivity } from "../../../domain/model/personnel";
import type { MockStore } from "./mock-store";

export type AutoReleveKind = NonNullable<ReleveEntry["autoKind"]>;

/** Resolve the display name for an actor (personnel lookup → fallback). */
function actorDisplayName(store: MockStore, actorId: string): string {
  const person = store.personnel.find(
    (p) => p.userId === actorId || p.id === actorId,
  );
  if (person) return `${person.firstName} ${person.lastName}`;
  return "Session courante";
}

/**
 * Append an auto-generated, append-only Relevé entry for a classroom
 * operation (grade entry / homework push / roll call).
 */
export function logAutoReleveEntry(params: {
  store: MockStore;
  appendAudit: (input: Parameters<typeof import("./mock-store").appendAudit>[0]) => void;
  nowIso: () => string;
  actorId: string;
  kind: AutoReleveKind;
  activity: ReleveActivity;
  note: string;
  classId?: string | null;
  subjectId?: string | null;
}): ReleveEntry {
  const { store, appendAudit, nowIso, actorId, kind, activity, note, classId, subjectId } = params;
  const now = new Date();
  const entry: ReleveEntry = {
    id: `rel-auto-${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    personnelId: actorId,
    personnelName: actorDisplayName(store, actorId),
    date: now.toISOString().slice(0, 10),
    // Event time-of-day (decimal hours); auto entries have no clock-out.
    hoursIn:
      now.getHours() + Math.round((now.getMinutes() / 60) * 100) / 100,
    hoursOut: null,
    activity,
    classId: classId ?? null,
    subjectId: subjectId ?? null,
    autoKind: kind,
    note,
    recordedAt: nowIso(),
  };
  store.releve = [entry, ...store.releve];
  store.notifyReleve();
  appendAudit({
    action: "releve.auto_log",
    entityType: "releve",
    entityId: entry.id,
    actorId: "system",
    actorName: "Système",
    diff: {
      before: null,
      after: { personnelId: actorId, kind, activity, classId: classId ?? null, subjectId: subjectId ?? null },
    },
    note: `Relevé auto — ${note}`,
  });
  return entry;
}

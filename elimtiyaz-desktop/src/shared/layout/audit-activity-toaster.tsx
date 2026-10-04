/**
 * AuditActivityToaster — T-299 (OFFLINE-400, 46th session, 2026-09-11).
 *
 * The realtime cross-platform attributed-broadcast surface on the desktop:
 * every audit_logs INSERT that arrives on the repository's realtime
 * stream (another operator's change — desktop, Android, or a server-side
 * trigger) renders an attributed toast "Actor (Role) — action · target".
 *
 * Mounted once in the topbar (next to the SyncIndicator). One event →
 * one toast; the toast provider handles stacking/duration. Self-silent
 * guard: events emitted by THIS session's own writes are suppressed for
 * the local actor (the user just did it — a toast would be noise; the
 * audit drawer is their record). The suppression compares the event's
 * actorId with the session's userId.
 */
import { useEffect, useRef } from "react";
import { Radio } from "lucide-react";
import { useAuth } from "../../app/providers/auth-provider";
import { useRepositories } from "../../app/providers/repository-provider";
import { useToast } from "../../app/providers/toast-provider";
import { formatAttributedActivity } from "../../domain/model/audit";

export function AuditActivityToaster() {
  const repos = useRepositories();
  const { session } = useAuth();
  const toast = useToast();
  const sessionRef = useRef(session);
  sessionRef.current = session;

  // REALTIME-105 (T-485, 141st session): the toast CONTEXT VALUE is not a
  // stable effect dependency — its useMemo re-runs on every toasts-state
  // change, so an effect depending on `toast` tears down and resubscribes
  // with every toast shown. Every resubscription replays the repository's
  // SubjectBehavior (its stored last event) → another toast → another
  // identity change → the unbounded amplification loop React reports as
  // "Maximum update depth exceeded" (live evidence: the worker session's
  // 9+ duplicate "Activité — admin@elimtiyaz.dz" toasts + the frozen main
  // content). The session one line above has the same shape and the same
  // correct answer: hold the churny context value in a ref, read it inside
  // the subscription, and keep the effect pinned to the STABLE repository
  // singleton.
  const toastRef = useRef(toast);
  toastRef.current = toast;

  useEffect(() => {
    // Events are fire-once; the stream contract is subscribe-only.
    const unsub = repos.audit.observeActivity().subscribe((event) => {
      // Self-suppression: the local actor's own writes are not toasts.
      if (sessionRef.current && event.actorId === sessionRef.current.userId) {
        return;
      }
      const { title, body } = formatAttributedActivity(event);
      toastRef.current.showInfo(title, body);
    });
    return unsub;
  }, [repos.audit]);

  // No visual footprint — the toaster renders through the toast provider.
  return null;
}

/** Icon re-export for surfaces that want the live-activity affordance. */
export const LiveActivityIcon = Radio;

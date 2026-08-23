/**
 * Lightweight Observable<T> implementation — used by mock repositories
 * to push updates to React via useSyncExternalStore.
 *
 * Not a full RxJS replacement — just enough for the mock layer to feel
 * reactive without pulling in a reactive streams library. Real Supabase
 * adapter will use realtime subscriptions underneath.
 */
import type { Observable, Subscriber } from "../../domain/repository/repository";

export class SubjectBehavior<T> implements Observable<T> {
  private current: T;
  private readonly subscribers = new Set<Subscriber<T>>();

  constructor(initial: T) {
    this.current = initial;
  }

  get(): T {
    return this.current;
  }

  set(value: T): void {
    if (Object.is(value, this.current)) return;
    this.current = value;
    for (const sub of this.subscribers) sub(value);
  }

  update(fn: (current: T) => T): void {
    this.set(fn(this.current));
  }

  subscribe(fn: Subscriber<T>): () => void {
    this.subscribers.add(fn);
    fn(this.current);
    return () => this.subscribers.delete(fn);
  }
}

/**
 * DerivedObservable — projects one or more source observables through a pure
 * function and re-emits whenever ANY source emits.
 *
 * FIX (drawer reactivity): `observeBy*` repository methods used to return
 * `new SubjectBehavior(snapshot)` — a detached one-shot snapshot that never
 * received store notifications. Drawers (parent/student detail) therefore
 * froze at mount: collecting a payment, importing Excel rows, or editing an
 * entity never refreshed them until the component remounted with different
 * dependency ids.
 *
 * Deriving from the store's reactive streams fixes this class of bug in one
 * place: any mutation that calls `store.notify*()` now flows through to every
 * derived view.
 */
class DerivedObservable<T> implements Observable<T> {
  private current: T;

  constructor(
    private readonly sources: readonly Observable<unknown>[],
    private readonly project: () => T,
  ) {
    this.current = project();
  }

  get(): T {
    // Recompute on read so a freshly constructed observable (e.g. between a
    // render and its effect subscription) is never stale.
    this.current = this.project();
    return this.current;
  }

  subscribe(fn: Subscriber<T>): () => void {
    // Re-project before the initial emission for the same reason as `get()`.
    this.current = this.project();
    fn(this.current);
    this.subscribers.add(fn);
    const unsubs = this.sources.map((src) =>
      src.subscribe(() => {
        this.current = this.project();
        for (const sub of this.subscribers) sub(this.current);
      }),
    );
    return () => {
      for (const u of unsubs) u();
      this.subscribers.delete(fn);
    };
  }

  private readonly subscribers = new Set<Subscriber<T>>();
}

/**
 * Create an `Observable<T>` derived from one or more source observables.
 * The projection must be a pure synchronous function over the sources'
 * current values (or over the shared store, as used by mock repositories).
 */
export function derived<T>(
  sources: readonly Observable<unknown>[],
  project: () => T,
): Observable<T> {
  return new DerivedObservable(sources, project);
}

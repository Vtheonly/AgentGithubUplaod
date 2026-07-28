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

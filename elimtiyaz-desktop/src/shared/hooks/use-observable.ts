/**
 * useObservable — subscribes to a Repository Observable<T> and re-renders
 * the component on every emission. Returns the latest value.
 *
 * Mirrors the Android Flow<T>.collectAsState() pattern. Initial value is
 * whatever the Observable.get() returns (the seed for mock repos).
 */
import { useEffect, useState } from "react";
import type { Observable } from "../../domain/repository/repository";

export function useObservable<T>(factory: () => Observable<T>, deps: unknown[]): T {
  const [value, setValue] = useState<T>(() => factory().get());
  useEffect(() => {
    const obs = factory();
    const unsub = obs.subscribe(setValue);
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return value;
}

/**
 * DZD money adapter — wraps Dinero.js v2 for exact-integer Algerian Dinar math.
 * Zero centime drift via integer subunits (1 DZD = 100 centimes).
 */
import { dinero, add, subtract, allocate, toSnapshot, equal, isZero, greaterThan, lessThan, type Dinero } from "dinero.js";
import { DZD } from "dinero.js/currencies";

export type Dzd = Dinero<number>;
export const DZD_CURRENCY = DZD;

export function dzd(amount: number): Dzd {
  return dinero({ amount: Math.round(amount * 100), currency: DZD });
}

export function dzdFromSubunits(subunits: number): Dzd {
  return dinero({ amount: Math.round(subunits), currency: DZD });
}

export function addDzd(a: Dzd, b: Dzd): Dzd { return add(a, b); }
export function subDzd(a: Dzd, b: Dzd): Dzd { return subtract(a, b); }

export function allocateDzd(amount: Dzd, proportions: readonly number[]): readonly Dzd[] {
  return allocate(amount, proportions as [number, ...number[]]);
}

export function toDzdNumber(a: Dzd): number {
  const snap = toSnapshot(a);
  const subunits = typeof snap.amount === "number" ? snap.amount : Number(snap.amount);
  return subunits / 100;
}

export function dzdEqual(a: Dzd, b: Dzd): boolean { return equal(a, b); }
export const dzdIsZero = (a: Dzd): boolean => isZero(a);
export const dzdGreaterThan = (a: Dzd, b: Dzd): boolean => greaterThan(a, b);
export const dzdLessThan = (a: Dzd, b: Dzd): boolean => lessThan(a, b);

export function sumDzd<T>(items: readonly T[], extract: (item: T) => Dzd): Dzd {
  return items.reduce<Dzd>((acc, item) => addDzd(acc, extract(item)), dzd(0));
}

export function splitDzdEqually(amount: Dzd, count: number): readonly Dzd[] {
  if (count <= 0) return [];
  return allocateDzd(amount, Array(count).fill(1));
}

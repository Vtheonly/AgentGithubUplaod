/**
 * The person display helpers (E2.5 / S-U1) — the ONE home for the
 * person-name presentation idioms that were scattered as inline template
 * joins across ~18 surfaces.
 *
 * The canonical shape every resolver shares (the shape
 * `parentDisplayName`/`studentDisplayName` already established):
 *   1. a trimmed non-empty `displayName` wins,
 *   2. else the composed `{firstName} {lastName}` (trimmed),
 *   3. else the caller's fallback.
 */

/** The minimal name shape every person entity satisfies structurally. */
export interface PersonNameParts {
  displayName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}

/**
 * The ONE person display-name resolver: displayName-trim → composed
 * join-trim → fallback (default "—", the canonical resolvers' sentinel).
 *
 * `parentDisplayName`/`studentDisplayName` delegate here (byte-identical
 * outputs); the surfaces that compose ad-hoc labels (Select options,
 * sorter keys, drawer titles) call it directly with their own fallback.
 */
export function personDisplayName(p: PersonNameParts, fallback = "—"): string {
  const dn = (p.displayName ?? "").trim();
  if (dn) return dn;
  const composed = `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim();
  return composed || fallback;
}

/**
 * The ONE person initials resolver — `${firstName[0]}${lastName[0]}`
 * uppercased, tolerating missing parts (the avatar-fallback idiom the
 * student/personnel/parent drawers hand-rolled three times).
 */
export function personInitials(p: PersonNameParts): string {
  return `${p.firstName?.[0] ?? ""}${p.lastName?.[0] ?? ""}`.toUpperCase();
}

/**
 * The last-first sort key (`Dupont André`) — the annuaire/account-ordering
 * idiom the comparators hand-rolled. A pure key: displayName precedence is
 * the CALLER's policy (some surfaces sort by displayName when present —
 * compose `a.displayName ?? personSortName(a)` there).
 */
export function personSortName(p: PersonNameParts): string {
  return `${p.lastName ?? ""} ${p.firstName ?? ""}`.trim();
}

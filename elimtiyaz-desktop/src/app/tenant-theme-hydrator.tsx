/**
 * TenantThemeHydrator — the T-627 (C-25) theme hydration.
 *
 * `UserPreferencesProvider` sits at the OUTERMOST position (above
 * RepositoryProvider — theme/locale must apply on first paint), so it
 * cannot read the repository itself. This null-rendering component mounts
 * INSIDE the repository tree (the app shell) and pushes the tenant's
 * custom-palette list into the provider's state ONCE per session:
 *
 *   repos.tenantSettings.load() → customThemes ≠ null → hydrateCustomThemes()
 *
 * The hydration merge (in the provider) lets the TENANT list win on id
 * collision and mirrors the merged list back to the device store — offline
 * boots render the last-known tenant palettes (the T-448 dashboard-layout
 * offline-cache pattern). FAIL-OPEN: a failed load (offline, refused,
 * malformed) keeps the device list — silent, by design (the failure is
 * logged; the user sees their palettes either way).
 */
import { useEffect } from "react";
import { useRepositories } from "./providers/repository-provider";
import { useUserPreferences } from "./providers/user-preferences-provider";
import { logger } from "../core/logger";

export function TenantThemeHydrator() {
  const repos = useRepositories();
  const { hydrateCustomThemes } = useUserPreferences();

  useEffect(() => {
    let cancelled = false;
    repos.tenantSettings
      .load()
      .then((r) => {
        if (cancelled) return;
        if (!r.ok) {
          logger.debug("tenant_themes.hydration_skipped", {
            reason: r.error.code,
          });
          return; // fail-open: keep the device list
        }
        if (r.value.customThemes && r.value.customThemes.length > 0) {
          hydrateCustomThemes(r.value.customThemes);
        }
      })
      .catch(() => undefined); // never crash the shell over a settings read
    return () => {
      cancelled = true;
    };
  }, [repos, hydrateCustomThemes]);

  return null;
}

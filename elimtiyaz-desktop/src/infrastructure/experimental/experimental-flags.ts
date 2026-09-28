/**
 * Experimental feature flags — T-438 / ADR-032 / identity-rules §9 (INV-56).
 *
 * The per-desktop LOCAL store for experimental capabilities. An experimental
 * opt-in must NEVER ride the server `feature_flags` (which every operator
 * shares): it is a deliberate, local, reversible choice — the localStorage
 * convention the local-config surface established (ADR-009's spirit).
 *
 * Every capability is OFF by default. The only activation path is
 * Settings → Expérimental (IDENT-101's contract).
 */

export interface ExperimentalCapability {
  readonly key: string;
  readonly labelFr: string;
  readonly descriptionFr: string;
}

/** The ER-PMAE flag key (issues #15/#16 — the identity-resolution engine). */
export const EXPERIMENTAL_ER_PMAE_KEY = "er-pmae";

/**
 * The registered experimental capabilities. Adding one here lands it on the
 * Settings → Expérimental tab automatically (each OFF by default).
 */
export const EXPERIMENTAL_CAPABILITIES: readonly ExperimentalCapability[] = [
  {
    key: EXPERIMENTAL_ER_PMAE_KEY,
    labelFr: "Agrégation & Résolution d'Identité (ER-PMAE)",
    descriptionFr:
      "Moteur expérimental de résolution d'identité : détecte les doublons de familles entre les imports Excel et le registre existant, " +
      "propose des rapprochements notés avec preuves, et fusionne/répartit les profils de manière RÉVERSIBLE (chaque fusion est annulable, " +
      "l'historique financier n'est jamais réécrit). Rien n'est fusionné sans confirmation explicite. " +
      "Les données d'agrégation suivent les sauvegardes existantes (jamais un système parallèle).",
  },
];

const storageKey = (key: string): string => `el-imtiyaz:experimental:${key}`;

/** Read one flag (OFF by default; missing/garbage values are OFF — fail-closed). */
export function isExperimentalEnabled(key: string): boolean {
  try {
    const raw = localStorage.getItem(storageKey(key));
    return raw === "true";
  } catch {
    return false;
  }
}

/** Write one flag (persists locally; never syncs — INV-56). */
export function setExperimentalEnabled(key: string, enabled: boolean): void {
  try {
    localStorage.setItem(storageKey(key), enabled ? "true" : "false");
  } catch {
    /* storage unavailable — the flag stays off for this session */
  }
}

/** True when ANY experimental capability is enabled (the app-mode hint). */
export function anyExperimentalEnabled(): boolean {
  return EXPERIMENTAL_CAPABILITIES.some((c) => isExperimentalEnabled(c.key));
}

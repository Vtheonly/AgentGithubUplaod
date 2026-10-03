/**
 * Helpers for building the repeated SettingsCard callbacks.
 *
 * The original `configuration-tab.tsx` inlined the same `onEditSecret`
 * and `onUpdateValue` callbacks 6 times — once per category. This module
 * builds them once, reducing duplication and the main file's LOC count.
 */
import type { LucideIcon } from "lucide-react";
import {
  Bot, Mail, Bell, Database, HardDrive, ToggleLeft, Scale,
} from "lucide-react";
import type {
  SystemConfigService,
  SystemSetting,
  SettingCategory,
} from "../../../infrastructure/system-config";
import type { SecretEditState } from "./types";
import { settingKeyToEnvVar } from "./types";

export interface CategoryCardConfig {
  category: SettingCategory;
  title: string;
  description: string;
  icon: LucideIcon;
  readOnly?: boolean;
}

/** The standard category cards rendered by ConfigurationTab. */
export const CATEGORY_CARDS: readonly CategoryCardConfig[] = [
  {
    category: "ai",
    title: "Fournisseurs IA",
    description: "Clés API pour Groq et OpenRouter. Les clés sont stockées chiffrées et jamais envoyées au client.",
    icon: Bot,
  },
  {
    // T-429 (DEBT-100, issues #24/#25 Track 5): the debt configuration —
    // the four configurable aging thresholds the canonical debt engine
    // consumes (migration 0125's seed: grace 5 / yellow 15 / red 60 /
    // active-payer window 15).
    category: "debt",
    title: "Configuration des Créances",
    description: "Seuils du moteur de vieillissement des créances : délai de grâce, seuils « À surveiller » et « Critique / Contentieux », fenêtre « payeur actif ». Les modifications s'appliquent au prochain calcul (aucun effet rétroactif sur les statuts déjà affichés).",
    icon: Scale,
  },
  {
    category: "email",
    title: "Service Email",
    description: "Configuration Resend pour l'envoi d'emails (convocations, alertes, etc.)",
    icon: Mail,
  },
  {
    category: "push",
    title: "Notifications Push",
    description: "Configuration Firebase Cloud Messaging pour l'app mobile Android",
    icon: Bell,
  },
  {
    category: "backup",
    title: "Sauvegardes",
    description: "Phrase secrète + rétention + planification des sauvegardes AES-256",
    icon: HardDrive,
  },
  {
    category: "storage",
    title: "Buckets de Stockage",
    description: "Noms des buckets Supabase Storage. Lecture seule — ne pas modifier après création.",
    icon: Database,
    readOnly: true,
  },
  {
    category: "feature_flags",
    title: "Indicateurs de Fonctionnalités",
    description: "Activer/désactiver des fonctionnalités spécifiques.",
    icon: ToggleLeft,
  },
] as const;

export interface CardCallbacks {
  onEditSecret: (setting: SystemSetting) => void;
  onUpdateValue: (setting: SystemSetting, value: unknown) => void;
}

/**
 * Build the shared edit-secret + update-value callbacks for a service.
 *
 * T-443 (DEBT-101): `allSettings` (the tab's currently-loaded rows) enables
 * the debt-threshold validation (the INV-16a no-gap hierarchy check) — a
 * violation is surfaced through `onError` and the update is NOT sent.
 */
export function buildCardCallbacks(
  service: SystemConfigService,
  onSuccess: (message: string) => void,
  onError: (message: string) => void,
  onReload: () => void,
  onSecretEdit: (state: SecretEditState) => void,
  allSettings: readonly SystemSetting[] = [],
): CardCallbacks {
  return {
    onEditSecret: (setting) => {
      onSecretEdit({
        settingKey: setting.key,
        envVarName: settingKeyToEnvVar(setting.key),
        label: setting.label_fr,
        value: "",
        showValue: false,
      });
    },
    onUpdateValue: async (setting, value) => {
      const violation = validateDebtThresholdUpdate(allSettings, setting, value);
      if (violation) {
        onError(violation);
        return;
      }
      const result = await service.updateValue(setting.id, value);
      if (result.ok) {
        onSuccess("Paramètre mis à jour");
        onReload();
      } else {
        onError(result.error.userMessage);
      }
    },
  };
}

/** Filter settings to a single category. */
export function filterByCategory(
  settings: readonly SystemSetting[],
  category: SettingCategory,
): SystemSetting[] {
  return settings.filter((s) => s.category === category);
}

/**
 * T-443 (DEBT-101): validate a debt-threshold update BEFORE it is written.
 *
 * INV-16a's no-gap partition (grace ≤ yellow ≤ red) is a CROSS-ROW
 * constraint — each row's own min/max is enforced by the column hints, but
 * nothing server-side stops an operator from saving yellow=3 under grace=5
 * (silently making the yellow tier unreachable) or red=10 under yellow=15
 * (silently absorbing the orange tier). The validation runs against the
 * CURRENTLY LOADED settings rows (the Configuration tab's state — the same
 * source the card renders), with the edited key substituted.
 *
 * Returns a FR error message, or null when the update is safe.
 */
export function validateDebtThresholdUpdate(
  allSettings: readonly SystemSetting[],
  setting: SystemSetting,
  value: unknown,
): string | null {
  if (setting.category !== "debt") return null;
  const next = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(next)) {
    return `Valeur invalide — un nombre est attendu (${String(value)}).`;
  }
  // The row's own documented bounds (migration 0125's validation columns).
  if (setting.validation_min != null && next < setting.validation_min) {
    return `Valeur trop basse — le minimum est ${setting.validation_min}.`;
  }
  if (setting.validation_max != null && next > setting.validation_max) {
    return `Valeur trop élevée — le maximum est ${setting.validation_max}.`;
  }
  // The cross-row hierarchy: grace ≤ yellow ≤ red (INV-16a — a strict,
  // no-gap partition of the age axis). The other three keys keep their
  // currently-loaded values.
  const current = new Map(
    filterByCategory(allSettings, "debt").map((s) => [s.key, s]),
  );
  const readKey = (key: string): number => {
    if (setting.key === key) return next;
    const row = current.get(key);
    const v = row?.value;
    return typeof v === "number" ? v : Number(v);
  };
  const grace = readKey("debt.grace_period_days");
  const yellow = readKey("debt.threshold_yellow_days");
  const red = readKey("debt.threshold_red_days");
  if (Number.isFinite(grace) && Number.isFinite(yellow) && grace > yellow) {
    return `Hiérarchie invalide — le délai de grâce (${grace} j) doit rester ≤ au seuil « À surveiller » (${yellow} j) (règles financières §15.1, INV-16a : partition sans trou de l'axe d'ancienneté).`;
  }
  if (Number.isFinite(yellow) && Number.isFinite(red) && yellow > red) {
    return `Hiérarchie invalide — le seuil « À surveiller » (${yellow} j) doit rester ≤ au seuil « Critique / Contentieux » (${red} j) (règles financières §15.1, INV-16a).`;
  }
  // T-469 (DEBT-103): the AMOUNT hierarchy — yellow ≤ red on the amount
  // axis (the same no-gap discipline). 0 is LEGAL on either edge = the
  // edge is DISABLED (classifyOutstandingAmount's documented semantics),
  // so the cross-edge constraint fires only when BOTH edges are active.
  const amountYellow = readKey("debt.amount_threshold_yellow_dzd");
  const amountRed = readKey("debt.amount_threshold_red_dzd");
  if (
    Number.isFinite(amountYellow) &&
    Number.isFinite(amountRed) &&
    amountYellow > 0 &&
    amountRed > 0 &&
    amountYellow > amountRed
  ) {
    // Locale-stable grouping (NBSP/NNBSP normalized to plain spaces so the
    // message is deterministic across ICU builds — the §15.3 rule).
    const dzd = (n: number) =>
      n.toLocaleString("fr-DZ").replace(/[\u00a0\u202f]/gu, " ");
    return `Hiérarchie invalide — le seuil montant « À surveiller » (${dzd(amountYellow)} DZD) doit rester ≤ au seuil montant « Critique » (${dzd(amountRed)} DZD) (T-469 / DEBT-103 : partition sans trou de l'axe montant ; 0 = dimension désactivée).`;
  }
  return null;
}

/**
 * Helpers for building the repeated SettingsCard callbacks.
 *
 * The original `configuration-tab.tsx` inlined the same `onEditSecret`
 * and `onUpdateValue` callbacks 6 times — once per category. This module
 * builds them once, reducing duplication and the main file's LOC count.
 */
import type { LucideIcon } from "lucide-react";
import {
  Bot, Mail, Bell, Database, HardDrive, ToggleLeft,
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

/** The 6 standard category cards rendered by ConfigurationTab. */
export const CATEGORY_CARDS: readonly CategoryCardConfig[] = [
  {
    category: "ai",
    title: "Fournisseurs IA",
    description: "Clés API pour Groq et OpenRouter. Les clés sont stockées chiffrées et jamais envoyées au client.",
    icon: Bot,
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

/** Build the shared edit-secret + update-value callbacks for a service. */
export function buildCardCallbacks(
  service: SystemConfigService,
  onSuccess: (message: string) => void,
  onError: (message: string) => void,
  onReload: () => void,
  onSecretEdit: (state: SecretEditState) => void,
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

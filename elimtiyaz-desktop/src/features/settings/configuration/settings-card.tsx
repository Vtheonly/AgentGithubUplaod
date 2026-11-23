/**
 * E6.11 (DUP-030 / SET-U1) — SettingsCard moved to `shared/ui/settings/`
 * (the shared settings-ceremony family). This file is the stable BARREL:
 * existing import sites keep their paths; the implementation lives in
 * the shared module.
 */
export { SettingsCard, type SettingsCardProps } from "../../../shared/ui/settings/settings-card";

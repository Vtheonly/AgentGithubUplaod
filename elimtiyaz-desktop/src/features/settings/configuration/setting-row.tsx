/**
 * E6.11 (DUP-030 / SET-U1) — SettingRow moved to `shared/ui/settings/`
 * (the shared settings-ceremony family). This file is the stable BARREL:
 * existing import sites keep their paths; the implementation lives in
 * the shared module.
 */
export { SettingRow, type SettingRowProps } from "../../../shared/ui/settings/setting-row";

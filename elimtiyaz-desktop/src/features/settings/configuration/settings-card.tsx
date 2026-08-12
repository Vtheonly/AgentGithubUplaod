/**
 * SettingsCard — generic card for one configuration category.
 *
 * Extracted from `configuration-tab.tsx` (iteration 20). Behavior is
 * unchanged — only the file location moved.
 */
import type { LucideIcon } from "lucide-react";
import { Lock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../../shared/ui/card";
import { Badge } from "../../../shared/ui/badge";
import { LoadingState } from "../../../shared/layout/state-views";
import type { SystemSetting, SettingCategory } from "../../../infrastructure/system-config";
import { SettingRow } from "./setting-row";

export interface SettingsCardProps {
  category: SettingCategory;
  title: string;
  description: string;
  icon: LucideIcon;
  settings: SystemSetting[];
  isLoading: boolean;
  readOnly?: boolean;
  onEditSecret: (setting: SystemSetting) => void;
  onUpdateValue: (setting: SystemSetting, value: unknown) => void;
}

export function SettingsCard({
  title,
  description,
  icon: Icon,
  settings,
  isLoading,
  readOnly = false,
  onEditSecret,
  onUpdateValue,
}: SettingsCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="h-4 w-4 text-primary" />
          {title}
          {readOnly && (
            <Badge variant="outline" className="ml-1 text-[10px]">
              <Lock className="h-3 w-3 mr-1" />
              Lecture seule
            </Badge>
          )}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <LoadingState message="Chargement..." />
        ) : settings.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">Aucun paramètre dans cette catégorie.</p>
        ) : (
          <div className="space-y-3">
            {settings.map((setting) => (
              <SettingRow
                key={setting.id}
                setting={setting}
                readOnly={readOnly || !setting.is_editable}
                onEditSecret={() => onEditSecret(setting)}
                onUpdateValue={(value) => onUpdateValue(setting, value)}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

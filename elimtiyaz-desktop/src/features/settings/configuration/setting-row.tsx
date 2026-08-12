/**
 * SettingRow — single setting row, renders different controls based on
 * value_type + is_sensitive.
 *
 * Extracted from `configuration-tab.tsx` (iteration 20). Behavior is
 * unchanged — only the file location moved.
 */
import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { Button } from "../../../shared/ui/button";
import { Input } from "../../../shared/ui/input";
import { Label } from "../../../shared/ui/label";
import { Textarea } from "../../../shared/ui/textarea";
import { Badge } from "../../../shared/ui/badge";
import { Switch } from "../../../shared/ui/switch";
import { StatusChip } from "../../../shared/ui/status-chip";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "../../../shared/ui/select";
import type { SystemSetting } from "../../../infrastructure/system-config";

export interface SettingRowProps {
  setting: SystemSetting;
  readOnly: boolean;
  onEditSecret: () => void;
  onUpdateValue: (value: unknown) => void;
}

export function SettingRow({ setting, readOnly, onEditSecret, onUpdateValue }: SettingRowProps) {
  const [localValue, setLocalValue] = useState<string>(initialLocalValue(setting));
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    setLocalValue(initialLocalValue(setting));
    setHasChanges(false);
  }, [setting]);

  const handleSave = () => {
    const value = coerceValue(setting, localValue);
    if (value === undefined) return; // JSON parse failure
    onUpdateValue(value);
    setHasChanges(false);
  };

  return (
    <div className="rounded-lg border border-border p-3 space-y-2">
      <SettingRowHeader setting={setting} />

      <SettingRowControl
        setting={setting}
        readOnly={readOnly}
        localValue={localValue}
        hasChanges={hasChanges}
        onLocalValueChange={(v) => { setLocalValue(v); setHasChanges(true); }}
        onEditSecret={onEditSecret}
        onSave={handleSave}
      />

      <SettingRowValidationHints setting={setting} />
    </div>
  );
}

function initialLocalValue(setting: SystemSetting): string {
  if (setting.value_type === "boolean") return String(setting.value === true);
  return typeof setting.value === "string"
    ? setting.value
    : JSON.stringify(setting.value ?? "");
}

function coerceValue(setting: SystemSetting, localValue: string): unknown {
  if (setting.value_type === "number") return Number(localValue);
  if (setting.value_type === "boolean") return localValue === "true";
  if (setting.value_type === "json") {
    try { return JSON.parse(localValue); } catch { return undefined; }
  }
  return localValue;
}

function SettingRowHeader({ setting }: { setting: SystemSetting }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Label className="font-medium text-sm">{setting.label_fr}</Label>
          {setting.is_required && (
            <Badge variant="outline" className="text-[10px]">Requis</Badge>
          )}
          {setting.is_sensitive && (
            <Badge variant="secondary" className="text-[10px]">Secret</Badge>
          )}
          {setting.is_sensitive && (
            setting.is_configured ? (
              <StatusChip label="Configuré" tone="success" />
            ) : (
              <StatusChip label="Non configuré" tone="warning" />
            )
          )}
        </div>
        {setting.description_fr && (
          <p className="text-xs text-muted-foreground mt-1">{setting.description_fr}</p>
        )}
        <p className="text-[11px] text-muted-foreground/70 mt-0.5">
          Clé: <code className="font-mono bg-muted px-1 rounded">{setting.key}</code>
          {setting.updated_at && (
            <span className="ml-2">· Modifié: {new Date(setting.updated_at).toLocaleDateString("fr-FR")}</span>
          )}
        </p>
      </div>
    </div>
  );
}

interface SettingRowControlProps {
  setting: SystemSetting;
  readOnly: boolean;
  localValue: string;
  hasChanges: boolean;
  onLocalValueChange: (v: string) => void;
  onEditSecret: () => void;
  onSave: () => void;
}

function SettingRowControl(props: SettingRowControlProps) {
  const { setting, readOnly, localValue, hasChanges, onLocalValueChange, onEditSecret, onSave } = props;

  if (setting.is_sensitive) {
    return (
      <div className="flex items-center gap-2">
        <Input
          type="password"
          value={setting.is_configured ? "********" : ""}
          readOnly
          placeholder="Non configuré"
          className="font-mono"
        />
        <Button size="sm" variant="outline" onClick={onEditSecret} disabled={readOnly}>
          {setting.is_configured ? "Modifier" : "Configurer"}
        </Button>
      </div>
    );
  }

  if (setting.value_type === "boolean") {
    return (
      <div className="flex items-center gap-3">
        <Switch
          checked={localValue === "true"}
          onCheckedChange={(checked) => onLocalValueChange(checked ? "true" : "false")}
          disabled={readOnly}
        />
        <span className="text-sm">{localValue === "true" ? "Activé" : "Désactivé"}</span>
        {hasChanges && (
          <Button size="sm" onClick={onSave} className="ml-auto" disabled={readOnly}>
            <Save className="h-3 w-3 mr-1" />Enregistrer
          </Button>
        )}
      </div>
    );
  }

  if (setting.options && setting.options.length > 0) {
    return (
      <div className="flex items-center gap-2">
        <Select value={localValue} onValueChange={onLocalValueChange} disabled={readOnly}>
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            {setting.options.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>{opt.label_fr}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {hasChanges && (
          <Button size="sm" onClick={onSave} disabled={readOnly}>
            <Save className="h-3 w-3 mr-1" />OK
          </Button>
        )}
      </div>
    );
  }

  if (setting.value_type === "json") {
    return (
      <div className="space-y-2">
        <Textarea
          value={localValue}
          onChange={(e) => onLocalValueChange(e.target.value)}
          rows={3}
          className="font-mono text-xs"
          readOnly={readOnly}
        />
        {hasChanges && (
          <Button size="sm" onClick={onSave} disabled={readOnly}>
            <Save className="h-3 w-3 mr-1" />Enregistrer
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        type={setting.value_type === "number" ? "number" : "text"}
        value={localValue}
        onChange={(e) => onLocalValueChange(e.target.value)}
        placeholder={setting.is_required ? "Requis" : "Optionnel"}
        readOnly={readOnly}
      />
      {hasChanges && (
        <Button size="sm" onClick={onSave} disabled={readOnly}>
          <Save className="h-3 w-3 mr-1" />OK
        </Button>
      )}
    </div>
  );
}

function SettingRowValidationHints({ setting }: { setting: SystemSetting }) {
  return (
    <>
      {setting.validation_pattern && (
        <p className="text-[11px] text-muted-foreground">
          Format attendu: <code className="font-mono">{setting.validation_pattern}</code>
        </p>
      )}
      {setting.validation_min !== null && setting.validation_max !== null && (
        <p className="text-[11px] text-muted-foreground">
          Entre {setting.validation_min} et {setting.validation_max}
        </p>
      )}
    </>
  );
}

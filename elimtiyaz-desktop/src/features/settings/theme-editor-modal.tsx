// ============================================================================
// FILE: src/features/settings/theme-editor-modal.tsx
// ============================================================================

import { useState } from "react";
import { Palette, Check, Sparkles, Sun, Moon } from "lucide-react";
import { UnifiedModal } from "../../shared/ui/unified-modal";
import { Button } from "../../shared/ui/button";
import { Input } from "../../shared/ui/input";
import { Label } from "../../shared/ui/label";
import { Switch } from "../../shared/ui/switch";
import { Badge } from "../../shared/ui/badge";
import { StatusChip } from "../../shared/ui/status-chip";
import {
  PRESET_THEMES,
  type CustomThemePalette,
  type ThemeColors,
} from "../../core/theme/theme-types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialPalette?: CustomThemePalette | null;
  onSave: (palette: CustomThemePalette) => void;
}

export function ThemeEditorModal({
  open,
  onOpenChange,
  initialPalette,
  onSave,
}: Props) {
  const [name, setName] = useState(
    initialPalette?.name ?? "Mon Thème Personnalisé",
  );
  const [isDark, setIsDark] = useState(initialPalette?.isDark ?? true);
  const [colors, setColors] = useState<ThemeColors>(
    initialPalette?.colors ?? { ...PRESET_THEMES[0].colors },
  );

  const updateColor = (key: keyof ThemeColors, value: string) => {
    setColors((prev) => ({ ...prev, [key]: value }));
  };

  const applyPresetTemplate = (preset: CustomThemePalette) => {
    setIsDark(preset.isDark);
    setColors({ ...preset.colors });
  };

  const handleSubmit = () => {
    const id = initialPalette?.isBuiltIn
      ? `custom-${Date.now()}`
      : (initialPalette?.id ?? `custom-${Date.now()}`);

    onSave({
      id,
      name: name.trim() || "Thème Personnalisé",
      isDark,
      isBuiltIn: false,
      colors,
    });
    onOpenChange(false);
  };

  return (
    <UnifiedModal
      open={open}
      onOpenChange={onOpenChange}
      size="xl"
      variant="dialog"
      icon={Palette}
      iconTone="primary"
      title={
        initialPalette
          ? `Modifier : ${initialPalette.name}`
          : "Créateur de Thème Personnalisé"
      }
      description="Personnalisez l'intégralité des couleurs de l'application : boutons, surfaces, textes et alertes."
      submitLabel="Enregistrer et appliquer"
      onSubmit={handleSubmit}
    >
      <div className="space-y-6">
        {/* Theme Name & Dark/Light Base Switch */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end rounded-lg border border-border p-3.5 bg-muted/20">
          <div>
            <Label className="text-xs font-semibold">Nom du Thème</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex. Nuit Polaire, Émeraude Dorée"
              className="mt-1 h-9 text-xs"
            />
          </div>

          <div className="flex items-center justify-between p-2 rounded-md border border-border bg-card">
            <div className="flex items-center gap-2 text-xs">
              {isDark ? (
                <Moon className="h-4 w-4 text-primary" />
              ) : (
                <Sun className="h-4 w-4 text-amber-500" />
              )}
              <span className="font-medium">
                {isDark ? "Base Sombre" : "Base Claire"}
              </span>
            </div>
            <Switch checked={isDark} onCheckedChange={setIsDark} />
          </div>
        </div>

        {/* Quick Template Starters */}
        <div className="space-y-1.5">
          <span className="text-[11px] font-semibold uppercase text-muted-foreground tracking-wider flex items-center gap-1">
            <Sparkles className="h-3 w-3" /> Partir d'une palette de départ :
          </span>
          <div className="flex flex-wrap gap-2">
            {PRESET_THEMES.map((preset) => (
              <Button
                key={preset.id}
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1.5"
                onClick={() => applyPresetTemplate(preset)}
              >
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: preset.colors.primary }}
                />
                {preset.name}
              </Button>
            ))}
          </div>
        </div>

        {/* Live Preview Card */}
        <div
          className="rounded-xl border p-4 space-y-3 transition-colors shadow-sm"
          style={{
            backgroundColor: colors.surfacePanel,
            borderColor: colors.borderColor,
            color: colors.textForeground,
          }}
        >
          <div className="flex items-center justify-between">
            <span
              className="text-xs font-bold uppercase tracking-wider"
              style={{ color: colors.textMuted }}
            >
              Aperçu en temps réel
            </span>
            <Badge
              style={{
                backgroundColor: colors.primary,
                color: colors.primaryForeground,
              }}
            >
              Élément Primaire
            </Badge>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="px-3 py-1.5 rounded-md text-xs font-semibold shadow-sm transition-opacity hover:opacity-90"
              style={{
                backgroundColor: colors.primary,
                color: colors.primaryForeground,
              }}
            >
              Bouton d'Action
            </button>

            <button
              type="button"
              className="px-3 py-1.5 rounded-md text-xs font-medium border"
              style={{
                backgroundColor: colors.surfaceElevated,
                borderColor: colors.borderColor,
                color: colors.textForeground,
              }}
            >
              Bouton Secondaire
            </button>

            <span
              className="px-2 py-0.5 rounded text-[11px] font-bold"
              style={{
                backgroundColor: `${colors.statusSuccess}20`,
                color: colors.statusSuccess,
              }}
            >
              Payé / Validé
            </span>

            <span
              className="px-2 py-0.5 rounded text-[11px] font-bold"
              style={{
                backgroundColor: `${colors.statusDanger}20`,
                color: colors.statusDanger,
              }}
            >
              En retard
            </span>
          </div>

          <div
            className="p-2.5 rounded-md border text-xs"
            style={{
              backgroundColor: colors.surfaceBackground,
              borderColor: colors.borderColor,
              color: colors.textMuted,
            }}
          >
            Zone de contenu textuel avec texte atténué et arrière-plan immersif.
          </div>
        </div>

        {/* Color Configuration Grid */}
        <div className="space-y-4">
          {/* 1. Primary & Brand */}
          <ColorSection title="Couleurs Principales & Accents">
            <ColorPickerRow
              label="Couleur Principale (Boutons, Actions)"
              colorKey="primary"
              value={colors.primary}
              onChange={updateColor}
            />
            <ColorPickerRow
              label="Texte sur Couleur Principale"
              colorKey="primaryForeground"
              value={colors.primaryForeground}
              onChange={updateColor}
            />
            <ColorPickerRow
              label="Accent Or / Secondaire"
              colorKey="brandGold"
              value={colors.brandGold}
              onChange={updateColor}
            />
            <ColorPickerRow
              label="Accent Cyan"
              colorKey="brandCyan"
              value={colors.brandCyan}
              onChange={updateColor}
            />
            <ColorPickerRow
              label="Accent Violet"
              colorKey="brandViolet"
              value={colors.brandViolet}
              onChange={updateColor}
            />
          </ColorSection>

          {/* 2. Surfaces & Backgrounds */}
          <ColorSection title="Fonds & Surfaces">
            <ColorPickerRow
              label="Arrière-plan Global (Canvas)"
              colorKey="surfaceBackground"
              value={colors.surfaceBackground}
              onChange={updateColor}
            />
            <ColorPickerRow
              label="Cartes & Panneaux (Panels)"
              colorKey="surfacePanel"
              value={colors.surfacePanel}
              onChange={updateColor}
            />
            <ColorPickerRow
              label="Surfaces Surélevées (Modales)"
              colorKey="surfaceElevated"
              value={colors.surfaceElevated}
              onChange={updateColor}
            />
            <ColorPickerRow
              label="Surfaces au Survol (Hover)"
              colorKey="surfaceHover"
              value={colors.surfaceHover}
              onChange={updateColor}
            />
          </ColorSection>

          {/* 3. Text & Borders */}
          <ColorSection title="Textes & Bordures">
            <ColorPickerRow
              label="Texte Principal"
              colorKey="textForeground"
              value={colors.textForeground}
              onChange={updateColor}
            />
            <ColorPickerRow
              label="Texte Atténué / Secondaire"
              colorKey="textMuted"
              value={colors.textMuted}
              onChange={updateColor}
            />
            <ColorPickerRow
              label="Bordures & Séparateurs"
              colorKey="borderColor"
              value={colors.borderColor}
              onChange={updateColor}
            />
          </ColorSection>

          {/* 4. Status Colors */}
          <ColorSection title="Couleurs d'Alerte & Statuts">
            <ColorPickerRow
              label="Succès (Paiements, Présents)"
              colorKey="statusSuccess"
              value={colors.statusSuccess}
              onChange={updateColor}
            />
            <ColorPickerRow
              label="Avertissement (Tranches, Échéances)"
              colorKey="statusWarning"
              value={colors.statusWarning}
              onChange={updateColor}
            />
            <ColorPickerRow
              label="Danger (Impayés, Retards)"
              colorKey="statusDanger"
              value={colors.statusDanger}
              onChange={updateColor}
            />
            <ColorPickerRow
              label="Information"
              colorKey="statusInfo"
              value={colors.statusInfo}
              onChange={updateColor}
            />
          </ColorSection>
        </div>
      </div>
    </UnifiedModal>
  );
}

function ColorSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border/70 p-3 space-y-2.5 bg-surface-elevated/20">
      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
        {title}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{children}</div>
    </div>
  );
}

function ColorPickerRow({
  label,
  colorKey,
  value,
  onChange,
}: {
  label: string;
  colorKey: keyof ThemeColors;
  value: string;
  onChange: (key: keyof ThemeColors, val: string) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 p-1.5 rounded-md border border-border/50 bg-card">
      <span
        className="text-xs font-medium text-foreground truncate"
        title={label}
      >
        {label}
      </span>
      <div className="flex items-center gap-2 shrink-0">
        <input
          type="color"
          value={
            value.startsWith("#") && value.length === 7 ? value : "#349bd4"
          }
          onChange={(e) => onChange(colorKey, e.target.value)}
          className="h-7 w-7 rounded cursor-pointer border-0 bg-transparent p-0"
        />
        <Input
          value={value}
          onChange={(e) => onChange(colorKey, e.target.value)}
          className="h-7 w-20 font-mono text-[11px] uppercase text-center px-1"
        />
      </div>
    </div>
  );
}

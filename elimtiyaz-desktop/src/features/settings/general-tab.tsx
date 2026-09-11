// ============================================================================
// FILE: src/features/settings/general-tab.tsx
// ============================================================================

import { useState } from "react";
import {
  useUserPreferences,
  type AppLocale,
} from "../../app/providers/user-preferences-provider";
import { useAuth } from "../../app/providers/auth-provider";
import { ROLE_LABELS_FR } from "../../core/rbac/roles";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../../shared/ui/card";
import { Label } from "../../shared/ui/label";
import { Button } from "../../shared/ui/button";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "../../shared/ui/select";
import {
  Globe,
  UserCircle,
  LogOut,
  RotateCcw,
  Palette,
  Plus,
  Trash2,
  Pencil,
  Check,
} from "lucide-react";
import { useToast } from "../../app/providers/toast-provider";
import {
  PRESET_THEMES,
  type CustomThemePalette,
} from "../../core/theme/theme-types";
import { ThemeEditorModal } from "./theme-editor-modal";

const TIMEZONES = [
  { value: "Africa/Algiers", label: "Alger (Africa/Algiers)" },
  { value: "Africa/Casablanca", label: "Casablanca (Africa/Casablanca)" },
  { value: "Europe/Paris", label: "Paris (Europe/Paris)" },
  { value: "UTC", label: "UTC" },
];

const CURRENCIES = [
  { value: "DZD", label: "Dinar algérien (DZD)" },
  { value: "EUR", label: "Euro (EUR)" },
  { value: "USD", label: "Dollar américain (USD)" },
];

export function GeneralTab() {
  const {
    theme,
    setTheme,
    locale,
    setLocale,
    timezone,
    setTimezone,
    currency,
    setCurrency,
    customThemes,
    saveCustomTheme,
    deleteCustomTheme,
    reset,
  } = useUserPreferences();
  const { session, signOut } = useAuth();
  const toast = useToast();

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingTheme, setEditingTheme] = useState<CustomThemePalette | null>(
    null,
  );

  const allThemes: CustomThemePalette[] = [...PRESET_THEMES, ...customThemes];

  const handleOpenCreate = () => {
    setEditingTheme(null);
    setEditorOpen(true);
  };

  const handleOpenEdit = (palette: CustomThemePalette, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingTheme(palette);
    setEditorOpen(true);
  };

  const handleDelete = (paletteId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    deleteCustomTheme(paletteId);
    toast.showSuccess("Thème supprimé", "Le thème personnalisé a été retiré.");
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* ───── 1. Dynamic Theme Studio & Customizer ───── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Palette className="h-4 w-4 text-primary" />
              Thèmes &amp; Apparence Personnalisée
            </CardTitle>
            <CardDescription>
              Sélectionnez un thème officiel ou créez votre propre palette de
              couleurs sur mesure.
            </CardDescription>
          </div>
          <Button
            size="sm"
            onClick={handleOpenCreate}
            className="h-8 gap-1 text-xs"
          >
            <Plus className="h-3.5 w-3.5" /> Créer un thème
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {allThemes.map((pal) => {
              const isActive = theme === pal.id;
              return (
                <div
                  key={pal.id}
                  onClick={() => setTheme(pal.id)}
                  className={`relative rounded-xl border p-3.5 cursor-pointer transition-all flex flex-col justify-between gap-3 ${
                    isActive
                      ? "border-primary bg-primary/10 ring-2 ring-primary/40 shadow-sm"
                      : "border-border hover:border-primary/40 bg-surface-panel/40"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-xs text-foreground">
                          {pal.name}
                        </span>
                        {isActive && (
                          <Check className="h-3.5 w-3.5 text-primary" />
                        )}
                      </div>
                      <span className="text-[10px] text-muted-foreground block mt-0.5">
                        {pal.isDark ? "Fond Sombre" : "Fond Clair"}{" "}
                        {pal.isBuiltIn ? "• Intégré" : "• Personnalisé"}
                      </span>
                    </div>

                    {!pal.isBuiltIn && (
                      <div className="flex items-center gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6 text-muted-foreground hover:text-foreground"
                          onClick={(e) => handleOpenEdit(pal, e)}
                          title="Modifier les couleurs"
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6 text-status-danger hover:bg-status-danger/10"
                          onClick={(e) => handleDelete(pal.id, e)}
                          title="Supprimer"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    )}
                  </div>

                  {/* Swatches preview */}
                  <div
                    className="flex items-center gap-1.5 rounded-lg p-2 border border-border/50"
                    style={{ backgroundColor: pal.colors.surfacePanel }}
                  >
                    <span
                      className="h-4 w-4 rounded-full border border-black/20"
                      style={{ backgroundColor: pal.colors.primary }}
                      title="Primaire"
                    />
                    <span
                      className="h-4 w-4 rounded-full border border-black/20"
                      style={{ backgroundColor: pal.colors.surfaceBackground }}
                      title="Fond"
                    />
                    <span
                      className="h-4 w-4 rounded-full border border-black/20"
                      style={{ backgroundColor: pal.colors.brandGold }}
                      title="Accent Or"
                    />
                    <span
                      className="h-4 w-4 rounded-full border border-black/20"
                      style={{ backgroundColor: pal.colors.statusSuccess }}
                      title="Succès"
                    />
                    <span
                      className="h-4 w-4 rounded-full border border-black/20"
                      style={{ backgroundColor: pal.colors.statusDanger }}
                      title="Danger"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* ───── 2. Langue & Région ───── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Globe className="h-4 w-4 text-primary" />
            Langue &amp; Région
          </CardTitle>
          <CardDescription>
            La langue est appliquée instantanément. Le passage à l'arabe active
            la disposition RTL.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <Label className="text-xs font-semibold">Langue</Label>
              <p className="text-[11px] text-muted-foreground">
                Direction LTR / RTL
              </p>
            </div>
            <Select
              value={locale}
              onValueChange={(v) => setLocale(v as AppLocale)}
            >
              <SelectTrigger className="w-48 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fr">Français</SelectItem>
                <SelectItem value="ar">العربية (Arabe)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <Label className="text-xs font-semibold">Fuseau horaire</Label>
              <p className="text-[11px] text-muted-foreground">
                Horodatages des transactions
              </p>
            </div>
            <Select value={timezone} onValueChange={setTimezone}>
              <SelectTrigger className="w-56 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIMEZONES.map((tz) => (
                  <SelectItem key={tz.value} value={tz.value}>
                    {tz.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <Label className="text-xs font-semibold">Devise</Label>
              <p className="text-[11px] text-muted-foreground">
                Devise monétaire par défaut
              </p>
            </div>
            <Select value={currency} onValueChange={setCurrency}>
              <SelectTrigger className="w-56 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CURRENCIES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* ───── 3. Session & Compte ───── */}
      {session && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <UserCircle className="h-4 w-4 text-primary" />
              Session
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-0.5 text-xs">
              <p className="font-semibold text-foreground">
                {session.displayName}
              </p>
              <p className="text-muted-foreground font-mono">
                {session.email} • {ROLE_LABELS_FR[session.role]}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => signOut()}>
                <LogOut className="h-3.5 w-3.5 mr-1" /> Déconnexion
              </Button>
              <Button variant="ghost" size="sm" onClick={() => reset()}>
                <RotateCcw className="h-3.5 w-3.5 mr-1" /> Réinitialiser
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Theme Creator / Color Customizer Dialog */}
      <ThemeEditorModal
        open={editorOpen}
        onOpenChange={setEditorOpen}
        initialPalette={editingTheme}
        onSave={(palette) => {
          saveCustomTheme(palette);
          toast.showSuccess(
            "Thème appliqué",
            `Le thème « ${palette.name} » a été activé.`,
          );
        }}
      />
    </div>
  );
}

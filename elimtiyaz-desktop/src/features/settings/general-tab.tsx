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
import { DangerZoneCard } from "./danger-zone-card";
import { TooltipHint } from "../../shared/ui/tooltip";
import { Role } from "../../core/rbac/roles";
// T-627 (C-25): the tenant-settings seam — the custom-palette list is
// TENANT BRANDING (every staff member reads/selects; super_admin edits).
import { useRepositories } from "../../app/providers/repository-provider";
import { isSupabaseConfigured } from "../../infrastructure/supabase/backend-access";

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
  const repos = useRepositories();

  // T-627 (C-25): the custom palettes are TENANT BRANDING. Every staff
  // member READS and SELECTS them (the card list + clicks stay live for
  // all); the EDITOR (create/modify/delete) gates to super_admin in
  // Supabase mode (the tenant write path — save_public_setting — is
  // super_admin-gated server-side; gating here makes the UI honest about
  // it instead of failing at the save). In mock/offline mode the editor
  // stays open to every operator exactly as before.
  const isTenantMode = isSupabaseConfigured();
  const canEditThemes = !isTenantMode || session?.role === Role.SuperAdmin;

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingTheme, setEditingTheme] = useState<CustomThemePalette | null>(
    null,
  );

  const allThemes: CustomThemePalette[] = [...PRESET_THEMES, ...customThemes];

  // T-627: mirror the FULL merged list to the tenant row after a local
  // save/delete (the tenant write is the sync — the device change is
  // already committed; a failed mirror surfaces an honest toast, never a
  // silent divergence).
  async function mirrorThemesToTenant(next: CustomThemePalette[], what: string) {
    if (!isTenantMode) return;
    const r = await repos.tenantSettings.saveCustomThemes(next);
    if (!r.ok) {
      toast.showError(
        "Synchronisation de l'établissement échouée",
        `Le thème est enregistré sur cet appareil, mais ${what} n'a pas été synchronisé — ${r.error.userMessage}`,
      );
    }
  }

  const handleOpenCreate = () => {
    if (!canEditThemes) return;
    setEditingTheme(null);
    setEditorOpen(true);
  };

  const handleOpenEdit = (palette: CustomThemePalette, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!canEditThemes) return;
    setEditingTheme(palette);
    setEditorOpen(true);
  };

  const handleDelete = async (paletteId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!canEditThemes) return;
    deleteCustomTheme(paletteId);
    toast.showSuccess("Thème supprimé", "Le thème personnalisé a été retiré.");
    await mirrorThemesToTenant(
      customThemes.filter((t) => t.id !== paletteId),
      "la suppression",
    );
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
          {canEditThemes ? (
            <Button
              size="sm"
              onClick={handleOpenCreate}
              className="h-8 gap-1 text-xs"
            >
              <Plus className="h-3.5 w-3.5" /> Créer un thème
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">
              La palette de l'établissement est gérée par le Super
              Administrateur.
            </span>
          )}
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

                    {!pal.isBuiltIn && canEditThemes && (
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
                    <TooltipHint content="Primaire"><span
                      className="h-4 w-4 rounded-full border border-black/20"
                      style={{ backgroundColor: pal.colors.primary }}
                    /></TooltipHint>
                    <TooltipHint content="Fond"><span
                      className="h-4 w-4 rounded-full border border-black/20"
                      style={{ backgroundColor: pal.colors.surfaceBackground }}
                    /></TooltipHint>
                    <TooltipHint content="Accent Or"><span
                      className="h-4 w-4 rounded-full border border-black/20"
                      style={{ backgroundColor: pal.colors.brandGold }}
                    /></TooltipHint>
                    <TooltipHint content="Succès"><span
                      className="h-4 w-4 rounded-full border border-black/20"
                      style={{ backgroundColor: pal.colors.statusSuccess }}
                    /></TooltipHint>
                    <TooltipHint content="Danger"><span
                      className="h-4 w-4 rounded-full border border-black/20"
                      style={{ backgroundColor: pal.colors.statusDanger }}
                    /></TooltipHint>
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

      {/* ───── 4. Zone de danger (T-416 / issue #12 — the domain purge;
           super-admin only; the card itself returns null for other roles) ───── */}
      <DangerZoneCard />

      {/* Theme Creator / Color Customizer Dialog */}
      <ThemeEditorModal
        open={editorOpen}
        onOpenChange={setEditorOpen}
        initialPalette={editingTheme}
        onSave={async (palette) => {
          saveCustomTheme(palette);
          toast.showSuccess(
            "Thème appliqué",
            `Le thème « ${palette.name} » a été activé.`,
          );
          // T-627: the tenant mirror — the full merged list through the seam.
          const idx = customThemes.findIndex((t) => t.id === palette.id);
          const next =
            idx >= 0
              ? customThemes.map((t, i) => (i === idx ? palette : t))
              : [...customThemes, palette];
          await mirrorThemesToTenant(next, "le nouveau thème");
        }}
      />
    </div>
  );
}

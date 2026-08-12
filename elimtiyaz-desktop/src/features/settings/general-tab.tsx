/**
 * GeneralTab — Settings → Général
 *
 * Iteration 15 redesign: every control is now fully functional.
 *
 * Before this iteration, this tab was 100% decorative — three cards with
 * static `<Badge>` elements showing the theme, language, and a hardcoded
 * tenant string. None of them actually did anything.
 *
 * Now the tab is the SINGLE source of truth for client-side preferences
 * (theme, locale, timezone, currency) plus a read-only tenant card that
 * reads the real `session.tenantId`. The preferences state is shared
 * with the Topbar's LanguageSwitcher via UserPreferencesContext.
 *
 * The previous "Configuration" tab (configuration-tab.tsx) ALSO had
 * cards for timezone + currency + locale, which duplicated this tab.
 * Those server-side `system_settings` rows still exist (they drive
 * server-side defaults for new tenants), but the GeneralTab is now the
 * only place the user edits them.
 *
 * Sections:
 *   1. Apparence — theme (dark/light)
 *   2. Langue & Région — locale (fr/ar), timezone, currency
 *   3. Tenant — read-only display of the current tenant
 *   4. Session — current session info (display name, role, sign-out)
 */
import { useTranslation } from "react-i18next";
import { useUserPreferences, type AppTheme, type AppLocale } from "../../app/providers/user-preferences-provider";
import { useAuth } from "../../app/providers/auth-provider";
import { ROLE_LABELS_FR } from "../../core/rbac/roles";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../shared/ui/card";
import { Label } from "../../shared/ui/label";
import { Badge } from "../../shared/ui/badge";
import { Button } from "../../shared/ui/button";
import { Switch } from "../../shared/ui/switch";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "../../shared/ui/select";
import { StatusChip } from "../../shared/ui/status-chip";
import { Moon, Sun, Globe, Clock, Coins, Building2, UserCircle, LogOut, RotateCcw } from "lucide-react";
import { useToast } from "../../app/providers/toast-provider";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const TIMEZONES: Array<{ value: string; label: string }> = [
  { value: "Africa/Algiers", label: "Alger (Africa/Algiers)" },
  { value: "Africa/Casablanca", label: "Casablanca (Africa/Casablanca)" },
  { value: "Africa/Tunis", label: "Tunis (Africa/Tunis)" },
  { value: "Europe/Paris", label: "Paris (Europe/Paris)" },
  { value: "Europe/London", label: "Londres (Europe/London)" },
  { value: "Asia/Dubai", label: "Dubaï (Asia/Dubai)" },
  { value: "UTC", label: "UTC" },
];

const CURRENCIES: Array<{ value: string; label: string }> = [
  { value: "DZD", label: "Dinar algérien (DZD)" },
  { value: "MAD", label: "Dirham marocain (MAD)" },
  { value: "TND", label: "Dinar tunisien (TND)" },
  { value: "EUR", label: "Euro (EUR)" },
  { value: "USD", label: "Dollar américain (USD)" },
];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function GeneralTab() {
  const { t } = useTranslation();
  const {
    theme, setTheme,
    locale, setLocale,
    timezone, setTimezone,
    currency, setCurrency,
    reset,
  } = useUserPreferences();
  const { session, signOut } = useAuth();
  const toast = useToast();

  const handleReset = () => {
    reset();
    toast.showSuccess("Préférences réinitialisées", "Thème, langue, fuseau horaire et devise remis aux valeurs par défaut.");
  };

  const handleSignOut = async () => {
    await signOut();
    toast.showSuccess("Déconnexion réussie", "À bientôt.");
  };

  return (
    <div className="space-y-6 max-w-3xl">
      {/* ───── Apparence ───── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Sun className="h-4 w-4 text-primary" />
            {t("settings.appearance")}
          </CardTitle>
          <CardDescription>
            Le thème est appliqué immédiatement à toute l'application. Le thème sombre est recommandé pour les longues heures opérationnelles.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3">
            <ThemeCard
              active={theme === "dark"}
              onClick={() => setTheme("dark")}
              icon={Moon}
              label="Sombre"
              description="Fond sombre, texte clair"
            />
            <ThemeCard
              active={theme === "light"}
              onClick={() => setTheme("light")}
              icon={Sun}
              label="Clair"
              description="Fond clair, texte sombre"
            />
          </div>
        </CardContent>
      </Card>

      {/* ───── Langue & Région ───── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Globe className="h-4 w-4 text-primary" />
            Langue &amp; Région
          </CardTitle>
          <CardDescription>
            La langue est appliquée immédiatement. Le passage à l'arabe bascule l'interface en RTL (de droite à gauche).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <LocaleRow label="Langue de l'interface" hint="Applique la direction du texte (LTR/RTL)">
            <Select value={locale} onValueChange={(v) => setLocale(v as AppLocale)}>
              <SelectTrigger className="w-full sm:w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fr">Français</SelectItem>
                <SelectItem value="ar">العربية (Arabe)</SelectItem>
              </SelectContent>
            </Select>
          </LocaleRow>

          <LocaleRow label="Fuseau horaire" hint="Utilisé pour les horodatages affichés">
            <Select value={timezone} onValueChange={setTimezone}>
              <SelectTrigger className="w-full sm:w-72">
                <span className="flex items-center gap-2">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                  <SelectValue />
                </span>
              </SelectTrigger>
              <SelectContent>
                {TIMEZONES.map((tz) => (
                  <SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </LocaleRow>

          <LocaleRow label="Devise" hint="Devise utilisée pour les montants financiers">
            <Select value={currency} onValueChange={setCurrency}>
              <SelectTrigger className="w-full sm:w-72">
                <span className="flex items-center gap-2">
                  <Coins className="h-3.5 w-3.5 text-muted-foreground" />
                  <SelectValue />
                </span>
              </SelectTrigger>
              <SelectContent>
                {CURRENCIES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </LocaleRow>
        </CardContent>
      </Card>

      {/* ───── Tenant ───── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Building2 className="h-4 w-4 text-primary" />
            Tenant
          </CardTitle>
          <CardDescription>
            Identifiant du tenant courant. La multi-location est gérée via Supabase RLS — chaque utilisateur ne voit que les données de son propre tenant.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2">
            <span className="text-xs uppercase text-muted-foreground">ID Tenant</span>
            <code className="text-xs font-mono text-foreground">
              {session?.tenantId ?? "—"}
            </code>
          </div>
          <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2">
            <span className="text-xs uppercase text-muted-foreground">Mode backend</span>
            <StatusChip
              label={isBackendSupabase() ? "Supabase" : "Mock"}
              tone={isBackendSupabase() ? "success" : "info"}
            />
          </div>
        </CardContent>
      </Card>

      {/* ───── Session ───── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <UserCircle className="h-4 w-4 text-primary" />
            Session courante
          </CardTitle>
          <CardDescription>
            Informations sur l'utilisateur connecté. La déconnexion ferme immédiatement la session.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {session ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <InfoBlock label="Nom" value={session.displayName} />
                <InfoBlock label="Email" value={session.email} mono />
                <InfoBlock label="Rôle" value={ROLE_LABELS_FR[session.role] ?? session.role} />
                <InfoBlock label="ID Utilisateur" value={session.userId} mono />
              </div>
              <div className="flex flex-wrap gap-2 pt-2">
                <Button variant="outline" onClick={handleSignOut}>
                  <LogOut className="h-4 w-4 mr-2" />
                  Se déconnecter
                </Button>
                <Button variant="ghost" onClick={handleReset} className="ml-auto">
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Réinitialiser les préférences
                </Button>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Aucune session active.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function ThemeCard({
  active, onClick, icon: Icon, label, description,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Moon;
  label: string;
  description: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-start gap-2 rounded-lg border p-3 text-left transition-all ${
        active
          ? "border-primary bg-primary/5 ring-1 ring-primary/20"
          : "border-border hover:border-primary/40 hover:bg-accent/5"
      }`}
      aria-pressed={active}
    >
      <div className={`flex h-9 w-9 items-center justify-center rounded-md ${active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {active && (
        <Badge variant="default" className="bg-primary text-primary-foreground">Actif</Badge>
      )}
    </button>
  );
}

function LocaleRow({
  label, hint, children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
      <div className="space-y-0.5">
        <Label className="text-sm font-medium">{label}</Label>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <div className="w-full sm:w-auto">{children}</div>
    </div>
  );
}

function InfoBlock({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
      <p className="text-[10px] uppercase text-muted-foreground">{label}</p>
      <p className={`text-sm text-foreground truncate ${mono ? "font-mono" : ""}`} title={value}>{value}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/**
 * Read whether the backend is in Supabase mode WITHOUT triggering a
 * React hook (so this can be called inside a render without polluting
 * the dependency tree). Falls back to "mock" if the value is absent.
 */
function isBackendSupabase(): boolean {
  try {
    const raw = localStorage.getItem("el-imtiyaz.local-config");
    if (!raw) return false;
    const cfg = JSON.parse(raw) as { supabase_use_supabase?: boolean };
    return cfg.supabase_use_supabase === true;
  } catch {
    return false;
  }
}

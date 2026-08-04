/**
 * LanguageSwitcher — iteration 7 (P3-O), updated iteration 15.
 *
 * Topbar dropdown that switches the application language between
 * French (default) and Arabic (RTL).
 *
 * Iteration 15: language state now lives in the unified
 * `UserPreferencesContext` (app/providers/user-preferences-provider.tsx) so the
 * Settings → General tab and this Topbar dropdown stay in sync. The
 * legacy `localStorage["el-imtiyaz:locale"]` key is still mirrored by
 * the provider for backward compatibility with any external readers.
 */
import { useState } from "react";
import { useUserPreferences, type AppLocale } from "../app/providers/user-preferences-provider";
import { Globe, Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../shared/ui/dropdown-menu";

const LOCALE_LABELS: Record<AppLocale, { label: string; native: string; flag: string }> = {
  fr: { label: "Français", native: "Français", flag: "FR" },
  ar: { label: "Arabic", native: "العربية", flag: "AR" },
};

export function LanguageSwitcher() {
  const { locale, setLocale } = useUserPreferences();
  const [open, setOpen] = useState(false);
  const current: AppLocale = locale;

  const handleChange = (next: AppLocale) => {
    setLocale(next);
    setOpen(false);
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-9 items-center gap-1.5 rounded-md px-2 text-muted-foreground transition-colors hover:bg-accent/10 hover:text-foreground"
          aria-label="Changer de langue"
          title="Langue"
        >
          <Globe className="h-4 w-4" />
          <span className="hidden text-xs font-medium sm:inline">
            {LOCALE_LABELS[current]?.flag ?? "FR"}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>Langue</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {(Object.keys(LOCALE_LABELS) as AppLocale[]).map((l) => (
          <DropdownMenuItem
            key={l}
            onClick={() => handleChange(l)}
            className="flex items-center justify-between"
          >
            <span className="flex items-center gap-2">
              <span className="w-8 text-xs font-mono text-muted-foreground">
                {LOCALE_LABELS[l].flag}
              </span>
              <span className="text-sm">{LOCALE_LABELS[l].native}</span>
            </span>
            {current === l && <Check className="h-4 w-4 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * LanguageSwitcher — iteration 7 (P3-O).
 *
 * Topbar dropdown that switches the application language between
 * French (default), Arabic (RTL), and English (reserved).
 *
 * On change:
 *   1. Calls `i18n.changeLanguage(locale)`
 *   2. Sets `document.documentElement.dir` to "rtl" or "ltr"
 *   3. Sets `document.documentElement.lang`
 *   4. Persists the choice to `localStorage["el-imtiyaz:locale"]`
 *
 * The dir attribute is what every RTL-aware CSS property in the app
 * keys off of (Tailwind's `ms-*`/`me-*`/`start-*`/`end-*` utilities,
 * plus our custom `border-s`/`border-e` etc.).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Globe, Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { cn } from "../ui/cn";

export type AppLocale = "fr" | "ar";

const LOCALE_LABELS: Record<AppLocale, { label: string; native: string; flag: string }> = {
  fr: { label: "Français", native: "Français", flag: "FR" },
  ar: { label: "Arabic", native: "العربية", flag: "AR" },
};

const LOCALE_STORAGE_KEY = "el-imtiyaz:locale";

export function getStoredLocale(): AppLocale {
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored === "fr" || stored === "ar") return stored;
  } catch {
    // ignore
  }
  return "fr";
}

export function applyLocale(locale: AppLocale): void {
  const dir = locale === "ar" ? "rtl" : "ltr";
  document.documentElement.dir = dir;
  document.documentElement.lang = locale;
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // ignore
  }
}

/** Initialize locale on app startup. Safe to call multiple times. */
export function initLocale(): void {
  const locale = getStoredLocale();
  applyLocale(locale);
}

export function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const current = (i18n.language as AppLocale) ?? "fr";

  const handleChange = (locale: AppLocale) => {
    void i18n.changeLanguage(locale);
    applyLocale(locale);
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
        {(Object.keys(LOCALE_LABELS) as AppLocale[]).map((locale) => (
          <DropdownMenuItem
            key={locale}
            onClick={() => handleChange(locale)}
            className="flex items-center justify-between"
          >
            <span className="flex items-center gap-2">
              <span className="w-8 text-xs font-mono text-muted-foreground">
                {LOCALE_LABELS[locale].flag}
              </span>
              <span className="text-sm">{LOCALE_LABELS[locale].native}</span>
            </span>
            {current === locale && <Check className="h-4 w-4 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * App topbar — global search (Cmd+K), alerts bell, language switcher,
 * quick backup, profile menu.
 *
 * Persistent across all hub pages. The search opens a command palette
 * (Cmd+K / Ctrl+K) for cross-entity navigation across 6 indexes:
 * parents, students, payments, expenses, audit entries, and personnel.
 *
 * Iteration 7 changes:
 *   - The Cmd+K palette now uses UnifiedModal variant="command-palette",
 *     eliminating the last raw <Dialog> exception in the codebase.
 *   - The search index now covers 6 entity types (was 2).
 *   - Recent searches are persisted to localStorage (max 8) and surfaced
 *     when the palette is opened with an empty query.
 *   - A language switcher is added between alerts and quick-backup.
 *   - All physical CSS properties (right-4, ml-auto) replaced with
 *     logical equivalents (end-4, ms-auto) for RTL support.
 */
import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Search,
  Bell,
  Database,
  User as UserIcon,
  UserCircle,
  LogOut,
  Settings as SettingsIcon,
  Command,
  Clock,
  Trash2,
  Wallet,
  Receipt,
  ScrollText,
  BookUser,
} from "lucide-react";
import { useAuth } from "../../state/auth-context";
import { useRepositories } from "../../infrastructure/repository-provider";
import { ROLE_LABELS_FR } from "../../core/rbac/roles";
import { formatRelative } from "../../core/format/date";
import { NOTIFICATION_TYPE_LABELS_FR } from "../../domain/model/operations";
import { Avatar, AvatarFallback } from "../ui/avatar";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Badge } from "../ui/badge";
import { StatusChip } from "./status-chip";
import { UnifiedModal } from "./unified-modal";
import { LanguageSwitcher } from "./language-switcher";
import { cn } from "../ui/cn";
import {
  makeSearchIndex,
  loadRecentSearches,
  saveRecentSearch,
  clearRecentSearches,
  type SearchResult,
  type SearchResultType,
  type RecentSearch,
} from "../search/search-index";

const RESULT_TYPE_META: Record<SearchResultType, { label: string; icon: typeof UserIcon }> = {
  parent: { label: "Parents", icon: UserIcon },
  student: { label: "Élèves", icon: UserIcon },
  payment: { label: "Paiements", icon: Wallet },
  expense: { label: "Dépenses", icon: Receipt },
  audit: { label: "Audit", icon: ScrollText },
  personnel: { label: "Personnel", icon: BookUser },
};

export function Topbar() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { session, signOut } = useAuth();
  const repos = useRepositories();
  const [searchOpen, setSearchOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [recentSearches, setRecentSearches] = useState<RecentSearch[]>([]);
  const [notifications, setNotifications] = useState<
    { id: string; type: string; title: string; body: string; readAt: string | null; createdAt: string }[]
  >([]);

  const searchIndex = useMemo(() => makeSearchIndex(repos), [repos]);
  const unreadCount = useMemo(() => notifications.filter((n) => !n.readAt).length, [notifications]);

  // Subscribe to notifications
  useEffect(() => {
    const unsub = repos.notifications.observe().subscribe((items) => {
      setNotifications([...items].slice(0, 8));
    });
    return unsub;
  }, [repos.notifications]);

  // Cmd+K / Ctrl+K shortcut
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((s) => !s);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Refresh recent searches whenever the palette opens
  useEffect(() => {
    if (searchOpen) {
      setRecentSearches(loadRecentSearches());
    }
  }, [searchOpen]);

  // Debounced search across all 6 indexes
  useEffect(() => {
    if (!searchOpen) return;
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      const results = await searchIndex.search(q);
      setSearchResults(results);
    }, 200);
    return () => clearTimeout(timer);
  }, [searchQuery, searchOpen, searchIndex]);

  const handleResultClick = (result: SearchResult | RecentSearch) => {
    saveRecentSearch({
      type: result.type,
      id: result.id,
      label: result.label,
      subtitle: result.subtitle,
      route: result.route,
    });
    navigate(result.route);
    setSearchOpen(false);
    setSearchQuery("");
  };

  if (!session) return null;
  const initials = session.displayName
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <>
      <header
        className="flex h-[var(--topbar-height)] shrink-0 items-center gap-3 border-b border-border bg-surface-panel px-4"
      >
        {/* Search trigger */}
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          className="group flex h-9 w-full max-w-md items-center gap-2 rounded-md border border-border bg-muted/30 px-3 text-sm text-muted-foreground transition-colors hover:border-primary/50"
        >
          <Search className="h-4 w-4" />
          <span className="flex-1 text-start">Rechercher…</span>
          <kbd className="flex items-center gap-0.5 rounded border border-border bg-popover px-1.5 py-0.5 text-[10px] font-mono">
            <Command className="h-3 w-3" />K
          </kbd>
        </button>

        <div className="flex-1" />

        {/* Alerts */}
        <DropdownMenu open={alertsOpen} onOpenChange={setAlertsOpen}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="relative flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/10 hover:text-foreground"
              aria-label="Alertes"
            >
              <Bell className="h-4 w-4" />
              {unreadCount > 0 && (
                <span className="absolute end-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-status-danger px-1 text-[9px] font-bold text-white">
                  {unreadCount}
                </span>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            <DropdownMenuLabel className="flex items-center justify-between">
              <span>{t("dashboard.alerts")}</span>
              {unreadCount > 0 && <Badge variant="danger">{unreadCount} non lues</Badge>}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {notifications.length === 0 ? (
              <div className="px-2 py-6 text-center text-xs text-muted-foreground">
                {t("common.noData")}
              </div>
            ) : (
              notifications.map((n) => (
                <DropdownMenuItem
                  key={n.id}
                  className="flex flex-col items-start gap-1 py-2"
                  onClick={async () => {
                    await repos.notifications.markRead(n.id);
                  }}
                >
                  <div className="flex w-full items-center justify-between gap-2">
                    <span className="text-xs font-medium text-foreground">{n.title}</span>
                    {!n.readAt && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2">{n.body}</p>
                  <span className="text-[10px] text-muted-foreground">
                    {formatRelative(n.createdAt)}
                  </span>
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Language switcher — iteration 7 (P3-O) */}
        <LanguageSwitcher />

        {/* Quick backup (links to Settings → Backup tab) */}
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-foreground"
          title="Sauvegardes"
          onClick={() => navigate("/settings?tab=backup")}
        >
          <Database className="h-4 w-4" />
        </Button>

        {/* Profile */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-2 rounded-md p-1 transition-colors hover:bg-accent/10"
            >
              <Avatar className="h-7 w-7">
                <AvatarFallback>{initials}</AvatarFallback>
              </Avatar>
              <div className="hidden md:flex flex-col items-start leading-tight">
                <span className="text-xs font-medium text-foreground">{session.displayName}</span>
                <span className="text-[10px] text-muted-foreground">
                  {ROLE_LABELS_FR[session.role]}
                </span>
              </div>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium text-foreground">{session.displayName}</span>
                <span className="text-xs text-muted-foreground font-mono">{session.email}</span>
                <div className="mt-1">
                  <StatusChip
                    label={ROLE_LABELS_FR[session.role]}
                    tone={session.role === "super_admin" ? "info" : "neutral"}
                  />
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate("/profile")}>
              <UserCircle className="h-4 w-4" /> Mon profil
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate("/settings")}>
              <SettingsIcon className="h-4 w-4" /> {t("nav.settings")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={async () => {
                await signOut();
                navigate("/login");
              }}
              className="text-status-danger focus:text-status-danger"
            >
              <LogOut className="h-4 w-4" /> {t("auth.signOut")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      {/* Command palette — iteration 7: now uses UnifiedModal variant="command-palette".
          This eliminates the last raw <Dialog> exception in the codebase.
          The visual chrome (overlay, animation, ESC behavior, backdrop click)
          is now provided by UnifiedModal — the only call-site-specific code is
          the search input header and the results list. */}
      <UnifiedModal
        open={searchOpen}
        onOpenChange={(o) => {
          setSearchOpen(o);
          if (!o) setSearchQuery("");
        }}
        variant="command-palette"
        size="lg"
        title={<span className="sr-only">{t("common.search")}</span>}
        header={
          <div className="flex items-center gap-2 p-4">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input
              autoFocus
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Rechercher dans toute l'application…"
              className="border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
            />
            <kbd className="flex items-center gap-0.5 rounded border border-border bg-muted/50 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
              ESC
            </kbd>
          </div>
        }
        bodyClassName="p-0"
        hideFooter
        hideCloseButton
      >
        <div className="max-h-[60vh] overflow-y-auto p-2">
          {searchQuery.trim() === "" ? (
            recentSearches.length > 0 ? (
              <div>
                <div className="flex items-center justify-between px-3 py-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Recherches récentes
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      clearRecentSearches();
                      setRecentSearches([]);
                    }}
                    className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
                  >
                    <Trash2 className="h-3 w-3" /> Effacer
                  </button>
                </div>
                {recentSearches.map((r) => (
                  <ResultRow
                    key={`${r.type}-${r.id}-${r.at}`}
                    icon={RESULT_TYPE_META[r.type].icon}
                    label={r.label}
                    subtitle={r.subtitle}
                    meta={formatRelative(new Date(r.at).toISOString())}
                    onClick={() => handleResultClick(r)}
                  />
                ))}
              </div>
            ) : (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                Tapez pour rechercher dans toute l'application.
                <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5 text-[10px]">
                  {(Object.keys(RESULT_TYPE_META) as SearchResultType[]).map((type) => (
                    <span
                      key={type}
                      className="inline-flex items-center gap-1 rounded-full bg-muted/60 px-2 py-0.5"
                    >
                      {RESULT_TYPE_META[type].label}
                    </span>
                  ))}
                </div>
              </div>
            )
          ) : searchResults.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              Aucun résultat pour « {searchQuery} ».
            </div>
          ) : (
            <ResultsByType results={searchResults} onSelect={handleResultClick} />
          )}
        </div>
      </UnifiedModal>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function ResultsByType({
  results,
  onSelect,
}: {
  results: SearchResult[];
  onSelect: (r: SearchResult) => void;
}) {
  // Group results by type for clearer scannability
  const grouped = new Map<SearchResultType, SearchResult[]>();
  for (const r of results) {
    const list = grouped.get(r.type) ?? [];
    list.push(r);
    grouped.set(r.type, list);
  }

  return (
    <>
      {Array.from(grouped.entries()).map(([type, items]) => {
        const meta = RESULT_TYPE_META[type];
        const Icon = meta.icon;
        return (
          <div key={type} className="mb-2">
            <p className="flex items-center gap-1.5 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              <Icon className="h-3 w-3" />
              {meta.label}
            </p>
            <div>
              {items.map((r) => (
                <ResultRow
                  key={`${r.type}-${r.id}`}
                  icon={Icon}
                  label={r.label}
                  subtitle={r.subtitle}
                  onClick={() => onSelect(r)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}

function ResultRow({
  icon: Icon,
  label,
  subtitle,
  meta,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  subtitle: string;
  meta?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-md px-3 py-2 text-start transition-colors",
        "hover:bg-accent/10",
      )}
    >
      <span className="text-muted-foreground">
        <Icon className="h-4 w-4" />
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{label}</p>
        <p className="text-xs text-muted-foreground font-mono truncate">{subtitle}</p>
      </div>
      {meta && (
        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <Clock className="h-3 w-3" />
          {meta}
        </span>
      )}
    </button>
  );
}

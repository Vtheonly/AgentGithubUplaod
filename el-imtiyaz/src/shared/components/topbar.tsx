/**
 * App topbar — global search (Cmd+K), alerts bell, quick backup, profile menu.
 *
 * Persistent across all hub pages. The search opens a command palette
 * (Cmd+K / Ctrl+K) for cross-entity navigation.
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
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
import { cn } from "../ui/cn";

export function Topbar() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { session, signOut } = useAuth();
  const repos = useRepositories();
  const [searchOpen, setSearchOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<{
    parents: { id: string; label: string; subtitle: string }[];
    students: { id: string; label: string; subtitle: string }[];
  }>({ parents: [], students: [] });
  const [notifications, setNotifications] = useState<
    { id: string; type: string; title: string; body: string; readAt: string | null; createdAt: string }[]
  >([]);

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

  // Debounced search across parents + students
  useEffect(() => {
    if (!searchOpen) return;
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults({ parents: [], students: [] });
      return;
    }
    const timer = setTimeout(async () => {
      const [parentRes, studentRes] = await Promise.all([
        repos.parents.search(q),
        repos.students.search(q),
      ]);
      setSearchResults({
        parents: parentRes.ok
          ? parentRes.value.slice(0, 5).map((p) => ({
              id: p.id,
              label: `${p.firstName} ${p.lastName}`,
              subtitle: p.code,
            }))
          : [],
        students: studentRes.ok
          ? studentRes.value.slice(0, 5).map((s) => ({
              id: s.id,
              label: `${s.firstName} ${s.lastName}`,
              subtitle: s.code,
            }))
          : [],
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [searchQuery, searchOpen, repos.parents, repos.students]);

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
        style={{ direction: "ltr" }}
      >
        {/* Search trigger */}
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          className="group flex h-9 w-full max-w-md items-center gap-2 rounded-md border border-border bg-muted/30 px-3 text-sm text-muted-foreground transition-colors hover:border-primary/50"
        >
          <Search className="h-4 w-4" />
          <span className="flex-1 text-left">Rechercher…</span>
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
                <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-status-danger px-1 text-[9px] font-bold text-white">
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

        {/* Quick backup (desktop-only feature, stubbed) */}
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-foreground"
          title="Sauvegarde rapide (bientôt disponible)"
          disabled
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

      {/* Search palette */}
      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent size="lg" className="p-0 gap-0">
          <DialogHeader className="p-4 border-b border-border">
            <DialogTitle className="sr-only">{t("common.search")}</DialogTitle>
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input
                autoFocus
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Rechercher un parent, un élève…"
                className="border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
              />
            </div>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto p-2">
            {searchQuery.trim() === "" ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                Tapez pour rechercher dans toute l'application.
              </div>
            ) : searchResults.parents.length === 0 && searchResults.students.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                Aucun résultat pour « {searchQuery} ».
              </div>
            ) : (
              <>
                {searchResults.parents.length > 0 && (
                  <Section label="Parents">
                    {searchResults.parents.map((p) => (
                      <ResultRow
                        key={p.id}
                        icon={<UserIcon className="h-4 w-4" />}
                        label={p.label}
                        subtitle={p.subtitle}
                        onClick={() => {
                          navigate(`/crm?parentId=${p.id}`);
                          setSearchOpen(false);
                        }}
                      />
                    ))}
                  </Section>
                )}
                {searchResults.students.length > 0 && (
                  <Section label="Élèves">
                    {searchResults.students.map((s) => (
                      <ResultRow
                        key={s.id}
                        icon={<UserIcon className="h-4 w-4" />}
                        label={s.label}
                        subtitle={s.subtitle}
                        onClick={() => {
                          navigate(`/crm?studentId=${s.id}`);
                          setSearchOpen(false);
                        }}
                      />
                    ))}
                  </Section>
                )}
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-2">
      <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div>{children}</div>
    </div>
  );
}

function ResultRow({
  icon,
  label,
  subtitle,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors",
        "hover:bg-accent/10",
      )}
    >
      <span className="text-muted-foreground">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{label}</p>
        <p className="text-xs text-muted-foreground font-mono truncate">{subtitle}</p>
      </div>
    </button>
  );
}

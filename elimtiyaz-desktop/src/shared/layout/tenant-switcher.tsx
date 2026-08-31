/**
 * TenantSwitcher — T-053 (TENANT-103).
 *
 * Global admins (user_profiles.tenant_id IS NULL per migration 0002) have no
 * home tenant: the desktop previously faked one via the DEMO UUID fallback
 * in getTenantId() — every query silently targeted the demo tenant and RLS
 * denied the rest. This switcher gives the global admin an EXPLICIT working
 * tenant instead:
 *
 *   - Rendered exactly when the session's working tenant is missing
 *     (session.tenantId === null) or the session's home tenant is explicitly
 *     null (session.homeTenantId === null — global admin who already picked).
 *   - Lists ACTIVE tenants via the canonical `tenants` table (RLS: 0053's
 *     tenant-scoped policies let global admins enumerate tenants).
 *   - Choosing one calls auth.switchTenant(id) — which persists the choice
 *     and reloads so every repository cache rebuilds in the new context.
 *
 * Non-admin users never see it (their sessions carry a working tenant and a
 * non-null home tenant). Pre-T-053 persisted sessions have `homeTenantId`
 * undefined but a string tenantId — the `=== null` checks hide the switcher
 * for them.
 */
import { useEffect, useState } from "react";
import { Building2, Check, ChevronDown } from "lucide-react";
import { useAuth } from "../../app/providers/auth-provider";
import { getSupabaseClient, isSupabaseConfigured } from "../../infrastructure/supabase/supabase-client";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { cn } from "../ui/cn";

interface TenantRow {
  id: string;
  name: string;
}

export function TenantSwitcher() {
  const { session, switchTenant } = useAuth();
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const isGlobalAdmin =
    !!session && (session.tenantId === null || session.homeTenantId === null);

  // Fetch the active-tenant list once when the switcher becomes relevant.
  useEffect(() => {
    if (!isGlobalAdmin || !isSupabaseConfigured()) return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await getSupabaseClient()
          .from("tenants")
          .select("id, name")
          .eq("is_active", true)
          .is("deleted_at", null)
          .order("name");
        if (cancelled) return;
        if (error) {
          setLoadError(error.message);
          return;
        }
        setTenants((data ?? []) as unknown as TenantRow[]);
      } catch (e) {
        if (!cancelled) setLoadError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isGlobalAdmin]);

  if (!isGlobalAdmin) return null;

  const activeName =
    tenants.find((t) => t.id === session?.tenantId)?.name ??
    (session?.tenantId ? session.tenantId.slice(0, 8) + "…" : null);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          title="Établissement actif (admin global)"
        >
          <Building2 className="h-4 w-4" />
          <span className="max-w-40 truncate">
            {activeName ?? "Sélectionner un établissement"}
          </span>
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Établissement actif</DropdownMenuLabel>
        {loadError ? (
          <div className="px-2 py-1.5 text-xs text-destructive">
            Impossible de charger les établissements : {loadError}
          </div>
        ) : tenants.length === 0 ? (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            {tenants.length === 0 && !loadError
              ? "Aucun établissement actif trouvé."
              : "Chargement…"}
          </div>
        ) : (
          tenants.map((t) => (
            <DropdownMenuItem
              key={t.id}
              onClick={() => switchTenant(t.id)}
              className={cn("gap-2", t.id === session?.tenantId && "font-semibold")}
            >
              <Check
                className={cn("h-4 w-4", t.id === session?.tenantId ? "opacity-100" : "opacity-0")}
              />
              {t.name}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

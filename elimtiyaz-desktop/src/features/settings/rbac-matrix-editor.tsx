/**
 * RbacMatrixEditor — editable role × permission matrix.
 *
 * T-588 (BUG-017 / SET-U5): the matrix now persists through the ONE
 * canonical RbacRepository seam — the `tenant_role_overrides` table via
 * the migration-0006 RPCs in Supabase mode, the device-local store in
 * mock mode. BEFORE T-588 the editor wrote a localStorage key that
 * NOTHING on the enforcement path ever read (a placebo: sessions derive
 * their permissions from current_user_permissions() / the mock resolver,
 * neither of which looked at that key on the save side).
 *
 * The displayed matrix is the EFFECTIVE one the server enforces (loaded
 * via read_rbac_effective_matrix in Supabase mode — defaults + overrides,
 * deny wins), not the desktop's fictional DEFAULT_ROLE_PERMISSIONS
 * baseline. Server-only codes (the legacy catalog vocabulary) are counted
 * honestly but not editable here.
 *
 * Every save/reset writes a real audit entry (iteration 15 + T-588: the
 * reset is a mutation too — rule §7.6).
 */
import { useState, useMemo, useEffect, Fragment } from "react";
import { Shield, Check, RotateCcw, Save, Lock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../shared/ui/card";
import { Button } from "../../shared/ui/button";
import { Badge } from "../../shared/ui/badge";
import { useToast } from "../../app/providers/toast-provider";
import { useAuth } from "../../app/providers/auth-provider";
import { Role, ROLE_LABELS_FR, STAFF_ROLES } from "../../core/rbac/roles";
import { Permission, PERMISSION_LABELS_FR, DEFAULT_ROLE_PERMISSIONS } from "../../core/rbac/permissions";
import { useRepositories } from "../../app/providers/repository-provider";
import { TooltipHint } from "../../shared/ui/tooltip";
import { RBAC_OVERRIDES_STORAGE_KEY } from "../../domain/model/rbac";

// Group permissions by domain for easier scanning
const PERMISSION_GROUPS: Array<{ name: string; permissions: Permission[] }> = [
  {
    name: "CRM",
    permissions: [
      Permission.ViewRoster, Permission.CreateParent, Permission.EditParent,
      Permission.DeleteParent, Permission.CreateStudent, Permission.EditStudent,
      Permission.DeleteStudent, Permission.PromoteStudent,
    ],
  },
  {
    name: "Pédagogie",
    permissions: [
      Permission.ViewAcademics, Permission.EnterGrades, Permission.ManageSubjects,
      Permission.ManageClasses, Permission.AssignHomework, Permission.RollCall,
      Permission.ManageSchoolYears, Permission.ViewClubs, Permission.ManageClubs,
      Permission.EnrollClubMembers, Permission.LogClubActivities,
      Permission.ViewAttendance,
    ],
  },
  {
    name: "Finances",
    permissions: [
      Permission.ViewFinancials, Permission.CollectPayment, Permission.RefundPayment,
      Permission.AdjustAccount, Permission.GenerateReceipt, Permission.ViewDebt,
      Permission.SendReminder, Permission.ManagePricing,
    ],
  },
  {
    name: "Dépenses",
    permissions: [
      Permission.SubmitExpense, Permission.ApproveExpense, Permission.DisburseExpense,
      Permission.SettleExpenseProof,
    ],
  },
  {
    name: "Personnel",
    permissions: [Permission.ViewPersonnel, Permission.ViewReleve],
  },
  {
    name: "Audit & Config",
    permissions: [
      // T-541 / OPS-324: AccessDriverMode removed with the Tournées feature.
      Permission.ViewAuditLog, Permission.ManageSettings,
      Permission.ManageTenants,
    ],
  },
];

/** The default matrix as a fresh mutable copy (per-role Sets). */
function defaultMatrix(): Record<Role, Set<Permission>> {
  const result = {} as Record<Role, Set<Permission>>;
  for (const role of STAFF_ROLES) {
    result[role] = new Set(DEFAULT_ROLE_PERMISSIONS[role]);
  }
  return result;
}

/** Does the matrix differ from the defaults on any role? */
function differsFromDefaults(matrix: Record<Role, Set<Permission>>): boolean {
  for (const role of STAFF_ROLES) {
    const a = Array.from(matrix[role]).sort();
    const b = Array.from(DEFAULT_ROLE_PERMISSIONS[role]).sort();
    if (JSON.stringify(a) !== JSON.stringify(b)) return true;
  }
  return false;
}

export function RbacMatrixEditor() {
  const toast = useToast();
  const { session, refreshPermissions } = useAuth();
  const repos = useRepositories();
  const canEdit = !!session && session.role === Role.SuperAdmin;

  // The effective matrix starts at the defaults and is replaced by the
  // loaded server state (defaults + overrides) once the repository answers.
  const [matrix, setMatrix] = useState<Record<Role, Set<Permission>>>(defaultMatrix);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [customized, setCustomized] = useState(false);
  /** Server-catalog codes the desktop enum cannot display (legacy vocabulary). */
  const [unmappedCount, setUnmappedCount] = useState(0);

  const staffRoleList = useMemo(() => Array.from(STAFF_ROLES), []);

  // Load the EFFECTIVE matrix from the canonical repository (T-588).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await repos.rbac.loadEffectiveMatrix();
      if (cancelled) return;
      if (res.ok) {
        const next = {} as Record<Role, Set<Permission>>;
        for (const role of STAFF_ROLES) {
          next[role] = new Set(res.value.matrix[role] ?? DEFAULT_ROLE_PERMISSIONS[role]);
        }
        setMatrix(next);
        setCustomized(res.value.hasOverrides);
        setUnmappedCount(res.value.unmappedServerCodes.length);
      } else {
        // Fail-loud but non-blocking: the editor stays on the defaults with
        // an honest banner (never a silent fictional matrix).
        toast.showError(
          "Matrice non chargée",
          "Impossible de lire la matrice effective du serveur. Vérifiez la connexion puis rouvrez cet onglet.",
        );
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mock-mode multi-window sync: a save in another window updates this one.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key !== RBAC_OVERRIDES_STORAGE_KEY) return;
      void repos.rbac.loadEffectiveMatrix().then((res) => {
        if (!res.ok) return;
        const next = {} as Record<Role, Set<Permission>>;
        for (const role of STAFF_ROLES) {
          next[role] = new Set(res.value.matrix[role] ?? DEFAULT_ROLE_PERMISSIONS[role]);
        }
        setMatrix(next);
        setCustomized(res.value.hasOverrides);
        setDirty(false);
      });
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [repos.rbac]);

  function toggle(role: Role, perm: Permission) {
    if (!canEdit) return;
    setMatrix((curr) => {
      const next = new Set(curr[role]);
      if (next.has(perm)) next.delete(perm);
      else next.add(perm);
      return { ...curr, [role]: next };
    });
    setDirty(true);
  }

  async function reset() {
    if (!session) return;
    setSaving(true);
    try {
      const res = await repos.rbac.resetMatrix();
      if (!res.ok) {
        toast.showError("Échec de la réinitialisation", res.error.userMessage ?? res.error.message);
        return;
      }
      setMatrix(defaultMatrix());
      setCustomized(false);
      setDirty(false);
      // The reset is a mutation — it leaves its audit trail too (rule §7.6).
      await repos.audit.log({
        action: "rbac.matrix_reset",
        entityType: "rbac",
        entityId: "role-permission-matrix",
        actorId: session.userId,
        actorName: session.displayName,
        tenantId: session.tenantId,
        diff: { before: { customized: true }, after: { customized: false } },
        note: `SuperAdmin a réinitialisé la matrice RBAC (${res.value.removed} personnalisation(s) supprimée(s)).`,
      });
      toast.showInfo(
        "Matrice réinitialisée",
        "Les permissions par défaut ont été restaurées.",
      );
    } catch (e) {
      toast.showError("Échec", e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function save() {
    if (!session) return;
    setSaving(true);
    try {
      // 1. Persist through the canonical seam — tenant_role_overrides via
      //    the 0006 RPCs (Supabase) / the device-local store (mock).
      const asArrays = {} as Record<Role, Permission[]>;
      for (const role of staffRoleList) asArrays[role] = Array.from(matrix[role]);
      const res = await repos.rbac.saveMatrix(asArrays);
      if (!res.ok) {
        toast.showError("Échec de l'enregistrement", res.error.userMessage ?? res.error.message);
        return;
      }
      // 1b. Reload the source of truth — the honest "Personnalisé" state
      //     (overrides may pre-exist this save; saved/removed alone cannot
      //     tell whether the tenant is still customized).
      const reloaded = await repos.rbac.loadEffectiveMatrix();
      if (reloaded.ok) {
        const next = {} as Record<Role, Set<Permission>>;
        for (const role of STAFF_ROLES) {
          next[role] = new Set(reloaded.value.matrix[role] ?? DEFAULT_ROLE_PERMISSIONS[role]);
        }
        setMatrix(next);
        setCustomized(reloaded.value.hasOverrides);
      }

      // 2. The audit entry: per-role diff against the DEFAULT matrix (the
      //    server-side diff against role_permissions is recorded by the RPC
      //    itself — these two views intentionally complement).
      const totalPerms = staffRoleList.reduce((s, r) => s + matrix[r].size, 0);
      const before: Record<string, string[]> = {};
      const after: Record<string, string[]> = {};
      let changedRoles = 0;
      for (const role of staffRoleList) {
        const b = Array.from(DEFAULT_ROLE_PERMISSIONS[role]).sort();
        const a = Array.from(matrix[role]).sort();
        before[role] = b;
        after[role] = a;
        if (JSON.stringify(b) !== JSON.stringify(a)) changedRoles++;
      }
      await repos.audit.log({
        action: "rbac.matrix_update",
        entityType: "rbac",
        entityId: "role-permission-matrix",
        actorId: session.userId,
        actorName: session.displayName,
        tenantId: session.tenantId,
        diff: { before, after },
        note: `SuperAdmin updated RBAC matrix — ${staffRoleList.length} roles × ${totalPerms} total permissions. ${changedRoles} role(s) changed. Server diff: ${res.value.saved} granted/denied, ${res.value.removed} restored to default.`,
      });

      // 3. Best-effort live refresh of the caller's own session (Supabase
      //    mode rebuilds from current_user_permissions; mock mode keeps the
      //    current session and applies the override at the next sign-in).
      const refreshed = await refreshPermissions();

      toast.showSuccess(
        "Matrice RBAC enregistrée",
        `${changedRoles} rôle(s) modifié(s) — journal d'audit mis à jour.` +
          (refreshed ? "" : " Les changements s'appliquent à la prochaine connexion."),
      );
      setDirty(false);
    } catch (e) {
      toast.showError("Échec", e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" /> Matrice RBAC — Édition
            {customized && (
              <Badge variant="secondary" className="text-[10px]">Personnalisé</Badge>
            )}
            {loading && (
              <Badge variant="outline" className="text-[10px]">Chargement…</Badge>
            )}
          </CardTitle>
          <CardDescription>
            {canEdit
              ? "Cliquez sur une cellule pour accorder/retirer une permission. Les modifications sont enregistrées pour toute l'organisation et journalisées."
              : "Lecture seule — réservé au Super Administrateur."}
          </CardDescription>
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={reset} disabled={(!dirty && !customized) || saving || loading}>
              <RotateCcw className="h-3.5 w-3.5" /> Réinitialiser
            </Button>
            <Button size="sm" onClick={save} disabled={!dirty || saving || loading}>
              <Save className="h-3.5 w-3.5" /> {saving ? "Enregistrement…" : "Enregistrer"}
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent>
        {!canEdit && (
          <div className="rounded-md border border-status-warning/30 bg-status-warning/5 p-3 mb-4 flex items-start gap-2">
            <Lock className="h-4 w-4 text-status-warning mt-0.5 shrink-0" />
            <p className="text-sm text-muted-foreground">
              Lecture seule pour votre rôle. Connectez-vous en tant que Super Administrateur pour modifier la matrice.
            </p>
          </div>
        )}

        {unmappedCount > 0 && (
          <div className="rounded-md border border-border bg-muted/20 p-2.5 mb-4">
            <p className="text-xs text-muted-foreground">
              {unmappedCount} permission(s) serveur supplémentaire(s) — issues d'un catalogue
              antérieur — restent actives et inchangées par cet écran.
            </p>
          </div>
        )}

        <div className="rounded-md border border-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr>
                <th className="text-left p-3 sticky left-0 bg-muted/30 z-10 min-w-[200px]">Permission</th>
                {staffRoleList.map((role) => (
                  <th key={role} className="p-3 text-center min-w-[120px]">
                    <div className="flex flex-col items-center gap-1">
                      <span className="text-xs font-semibold">{ROLE_LABELS_FR[role]}</span>
                      <Badge variant="outline" className="text-[9px]">
                        {matrix[role].size} perm.
                      </Badge>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERMISSION_GROUPS.map((group) => (
                <Fragment key={group.name}>
                  <tr className="bg-muted/20">
                    <td colSpan={staffRoleList.length + 1} className="p-2 text-xs uppercase tracking-wide text-muted-foreground font-semibold">
                      {group.name}
                    </td>
                  </tr>
                  {group.permissions.map((perm) => (
                    <tr key={perm} className="border-t border-border hover:bg-accent/5">
                      <td className="p-3 sticky left-0 bg-popover z-10">
                        <TooltipHint content={perm}>
                          <p className="text-sm font-medium">{PERMISSION_LABELS_FR[perm]}</p>
                        </TooltipHint>
                      </td>
                      {staffRoleList.map((role) => {
                        const granted = matrix[role].has(perm);
                        return (
                          <td key={role} className="p-3 text-center">
                            <TooltipHint content={granted ? "Accordée — cliquer pour retirer" : "Non accordée — cliquer pour accorder"}><button
                              type="button"
                              disabled={!canEdit}
                              onClick={() => toggle(role, perm)}
                              className={`inline-flex h-7 w-7 items-center justify-center rounded-md border transition-all ${
                                granted
                                  ? "bg-status-success/15 border-status-success/40 text-status-success"
                                  : "bg-transparent border-border text-muted-foreground hover:border-primary/50"
                              } ${canEdit ? "cursor-pointer" : "cursor-not-allowed opacity-70"}`}
                            >
                              {granted && <Check className="h-4 w-4" />}
                            </button></TooltipHint>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
          {staffRoleList.map((role) => (
            <div key={role} className="rounded-md border border-border p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{ROLE_LABELS_FR[role]}</p>
              <p className="text-xl font-mono font-bold mt-1">{matrix[role].size}</p>
              <p className="text-[10px] text-muted-foreground">permissions</p>
            </div>
          ))}
        </div>

        <p className="text-[11px] text-muted-foreground mt-4">
          {/* E2.6 / BUG-027: derived, never hardcoded — the role and
              permission catalogs have both grown since §02.07 was
              written (both old counts were stale). */}
          {staffRoleList.length} rôles × {Object.values(Permission).length} permissions. Les rôles Parent et Étudiant ne sont pas éditables ici (portail web).
        </p>
      </CardContent>
    </Card>
  );
}

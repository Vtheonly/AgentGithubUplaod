/**
 * RbacMatrixEditor — editable role × permission matrix.
 *
 * Iteration 3-I (plan §02.07): SuperAdmin can edit role → permission mapping
 * from the UI. Updates persist to localStorage (so the change survives reloads
 * in mock mode) AND trigger an audit log entry.
 *
 * Iteration 15 fix: previously the save() function only fired a toast — no
 * actual persistence happened, and no audit entry was written. Now:
 *   - The matrix is loaded from localStorage on mount (falls back to
 *     DEFAULT_ROLE_PERMISSIONS if no override has been saved).
 *   - The save() function writes the override to localStorage AND writes
 *     a real audit entry via the audit repository with action
 *     "rbac.matrix_update" + a diff of the permission sets per role.
 *   - The reset() function clears the localStorage override.
 *
 * In a future iteration, the override will be persisted to the
 * `tenant_role_overrides` Supabase table (migration 0003_rbac.sql defines
 * the table; the desktop Supabase adapter does not yet implement the
 * RBAC repository — that's documented in ITERATION-12-DONE.md as
 * remaining work).
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

const STORAGE_KEY = "el-imtiyaz:rbac-overrides";

/**
 * Read the saved override (or null if none). Stored as a plain object
 * { [role]: Permission[] } because Set doesn't serialize to JSON.
 */
function loadOverride(): Record<Role, Set<Permission>> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, Permission[]>;
    const result = {} as Record<Role, Set<Permission>>;
    for (const role of STAFF_ROLES) {
      const arr = parsed[role];
      result[role] = new Set(Array.isArray(arr) ? arr : DEFAULT_ROLE_PERMISSIONS[role]);
    }
    return result;
  } catch {
    return null;
  }
}

function saveOverride(matrix: Record<Role, Set<Permission>>): void {
  try {
    const serializable: Record<string, Permission[]> = {};
    for (const role of STAFF_ROLES) {
      serializable[role] = Array.from(matrix[role]);
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serializable));
  } catch {
    /* ignore — in-memory only */
  }
}

function clearOverride(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

// Group permissions by domain for easier scanning
const PERMISSION_GROUPS: Array<{ name: string; permissions: Permission[] }> = [
  {
    name: "CRM",
    permissions: [
      Permission.ViewRoster, Permission.CreateParent, Permission.EditParent,
      Permission.DeleteParent, Permission.CreateStudent, Permission.EditStudent,
      Permission.PromoteStudent,
    ],
  },
  {
    name: "Pédagogie",
    permissions: [
      Permission.ViewAcademics, Permission.EnterGrades, Permission.ManageSubjects,
      Permission.ManageClasses, Permission.AssignHomework, Permission.RollCall,
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
      Permission.ViewAuditLog, Permission.ManageSettings,
      Permission.ManageTenants, Permission.AccessDriverMode,
    ],
  },
];

export function RbacMatrixEditor() {
  const toast = useToast();
  const { session } = useAuth();
  const repos = useRepositories();
  const canEdit = !!session && session.role === Role.SuperAdmin;

  // Initialize from saved override if present (iteration 15 fix), else
  // fall back to DEFAULT_ROLE_PERMISSIONS.
  const [matrix, setMatrix] = useState<Record<Role, Set<Permission>>>(() => {
    const saved = loadOverride();
    if (saved) return saved;
    const result = {} as Record<Role, Set<Permission>>;
    for (const role of STAFF_ROLES) {
      result[role] = new Set(DEFAULT_ROLE_PERMISSIONS[role]);
    }
    return result;
  });

  // Track whether the user has unsaved changes (matrix differs from last save).
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [usingOverride, setUsingOverride] = useState(() => loadOverride() !== null);

  const staffRoleList = useMemo(() => Array.from(STAFF_ROLES), []);

  // Re-load if the saved override changes from elsewhere (multi-window).
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY) {
        const next = loadOverride();
        if (next) {
          setMatrix(next);
          setUsingOverride(true);
        } else {
          // Override was cleared — fall back to defaults.
          const result = {} as Record<Role, Set<Permission>>;
          for (const role of STAFF_ROLES) {
            result[role] = new Set(DEFAULT_ROLE_PERMISSIONS[role]);
          }
          setMatrix(result);
          setUsingOverride(false);
        }
        setDirty(false);
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

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

  function reset() {
    const result = {} as Record<Role, Set<Permission>>;
    for (const role of STAFF_ROLES) {
      result[role] = new Set(DEFAULT_ROLE_PERMISSIONS[role]);
    }
    setMatrix(result);
    clearOverride();
    setUsingOverride(false);
    setDirty(false);
    toast.showInfo("Matrice réinitialisée", "Les permissions par défaut ont été restaurées.");
  }

  async function save() {
    if (!session) return;
    setSaving(true);
    try {
      // 1. Persist the override to localStorage (so it survives reloads in mock mode).
      saveOverride(matrix);
      setUsingOverride(true);

      // 2. Write a real audit log entry — iteration 15 fix. Previously the
      //    save function was a no-op that only fired a success toast. The
      //    audit log signature expects diff: { before?: unknown; after?: unknown }.
      //    We pack the per-role diff into `before` (DEFAULT_ROLE_PERMISSIONS) and
      //    `after` (the new override) so the audit drawer can render it.
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
        note: `SuperAdmin updated RBAC matrix — ${staffRoleList.length} roles × ${totalPerms} total permissions. ${changedRoles} role(s) changed.`,
      });

      toast.showSuccess(
        "Matrice RBAC enregistrée",
        `${staffRoleList.length} rôles × ${totalPerms} permissions au total. ${changedRoles} rôle(s) modifié(s) — journal d'audit mis à jour.`,
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
            {usingOverride && (
              <Badge variant="secondary" className="text-[10px]">Personnalisé</Badge>
            )}
          </CardTitle>
          <CardDescription>
            {canEdit
              ? "Cliquez sur une cellule pour accorder/retirer une permission. Les modifications sont persistées localement et journalisées."
              : "Lecture seule — réservé au Super Administrateur."}
          </CardDescription>
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={reset} disabled={(!dirty && !usingOverride) || saving}>
              <RotateCcw className="h-3.5 w-3.5" /> Réinitialiser
            </Button>
            <Button size="sm" onClick={save} disabled={!dirty || saving}>
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
                        <p className="text-sm font-medium">{PERMISSION_LABELS_FR[perm]}</p>
                        <p className="text-[10px] text-muted-foreground font-mono">{perm}</p>
                      </td>
                      {staffRoleList.map((role) => {
                        const granted = matrix[role].has(perm);
                        return (
                          <td key={role} className="p-3 text-center">
                            <button
                              type="button"
                              disabled={!canEdit}
                              onClick={() => toggle(role, perm)}
                              className={`inline-flex h-7 w-7 items-center justify-center rounded-md border transition-all ${
                                granted
                                  ? "bg-status-success/15 border-status-success/40 text-status-success"
                                  : "bg-transparent border-border text-muted-foreground hover:border-primary/50"
                              } ${canEdit ? "cursor-pointer" : "cursor-not-allowed opacity-70"}`}
                              title={granted ? "Accordée — cliquer pour retirer" : "Non accordée — cliquer pour accorder"}
                            >
                              {granted && <Check className="h-4 w-4" />}
                            </button>
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
          Plan §02.07 — 6 rôles × 28 permissions. Les modifications sont journalisées dans l'audit log.
          Les rôles Parent et Étudiant ne sont pas éditables ici (portail web).
        </p>
      </CardContent>
    </Card>
  );
}

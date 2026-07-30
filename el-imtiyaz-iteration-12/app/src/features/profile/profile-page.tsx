/**
 * ProfilePage — dedicated /profile route (iteration 3-J).
 *
 * Replaces the previous behavior where the topbar profile menu navigated
 * to Settings. Now the profile menu opens this dedicated page with:
 *   - Header (avatar, displayName, email, role badge, tenant ID, session expiry)
 *   - Permission grid (chip per granted permission)
 *   - Recent activity (10 most-recent audit entries by current user)
 *
 * Iteration 10 — added Password Governance card (plan §12.04):
 *   - "Modifier mon mot de passe" button opens the ChangePasswordModal.
 *   - Self-service password change with re-authentication + session revocation.
 *   - Strength checklist (8+ chars, lowercase, uppercase, digit) per
 *     plan §12.04 "Strong Entropy".
 *
 * Uses UnifiedModal-style cards and the standard PageHeader so the
 * visual language matches every other page in the application.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Shield, Clock, Mail, Building2, KeyRound, Lock } from "lucide-react";
import { useAuth } from "../../state/auth-context";
import { useRepositories } from "../../infrastructure/repository-provider";
import { PageHeader } from "../../shared/components/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../shared/ui/card";
import { Button } from "../../shared/ui/button";
import { Avatar, AvatarFallback } from "../../shared/ui/avatar";
import { Badge } from "../../shared/ui/badge";
import { StatusChip } from "../../shared/components/status-chip";
import { EmptyState } from "../../shared/components/state-views";
import { ChangePasswordModal } from "../../shared/components/change-password-modal";
import { Permission, PERMISSION_LABELS_FR } from "../../core/rbac/permissions";
import { ROLE_LABELS_FR } from "../../core/rbac/roles";
import { formatDateTime } from "../../core/format/date";
import type { AuditEntry } from "../../domain/model/audit";

export function ProfilePage() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const repos = useRepositories();

  const [recentActivity, setRecentActivity] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [pwdOpen, setPwdOpen] = useState(false);

  useEffect(() => {
    void (async () => {
      if (!session) return;
      setLoading(true);
      // Query the most recent 10 audit entries by the current user
      const result = await repos.audit.query({
        actorNameContains: session.displayName,
        limit: 10,
      });
      if (result.ok) {
        // Filter to entries actually by this user (defensive)
        const filtered = result.value.entries.filter(
          (e) => e.actorName === session.displayName || e.actorId === session.userId,
        );
        setRecentActivity(filtered.slice(0, 10));
      }
      setLoading(false);
    })();
  }, [session, repos.audit]);

  if (!session) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader title="Profil" description="Aucune session active." />
      </div>
    );
  }

  const initials = session.displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0] ?? "")
    .join("")
    .toUpperCase();

  const expiresAt = new Date(session.expiresAt);
  const msUntilExpiry = session.expiresAt - Date.now();
  const hoursUntilExpiry = Math.round(msUntilExpiry / (1000 * 60 * 60));
  const minutesUntilExpiry = Math.round(msUntilExpiry / (1000 * 60));

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Mon profil"
        description="Vos informations de session, permissions et activité récente"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setPwdOpen(true)}>
              <Lock className="h-4 w-4" /> Mot de passe
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate(-1)}>
              <ArrowLeft className="h-4 w-4" /> Retour
            </Button>
          </>
        }
      />

      <div className="flex-1 overflow-y-auto px-6 pb-6 space-y-4">
        {/* Identity header */}
        <Card>
          <CardContent className="p-5">
            <div className="flex items-start gap-4">
              <Avatar className="h-16 w-16">
                <AvatarFallback className="text-lg font-semibold">
                  {initials || "?"}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold text-foreground">{session.displayName}</h2>
                  <Badge variant="default">{ROLE_LABELS_FR[session.role]}</Badge>
                </div>
                <div className="mt-1 space-y-0.5 text-sm text-muted-foreground">
                  <p className="flex items-center gap-1.5">
                    <Mail className="h-3.5 w-3.5" /> {session.email}
                  </p>
                  <p className="flex items-center gap-1.5">
                    <Building2 className="h-3.5 w-3.5" /> Tenant: <code className="font-mono text-xs">{session.tenantId}</code>
                  </p>
                  <p className="flex items-center gap-1.5">
                    <KeyRound className="h-3.5 w-3.5" /> User ID: <code className="font-mono text-xs">{session.userId}</code>
                  </p>
                  <p className="flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5" />
                    Session: expire {hoursUntilExpiry > 0
                      ? `dans ${hoursUntilExpiry}h`
                      : `dans ${minutesUntilExpiry}min`}
                    <span className="text-[11px]">({formatDateTime(expiresAt.toISOString())})</span>
                  </p>
                </div>
              </div>
              <StatusChip
                label={msUntilExpiry > 0 ? "Active" : "Expirée"}
                tone={msUntilExpiry > 0 ? "success" : "danger"}
              />
            </div>
          </CardContent>
        </Card>

        {/* Iteration 10 — Password Governance card (plan §12.04) */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Lock className="h-4 w-4 text-status-warning" /> Sécurité du compte
            </CardTitle>
            <CardDescription>
              Plan §12.04 — modification du mot de passe avec ré-authentification + révocation de session.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-foreground">Mot de passe</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Modifiez votre mot de passe pour sécuriser votre compte. Toutes vos sessions actives
                  seront révoquées après le changement.
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setPwdOpen(true)}>
                <KeyRound className="h-4 w-4" /> Modifier
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Permissions grid */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Shield className="h-4 w-4 text-primary" /> Permissions accordées
            </CardTitle>
            <CardDescription>
              {session.permissions.size} permission(s) — précalculées à la connexion (plan §02.07)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {Array.from(session.permissions).map((perm) => (
                <div
                  key={perm}
                  className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-status-success" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">
                      {PERMISSION_LABELS_FR[perm as Permission] ?? perm}
                    </p>
                    <p className="text-[10px] font-mono text-muted-foreground">{perm}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Recent activity */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Clock className="h-4 w-4 text-primary" /> Activité récente
            </CardTitle>
            <CardDescription>10 dernières actions enregistrées dans le journal d'audit</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground text-center py-6">Chargement…</p>
            ) : recentActivity.length === 0 ? (
              <EmptyState
                title="Aucune activité récente"
                description="Vos actions apparaîtront ici dès que vous interagissez avec le système."
              />
            ) : (
              <ul className="divide-y divide-border">
                {recentActivity.map((entry) => (
                  <li key={entry.id} className="flex items-center gap-3 py-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <code className="text-xs font-mono text-primary">{entry.action}</code>
                        <span className="text-xs text-muted-foreground">{entry.entityType}</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {entry.entityId}
                        {entry.note ? ` · ${entry.note}` : ""}
                      </p>
                    </div>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {formatDateTime(entry.at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <ChangePasswordModal open={pwdOpen} onOpenChange={setPwdOpen} />
    </div>
  );
}

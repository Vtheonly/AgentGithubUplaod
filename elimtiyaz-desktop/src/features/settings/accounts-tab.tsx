/**
 * AccountsTab — admin-created login accounts, redesigned (T-079 + T-371).
 *
 * T-079 (original): a login account could only originate from a web
 * self-signup reviewed in the "Inscriptions" tab; this tab gave the
 * SuperAdmin a direct provisioning path (create the account, hand the
 * initial credentials out-of-band, the user signs in and changes the
 * password).
 *
 * T-371 (WORKFORCE-501, the redesign): the account is now associated with
 * the selected EMPLOYEE from the moment it is created — the new
 * CreateAccountModal puts the employee picker first, prefills the identity
 * from the personnel record, and the backend binds personnel.user_id in the
 * creation transaction. This tab gained the verification surface:
 *   - the credentials panel shows the LINKED EMPLOYEE (code + name) so the
 *     admin can confirm the association before handing the credentials over;
 *   - the "Comptes & rattachements" overview lists every account with its
 *     role and its bound employee (or the absence of one).
 *
 * RBAC: SuperAdmin ONLY. The Edge Function enforces the same gate
 * server-side (deliberately narrower than the approvals workflow, whose
 * assign_role surface is the registered SEC-107 escalation).
 */

import { useCallback, useEffect, useState } from "react";
import { useRepositories } from "../../app/providers/repository-provider";
import { useAuth } from "../../app/providers/auth-provider";
import { useToast } from "../../app/providers/toast-provider";
import { Role, ROLE_LABELS_FR } from "../../core/rbac/roles";
import type {
  AccountOverviewEntry,
  CreatedAccount,
} from "../../domain/repository/repository";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../shared/ui/card";
import { Button } from "../../shared/ui/button";
import { StatusChip } from "../../shared/ui/status-chip";
import { CreateAccountModal } from "./create-account-modal";
import { UserPlus, Users, KeyRound, ShieldAlert, Copy, Check, Link2, Unlink, RefreshCw } from "lucide-react";

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function AccountsTab() {
  const repos = useRepositories();
  const { session } = useAuth();
  const { showError } = useToast();

  const [createOpen, setCreateOpen] = useState(false);
  const [credentials, setCredentials] = useState<CreatedAccount | null>(null);
  const [copied, setCopied] = useState(false);

  const [accounts, setAccounts] = useState<AccountOverviewEntry[] | null>(null);
  const [loadingAccounts, setLoadingAccounts] = useState(false);

  const refreshAccounts = useCallback(async () => {
    setLoadingAccounts(true);
    const result = await repos.userAccounts.listAccounts();
    if (result.ok) {
      setAccounts(result.value);
    } else {
      setAccounts(null);
      showError(
        "Chargement impossible",
        result.error.userMessage ?? result.error.message,
      );
    }
    setLoadingAccounts(false);
  }, [repos.userAccounts, showError]);

  useEffect(() => {
    // SuperAdmin-only surface — the list is RLS-gated server-side too.
    if (session?.role === Role.SuperAdmin) {
      void refreshAccounts();
    }
  }, [session?.role, refreshAccounts]);

  function handleCreated(account: CreatedAccount): void {
    setCredentials(account);
    setCopied(false);
    // The overview must show the new account + its linkage immediately.
    void refreshAccounts();
  }

  // RBAC gate — the Edge Function enforces the same rule server-side.
  if (!session || session.role !== Role.SuperAdmin) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
          <ShieldAlert className="h-8 w-8 text-status-danger" />
          <p className="text-sm font-medium">Accès refusé</p>
          <p className="text-xs text-muted-foreground max-w-md">
            La création de comptes est réservée au Super Administrateur (la même règle est
            appliquée côté serveur par la fonction create-user-account).
          </p>
        </CardContent>
      </Card>
    );
  }

  function copyCredentials(): void {
    if (!credentials) return;
    const linked = credentials.personnelCode
      ? `\nEmployé lié : ${credentials.personnelName ?? ""} (${credentials.personnelCode})`
      : "";
    const text = `El-Imtiyaz — Identifiants\nEmail : ${credentials.email}\nMot de passe initial : ${credentials.initialPassword}${linked}`;
    navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {
        /* clipboard unavailable (e.g. insecure context) — the admin can copy manually */
      });
  }

  return (
    <div className="space-y-4 max-w-4xl">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Comptes utilisateurs
              </CardTitle>
              <CardDescription>
                Créez un compte rattaché à un membre du personnel — la fiche
                employé pilote le formulaire et le compte est lié à
                l'employé dès sa création : à la connexion, il retrouve son
                profil, ses tâches et ses responsabilités. Pour un parent ou
                un élève, choisissez le mode « Autre utilisateur ». Les
                inscriptions venues du site web restent dans l'onglet «
                Inscriptions ».
              </CardDescription>
            </div>
            <Button onClick={() => setCreateOpen(true)}>
              <UserPlus className="h-4 w-4 mr-2" />
              Créer un compte
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {credentials ? (
            <div className="rounded-lg border border-status-success/40 bg-status-success/10 p-4 space-y-3">
              <div className="flex items-center gap-2 font-medium text-status-success">
                <KeyRound className="h-4 w-4" />
                Identifiants à communiquer — affichés une seule fois
              </div>
              <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                <div>
                  <span className="text-muted-foreground">Email : </span>
                  <span className="font-medium">{credentials.email}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Rôle : </span>
                  <span className="font-medium">{ROLE_LABELS_FR[credentials.role]}</span>
                </div>
                {credentials.personnelCode ? (
                  <div className="sm:col-span-2 flex items-center gap-1.5">
                    <Link2 className="h-4 w-4 text-status-success" />
                    <span className="text-muted-foreground">Employé lié : </span>
                    <span className="font-medium">
                      {credentials.personnelName ?? "—"}
                    </span>
                    <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
                      {credentials.personnelCode}
                    </code>
                    <span className="text-xs text-muted-foreground">
                      (profil, tâches et responsabilités visibles dès sa connexion)
                    </span>
                  </div>
                ) : null}
                <div className="sm:col-span-2">
                  <span className="text-muted-foreground">Mot de passe initial : </span>
                  <code className="font-mono bg-muted px-2 py-1 rounded select-all">
                    {credentials.initialPassword}
                  </code>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Communiquez ces identifiants de manière sécurisée (en main propre ou par
                téléphone) — jamais par email. L'utilisateur devra changer son mot de
                passe à la première connexion.
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={copyCredentials}>
                  {copied ? <Check className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
                  {copied ? "Copié" : "Copier les identifiants"}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setCredentials(null)}>
                  Fermer
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Aucun compte créé dans cette session. Cliquez sur « Créer un compte » pour
              provisionner un nouvel accès — les identifiants initiaux s'afficheront ici
              une seule fois, puis ne seront plus jamais consultables.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Link2 className="h-4 w-4" />
                Comptes &amp; rattachements
              </CardTitle>
              <CardDescription>
                Tous les comptes du tenant avec leur rôle et l'employé lié —
                l'état de l'association créée par le workflow ci-dessus.
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => void refreshAccounts()}>
              <RefreshCw className={"h-4 w-4" + (loadingAccounts ? " animate-spin" : "")} />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {accounts === null ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              {loadingAccounts ? "Chargement…" : "Aucun compte lisible."}
            </p>
          ) : accounts.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Aucun compte dans ce tenant.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Email</th>
                    <th className="py-2 pr-3 font-medium">Nom</th>
                    <th className="py-2 pr-3 font-medium">Rôle</th>
                    <th className="py-2 pr-3 font-medium">Employé lié</th>
                    <th className="py-2 font-medium">Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((a) => (
                    <tr key={a.profileId} className="border-b last:border-b-0">
                      <td className="py-2 pr-3">{a.email}</td>
                      <td className="py-2 pr-3">{a.displayName ?? "—"}</td>
                      <td className="py-2 pr-3">
                        {a.role ? ROLE_LABELS_FR[a.role] : "—"}
                      </td>
                      <td className="py-2 pr-3">
                        {a.personnelId ? (
                          <span className="inline-flex items-center gap-1.5">
                            <Link2 className="h-3.5 w-3.5 text-status-success" />
                            <span>
                              {a.personnelName ?? "—"}{" "}
                              <code className="font-mono text-[11px] text-muted-foreground">
                                {a.personnelCode}
                              </code>
                            </span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                            <Unlink className="h-3.5 w-3.5" />
                            non lié
                          </span>
                        )}
                      </td>
                      <td className="py-2">
                        <StatusChip
                          label={a.status === "active" ? "Actif" : a.status}
                          tone={a.status === "active" ? "success" : "warning"}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <CreateAccountModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={handleCreated}
      />
    </div>
  );
}

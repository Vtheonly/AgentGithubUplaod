/**
 * AccountsTab — admin-created login accounts (T-079).
 *
 * Owner request: "Implement the functionality in the desktop app that
 * allows an admin to create accounts for other users so they can log in
 * with their own accounts."
 *
 * Before T-079 a login account could ONLY originate from a web
 * self-signup reviewed in the "Inscriptions" tab. This tab gives the
 * SuperAdmin a direct provisioning path: create the account, hand the
 * initial credentials to the user out-of-band, and the user signs in
 * with their own email + password (then changes the password — the
 * changePassword path works since T-003).
 *
 * RBAC: SuperAdmin ONLY. The create-user-account Edge Function enforces
 * the same gate server-side (deliberately narrower than the approvals
 * workflow, whose assign_role surface is the registered SEC-107
 * escalation — support_staff must NOT be able to mint privileged
 * accounts).
 *
 * Mock parity: with VITE_USE_SUPABASE=false the account is minted into
 * the in-memory seedAccounts (the new user can sign in immediately in
 * dev/demo); with Supabase configured the request goes through the EF,
 * which creates the auth.users row via the Admin API (service role never
 * ships in the client, plan §12.05).
 */

import { useState } from "react";
import { z } from "zod";
import { useRepositories } from "../../app/providers/repository-provider";
import { useAuth } from "../../app/providers/auth-provider";
import { useToast } from "../../app/providers/toast-provider";
import { Role, ROLE_LABELS_FR } from "../../core/rbac/roles";
import type { CreatedAccount } from "../../domain/repository/repository";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../shared/ui/card";
import { Button } from "../../shared/ui/button";
import { AutoFormModal, type AutoFormField } from "../../shared/ui/auto-form";
import { UserPlus, Users, KeyRound, ShieldAlert, Copy, Check } from "lucide-react";

/* ------------------------------------------------------------------ */
/* Form schema + fields                                                */
/* ------------------------------------------------------------------ */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const CreateAccountSchema = z.object({
  email: z
    .string()
    .min(1, "Email requis")
    .regex(EMAIL_RE, "Adresse email invalide"),
  fullName: z.string().optional(),
  phone: z.string().optional(),
  role: z
    .string()
    .min(1, "Rôle requis")
    .refine((v) => v in ROLE_LABELS_FR, "Rôle inconnu"),
  password: z
    .string()
    .optional()
    .refine(
      (v) => !v || (v.length >= 8 && /[a-z]/.test(v) && /[A-Z]/.test(v) && /\d/.test(v)),
      "Au moins 8 caractères, une majuscule, une minuscule et un chiffre",
    ),
});

type CreateAccountFormData = z.infer<typeof CreateAccountSchema>;

/** Staff roles first (desktop access), then the web-portal roles. */
const ROLE_OPTIONS = [
  Role.SupportStaff,
  Role.FinancialOfficer,
  Role.Teacher,
  Role.Manager,
  Role.Buyer,
  Role.Driver,
  Role.WarehouseWorker,
  Role.Worker,
  Role.SuperAdmin,
  Role.Parent,
  Role.Student,
].map((role) => ({ value: role, label: ROLE_LABELS_FR[role] }));

const CREATE_FIELDS: readonly AutoFormField[] = [
  { name: "email", label: "Email de connexion", type: "email", required: true, placeholder: "prenom.nom@elimtiyaz.dz" },
  { name: "fullName", label: "Nom complet", type: "text", placeholder: "Prénom Nom" },
  { name: "phone", label: "Téléphone", type: "tel", placeholder: "+213 …" },
  { name: "role", label: "Rôle", type: "select", required: true, options: ROLE_OPTIONS, placeholder: "Sélectionner un rôle…" },
  {
    name: "password",
    label: "Mot de passe initial",
    type: "password",
    wide: true,
    placeholder: "••••••••",
    help: "Laissez vide pour générer un mot de passe conforme. Min. 8 caractères avec majuscule, minuscule et chiffre.",
  },
];

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function AccountsTab() {
  const repos = useRepositories();
  const { session } = useAuth();
  const { showSuccess, showError } = useToast();

  const [createOpen, setCreateOpen] = useState(false);
  const [credentials, setCredentials] = useState<CreatedAccount | null>(null);
  const [copied, setCopied] = useState(false);

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

  async function handleSubmit(data: CreateAccountFormData): Promise<void> {
    const result = await repos.userAccounts.createAccount({
      email: data.email,
      fullName: data.fullName || undefined,
      phone: data.phone || undefined,
      role: data.role as Role,
      initialPassword: data.password || undefined,
    });

    if (result.ok) {
      setCredentials(result.value);
      setCopied(false);
      showSuccess(
        "Compte créé",
        `${result.value.email} peut maintenant se connecter.`,
      );
      return; // AutoFormModal closes on resolve
    }

    // Keep the modal open (AutoFormModal only closes when onSubmit resolves).
    showError("Création impossible", result.error.userMessage ?? result.error.message);
    throw new Error(result.error.message);
  }

  function copyCredentials(): void {
    if (!credentials) return;
    const text = `El-Imtiyaz — Identifiants\nEmail : ${credentials.email}\nMot de passe initial : ${credentials.initialPassword}`;
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
                Créez un compte de connexion pour un membre du personnel ou un parent.
                L'utilisateur se connecte ensuite avec son propre email et mot de passe,
                puis change son mot de passe à la première connexion. Les inscriptions
                venues du site web restent dans l'onglet « Inscriptions ».
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

      <AutoFormModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="Créer un compte"
        description="Le compte sera actif immédiatement avec le rôle choisi. Un email de confirmation n'est pas requis — l'utilisateur peut se connecter dès que vous lui avez transmis ses identifiants."
        schema={CreateAccountSchema}
        fields={CREATE_FIELDS}
        onSubmit={handleSubmit}
        submitLabel="Créer le compte"
      />
    </div>
  );
}

// ============================================================================
// FILE: src/features/settings/danger-zone-card.tsx
// T-416 (issue #12 / ADR-027) — the Settings "Zone de danger": the ONE
// desktop surface for the canonical student/parent domain purge
// (migration 0120's purge_student_parent_domain RPC).
//
// SAFETY MODEL (the issue's "cannot be triggered accidentally"):
//   1. Visible ONLY to the super administrateur (isSuperAdmin).
//   2. In mock mode there is no server to purge — the card renders an
//      honest disabled state instead of a demo twin (§15.16).
//   3. Three explicit steps: dry-run preview (counts, no deletion) → the
//      operator TYPES the phrase "PURGER" → a destructive ConfirmModal
//      recapping the preview's total → only then the execute call. The
//      phrase is re-checked SERVER-SIDE (a bypassed UI gate changes
//      nothing).
//   4. The success panel shows the server's per-family counts AND the
//      preserved evidence (backup/sync/audit untouched — ADR-027).
// ============================================================================

import { useState } from "react";
import {
  AlertTriangle,
  Eye,
  Loader2,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../shared/ui/card";
import { Button } from "../../shared/ui/button";
import { Input } from "../../shared/ui/input";
import { Label } from "../../shared/ui/label";
import { ConfirmModal } from "../../shared/ui/unified-modal";
import { useAuth } from "../../app/providers/auth-provider";
import { useToast } from "../../app/providers/toast-provider";
import { isSuperAdmin } from "../../core/rbac/session";
import { isSupabaseConfigured } from "../../infrastructure/supabase/supabase-client";
import {
  dryRunPurge,
  executePurge,
  type PurgeVerdict,
} from "../../infrastructure/supabase/repositories/supabase-purge-repository";

/** The typed confirmation phrase (must match migration 0120's gate). */
const CONFIRM_PHRASE = "PURGER";

/** French labels for the RPC's per-family count keys. */
const FAMILY_LABELS_FR: Record<string, string> = {
  payment_allocations: "Répartitions de paiement",
  payments: "Paiements",
  installments: "Tranches (échelonniers)",
  invoices: "Factures",
  ledger_entries: "Écritures du grand livre",
  account_adjustments: "Ajustements de compte",
  receipts: "Reçus financiers",
  discount_applications: "Remises appliquées",
  service_enrollments: "Inscriptions aux services",
  grades: "Notes",
  attendance_records: "Pointages (assiduité)",
  academic_history: "Historique académique",
  student_academic_histories: "Historiques académiques détaillés",
  student_documents: "Documents élèves",
  activation_codes: "Codes d'activation",
  parent_student_links: "Liens parent–élève",
  account_approval_requests: "Demandes d'inscription liées",
  students: "Élèves",
  parents: "Parents",
  chat_messages: "Messages de messagerie",
  chat_channels: "Conversations de messagerie",
  notifications: "Notifications",
  calendar_events: "Événements d'agenda ciblés",
  notification_preferences: "Préférences de notification",
  device_tokens: "Jetons d'appareil (notifications push)",
  sessions: "Sessions de portail",
  role_assignments: "Attributions de rôles (portail)",
  user_profiles: "Profils utilisateurs (portail)",
  auth_users: "Comptes d'authentification (portail)",
  sync_queue_domain: "File de synchronisation (entités du domaine)",
};

function familyLabel(key: string): string {
  return FAMILY_LABELS_FR[key] ?? key;
}

function formatNumber(n: number): string {
  return new Intl.NumberFormat("fr-FR").format(n);
}

/** The counts table shared by the dry-run preview and the result panel. */
function CountsTable({ verdict }: { verdict: PurgeVerdict }) {
  const rows = Object.entries(verdict.counts)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Aucune donnée du domaine élève/parent sur ce tenant — rien à purger.
      </p>
    );
  }
  return (
    <div className="max-h-56 overflow-y-auto rounded-md border">
      <table className="w-full text-xs">
        <tbody>
          {rows.map(([key, n]) => (
            <tr key={key} className="border-b last:border-b-0">
              <td className="px-3 py-1.5 text-muted-foreground">{familyLabel(key)}</td>
              <td className="px-3 py-1.5 text-right font-mono font-semibold">
                {formatNumber(n)}
              </td>
            </tr>
          ))}
          <tr className="border-t bg-muted/50">
            <td className="px-3 py-1.5 font-semibold">Total</td>
            <td className="px-3 py-1.5 text-right font-mono font-bold">
              {formatNumber(verdict.total)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function DangerZoneCard() {
  const { session } = useAuth();
  const toast = useToast();

  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<PurgeVerdict | null>(null);
  const [phrase, setPhrase] = useState("");
  const [executing, setExecuting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [result, setResult] = useState<PurgeVerdict | null>(null);

  // Gate 1 — super administrateur only; other roles never see the surface.
  if (!session || !isSuperAdmin(session)) return null;

  const supabaseReady = isSupabaseConfigured();
  const phraseValid = phrase.trim() === CONFIRM_PHRASE;

  async function handlePreview() {
    setPreviewing(true);
    setResult(null);
    try {
      const outcome = await dryRunPurge();
      if (outcome.ok) {
        setPreview(outcome.value);
        toast.showInfo(
          "Prévisualisation prête",
          `${formatNumber(outcome.value.total)} ligne(s) du domaine élève/parent seraient supprimées.`,
        );
      } else {
        toast.showError("Prévisualisation impossible", outcome.error.userMessage);
      }
    } finally {
      setPreviewing(false);
    }
  }

  async function handleExecute() {
    setExecuting(true);
    try {
      const outcome = await executePurge(phrase.trim());
      if (outcome.ok) {
        setResult(outcome.value);
        setPreview(null);
        setPhrase("");
        setConfirmOpen(false);
        toast.showSuccess(
          "Purge terminée",
          `${formatNumber(outcome.value.total)} ligne(s) supprimée(s) — sauvegardes et synchronisation intactes.`,
        );
      } else {
        toast.showError("Purge refusée", outcome.error.userMessage);
        setConfirmOpen(false);
      }
    } finally {
      setExecuting(false);
    }
  }

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-destructive">
          <AlertTriangle className="h-4 w-4" />
          Zone de danger — Réinitialisation du domaine élèves/parents
        </CardTitle>
        <CardDescription>
          Opération administrative <strong>irréversible</strong> : supprime
          définitivement l'intégralité des données élèves et parents de
          l'établissement — dossiers, inscriptions, historiques académiques,
          et tout le volet financier associé (paiements, répartitions,
          tranches, factures, grand livre, ajustements, remises), ainsi que
          les comptes du portail parents/élèves.{" "}
          <strong>Prenez une sauvegarde au préalable</strong> (onglet
          « Sauvegarde ») : c'est la seule voie de restauration.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!supabaseReady ? (
          <div className="flex items-start gap-3 rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              La purge s'exécute côté serveur (mode Supabase requis). Les
              données de démonstration locales n'ont rien à purger —
              connectez l'application au projet Supabase
              (Configuration → Connexion) pour activer cette opération.
            </p>
          </div>
        ) : (
          <>
            {/* What the purge deliberately never touches (ADR-027). */}
            <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
              <p className="mb-1 font-semibold text-foreground">
                Ce que la purge ne touche jamais :
              </p>
              <ul className="list-inside list-disc space-y-0.5">
                <li>Sauvegardes (archives + planificateur) et file de synchronisation des autres domaines</li>
                <li>Journal d'audit (la purge y est enregistrée), catalogue académique, personnel, opérations</li>
              </ul>
            </div>

            {/* Step 1 — the dry-run preview. */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handlePreview}
                  disabled={previewing || executing}
                >
                  {previewing ? (
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Eye className="mr-1 h-3.5 w-3.5" />
                  )}
                  Prévisualiser (aucune suppression)
                </Button>
                <span className="text-xs text-muted-foreground">
                  Étape 1 — comptage exact de ce qui serait supprimé.
                </span>
              </div>
              {preview && <CountsTable verdict={preview} />}
            </div>

            {/* Step 2 — the typed phrase. */}
            <div className="space-y-1.5">
              <Label htmlFor="purge-confirm-phrase" className="text-xs">
                Étape 2 — saisissez exactement{" "}
                <code className="rounded bg-muted px-1 font-mono font-bold">
                  {CONFIRM_PHRASE}
                </code>{" "}
                pour armer la purge
              </Label>
              <Input
                id="purge-confirm-phrase"
                className="max-w-56 font-mono"
                placeholder="PURGER"
                value={phrase}
                onChange={(e) => setPhrase(e.target.value)}
                disabled={executing}
                autoComplete="off"
                spellCheck={false}
              />
            </div>

            {/* Step 3 — the final confirm. */}
            <Button
              variant="destructive"
              size="sm"
              disabled={!phraseValid || !preview || executing}
              onClick={() => setConfirmOpen(true)}
            >
              <Trash2 className="mr-1 h-3.5 w-3.5" />
              Purger définitivement
            </Button>
            {!preview && phraseValid && (
              <p className="text-xs text-muted-foreground">
                Lancez d'abord la prévisualisation — le récapitulatif final
                s'appuie sur le comptage serveur.
              </p>
            )}

            {result && (
              <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
                <p className="text-sm font-semibold text-destructive">
                  Purge exécutée — {formatNumber(result.total)} ligne(s)
                  supprimée(s) dans {Object.values(result.counts).filter((n) => n > 0).length} famille(s).
                </p>
                <CountsTable verdict={result} />
                <p className="text-xs text-muted-foreground">
                  Preuves d'intégrité serveur : archives de sauvegarde
                  intactes · {formatNumber(result.preserved.sync_queue_other)} entrée(s) de
                  synchronisation hors domaine conservées · journal d'audit en
                  ajout seul{result.audit_entry_id ? ` (entrée ${result.audit_entry_id.slice(0, 8)}…)` : ""}.
                  Rechargez l'application (F5) pour vider les caches locaux.
                </p>
              </div>
            )}
          </>
        )}
      </CardContent>

      <ConfirmModal
        open={confirmOpen}
        onOpenChange={(o) => !executing && setConfirmOpen(o)}
        title="Purger TOUTES les données élèves/parents ?"
        description={
          preview ? (
            <span>
              Cette action est <strong>irréversible</strong> :{" "}
              <strong>{formatNumber(preview.total)}</strong> ligne(s) seront
              définitivement supprimées (élèves, parents, volet financier,
              historiques, comptes du portail). Sauvegardes et synchronisation
              des autres domaines restent intactes.
            </span>
          ) : (
            "Cette action est irréversible."
          )
        }
        confirmLabel="Oui, purger définitivement"
        cancelLabel="Annuler"
        destructive
        onConfirm={handleExecute}
      />
    </Card>
  );
}

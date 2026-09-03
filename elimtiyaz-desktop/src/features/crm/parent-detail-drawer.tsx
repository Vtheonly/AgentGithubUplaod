/**
 * ParentDetailDrawer — slide-over panel showing a parent's complete profile.
 *
 * Plan §04.05: 3 sections — Identity / Children / Finances.
 * The Finances section embeds ParentFinancialProfile (services, payments,
 * balance, tranches, due dates). Per plan §03.02 / §07.06, financial
 * views must NOT open in a separate tab — always render inside the
 * parent drawer.
 *
 * Phase 4B refactor: now built on the shared `<EntityDetailDrawer<Parent>>`
 * primitive (`src/shared/ui/entity-drawer/`). The conditional modals
 * (`UnifiedPaymentModal`, `AdjustAccountButton`) live OUTSIDE the drawer
 * and are triggered via local state set by action callbacks.
 */
import { useState } from "react";
import {
  Phone,
  MessageCircle,
  MessagesSquare,
  Mail,
  FileText,
  Plus,
  UserPlus,
  Wallet,
  AlertTriangle,
  Users,
  Pencil,
  KeyRound,
} from "lucide-react";
import { useRepositories } from "../../app/providers/repository-provider";
import { useToast } from "../../app/providers/toast-provider";
import { useAuth } from "../../app/providers/auth-provider";
import { useObservable } from "../../shared/hooks/use-observable";
import { EntityDetailDrawer, type EntityDrawerTab, type EntityDrawerAction, type EntityDrawerMetaItem } from "../../shared/ui/entity-drawer";
import { Button } from "../../shared/ui/button";
import { Badge } from "../../shared/ui/badge";
import { Avatar, AvatarFallback } from "../../shared/ui/avatar";
import { Separator } from "../../shared/ui/separator";
import { StatusChip } from "../../shared/ui/status-chip";
import { MoneyInput } from "../../shared/ui/money-input";
import { FormField } from "../../shared/ui/form-field";
import { Textarea } from "../../shared/ui/textarea";
import { UnifiedModal } from "../../shared/ui/unified-modal";
import { formatDzd, formatDzdPlain } from "../../core/format/currency";
import { formatRelative, formatDate } from "../../core/format/date";
import {
  PAYMENT_METHOD_LABELS_FR,
  PAYMENT_STATUS_LABELS_FR,
  PAYMENT_CATEGORY_LABELS_FR,
  ADJUSTMENT_REASON_CODES,
  ADJUSTMENT_REASON_LABELS_FR,
  type AdjustmentReasonCode,
  type ParentFinancialProfile,
} from "../../domain/model/payment";
import { UnifiedPaymentModal } from "../financials/unified-payment-modal";
import { deterministicActivationCode } from "../../core/format/id";
import { displayParentCredit } from "../../domain/calc/ledger/balance";
import { isSupabaseConfigured } from "../../infrastructure/supabase/supabase-client";
import { ActivationCodeModal } from "./activation-code-modal";
import { EditParentModal } from "./edit-parent-modal";
import {
  TRANSPORT_DESTINATION_LABELS_FR,
  cityTierToDestination,
  parentDisplayName,
  type Parent,
  type TransportDestination,
} from "../../domain/model/parent";
import { Permission } from "../../core/rbac/permissions";
import { cn } from "../../shared/ui/cn";
import { generateAccountStatementPdf, downloadPdf } from "../../infrastructure/receipt-pdf";

export function ParentDetailDrawer({
  parentId,
  open,
  onOpenChange,
  onAddChild,
  onOpenStudent,
}: {
  parentId: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Receives the FULL parent entity so callers can prefill the wizard. */
  onAddChild?: (parent: Parent) => void;
  /**
   * FIX (bidirectional navigation, plan §04.04): clicking a child in the
   * parent drawer opens the Student drawer. Previously only Student→Parent
   * navigation existed — the vault requires BOTH directions from any
   * profile view.
   */
  onOpenStudent?: (studentId: string) => void;
}) {
  const repos = useRepositories();
  const toast = useToast();
  const { session } = useAuth();
  const parent = useObservable(
    () => repos.parents.observeById(parentId ?? ""),
    [parentId],
  );
  const students = useObservable(
    () => repos.students.observeByParent(parentId ?? ""),
    [parentId],
  );
  const financialProfile = useObservable(
    () => repos.debt.observeParentProfile(parentId ?? ""),
    [parentId],
  );
  const payments = useObservable(
    () => repos.payments.observeByParent(parentId ?? ""),
    [parentId],
  );
  // FIX (§04.04/§04.05): resolve each child's assigned class so the children
  // list shows "grade level + assigned class" as the vault requires —
  // previously only the level/year badge was displayed.
  const classes = useObservable(() => repos.classes.observe(), []);

  // === Epic 6.3 — UnifiedPaymentModal + AdjustAccount modal triggers ===
  const [collectOpen, setCollectOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  // FIX (editing): edit modal trigger — `updateParent` was previously
  // implemented in every repository but unreachable from any UI.
  const [editOpen, setEditOpen] = useState(false);

  // The drawer expects an entity or null; when closed/missing we render an
  // empty portal so animations work correctly.
  const entity: Parent | null = (open && parentId && parent) ? parent : null;

  async function handleDownloadStatement(p: Parent) {
    if (payments.length === 0) {
      toast.showWarning("Aucun paiement", "Ce parent n'a aucun paiement à inclure dans le relevé.");
      return;
    }
    try {
      const pdfBytes = await generateAccountStatementPdf(payments, p);
      const fileName = `releve-compte-${p.code}-${new Date().toISOString().slice(0, 10)}.pdf`;
      downloadPdf(pdfBytes, fileName);
      toast.showSuccess("Relevé téléchargé", fileName);
    } catch (e) {
      toast.showError("Échec du téléchargement", e instanceof Error ? e.message : String(e));
    }
  }

  // === Metadata grid (Identity summary at the top of the drawer) ===
  const metadata = (p: Parent): readonly EntityDrawerMetaItem[] => [
    { label: "Téléphone", value: p.phone },
    { label: "WhatsApp", value: p.whatsapp ?? "—" },
    { label: "E-mail", value: p.email ?? "—" },
    { label: "Profession", value: p.occupation ?? "—" },
    { label: "Zone", value: zoneLabel(p) },
    { label: "Langue", value: p.preferredLanguage === "fr" ? "Français" : "العربية" },
    { label: "Adresse", value: p.address ?? "—" },
  ];

  // === Tabs (Identity / Children / Finances) ===
  const tabs = (p: Parent): readonly EntityDrawerTab<Parent>[] => [
    {
      id: "identity",
      label: "Identité",
      content: () => (
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            <Detail label="Téléphone" value={p.phone} />
            <Detail label="WhatsApp" value={p.whatsapp ?? "—"} />
            <Detail label="E-mail" value={p.email ?? "—"} />
            <Detail label="Profession" value={p.occupation ?? "—"} />
            <Detail label="Zone" value={zoneLabel(p)} />
            <Detail label="Langue" value={p.preferredLanguage === "fr" ? "Français" : "العربية"} />
            <Detail label="Adresse" value={p.address ?? "—"} className="col-span-2" />
          </div>
        </div>
      ),
    },
    {
      id: "children",
      label: "Enfants",
      badge: () => students.length,
      content: () => (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <SectionTitle icon={<UserPlus className="h-3.5 w-3.5" />}>
              Enfants ({students.length})
            </SectionTitle>
            {onAddChild && (
              <Button size="sm" variant="outline" onClick={() => onAddChild(p)}>
                <Plus className="h-4 w-4" /> Ajouter un enfant
              </Button>
            )}
          </div>
          {students.length === 0 ? (
            <p className="text-xs text-muted-foreground">Aucun enfant inscrit.</p>
          ) : (
            <ul className="space-y-1.5">
              {students.map((s) => {
                const klass = classes.find((c) => c.id === s.classId) ?? null;
                const clickable = !!onOpenStudent;
                return (
                  <li
                    key={s.id}
                    className={cn(
                      "flex items-center gap-3 rounded-md border border-border p-2.5",
                      clickable &&
                        "cursor-pointer hover:bg-accent/10 hover:border-primary/30 transition-colors",
                    )}
                    onClick={() => clickable && onOpenStudent(s.id)}
                    title={
                      clickable
                        ? "Ouvrir le dossier de l'élève (navigation bidirectionnelle §04.04)"
                        : undefined
                    }
                  >
                    <Avatar className="h-8 w-8">
                      <AvatarFallback className="text-xs">
                        {s.firstName[0]}
                        {s.lastName[0]}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {s.firstName} {s.lastName}
                      </p>
                      <p className="text-[11px] text-muted-foreground font-mono">{s.code}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge variant="outline" className="text-[10px]">
                        {levelLabel(s.level)} · An. {s.gradeYear}
                      </Badge>
                      {klass && (
                        <span className="text-[10px] text-muted-foreground">
                          {klass.name}
                        </span>
                      )}
                    </div>
                    <StatusChip
                      label={s.status === "active" ? "Actif" : s.status}
                      tone={s.status === "active" ? "success" : "neutral"}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ),
    },
    {
      id: "finances",
      label: "Finances",
      content: () => (
        <FinancesTab
          profile={financialProfile}
          outstanding={financialProfile?.totalOutstanding ?? 0}
          overdue={financialProfile?.overdueAmount ?? 0}
        />
      ),
    },
  ];

  // === Actions (footer) ===
  const canAdjust = !!session && session.permissions.has(Permission.AdjustAccount);
  // VAULT §02 — staff issues the activation code (KeyIcon action).
  const canIssueActivation = !!session && session.permissions.has(Permission.EditParent);
  const [activationCode, setActivationCode] = useState<string | null>(null);
  const [issuingCode, setIssuingCode] = useState(false);

  /**
   * VAULT §02.08 (Account Activation Protocol) — Step 1: staff issues the
   * 6-7 digit single-use code.
   *
   *   - Supabase mode: persist via the approvals repository
   *     (`generate_activation_code` RPC + `activation_codes` insert) so the
   *     code the parent receives is the code the portal will validate.
   *   - Mock mode: derive the SAME deterministic code Android would derive
   *     from (tenantId|parentCode) so the demo stays cross-platform
   *     consistent, then audit-log the issuance.
   *
   * T-145 / ACT-200 (2026-09-03): the previous version fell back to the
   * deterministic code even when the SUPABASE path FAILED (the RPC error or
   * the insert error was swallowed) — the staff then handed the parent a
   * phantom code that never existed server-side and the portal answered
   * "Invalid or already-used activation code". In Supabase mode a failure
   * now STOPS the issuance and surfaces the real error; the deterministic
   * fallback is reserved for mock mode (where there is no server to
   * validate against).
   */
  async function issueActivationCode(parent: Parent) {
    setIssuingCode(true);
    try {
      let code: string | null = null;
      const approvals = (repos as { approvals?: { generateActivationCode(parentId: string): Promise<{ ok: boolean; value?: string }> } }).approvals;
      if (isSupabaseConfigured() && approvals) {
        const res = await approvals.generateActivationCode(parent.id);
        if (res.ok && res.value) {
          code = res.value;
        } else {
          // Supabase mode FAILED (RPC or insert error — see ACT-200: the
          // pre-T-145 insert always failed on the missing tenant_id). Do
          // NOT fall through to the deterministic phantom code: surface
          // the failure so staff can retry instead of handing the parent
          // a code the portal will reject.
          const detail = res && "error" in res && res.error ? (res.error as { message?: string; userMessage?: string }) : null;
          const why = detail?.userMessage ?? detail?.message ?? "erreur inconnue";
          toast.showError(
            "Émission impossible",
            `Le code n'a PAS été enregistré sur le serveur — n'utilisez pas le code affiché. Détail : ${why}`,
          );
          void repos.audit.log({
            action: "parent.activation_code_issuance_failed",
            entityType: "parent",
            entityId: parent.id,
            actorId: session?.userId ?? "usr-current",
            actorName: session?.displayName ?? "Session courante",
            tenantId: parent.tenantId,
            diff: { before: null, after: null },
            note: `Émission du code d'activation ÉCHOUÉE pour ${parentDisplayName(parent)} (le serveur n'a pas de code — ACT-200)`,
          });
          return;
        }
      }
      if (!code) {
        // Mock path only — deterministic fallback keeps the protocol shape
        // identical across platforms in the offline/demo sandbox.
        code = deterministicActivationCode(parent.code, parent.tenantId);
      }
      setActivationCode(code);
      void repos.audit.log({
        action: "parent.activation_code_issued",
        entityType: "parent",
        entityId: parent.id,
        actorId: session?.userId ?? "usr-current",
        actorName: session?.displayName ?? "Session courante",
        tenantId: parent.tenantId,
        diff: { before: null, after: { parentCode: parent.code } },
        note: `Code d'activation portail émis pour ${parentDisplayName(parent)} (usage unique, lié au profil maître)`,
      });
    } finally {
      setIssuingCode(false);
    }
  }

  // T-100 (CHAT-103): staff opens the direct channel with THIS parent —
  // the channel-creation path that makes the parent portal's MessagesView
  // non-empty (the portal is read+reply by design).
  const [openingChannel, setOpeningChannel] = useState(false);

  async function openParentConversation(parent: Parent) {
    if (!session) return;
    setOpeningChannel(true);
    try {
      const r = await repos.chat.openParentChannel(
        parent.id,
        parentDisplayName(parent),
      );
      if (r.ok) {
        toast.showSuccess(
          "Conversation prête",
          `« ${r.value.name} » — le parent la voit dans son portail (Messagerie).`,
        );
      } else {
        toast.showError("Conversation impossible", r.error.userMessage);
      }
    } finally {
      setOpeningChannel(false);
    }
  }

  const actions = (p: Parent): readonly EntityDrawerAction<Parent>[] => {
    const list: EntityDrawerAction<Parent>[] = [];
    // FIX (editing): expose the parent edit modal from the drawer footer.
    list.push({
      label: "Modifier",
      onClick: () => setEditOpen(true),
      variant: "outline",
      icon: <Pencil className="h-4 w-4" />,
    });
    // VAULT §02 — Account Activation Protocol (staff-issued code).
    if (canIssueActivation) {
      list.push({
        label: "Code d'activation",
        onClick: (pp) => void issueActivationCode(pp),
        variant: "outline",
        icon: <KeyRound className="h-4 w-4" />,
        disabled: () => issuingCode,
      });
    }
    if (canAdjust) {
      list.push({
        label: "Ajuster le compte",
        onClick: () => setAdjustOpen(true),
        variant: "outline",
        icon: <Wallet className="h-4 w-4" />,
      });
    }
    list.push({
      label: "Encaisser / Régler",
      onClick: () => setCollectOpen(true),
      variant: "default",
      icon: <Wallet className="h-4 w-4" />,
      disabled: () => (financialProfile?.totalOutstanding ?? 0) <= 0,
    });
    list.push({
      label: "Appeler",
      onClick: (pp) => window.open(`tel:${pp.phone}`),
      variant: "outline",
      icon: <Phone className="h-4 w-4" />,
    });
    if (p.whatsapp) {
      list.push({
        label: "WhatsApp",
        onClick: (pp) => window.open(`https://wa.me/${pp.whatsapp!.replace(/[\s+]/g, "")}`),
        variant: "outline",
        icon: <MessageCircle className="h-4 w-4" />,
      });
    }
    // T-100 (CHAT-103): in-app chat with the parent (persisted to the shared
    // backend — visible in the parent portal's Messages view).
    list.push({
      label: "Messager",
      onClick: (pp) => void openParentConversation(pp),
      variant: "outline",
      icon: <MessagesSquare className="h-4 w-4" />,
      disabled: () => openingChannel,
    });
    if (p.email) {
      list.push({
        label: "E-mail",
        onClick: (pp) => window.open(`mailto:${pp.email}`),
        variant: "outline",
        icon: <Mail className="h-4 w-4" />,
      });
    }
    list.push({
      label: "Relevé PDF",
      onClick: (pp) => { void handleDownloadStatement(pp); },
      variant: "outline",
      icon: <FileText className="h-4 w-4" />,
      disabled: () => payments.length === 0,
    });
    return list;
  };

  return (
    <>
      <EntityDetailDrawer<Parent>
        open={open}
        onOpenChange={onOpenChange}
        entity={entity}
        widthClass="max-w-lg"
        title={(p) => parentDisplayName(p)}
        subtitle={(p) => p.code}
        avatar={(p) => ({
          initials: `${p.firstName[0] ?? ""}${p.lastName[0] ?? ""}`.toUpperCase(),
        })}
        metadata={metadata}
        tabs={tabs}
        actions={actions}
        headerAccent="bg-primary/5"
      />

      {/* === Sibling modals (triggered by drawer actions) === */}
      {entity && (
        <>
          {/* VAULT §02 — activation code display (single-use, staff-issued,
              with QR delivery per §02.08). */}
          <ActivationCodeModal
            open={activationCode !== null}
            onOpenChange={(o) => !o && setActivationCode(null)}
            code={activationCode}
            parentName={parentDisplayName(entity)}
            whatsapp={entity.whatsapp}
            phone={entity.phone}
          />
          <EditParentModal
            open={editOpen}
            onOpenChange={setEditOpen}
            parentId={entity.id}
          />
          <AdjustAccountModal
            open={adjustOpen}
            onOpenChange={setAdjustOpen}
            parentId={entity.id}
            outstanding={financialProfile?.totalOutstanding ?? 0}
          />
          <UnifiedPaymentModal
            open={collectOpen}
            onOpenChange={setCollectOpen}
            context={
              (financialProfile?.totalOutstanding ?? 0) > 0
                ? {
                    parentId: entity.id,
                    parentName: parentDisplayName(entity),
                    parentCode: entity.code,
                    mode: "consolidated_debt",
                    presetAmount: financialProfile!.totalOutstanding,
                    lineItems: [{
                      itemId: `parent-debt-${entity.id}`,
                      category: "other",
                      label: "Solde familial consolidé",
                      grossAmount: financialProfile!.totalOutstanding,
                      discountAmount: 0,
                      netAmount: financialProfile!.totalOutstanding,
                      alreadyPaidAmount: 0,
                      remainingAmount: financialProfile!.totalOutstanding,
                    }],
                    allowPartial: true,
                    originRoute: "crm.parent_drawer",
                  }
                : null
            }
          />
        </>
      )}
    </>
  );
}

// ============================================================
// FinancesTab — balance cards + installments + recent payments
// ============================================================

function FinancesTab({
  profile,
  outstanding,
  overdue,
}: {
  profile: ParentFinancialProfile | null | undefined;
  outstanding: number;
  overdue: number;
}) {
  return (
    <div className="space-y-3">
      <SectionTitle icon={<Wallet className="h-3.5 w-3.5" />}>Finances</SectionTitle>

      {/* Balance cards */}
      <div className="grid grid-cols-3 gap-2">
        <BalanceCard label="Total dû" value={profile?.totalDue ?? 0} tone="default" />
        <BalanceCard label="Payé" value={profile?.totalPaid ?? 0} tone="success" />
        {outstanding < 0 ? (
          // T-104 (DATA-009/ADR-010) — an overpaid parent holds a CREDIT, but
          // the RAW ledger balance double-counts it for canonical-path
          // overpayments (the writer books the payment excess AND a
          // parent_credit adjustment). The card now renders the ADR-010
          // derived credit (booked unallocated credit wins; else the raw
          // negative balance) instead of `-outstanding`. Consistent with the
          // portal's credit KPI and the debt-meter's unallocated-credit row.
          <BalanceCard
            label="Crédit parent"
            value={displayParentCredit(outstanding, profile?.totalUnallocatedCredit ?? 0)}
            tone="success"
          />
        ) : (
          <BalanceCard label="Reste" value={outstanding} tone={outstanding > 0 ? "danger" : "neutral"} />
        )}
      </div>

      {overdue > 0 && outstanding > 0 && (
        <div className="flex items-center gap-2 rounded-md border border-status-danger/40 bg-status-danger/10 p-2 text-xs">
          <AlertTriangle className="h-3.5 w-3.5 text-status-danger" />
          <span className="text-status-danger font-medium">
            Créance en retard: {formatDzd(overdue)}
          </span>
        </div>
      )}

      <Separator />

      {/* Installments (tranches) */}
      <div className="rounded-md border border-border">
        <div className="border-b border-border px-3 py-1.5 bg-muted/30">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Tranches
          </p>
        </div>
        {profile && profile.installments.length > 0 ? (
          <ul className="divide-y divide-border text-xs">
            {profile.installments.map((i) => (
              <li key={i.id} className="flex items-center gap-2 px-3 py-2">
                <span className="font-medium">{i.label}</span>
                <span className="text-muted-foreground">{PAYMENT_CATEGORY_LABELS_FR[i.category]}</span>
                <span className="ml-auto font-mono">{formatDzdPlain(i.amountDue)}</span>
                <span className="text-muted-foreground">→ {formatDate(i.dueDate)}</span>
                <StatusChip
                  label={PAYMENT_STATUS_LABELS_FR[i.status]}
                  tone={
                    i.status === "paid"
                      ? "success"
                      : i.status === "partial"
                        ? "warning"
                        : i.status === "overdue"
                          ? "danger"
                          : "neutral"
                  }
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-3 py-3 text-xs text-muted-foreground">Aucune tranche.</p>
        )}
      </div>

      {/* Recent payments */}
      <div className="rounded-md border border-border">
        <div className="border-b border-border px-3 py-1.5 bg-muted/30">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Paiements récents
          </p>
        </div>
        {profile && profile.recentPayments.length > 0 ? (
          <ul className="divide-y divide-border text-xs">
            {profile.recentPayments.slice(0, 5).map((p) => (
              <li key={p.id} className="flex items-center gap-2 px-3 py-2">
                <code className="font-mono text-[10px] text-muted-foreground">{p.receiptNumber}</code>
                <span className="text-muted-foreground">{PAYMENT_METHOD_LABELS_FR[p.method]}</span>
                <span className="ml-auto font-mono">{formatDzdPlain(p.amount)}</span>
                <span className="text-muted-foreground">{formatRelative(p.collectedAt)}</span>
                <StatusChip
                  label={PAYMENT_STATUS_LABELS_FR[p.status]}
                  tone={p.status === "paid" ? "success" : p.status === "pending" ? "warning" : "neutral"}
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-3 py-3 text-xs text-muted-foreground">Aucun paiement.</p>
        )}
      </div>

      {/* VAULT §07.06 — discretionary adjustment history (replaces scholarships) */}
      <div className="rounded-md border border-border">
        <div className="border-b border-border px-3 py-1.5 bg-muted/30">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Historique des ajustements discrétionnaires
          </p>
        </div>
        {profile && profile.adjustments.length > 0 ? (
          <ul className="divide-y divide-border text-xs">
            {profile.adjustments.slice(0, 8).map((a) => (
              <li key={a.id} className="px-3 py-2 space-y-0.5">
                <div className="flex items-center gap-2">
                  <span
                    className={`font-mono font-medium ${a.amount < 0 ? "text-status-success" : "text-status-danger"}`}
                  >
                    {a.amount < 0 ? "−" : "+"}{formatDzdPlain(Math.abs(a.amount))}
                  </span>
                  <span className="text-muted-foreground">{formatRelative(a.approvedAt)}</span>
                  <span className="ml-auto text-[10px] text-muted-foreground font-mono">{a.approvedBy}</span>
                </div>
                <p className="text-[11px] text-muted-foreground">{a.reason}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-3 py-3 text-xs text-muted-foreground">Aucun ajustement.</p>
        )}
      </div>
    </div>
  );
}

// ============================================================
// AdjustAccountModal — replaces deprecated scholarships (plan §07.04)
// ============================================================

function AdjustAccountModal({
  open,
  onOpenChange,
  parentId,
  outstanding,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  parentId: string;
  outstanding: number;
}) {
  const repos = useRepositories();
  const { session } = useAuth();
  const toast = useToast();
  const [amount, setAmount] = useState(0);
  // VAULT §07.04 — reason code from the CONTROLLED list (no free text) +
  // mandatory administrative note.
  const [reasonCode, setReasonCode] = useState<AdjustmentReasonCode>("sibling_discount");
  const [adminNote, setAdminNote] = useState("");

  async function submit() {
    if (amount === 0 || !adminNote.trim()) {
      toast.showWarning("Champs invalides", "Montant non nul et note administrative requis.");
      return;
    }
    // Compose the auditable reason: controlled code (for the backend
    // reason_code CHECK constraint) + the admin's explanatory note.
    const reason = `[${reasonCode}] ${adminNote.trim()}`;
    const r = await repos.payments.adjust(
      parentId,
      amount,
      reason,
      session?.userId ?? "usr-current",
    );
    if (r.ok) {
      toast.showSuccess(
        "Ajustement appliqué",
        `${amount < 0 ? "Crédit" : "Débit"} de ${formatDzdPlain(Math.abs(amount))} — ${ADJUSTMENT_REASON_LABELS_FR[reasonCode]}`,
      );
      onOpenChange(false);
      setAmount(0);
      setReasonCode("sibling_discount");
      setAdminNote("");
    } else {
      toast.showError("Échec", r.error.userMessage);
    }
  }

  return (
    <UnifiedModal
      open={open}
      onOpenChange={onOpenChange}
      variant="dialog"
      size="sm"
      icon={Wallet}
      iconTone="primary"
      title="Ajustement de compte"
      description="Remplace le système de bourses supprimé (plan §07.04). Reason code + note admin requis."
      submitLabel="Appliquer"
      submitIcon={Wallet}
      onSubmit={submit}
      submitDisabled={amount === 0 || !adminNote.trim()}
    >
      <div className="space-y-3">
        <div className="rounded-md border border-border p-2 text-xs">
          <p className="text-muted-foreground">Solde en cours</p>
          <p className="font-mono font-semibold">{formatDzd(outstanding)}</p>
        </div>
        <FormField
          label="Montant"
          required
          hint="Négatif = crédit (remise / annulation de dette). Positif = débit (pénalité / frais supplémentaires)."
        >
          <MoneyInput value={amount} onChange={setAmount} />
        </FormField>
        <FormField label="Motif (reason code)" required hint="Liste contrôlée — aucun texte libre (plan §07.04)">
          <select
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            value={reasonCode}
            onChange={(e) => setReasonCode(e.target.value as AdjustmentReasonCode)}
          >
            {ADJUSTMENT_REASON_CODES.map((code) => (
              <option key={code} value={code}>
                {ADJUSTMENT_REASON_LABELS_FR[code]}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Note administrative" required hint="Obligatoire — expliquer la décision pour l'audit">
          <Textarea
            value={adminNote}
            onChange={(e) => setAdminNote(e.target.value)}
            placeholder="ex. Remise fratrie 10% applicable au 2ème enfant (décision direction)"
            rows={3}
          />
        </FormField>
      </div>
    </UnifiedModal>
  );
}

// ============================================================
// Helpers
// ============================================================

function SectionTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {icon}
      {children}
    </p>
  );
}

function Detail({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={className}>
      <p className="text-[10px] uppercase text-muted-foreground">{label}</p>
      <p className="text-sm text-foreground">{value}</p>
    </div>
  );
}

function BalanceCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "default" | "success" | "danger" | "neutral";
}) {
  const toneClass = {
    default: "text-foreground",
    success: "text-status-success",
    danger: "text-status-danger",
    neutral: "text-muted-foreground",
  }[tone];
  return (
    <div className="rounded-md border border-border p-2 text-center">
      <p className="text-[10px] uppercase text-muted-foreground">{label}</p>
      <p className={`text-sm font-mono font-semibold ${toneClass}`}>{formatDzdPlain(value)}</p>
    </div>
  );
}

function zoneLabel(parent: { transportDestination?: TransportDestination | null; cityTier?: string | null }): string {
  // Prefer the canonical TransportDestination field; fall back to legacy cityTier.
  const dest = parent.transportDestination ?? cityTierToDestination(parent.cityTier as "t1" | "t2" | "t3" | null | undefined);
  if (dest) return TRANSPORT_DESTINATION_LABELS_FR[dest];
  return "—";
}

function levelLabel(level: string): string {
  if (level === "primaire") return "Primaire";
  if (level === "cem") return "CEM";
  if (level === "lycee") return "Lycée";
  return level;
}

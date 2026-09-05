/**
 * ParentDetailDrawer — slide-over panel showing a parent's complete profile.
 *
 * Plan §04.05: 3 sections — Identity / Children / Finances.
 * The Finances section embeds:
 *   1. Balance Cards (Brut facturé, Net à payer, Payé, Reste / Crédit parent).
 *   2. Itemized Shopping List & Allocation ("Ce que couvre le montant dû" & "Où sont allés les paiements"):
 *      - Academic Year & Class placement per child
 *      - Sticker Price / Prestation breakdown (service icons + subtotals,
 *        T-168) + family-level unattributed block (multi-child families)
 *      - Waterfall tranche allocation (shows exactly which tranches the payments covered)
 *      - Toggle between "Par Enfant" and "Par Service / Total" (share % +
 *        per-child attribution per service, T-168)
 *   3. Installment schedule (Tranches).
 *   4. Recent payments list with breakdown.
 *   5. Explicit Adjustments History with clear context, badges, and diagnostic notes.
 *      T-168: every adjustment carries a PROVENANCE classification
 *      (Documenté = actual content / Contrepassation = net-zero reversal
 *      pair / Non documenté = legacy import to audit) plus a full meaning
 *      sentence — no entry can be mistaken for unexplained money.
 *   6. Adjustment-aware reconciliation footer (T-168): gross − remises +
 *      majorations = net; net − cleared − pending = reste; explicit bridge
 *      to the server balance.
 */
import { useState, useMemo } from "react";
import {
  MessageCircle,
  MessagesSquare,
  Mail,
  FileText,
  Plus,
  UserPlus,
  Wallet,
  AlertTriangle,
  Pencil,
  KeyRound,
  User as UserIcon,
  ShoppingCart,
  Users,
  Layers,
  HelpCircle,
  Sparkles,
  Calendar,
  CheckCircle2,
  Clock,
  BookOpen,
  GraduationCap,
  Bus,
  Utensils,
  Shirt,
  Palette,
  Brain,
  Mic,
  HandCoins,
  Package,
  ArrowLeftRight,
  type LucideIcon,
} from "lucide-react";
import { useRepositories } from "../../app/providers/repository-provider";
import { useToast } from "../../app/providers/toast-provider";
import { useAuth } from "../../app/providers/auth-provider";
import { useObservable } from "../../shared/hooks/use-observable";
import {
  EntityDetailDrawer,
  type EntityDrawerTab,
  type EntityDrawerAction,
} from "../../shared/ui/entity-drawer";
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
  ADJUSTMENT_REASON_CODES,
  ADJUSTMENT_REASON_LABELS_FR,
  type AdjustmentReasonCode,
  type Installment,
  type ParentFinancialProfile,
  type Payment,
} from "../../domain/model/payment";
import { UnifiedPaymentModal } from "../financials/unified-payment-modal";
import { deterministicActivationCode } from "../../core/format/id";
import { displayParentCredit } from "../../domain/calc/ledger/balance";
import {
  computeParentBillingBreakdown,
  classifyAdjustmentHistory,
  type AdjustmentProvenance,
} from "../../domain/calc/payment/billing-breakdown";
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
import { GRADE_LEVEL_LABELS_FR, type Student } from "../../domain/model/student";
import type { LedgerEntry } from "../../domain/model/ledger";
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
  onAddChild?: (parent: Parent) => void;
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
  const ledgerEntries = useObservable(
    () => repos.ledger.observeByParent(parentId ?? ""),
    [parentId],
  );
  // T-164: REAL tranche rows — the Finances tab previously synthesized the
  // 40/30/30 schedule from charge entries even when physical `installments`
  // rows existed (the debt-profile contract shipped an empty list — see the
  // SupabaseDebtRepository fix). Reading the canonical installment stream
  // keeps this tab consistent with the UnifiedPaymentModal + Installments
  // tab, which already consume `repos.installments`.
  const installments = useObservable(
    () => repos.installments.observeByParent(parentId ?? ""),
    [parentId],
  );
  const classes = useObservable(() => repos.classes.observe(), []);
  const academicYears = useObservable(() => repos.academicYears.observeAll(), []);

  const [collectOpen, setCollectOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [activationCode, setActivationCode] = useState<string | null>(null);
  const [issuingCode, setIssuingCode] = useState(false);
  const [openingChannel, setOpeningChannel] = useState(false);

  const entity: Parent | null = open && parentId && parent ? parent : null;

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

  async function issueActivationCode(p: Parent) {
    setIssuingCode(true);
    try {
      let code: string | null = null;
      const approvals = (repos as { approvals?: { generateActivationCode(parentId: string): Promise<{ ok: boolean; value?: string }> } }).approvals;
      if (isSupabaseConfigured() && approvals) {
        const res = await approvals.generateActivationCode(p.id);
        if (res.ok && res.value) {
          code = res.value;
        } else {
          // T-145 / ACT-200: Supabase mode FAILED (RPC or insert error). Do
          // NOT fall through to the deterministic phantom code — surface the
          // failure so staff can retry instead of handing the parent a code
          // the portal will reject, and audit-log the failed issuance so the
          // failure is traceable (this audit branch was lost in the
          // pre-T-164 patch squash and is restored verbatim).
          const detail = res && "error" in res && res.error ? (res.error as { message?: string; userMessage?: string }) : null;
          const why = detail?.userMessage ?? detail?.message ?? "erreur inconnue";
          toast.showError(
            "Émission impossible",
            `Le code n'a PAS été enregistré sur le serveur — n'utilisez pas le code affiché. Détail : ${why}`,
          );
          void repos.audit.log({
            action: "parent.activation_code_issuance_failed",
            entityType: "parent",
            entityId: p.id,
            actorId: session?.userId ?? "usr-current",
            actorName: session?.displayName ?? "Session courante",
            tenantId: p.tenantId,
            diff: { before: null, after: null },
            note: `Émission du code d'activation ÉCHOUÉE pour ${parentDisplayName(p)} (le serveur n'a pas de code — ACT-200)`,
          });
          return;
        }
      }
      if (!code) {
        code = deterministicActivationCode(p.code, p.tenantId);
      }
      setActivationCode(code);
      void repos.audit.log({
        action: "parent.activation_code_issued",
        entityType: "parent",
        entityId: p.id,
        actorId: session?.userId ?? "usr-current",
        actorName: session?.displayName ?? "Session courante",
        tenantId: p.tenantId,
        diff: { before: null, after: { parentCode: p.code } },
        note: `Code d'activation portail émis pour ${parentDisplayName(p)}`,
      });
    } finally {
      setIssuingCode(false);
    }
  }

  async function openParentConversation(p: Parent) {
    if (!session) return;
    setOpeningChannel(true);
    try {
      const r = await repos.chat.openParentChannel(
        p.id,
        parentDisplayName(p),
      );
      if (r.ok) {
        toast.showSuccess(
          "Conversation prête",
          `« ${r.value.name} » — visible dans le portail parents (Messagerie).`,
        );
      } else {
        toast.showError("Conversation impossible", r.error.userMessage);
      }
    } finally {
      setOpeningChannel(false);
    }
  }

  const canAdjust = !!session && session.permissions.has(Permission.AdjustAccount);
  const canIssueActivation = !!session && session.permissions.has(Permission.EditParent);

  // === Tabs Definition ===
  const tabs = (p: Parent): readonly EntityDrawerTab<Parent>[] => [
    {
      id: "identity",
      label: "Identité",
      content: () => (
        <div className="space-y-4 text-sm">
          <div className="rounded-lg border border-border bg-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <SectionTitle icon={<UserIcon className="h-3.5 w-3.5" />}>
                Coordonnées & Informations
              </SectionTitle>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setEditOpen(true)}
              >
                <Pencil className="h-3 w-3 mr-1" /> Modifier
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Detail label="Téléphone" value={p.phone} mono />
              <Detail label="WhatsApp" value={p.whatsapp ?? "—"} mono />
              <Detail label="E-mail" value={p.email ?? "—"} />
              <Detail label="Profession" value={p.occupation ?? "—"} />
              <Detail label="Zone de transport" value={zoneLabel(p)} />
              <Detail label="Langue préférée" value={p.preferredLanguage === "fr" ? "Français" : "العربية"} />
              <Detail label="Adresse" value={p.address ?? "—"} className="col-span-2" />
            </div>

            <div className="pt-2 border-t border-border/60 flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs text-status-success hover:text-status-success"
                onClick={() => {
                  const clean = (p.whatsapp || p.phone || "").replace(/[\s+]/g, "");
                  if (clean) window.open(`https://wa.me/${clean}`);
                }}
              >
                <MessageCircle className="h-3.5 w-3.5 mr-1 text-status-success" />
                WhatsApp ({p.whatsapp || p.phone})
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() => void openParentConversation(p)}
                disabled={openingChannel}
              >
                <MessagesSquare className="h-3.5 w-3.5 mr-1" /> Messager interne
              </Button>
              {p.email && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => window.open(`mailto:${p.email}`)}
                >
                  <Mail className="h-3.5 w-3.5 mr-1" /> E-mail
                </Button>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card p-4 space-y-3">
            <SectionTitle icon={<KeyRound className="h-3.5 w-3.5" />}>
              Portail Parents & Sécurité
            </SectionTitle>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              <Detail label="Code famille" value={p.code} mono />
              <div>
                <p className="text-[10px] uppercase text-muted-foreground">Statut financier</p>
                <div className="mt-0.5">
                  <StatusChip
                    label={p.financiallyRestricted ? "Accès restreint" : "Actif"}
                    tone={p.financiallyRestricted ? "danger" : "success"}
                  />
                </div>
              </div>
            </div>
            {canIssueActivation && (
              <div className="pt-2 border-t border-border/60 flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  Générer un code à usage unique pour lier le compte web du parent.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs shrink-0"
                  onClick={() => void issueActivationCode(p)}
                  disabled={issuingCode}
                >
                  <KeyRound className="h-3.5 w-3.5 mr-1" /> Code d'activation
                </Button>
              </div>
            )}
          </div>
        </div>
      ),
    },
    {
      id: "children",
      label: "Enfants",
      badge: () => students.length,
      content: () => (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <SectionTitle icon={<UserPlus className="h-3.5 w-3.5" />}>
              Enfants inscrits ({students.length})
            </SectionTitle>
            {onAddChild && (
              <Button size="sm" variant="outline" onClick={() => onAddChild(p)}>
                <Plus className="h-4 w-4 mr-1" /> Ajouter un enfant
              </Button>
            )}
          </div>
          {students.length === 0 ? (
            <p className="text-xs text-muted-foreground italic py-4 text-center">Aucun enfant inscrit.</p>
          ) : (
            <ul className="space-y-2">
              {students.map((s) => {
                const klass = classes.find((c) => c.id === s.classId) ?? null;
                const clickable = !!onOpenStudent;
                return (
                  <li
                    key={s.id}
                    className={cn(
                      "flex items-center gap-3 rounded-md border border-border p-2.5 bg-card",
                      clickable &&
                        "cursor-pointer hover:bg-accent/10 hover:border-primary/40 transition-colors",
                    )}
                    onClick={() => clickable && onOpenStudent(s.id)}
                    title={clickable ? "Ouvrir le dossier de l'élève" : undefined}
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
                        {s.gradeLevel ? (GRADE_LEVEL_LABELS_FR[s.gradeLevel] ?? s.gradeLevel) : levelLabel(s.level)}
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
          payments={payments}
          installments={installments}
          students={students}
          ledgerEntries={ledgerEntries}
          classes={classes}
          academicYears={academicYears}
          canAdjust={canAdjust}
          onAdjust={() => setAdjustOpen(true)}
          onDownloadStatement={() => void handleDownloadStatement(p)}
        />
      ),
    },
  ];

  const actions = (): readonly EntityDrawerAction<Parent>[] => {
    const list: EntityDrawerAction<Parent>[] = [];

    list.push({
      label: "Modifier",
      onClick: () => setEditOpen(true),
      variant: "outline",
      icon: <Pencil className="h-4 w-4" />,
    });

    if (canIssueActivation) {
      list.push({
        label: "Code d'activation",
        onClick: (pp) => void issueActivationCode(pp),
        variant: "outline",
        icon: <KeyRound className="h-4 w-4" />,
        disabled: () => issuingCode,
      });
    }

    list.push({
      label: "Encaisser / Régler",
      onClick: () => setCollectOpen(true),
      variant: "default",
      icon: <Wallet className="h-4 w-4" />,
      disabled: () => (financialProfile?.totalOutstanding ?? 0) <= 0,
    });

    return list;
  };

  return (
    <>
      <EntityDetailDrawer<Parent>
        open={open}
        onOpenChange={onOpenChange}
        entity={entity}
        widthClass="max-w-4xl"
        title={(p) => parentDisplayName(p)}
        subtitle={(p) => p.code}
        avatar={(p) => ({
          initials: `${p.firstName[0] ?? ""}${p.lastName[0] ?? ""}`.toUpperCase(),
        })}
        tabs={tabs}
        actions={actions}
        headerAccent="bg-primary/5"
      />

      {entity && (
        <>
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
// FinancesTab — Balance cards + Itemized Shopping List + Settlement Waterfall
// ============================================================

function FinancesTab({
  profile,
  outstanding,
  overdue,
  payments,
  installments,
  students,
  ledgerEntries,
  classes,
  academicYears,
  canAdjust,
  onAdjust,
  onDownloadStatement,
}: {
  profile: ParentFinancialProfile | null | undefined;
  outstanding: number;
  overdue: number;
  payments: readonly Payment[];
  installments: readonly Installment[];
  students: readonly Student[];
  ledgerEntries: readonly LedgerEntry[];
  classes: readonly import("../../domain/model/academic").AcademicClass[];
  academicYears: readonly import("../../domain/model/academic").AcademicYear[];
  canAdjust: boolean;
  onAdjust: () => void;
  onDownloadStatement: () => void;
}) {
  const [breakdownMode, setBreakdownMode] = useState<"by_child" | "by_service">("by_child");

  // T-164/T-168 — Zero-Logic Rule: the entire billing breakdown (itemized
  // charges, per-child attribution, REAL tranche coverage with the server
  // waterfall amounts, canonical 40/30/30 synthesis fallback, per-service
  // totals with share % + child attribution, family-level unattributed
  // items, academic-year resolution AND the adjustment-aware reconciliation
  // feeding the server-balance bridge) is derived by the canonical engine
  // in `domain/calc/payment/billing-breakdown.ts`. The previous inline
  // implementation (defect class DATA-008) re-implemented the split + a
  // waterfall that ignored `amountPending` and re-derived tranches from
  // charges even when real `installments` rows existed.
  const breakdown = useMemo(
    () =>
      computeParentBillingBreakdown({
        ledgerEntries,
        installments,
        payments,
        students,
        fallbackTotalDue: profile?.totalDue,
        adjustments: profile?.adjustments,
        serverOutstanding: profile?.totalOutstanding,
        hints: {
          classAcademicYearOf: (studentId) => {
            const s = students.find((x) => x.id === studentId);
            const cls = s?.classId ? classes.find((c) => c.id === s.classId) : null;
            return cls?.academicYear ?? null;
          },
          currentYearCode:
            academicYears.find((y) => y.isCurrent && !y.isArchived)?.code ?? null,
        },
        classLabelOf: (studentId) => {
          const s = students.find((x) => x.id === studentId);
          const cls = s?.classId ? classes.find((c) => c.id === s.classId) : null;
          return cls?.name ?? null;
        },
      }),
    [ledgerEntries, installments, payments, students, profile, classes, academicYears],
  );

  // T-168 — provenance classification of every adjustment (actual content /
  // net-zero reversal pair / undocumented legacy), derived canonically so
  // the drawer, the website portal and the Android terminal label the same
  // row identically.
  const classifiedAdjustments = useMemo(
    () => (profile ? classifyAdjustmentHistory(profile.adjustments) : []),
    [profile],
  );

  const recon = breakdown.reconciliation;
  const totalPaidAmount = breakdown.totalClearedPaid;

  return (
    <div className="space-y-4 text-sm">
      {/* Financial Actions Bar */}
      <div className="flex items-center justify-between">
        <SectionTitle icon={<Wallet className="h-3.5 w-3.5" />}>Finances & Facturation</SectionTitle>
        <div className="flex items-center gap-1.5">
          {canAdjust && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={onAdjust}
            >
              Ajuster le compte
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={onDownloadStatement}
            disabled={payments.length === 0}
          >
            <FileText className="h-3 w-3 mr-1" /> Relevé PDF
          </Button>
        </div>
      </div>

      {/* Balance Cards — T-168: the four visible terms of the account equation */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <BalanceCard
          label="Brut facturé"
          value={recon.grossBilled}
          tone="default"
          sub="articles souscrits"
        />
        <BalanceCard
          label="Net à payer"
          value={recon.netDue}
          tone="default"
          sub={
            recon.adjustmentsCount > 0
              ? `après ${recon.adjustmentsCount} ajustement(s)`
              : "aucun ajustement"
          }
        />
        <BalanceCard
          label="Payé"
          value={profile?.totalPaid ?? totalPaidAmount}
          tone="success"
          sub={recon.pendingPaid > 0 ? `dont en attente : ${formatDzdPlain(recon.pendingPaid)}` : "encaissé"}
        />
        {outstanding < 0 ? (
          <BalanceCard
            label="Crédit parent"
            value={displayParentCredit(outstanding, profile?.totalUnallocatedCredit ?? 0)}
            tone="success"
            sub="à déduire plus tard"
          />
        ) : (
          <BalanceCard
            label="Reste à payer"
            value={outstanding}
            tone={outstanding > 0 ? "danger" : "neutral"}
            sub={outstanding > 0 ? "solde du compte" : "compte soldé"}
          />
        )}
      </div>

      {overdue > 0 && outstanding > 0 && (
        <div className="flex items-center gap-2 rounded-md border border-status-danger/40 bg-status-danger/10 p-2 text-xs">
          <AlertTriangle className="h-3.5 w-3.5 text-status-danger shrink-0" />
          <span className="text-status-danger font-medium">
            Créance en retard : {formatDzd(overdue)}
          </span>
        </div>
      )}

      {/* ============================================================ */}
      {/* SECTION: Itemized Shopping List, Sticker Price & Allocation */}
      {/* ============================================================ */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="border-b border-border px-3 py-2.5 bg-muted/30 flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <ShoppingCart className="h-4 w-4 text-primary" />
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-foreground">
                Décomposition du Prix & Affectation des Paiements
              </p>
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
                <span className="flex items-center gap-1 text-primary font-medium">
                  <Calendar className="h-3 w-3" />
                  Année Scolaire {breakdown.academicYear}
                </span>
                <span>·</span>
                <span>{students.length} enfant(s) inscrit(s)</span>
              </div>
            </div>
          </div>
          {/* Dual Toggle View */}
          <div className="flex items-center rounded-md border border-border bg-background p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setBreakdownMode("by_child")}
              className={cn(
                "flex items-center gap-1 px-2.5 py-1 rounded transition-colors",
                breakdownMode === "by_child"
                  ? "bg-primary text-primary-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Users className="h-3 w-3" /> Par Enfant
            </button>
            <button
              type="button"
              onClick={() => setBreakdownMode("by_service")}
              className={cn(
                "flex items-center gap-1 px-2.5 py-1 rounded transition-colors",
                breakdownMode === "by_service"
                  ? "bg-primary text-primary-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Layers className="h-3 w-3" /> Par Service
            </button>
          </div>
        </div>

        <div className="p-3 space-y-4">
          {breakdown.hasSyntheticTranches && (
            <div className="flex items-start gap-2 rounded-md border border-status-warning/40 bg-status-warning/10 p-2 text-[11px] text-status-warning">
              <HelpCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>
                Échéancier non matérialisé en base pour au moins un enfant — affichage
                déduit du décompte canonique (40 % / 30 % / 30 %, échéances 15 sep /
                15 déc / 15 mars) et de l'affectation chronologique des paiements
                encaissés. Les montants restent exacts au dinar.
              </span>
            </div>
          )}
          {breakdownMode === "by_child" ? (
            /* VIEW 1: Per Child Breakdown with Tranche Coverage */
            <div className="space-y-4">
              {breakdown.byChild.map((child) => (
                <div key={child.student.id} className="rounded-lg border border-border bg-surface-panel/30 p-3 space-y-3">
                  {/* Child Header */}
                  <div className="flex items-center justify-between border-b border-border/60 pb-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="flex items-center gap-1.5 font-bold text-foreground text-sm">
                        <BookOpen className="h-4 w-4 text-primary" />
                        {child.student.firstName} {child.student.lastName}
                      </div>
                      <Badge variant="outline" className="text-[10px] font-medium bg-primary/5 text-primary border-primary/20">
                        {child.gradeLabel}
                      </Badge>
                      <Badge variant="secondary" className="text-[10px] font-normal">
                        Classe : {child.classLabel ?? "Non assignée"}
                      </Badge>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] uppercase text-muted-foreground block">Prix Total Engagé</span>
                      <span className="font-mono font-bold text-sm text-foreground">
                        {formatDzd(child.billedTotal)}
                      </span>
                    </div>
                  </div>

                  {/* Sticker Price / Purchased items — T-168 with service icons + subtotal */}
                  <div className="space-y-1">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
                      Articles & Prestations Souscrites
                    </p>
                    {child.lineItems.length > 0 ? (
                      <div className="text-xs bg-muted/20 rounded p-2 border border-border/40">
                        <ul className="divide-y divide-border/40">
                          {child.lineItems.map((item) => {
                            const SvcIcon = serviceIconOf(item.category);
                            return (
                              <li key={item.id} className="py-1.5 flex items-center gap-2">
                                <span className="flex h-6 w-6 items-center justify-center rounded bg-primary/10 text-primary shrink-0">
                                  <SvcIcon className="h-3.5 w-3.5" />
                                </span>
                                <span className="text-foreground flex-1 min-w-0 truncate" title={item.label}>
                                  {item.label}
                                </span>
                                <span className="font-mono font-medium">{formatDzdPlain(item.amount)}</span>
                              </li>
                            );
                          })}
                        </ul>
                        <div className="pt-1.5 mt-1 border-t border-border/60 flex items-center justify-between">
                          <span className="text-[10px] uppercase text-muted-foreground font-semibold">
                            Sous-total {child.student.firstName}
                          </span>
                          <span className="font-mono font-bold text-foreground">
                            {formatDzdPlain(child.billedTotal)}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="text-xs bg-muted/20 rounded p-2 border border-border/40 flex items-center justify-between">
                        <span>Scolarité annuelle complète ({child.gradeLabel})</span>
                        <span className="font-mono font-medium">{formatDzdPlain(child.billedTotal)}</span>
                      </div>
                    )}
                  </div>

                  {/* WHERE THE MONEY WENT: Tranche Coverage (server waterfall) */}
                  <div className="space-y-1.5 pt-1">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold flex items-center gap-1">
                      <span>Échéancier & Affectation des {formatDzd(totalPaidAmount)} encaissés :</span>
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                      {child.tranches.map((t) => (
                        <div
                          key={t.key}
                          className={cn(
                            "rounded-md border p-2 text-xs space-y-1 transition-all",
                            t.status === "paid"
                              ? "border-status-success/40 bg-status-success/5"
                              : t.amountPaid > 0 || t.amountPending > 0
                                ? "border-status-warning/40 bg-status-warning/5"
                                : "border-border bg-card"
                          )}
                        >
                          <div className="flex items-center justify-between font-medium">
                            <span className="truncate" title={t.dueDate ? formatDate(t.dueDate) : undefined}>
                              {t.label}
                            </span>
                            {t.status === "paid" ? (
                              <CheckCircle2 className="h-3.5 w-3.5 text-status-success shrink-0" />
                            ) : t.amountPaid > 0 || t.amountPending > 0 ? (
                              <Clock className="h-3.5 w-3.5 text-status-warning shrink-0" />
                            ) : (
                              <span className="text-[10px] text-status-danger font-bold">Dû</span>
                            )}
                          </div>
                          <div className="text-muted-foreground text-[10px] flex justify-between">
                            <span>Échéance : {t.dueWindowLabel}</span>
                            <span>Prévu : <strong className="text-foreground font-mono">{formatDzdPlain(t.amountDue)}</strong></span>
                          </div>
                          {t.amountPending > 0 && (
                            <div className="text-[10px] text-status-warning">
                              En attente (chèque/virement) : {formatDzdPlain(t.amountPending)}
                            </div>
                          )}
                          <div className="text-[10px] flex justify-between pt-0.5 border-t border-border/40">
                            <span className="text-status-success">Payé : {formatDzdPlain(t.amountPaid)}</span>
                            <span className={t.remaining > 0 ? "text-status-danger font-bold font-mono" : "text-muted-foreground font-mono"}>
                              Reste : {formatDzdPlain(t.remaining)}
                            </span>
                          </div>
                          {t.amountDue > 0 && (
                            <div className="h-1 rounded bg-border overflow-hidden">
                              <div
                                className={cn(
                                  "h-full",
                                  t.status === "paid" ? "bg-status-success" : "bg-status-warning",
                                )}
                                style={{ width: `${Math.min(100, t.coveragePct)}%` }}
                              />
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            /* VIEW 2: Consolidated by Service — T-168 share % + child attribution */
            <div className="space-y-2">
              {breakdown.byService.map((s) => {
                const SvcIcon = serviceIconOf(s.category);
                return (
                  <div key={s.category} className="rounded-md border border-border bg-muted/10 p-2.5 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="flex h-7 w-7 items-center justify-center rounded bg-primary/10 text-primary shrink-0">
                        <SvcIcon className="h-4 w-4" />
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-foreground text-sm leading-tight">{s.label}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {s.count} élément(s) rattaché(s) pour l'année {breakdown.academicYear}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="font-mono font-bold text-sm text-primary block">{formatDzdPlain(s.amount)}</span>
                        <span className="text-[10px] text-muted-foreground">{s.sharePct} % du total</span>
                      </div>
                    </div>
                    {/* Share of total bar */}
                    <div className="h-1.5 rounded bg-border overflow-hidden">
                      <div
                        className="h-full bg-primary/70 rounded"
                        style={{ width: `${Math.min(100, s.sharePct)}%` }}
                      />
                    </div>
                    {/* Per-child attribution inside this service */}
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 pt-0.5">
                      {s.childAttribution.map((a) => (
                        <span key={`${s.category}-${a.studentId ?? "famille"}`} className="text-[10px] text-muted-foreground">
                          {a.studentName} : <strong className="text-foreground font-mono">{formatDzdPlain(a.amount)}</strong>
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
              {breakdown.unattributedItems.length > 0 && (
                <div className="rounded-md border border-dashed border-border p-2.5 space-y-1">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold flex items-center gap-1.5">
                    <Users className="h-3 w-3" /> Éléments familiaux (non rattachés à un enfant)
                  </p>
                  <ul className="divide-y divide-border/40 text-xs">
                    {breakdown.unattributedItems.map((item) => (
                      <li key={item.id} className="py-1 flex items-center justify-between">
                        <span className="text-foreground">{item.label}</span>
                        <span className="font-mono font-medium">{formatDzdPlain(item.amount)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Family-level block (Par Enfant view) — keeps the list exhaustive */}
          {breakdownMode === "by_child" && breakdown.unattributedItems.length > 0 && (
            <div className="rounded-lg border border-dashed border-border bg-muted/10 p-3 space-y-1.5">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold flex items-center gap-1.5">
                <Users className="h-3 w-3" /> Famille — éléments non rattachés à un enfant
              </p>
              <ul className="divide-y divide-border/40 text-xs">
                {breakdown.unattributedItems.map((item) => (
                  <li key={item.id} className="py-1 flex items-center justify-between">
                    <span className="text-foreground">{item.label}</span>
                    <span className="font-mono font-medium">{formatDzdPlain(item.amount)}</span>
                  </li>
                ))}
              </ul>
              <p className="text-[10px] text-muted-foreground text-right">
                Sous-total familial : <strong className="font-mono text-foreground">{formatDzdPlain(breakdown.unattributedTotal)}</strong>
              </p>
            </div>
          )}

          {/* Mathematical Reconciliation — T-168: the FULL account equation,
              every term visible and labelled (no mystery numbers). */}
          <div className="border-t border-border bg-muted/30 -mx-3 -mb-3 p-3 rounded-b-lg space-y-1">
            <p className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground flex items-center gap-1.5 pb-1">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              Réconciliation du compte — chaque dinar expliqué
            </p>
            <ReconRow label="Brut facturé (articles ci-dessus)" amount={recon.grossBilled} tone="gross" />
            {recon.adjustmentsCredit > 0 && (
              <ReconRow label="− Remises / déductions" amount={-recon.adjustmentsCredit} tone="credit" />
            )}
            {recon.adjustmentsDebit > 0 && (
              <ReconRow label="+ Majorations / annulations de remise" amount={recon.adjustmentsDebit} tone="debit" />
            )}
            <ReconRow label="= Net à payer" amount={recon.netDue} tone="net" />
            <ReconRow label="− Encaissé confirmé" amount={-recon.clearedPaid} tone="paid" />
            {recon.pendingPaid > 0 && (
              <ReconRow label="− En attente (chèque / virement non débloqué)" amount={-recon.pendingPaid} tone="paid" />
            )}
            <ReconRow label="= Reste net (dérivation locale)" amount={recon.derivedRemaining} tone="net" />
            {recon.hasBridge && (
              <div className="flex items-center justify-between text-[11px] rounded border border-status-warning/40 bg-status-warning/10 px-2 py-1">
                <span className="text-status-warning">
                  ± Pont — autres écritures (remboursements, contrepassations, ajustements anciens)
                </span>
                <span className="font-mono font-bold text-status-warning">
                  {recon.bridge > 0 ? "+" : "−"} {formatDzdPlain(Math.abs(recon.bridge))}
                </span>
              </div>
            )}
            {recon.serverOutstanding != null && (
              <div className="flex items-center justify-between text-sm pt-1 border-t border-border/60">
                <span className="text-muted-foreground uppercase text-[11px] font-semibold flex items-center gap-1">
                  {!recon.hasBridge && <CheckCircle2 className="h-3.5 w-3.5 text-status-success" />}
                  Solde du compte (source : serveur)
                </span>
                <span
                  className={cn(
                    "font-mono font-bold",
                    recon.serverOutstanding > 0 ? "text-status-danger" : "text-status-success",
                  )}
                >
                  {formatDzd(recon.serverOutstanding)}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      <Separator />

      {/* Recent Payments */}
      <div className="rounded-md border border-border bg-card">
        <div className="border-b border-border px-3 py-2 bg-muted/30">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Paiements récents
          </p>
        </div>
        {payments.length > 0 ? (
          <ul className="divide-y divide-border text-xs">
            {payments.slice(0, 5).map((p) => (
              <li key={p.id} className="flex items-center gap-2 px-3 py-2.5">
                <code className="font-mono text-[10px] text-muted-foreground">{p.receiptNumber}</code>
                <span className="text-muted-foreground">{PAYMENT_METHOD_LABELS_FR[p.method]}</span>
                <span className="ml-auto font-mono font-semibold">{formatDzdPlain(p.amount)}</span>
                <span className="text-muted-foreground text-[11px]">{formatRelative(p.collectedAt)}</span>
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

      {/* Adjustments Section */}
      <div className="rounded-md border border-border bg-card">
        <div className="border-b border-border px-3 py-2 bg-muted/30 flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
            Historique des ajustements
            <span className="text-[10px] font-normal lowercase">({profile?.adjustments.length ?? 0} entrée(s))</span>
          </p>
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <HelpCircle className="h-3 w-3" />
            <span>Remises & régularisations</span>
          </div>
        </div>

        <div className="p-3 bg-muted/15 border-b border-border/60 text-[11px] text-muted-foreground space-y-1">
          <p className="flex items-center gap-1.5 font-medium text-foreground">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            Comprendre ces montants :
          </p>
          <p>
            • <strong className="text-status-success font-mono">− En vert (Négatif) :</strong> Remise ou déduction qui <u>diminue</u> ce que doit la famille.
          </p>
          <p>
            • <strong className="text-status-danger font-mono">+ En rouge (Positif) :</strong> Majoration, ou <u>annulation d'une remise précédente</u> (qui <u>rajoute</u> de la dette).
          </p>
          <p className="pt-1 border-t border-border/40 mt-1">
            <span className="font-medium text-foreground">Origine de chaque écriture (badge) :</span>
            <span className="ml-1 rounded bg-status-success/10 text-status-success px-1 py-0.5">Documenté</span> contenu réel (décision d'opérateur, motif conservé) ·
            <span className="mx-1 rounded bg-status-warning/10 text-status-warning px-1 py-0.5">Contrepassation</span> paire +X/−X détectée — effet net nul (ré-import/révélateur) ·
            <span className="rounded bg-status-danger/10 text-status-danger px-1 py-0.5">Non documenté</span> entrée héritée à auditer (erreur probable).
          </p>
        </div>

        {classifiedAdjustments.length > 0 ? (
          <ul className="divide-y divide-border text-xs">
            {classifiedAdjustments.map((c) => {
              // T-168: badge + reason + PROVENANCE derived by the canonical
              // engine (shared with the website portal + Android terminal so
              // every platform labels the same adjustment identically):
              //   Documenté = actual content · Contrepassation = net-zero
              //   reversal pair · Non documenté = legacy import to audit.
              const isCredit = c.kind === "credit";
              const pair = c.pairedWithId
                ? classifiedAdjustments.find((x) => x.id === c.pairedWithId)
                : null;

              return (
                <li key={c.id} className="px-3 py-2.5 space-y-1 hover:bg-accent/5 transition-colors">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={`font-mono font-bold text-sm ${
                        isCredit ? "text-status-success" : "text-status-danger"
                      }`}
                    >
                      {isCredit ? "− " : "+ "}
                      {formatDzdPlain(Math.abs(c.amount))}
                    </span>

                    <Badge
                      variant="outline"
                      className={`text-[9px] ${
                        isCredit
                          ? "bg-status-success/10 text-status-success border-status-success/30"
                          : "bg-status-danger/10 text-status-danger border-status-danger/30"
                      }`}
                    >
                      {c.badgeLabel}
                    </Badge>

                    <ProvenanceChip provenance={c.provenance} />

                    <span className="text-muted-foreground text-[10px]">
                      {formatRelative(c.at)} ({formatDate(c.at)})
                    </span>

                    <span className="ml-auto text-[10px] text-muted-foreground font-mono bg-muted/40 px-1.5 py-0.5 rounded">
                      Auteur : {c.approvedBy}
                    </span>
                  </div>

                  <p
                    className={cn(
                      "text-[11px] text-foreground font-medium",
                      c.isDiagnosticFallback && "italic text-muted-foreground",
                    )}
                  >
                    {c.reasonLabel}
                  </p>

                  {/* T-168 — explicit meaning: what this entry IS and what it
                      does to the balance (content vs trap vs mistake). */}
                  <p className="text-[10px] text-muted-foreground flex items-start gap-1.5">
                    <HelpCircle className="h-3 w-3 shrink-0 mt-0.5" />
                    <span>{c.meaningLabel}</span>
                  </p>

                  {pair && (
                    <p className="text-[10px] text-muted-foreground flex items-center gap-1.5 font-mono bg-muted/30 rounded px-1.5 py-0.5 w-fit">
                      <ArrowLeftRight className="h-3 w-3 text-status-warning" />
                      Contrepassée par l'écriture {isCredit ? "débit" : "crédit"} du {formatDate(pair.at)}
                      {pair.receiptRef && pair.receiptRef.length > 0 ? ` (réf. ${pair.receiptRef})` : ""}
                    </p>
                  )}

                  {c.receiptRef && (
                    <p className="text-[10px] text-muted-foreground font-mono">
                      Réf. pièce : {c.receiptRef}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="px-3 py-3 text-xs text-muted-foreground">Aucun ajustement enregistré sur ce compte.</p>
        )}
      </div>
    </div>
  );
}

// ============================================================
// AdjustAccountModal
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
  const [reasonCode, setReasonCode] = useState<AdjustmentReasonCode>("sibling_discount");
  const [adminNote, setAdminNote] = useState("");

  async function submit() {
    if (amount === 0 || !adminNote.trim()) {
      toast.showWarning("Champs invalides", "Montant non nul et note administrative requis.");
      return;
    }
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
      description="Crédit ou débit discrétionnaire sur le compte du parent."
      submitLabel="Appliquer"
      submitIcon={Wallet}
      onSubmit={submit}
      submitDisabled={amount === 0 || !adminNote.trim()}
    >
      <div className="space-y-3">
        <div className="rounded-md border border-border p-2 text-xs bg-muted/20">
          <p className="text-muted-foreground">Solde en cours</p>
          <p className="font-mono font-semibold text-sm">{formatDzd(outstanding)}</p>
        </div>
        <FormField
          label="Montant (DZD)"
          required
          hint="Négatif = remise / crédit. Positif = pénalité / débit."
        >
          <MoneyInput value={amount} onChange={setAmount} />
        </FormField>
        <FormField label="Motif" required>
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
        <FormField label="Note administrative" required hint="Obligatoire pour la traçabilité d'audit">
          <Textarea
            value={adminNote}
            onChange={(e) => setAdminNote(e.target.value)}
            placeholder="Ex. Remise accordée par la direction..."
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

function Detail({ label, value, mono, className }: { label: string; value: string; mono?: boolean; className?: string }) {
  return (
    <div className={className}>
      <p className="text-[10px] uppercase text-muted-foreground">{label}</p>
      <p className={`text-sm text-foreground mt-0.5 ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  );
}

function BalanceCard({
  label,
  value,
  tone,
  sub,
}: {
  label: string;
  value: number;
  tone: "default" | "success" | "danger" | "neutral";
  sub?: string;
}) {
  const toneClass = {
    default: "text-foreground",
    success: "text-status-success",
    danger: "text-status-danger",
    neutral: "text-muted-foreground",
  }[tone];
  return (
    <div className="rounded-md border border-border p-2.5 text-center bg-card">
      <p className="text-[10px] uppercase text-muted-foreground">{label}</p>
      <p className={`text-base font-mono font-semibold mt-0.5 ${toneClass}`}>{formatDzdPlain(value)}</p>
      {sub && <p className="text-[9px] text-muted-foreground mt-0.5 leading-tight">{sub}</p>}
    </div>
  );
}

/** T-168 — lucide icon per billing category (presentation-only mapping). */
function serviceIconOf(category: string): LucideIcon {
  switch (category) {
    case "tuition":
      return GraduationCap;
    case "transport":
      return Bus;
    case "canteen":
      return Utensils;
    case "uniform":
    case "second_apron":
      return Shirt;
    case "books":
      return BookOpen;
    case "extracurricular":
      return Palette;
    case "therapy_psychology":
      return Brain;
    case "therapy_speech":
      return Mic;
    case "parent_credit":
      return HandCoins;
    default:
      return Package;
  }
}

/** T-168 — provenance chip: Documenté / Contrepassation / Non documenté. */
function ProvenanceChip({ provenance }: { provenance: AdjustmentProvenance }) {
  const styles: Record<AdjustmentProvenance, string> = {
    documented: "bg-status-success/10 text-status-success border-status-success/30",
    reversal_pair: "bg-status-warning/10 text-status-warning border-status-warning/40",
    undocumented: "bg-status-danger/10 text-status-danger border-status-danger/30",
  };
  const labels: Record<AdjustmentProvenance, string> = {
    documented: "Documenté",
    reversal_pair: "Contrepassation",
    undocumented: "Non documenté",
  };
  return (
    <span
      className={`text-[9px] font-medium border rounded px-1.5 py-0.5 ${styles[provenance]}`}
      title={
        provenance === "documented"
          ? "Contenu réel — décision d'opérateur, motif conservé"
          : provenance === "reversal_pair"
            ? "Paire annulée détectée — effet net nul sur le solde"
            : "Entrée héritée sans motif — à auditer"
      }
    >
      {labels[provenance]}
    </span>
  );
}

/** T-168 — one labelled line of the reconciliation equation. */
function ReconRow({
  label,
  amount,
  tone,
}: {
  label: string;
  amount: number;
  tone: "gross" | "credit" | "debit" | "net" | "paid";
}) {
  const amountClass = {
    gross: "text-foreground font-semibold",
    credit: "text-status-success",
    debit: "text-status-danger",
    net: "text-foreground font-bold",
    paid: "text-status-success",
  }[tone];
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-mono ${amountClass}`}>
        {amount < 0 ? "−" : amount > 0 ? "+" : ""} {formatDzdPlain(Math.abs(amount))}
      </span>
    </div>
  );
}

function zoneLabel(parent: { transportDestination?: TransportDestination | null; cityTier?: string | null }): string {
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
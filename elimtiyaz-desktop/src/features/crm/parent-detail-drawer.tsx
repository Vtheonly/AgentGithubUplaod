// ============================================================================
// FILE: elimtiyaz-desktop/src/features/crm/parent-detail-drawer.tsx
// ============================================================================

import { useState, useMemo, useEffect } from "react";
import {
  MessageCircle,
  MessagesSquare,
  Mail,
  FileText,
  Plus,
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
  ChevronDown,
  ChevronUp,
  Scale,
  Phone,
  ArrowRight,
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
  type EntityDrawerMetaItem,
} from "../../shared/ui/entity-drawer";
import { Button } from "../../shared/ui/button";
import { Badge } from "../../shared/ui/badge";
import { Avatar, AvatarFallback } from "../../shared/ui/avatar";
import { Separator } from "../../shared/ui/separator";
import { StatusChip } from "../../shared/ui/status-chip";
import { MoneyInput } from "../../shared/ui/money-input";
import { FormField } from "../../shared/ui/form-field";
import { Textarea } from "../../shared/ui/textarea";
import { Card, CardContent } from "../../shared/ui/card";
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
  type PaymentNavigationContext,
  installmentRemaining,
} from "../../domain/model/payment";
import { UnifiedPaymentModal } from "../financials/unified-payment-modal";
import { ParentYearHistorySection } from "./parent-year-history-section";
import type { PricingConfigSummary } from "../../domain/model/pricing";
import { deterministicActivationCode } from "../../core/format/id";
import { displayParentCredit } from "../../domain/calc/ledger/balance";
import {
  computeParentBillingBreakdown,
  classifyAdjustmentHistory,
  type AdjustmentProvenance,
  type ChildBillingBreakdown,
  type TrancheCoverageNode,
  type ServiceTotalNode,
} from "../../domain/calc/payment/billing-breakdown";
import {
  servicePricingProfiles,
  type ServicePricingProfile,
} from "../../domain/calc/payment/service-pricing-profile";
// T-444/UI-324: restored — the ServicePricingCard's échéancier section uses
// the canonical settled predicate (T-424/DATA-042, the INV-4 rule).
import { isInstallmentSettled } from "../../domain/calc/payment/queries";
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
import {
  GRADE_LEVEL_LABELS_FR,
  type Student,
} from "../../domain/model/student";
import type { LedgerEntry } from "../../domain/model/ledger";
import { Permission } from "../../core/rbac/permissions";
import { cn } from "../../shared/ui/cn";
import {
  generateAccountStatementPdf,
  downloadPdf,
} from "../../infrastructure/receipt-pdf";
import { StudentActionsMenu } from "../../shared/ui/student-actions-menu";
import { usePersonNavigation } from "../../shared/navigation/person-navigation-context";

export function ParentDetailDrawer({
  parentId,
  open,
  onOpenChange,
  onAddChild,
  onOpenStudent,
  onOpenPortalChat,
}: {
  parentId: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onAddChild?: (parent: Parent) => void;
  onOpenStudent?: (studentId: string) => void;
  /** T-463 / CHAT-300: open (and navigate to) this parent's PORTAL
   *  conversation — the CRM "Messagerie Portail" tab. The internal staff
   *  messenger is a separate system and is never used for parents. */
  onOpenPortalChat?: (channelId: string) => void;
}) {
  const repos = useRepositories();
  const toast = useToast();
  const { session } = useAuth();
  const { openStudent } = usePersonNavigation();

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
  const installments = useObservable(
    () => repos.installments.observeByParent(parentId ?? ""),
    [parentId],
  );
  const classes = useObservable(() => repos.classes.observe(), []);
  const academicYears = useObservable(
    () => repos.academicYears.observeAll(),
    [],
  );
  const pricingConfig = useObservable(() => repos.pricing.observe(), []);
  const allocations = useObservable(
    () =>
      repos.payments.observeAllocations?.() ?? {
        subscribe: () => () => {},
        get: () => [],
      },
    [],
  );
  const [yearPricingConfigs, setYearPricingConfigs] = useState<
    readonly PricingConfigSummary[]
  >([]);

  useEffect(() => {
    let cancelled = false;
    repos.pricing
      .listConfigs()
      .then((result) => {
        if (!cancelled && result.ok) setYearPricingConfigs(result.value);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [repos.pricing, parentId]);

  const [collectContext, setCollectContext] =
    useState<PaymentNavigationContext | null>(null);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [activationCode, setActivationCode] = useState<string | null>(null);
  const [issuingCode, setIssuingCode] = useState(false);
  const [openingChannel, setOpeningChannel] = useState(false);

  const entity: Parent | null = open && parentId && parent ? parent : null;

  function buildTrancheContext(
    child: ChildBillingBreakdown,
    tranche: TrancheCoverageNode,
  ): PaymentNavigationContext {
    const fallbackConsolidated = (
      preset: number,
    ): PaymentNavigationContext => ({
      parentId: entity?.id ?? parentId ?? "",
      parentName: entity ? parentDisplayName(entity) : undefined,
      parentCode: entity?.code,
      studentId: child.student.id,
      mode: "consolidated_debt",
      presetAmount: preset,
      lineItems: [
        {
          itemId: tranche.key,
          category: "tuition",
          label: `${tranche.label} — ${child.student.firstName} ${child.student.lastName}`,
          grossAmount: tranche.amountDue,
          discountAmount: 0,
          netAmount: tranche.amountDue,
          alreadyPaidAmount: tranche.amountPaid,
          remainingAmount: tranche.remaining,
          dueDate: tranche.dueDate ?? undefined,
          isOverdue:
            tranche.status === "unpaid" &&
            tranche.dueDate != null &&
            new Date(tranche.dueDate).getTime() < Date.now(),
        },
      ],
      allowPartial: true,
      originRoute: "crm.parent_drawer",
    });

    const real = tranche.installment;
    if (!real || real.parentId !== (entity?.id ?? parentId)) {
      return fallbackConsolidated(Math.max(0, tranche.remaining));
    }
    const remaining = installmentRemaining(real);
    const isOverdue = real.status === "overdue";
    const overdueDays = isOverdue
      ? Math.max(
          0,
          Math.floor(
            (Date.now() - new Date(real.dueDate).getTime()) / 86_400_000,
          ),
        )
      : undefined;
    return {
      parentId: real.parentId,
      parentName: entity ? parentDisplayName(entity) : undefined,
      parentCode: entity?.code,
      studentId: real.studentId,
      mode: "installment_tranche",
      targetItemId: real.id,
      presetAmount: remaining,
      overdueDays,
      dueWindowLabel: tranche.dueWindowLabel,
      lineItems: [
        {
          itemId: real.id,
          category: real.category,
          label: real.label,
          grossAmount: real.amountDue,
          discountAmount: 0,
          netAmount: real.amountDue,
          alreadyPaidAmount: real.amountPaid,
          remainingAmount: remaining,
          dueDate: real.dueDate,
          isOverdue,
          daysOverdue: overdueDays,
        },
      ],
      allowPartial: true,
      originRoute: "crm.parent_drawer",
    } as PaymentNavigationContext;
  }

  async function handleDownloadStatement(p: Parent) {
    if (payments.length === 0) {
      toast.showWarning(
        "Aucun paiement",
        "Ce parent n'a aucun paiement à inclure dans le relevé.",
      );
      return;
    }
    try {
      const pdfBytes = await generateAccountStatementPdf(payments, p);
      const fileName = `releve-compte-${p.code}-${new Date().toISOString().slice(0, 10)}.pdf`;
      downloadPdf(pdfBytes, fileName);
      toast.showSuccess("Relevé téléchargé", fileName);
    } catch (e) {
      toast.showError(
        "Échec du téléchargement",
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  async function issueActivationCode(p: Parent) {
    setIssuingCode(true);
    try {
      let code: string | null = null;
      const approvals = (
        repos as {
          approvals?: {
            generateActivationCode(
              parentId: string,
            ): Promise<{ ok: boolean; value?: string }>;
          };
        }
      ).approvals;
      if (isSupabaseConfigured() && approvals) {
        const res = await approvals.generateActivationCode(p.id);
        if (res.ok && res.value) {
          code = res.value;
        } else {
          toast.showError(
            "Émission impossible",
            "Le code n'a pas pu être enregistré sur le serveur.",
          );
          return;
        }
      }
      if (!code) {
        code = deterministicActivationCode(p.code, p.tenantId);
      }
      setActivationCode(code);
    } finally {
      setIssuingCode(false);
    }
  }

  async function openParentConversation(p: Parent) {
    if (!session) return;
    setOpeningChannel(true);
    try {
      const r = await repos.chat.openParentChannel(p.id, parentDisplayName(p));
      if (r.ok) {
        toast.showSuccess("Conversation prête", `« ${r.value.name} » ouverte.`);
        // T-463 / CHAT-300: the conversation lives in the PORTAL messenger
        // (the CRM tab) — take the operator straight to it instead of the
        // old toast-only dead end that dropped the channel into the mixed
        // internal list.
        if (onOpenPortalChat) {
          onOpenChange(false);
          onOpenPortalChat(r.value.id);
        }
      } else {
        toast.showError("Conversation impossible", r.error.userMessage);
      }
    } finally {
      setOpeningChannel(false);
    }
  }

  const canAdjust =
    !!session && session.permissions.has(Permission.AdjustAccount);
  const canIssueActivation =
    !!session && session.permissions.has(Permission.EditParent);

  const metadata = (p: Parent): readonly EntityDrawerMetaItem[] => [
    { label: "Code Famille", value: p.code },
    { label: "Téléphone", value: p.phone },
    { label: "Enfants Inscrits", value: `${students.length} élève(s)` },
    {
      label: "Solde Créance",
      value: formatDzd(financialProfile?.totalOutstanding ?? 0),
    },
  ];

  const tabs = (p: Parent): readonly EntityDrawerTab<Parent>[] => [
    {
      id: "identity",
      label: "Coordonnées & Accès",
      content: () => (
        <div className="space-y-4 text-sm">
          {/* Identity & Contact Card */}
          <Card className="rounded-xl border border-border/80 bg-surface-panel shadow-sm">
            <CardContent className="p-4 space-y-4">
              <div className="flex items-center justify-between border-b border-border/50 pb-3">
                <SectionTitle
                  icon={<UserIcon className="h-4 w-4 text-primary" />}
                >
                  Coordonnées Administratives
                </SectionTitle>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1 border-primary/30 text-primary"
                  onClick={() => setEditOpen(true)}
                >
                  <Pencil className="h-3 w-3" /> Modifier
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                <Detail label="Téléphone principal" value={p.phone} mono />
                <Detail
                  label="Numéro WhatsApp"
                  value={p.whatsapp ?? "—"}
                  mono
                />
                <Detail label="Adresse E-mail" value={p.email ?? "—"} />
                <Detail label="Profession" value={p.occupation ?? "—"} />
                <Detail label="Zone de transport" value={zoneLabel(p)} />
                <Detail
                  label="Langue préférée"
                  value={p.preferredLanguage === "fr" ? "Français" : "العربية"}
                />
                <Detail
                  label="Adresse physique"
                  value={p.address ?? "—"}
                  className="col-span-2"
                />
              </div>

              <div className="pt-2 border-t border-border/60 flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs text-status-success border-status-success/30 hover:bg-status-success/10"
                  onClick={() => {
                    const clean = (p.whatsapp || p.phone || "").replace(
                      /[\s+]/g,
                      "",
                    );
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
                  onClick={() => window.open(`tel:${p.phone}`)}
                >
                  <Phone className="h-3.5 w-3.5 mr-1" /> Appeler
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => void openParentConversation(p)}
                  disabled={openingChannel}
                >
                  <MessagesSquare className="h-3.5 w-3.5 mr-1" /> Messager
                  interne
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
            </CardContent>
          </Card>

          {/* Portal Security Card */}
          <Card className="rounded-xl border border-border/80 bg-surface-panel shadow-sm">
            <CardContent className="p-4 space-y-3">
              <SectionTitle
                icon={<KeyRound className="h-4 w-4 text-brand-gold" />}
              >
                Portail Parents & Sécurité du Dossier
              </SectionTitle>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                <Detail label="Identifiant Unique" value={p.code} mono />
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
                    Statut du Compte
                  </span>
                  <div className="mt-1">
                    <StatusChip
                      label={
                        p.financiallyRestricted
                          ? "Accès restreint"
                          : "Actif & Autorisé"
                      }
                      tone={p.financiallyRestricted ? "danger" : "success"}
                    />
                  </div>
                </div>
              </div>
              {canIssueActivation && (
                <div className="pt-2 border-t border-border/50 flex items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">
                    Émettez un code d'activation à usage unique pour lier
                    l'application web du parent.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs shrink-0 border-brand-gold/30 text-brand-gold hover:bg-brand-gold/10"
                    onClick={() => void issueActivationCode(p)}
                    disabled={issuingCode}
                  >
                    <KeyRound className="h-3.5 w-3.5 mr-1" /> Code d'activation
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      ),
    },
    {
      id: "children",
      label: "Enfants",
      badge: () => students.length,
      content: () => (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <SectionTitle
              icon={<GraduationCap className="h-4 w-4 text-primary" />}
            >
              Enfants rattachés ({students.length})
            </SectionTitle>
            {onAddChild && (
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                onClick={() => onAddChild(p)}
              >
                <Plus className="h-3.5 w-3.5 mr-1" /> Ajouter un enfant
              </Button>
            )}
          </div>

          {students.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-8 text-center text-xs text-muted-foreground">
              Aucun élève n'est encore rattaché à ce dossier familial.
            </div>
          ) : (
            <div className="space-y-2.5">
              {students.map((s) => {
                const klass = classes.find((c) => c.id === s.classId) ?? null;
                const handleOpen = () => {
                  if (onOpenStudent) {
                    onOpenStudent(s.id);
                  } else {
                    openStudent(s.id);
                  }
                };

                return (
                  <Card
                    key={s.id}
                    className="rounded-xl border border-border/70 bg-surface-panel hover:border-primary/40 hover:bg-surface-elevated/40 transition-all shadow-sm"
                  >
                    <CardContent className="p-3.5 flex items-center justify-between gap-3">
                      <div
                        onClick={handleOpen}
                        className="flex items-center gap-3 min-w-0 flex-1 cursor-pointer"
                      >
                        <Avatar className="h-10 w-10 shrink-0">
                          <AvatarFallback className="text-xs font-bold bg-primary/10 text-primary">
                            {s.firstName[0]}
                            {s.lastName[0]}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-foreground hover:text-primary transition-colors truncate">
                            {s.firstName} {s.lastName}
                          </p>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono mt-0.5">
                            <span>{s.code}</span>
                            <span>·</span>
                            <span>
                              {s.gradeLevel
                                ? (GRADE_LEVEL_LABELS_FR[s.gradeLevel] ??
                                  s.gradeLevel)
                                : levelLabel(s.level)}
                            </span>
                            {klass && (
                              <>
                                <span>·</span>
                                <span className="text-foreground font-medium">
                                  {klass.name}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <StatusChip
                          label={s.status === "active" ? "Actif" : s.status}
                          tone={s.status === "active" ? "success" : "neutral"}
                        />
                        <StudentActionsMenu
                          student={s}
                          parentName={parentDisplayName(p)}
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 text-xs text-primary"
                          onClick={handleOpen}
                        >
                          Fiche <ArrowRight className="h-3.5 w-3.5 ml-1" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      ),
    },
    {
      id: "finances",
      label: "Finances & Échéances",
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
          pricingConfig={pricingConfig}
          allocations={allocations}
          yearPricingConfigs={yearPricingConfigs}
          canAdjust={canAdjust}
          onAdjust={() => setAdjustOpen(true)}
          onDownloadStatement={() => void handleDownloadStatement(p)}
          onCollectTranche={(child, tranche) =>
            setCollectContext(buildTrancheContext(child, tranche))
          }
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
      icon: <Pencil className="h-3.5 w-3.5" />,
    });

    if (canIssueActivation) {
      list.push({
        label: "Code d'activation",
        onClick: (pp) => void issueActivationCode(pp),
        variant: "outline",
        icon: <KeyRound className="h-3.5 w-3.5" />,
        disabled: () => issuingCode,
      });
    }

    list.push({
      label: "Encaisser / Régler",
      onClick: () => {
        const outstandingTotal = financialProfile?.totalOutstanding ?? 0;
        setCollectContext(
          outstandingTotal > 0
            ? {
                parentId: entity!.id,
                parentName: parentDisplayName(entity!),
                parentCode: entity!.code,
                mode: "consolidated_debt",
                presetAmount: outstandingTotal,
                lineItems: [
                  {
                    itemId: `parent-debt-${entity!.id}`,
                    category: null,
                    label: "Solde familial consolidé (toutes catégories)",
                    grossAmount: outstandingTotal,
                    discountAmount: 0,
                    netAmount: outstandingTotal,
                    alreadyPaidAmount: 0,
                    remainingAmount: outstandingTotal,
                  },
                ],
                allowPartial: true,
                originRoute: "crm.parent_drawer",
              }
            : null,
        );
      },
      variant: "default",
      icon: <Wallet className="h-3.5 w-3.5" />,
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
        widthClass="w-full sm:max-w-xl md:max-w-2xl lg:max-w-3xl"
        title={(p) => parentDisplayName(p)}
        subtitle={(p) => `${p.code} · ${p.phone ?? "Sans téléphone"}`}
        metadata={metadata}
        avatar={(p) => ({
          initials:
            `${p.firstName[0] ?? ""}${p.lastName[0] ?? ""}`.toUpperCase(),
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
            open={collectContext !== null}
            onOpenChange={(o) => !o && setCollectContext(null)}
            context={collectContext}
          />
        </>
      )}
    </>
  );
}

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
  onCollectTranche,
  pricingConfig,
  allocations,
  yearPricingConfigs,
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
  pricingConfig:
    | import("../../domain/model/pricing").PricingConfig
    | null
    | undefined;
  allocations: readonly import("../../domain/model/payment").PaymentAllocation[];
  yearPricingConfigs: readonly PricingConfigSummary[];
  canAdjust: boolean;
  onAdjust: () => void;
  onDownloadStatement: () => void;
  onCollectTranche: (
    child: ChildBillingBreakdown,
    tranche: TrancheCoverageNode,
  ) => void;
}) {
  const [breakdownMode, setBreakdownMode] = useState<"by_child" | "by_service">(
    "by_child",
  );

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
            const cls = s?.classId
              ? classes.find((c) => c.id === s.classId)
              : null;
            return cls?.academicYear ?? null;
          },
          currentYearCode:
            academicYears.find((y) => y.isCurrent && !y.isArchived)?.code ??
            null,
        },
        classLabelOf: (studentId) => {
          const s = students.find((x) => x.id === studentId);
          const cls = s?.classId
            ? classes.find((c) => c.id === s.classId)
            : null;
          return cls?.name ?? null;
        },
      }),
    [
      ledgerEntries,
      installments,
      payments,
      students,
      profile,
      classes,
      academicYears,
    ],
  );

  const classifiedAdjustments = useMemo(
    () => (profile ? classifyAdjustmentHistory(profile.adjustments) : []),
    [profile],
  );

  const serviceProfiles = useMemo(
    () =>
      pricingConfig
        ? servicePricingProfiles({
            ledgerEntries,
            installments,
            students,
            pricingConfig,
            classLabelOf: (studentId) => {
              const s = students.find((x) => x.id === studentId);
              const cls = s?.classId
                ? classes.find((c) => c.id === s.classId)
                : null;
              return cls?.name ?? null;
            },
            academicYearContext:
              academicYears.find((y) => y.isCurrent && !y.isArchived)?.code ??
              null,
            fallbackAcademicYear: breakdown.academicYear,
          })
        : [],
    [
      ledgerEntries,
      installments,
      students,
      pricingConfig,
      classes,
      academicYears,
      breakdown.academicYear,
    ],
  );

  const recon = breakdown.reconciliation;
  const totalPaidAmount = breakdown.totalClearedPaid;

  return (
    <div className="space-y-4 text-sm">
      {/* Actions */}
      <div className="flex items-center justify-between">
        <SectionTitle icon={<Wallet className="h-3.5 w-3.5" />}>
          Finances & Facturation
        </SectionTitle>
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

      {/* Balance Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <BalanceCard
          label="Brut facturé"
          value={recon.grossBilled}
          tone="default"
          sub="Total des articles"
        />
        <BalanceCard
          label="Net à payer"
          value={recon.netDue}
          tone="default"
          sub={
            recon.adjustmentsCount > 0
              ? `${recon.adjustmentsCount} remise(s)`
              : "Aucune remise"
          }
        />
        <BalanceCard
          label="Payé"
          value={profile?.totalPaid ?? totalPaidAmount}
          tone="success"
          sub={
            recon.pendingPaid > 0
              ? `+${formatDzdPlain(recon.pendingPaid)} attente`
              : "Confirmé"
          }
        />
        {outstanding < 0 ? (
          <BalanceCard
            label="Crédit parent"
            // T-444/UI-324: kept single-line — the t-104 source-scan guard
            // pins the ADR-010 derivation call on the dossier card.
            value={displayParentCredit(outstanding, profile?.totalUnallocatedCredit ?? 0)}
            tone="success"
            sub="Avance disponible"
          />
        ) : (
          <BalanceCard
            label="Reste à payer"
            value={outstanding}
            tone={outstanding > 0 ? "danger" : "neutral"}
            sub={outstanding > 0 ? "Solde débiteur" : "Compte soldé"}
          />
        )}
      </div>

      {overdue > 0 && outstanding > 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-status-danger/40 bg-status-danger/10 p-3 text-xs">
          <AlertTriangle className="h-4 w-4 text-status-danger shrink-0" />
          <span className="text-status-danger font-semibold">
            Créance échue en retard : {formatDzd(overdue)}
          </span>
        </div>
      )}

      {/* T-252 (AI-review Screen 8, restored T-444/UI-324) — family-level
          « Couverture de l'Engagement Annuel » visual stack: paid vs
          remaining, derived from the canonical reconciliation (clearedPaid /
          netDue — the §15.18 discipline; pending funds shown as their own
          legend line, the bridge stays visible in the balance cards above). */}
      {recon.netDue > 0 && (
        <div className="rounded-xl border border-border bg-surface-panel/40 p-3.5 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Couverture de l'Engagement Annuel
            </span>
            <span className="font-mono text-xs text-foreground break-words">
              {formatDzdPlain(recon.clearedPaid)} / {formatDzdPlain(recon.netDue)} DZD
              ({Math.min(100, Math.round((recon.clearedPaid / recon.netDue) * 100))}%)
            </span>
          </div>
          <div className="h-3 w-full rounded-full bg-muted overflow-hidden flex" aria-hidden="true">
            <div
              className="h-full bg-status-success transition-all duration-700"
              style={{
                width: `${Math.min(100, Math.round((recon.clearedPaid / recon.netDue) * 100))}%`,
              }}
              title="Encaissé confirmé"
            />
            <div
              className="h-full bg-status-danger/80 transition-all duration-700"
              style={{
                width: `${Math.max(0, 100 - Math.min(100, Math.round((recon.clearedPaid / recon.netDue) * 100)))}%`,
              }}
              title="Reste à payer"
            />
          </div>
          <div className="flex flex-wrap justify-between gap-2 text-[10px] text-muted-foreground font-mono">
            <span className="flex items-center gap-1 text-status-success">
              <span className="h-1.5 w-1.5 rounded-full bg-status-success" />
              Payé : {formatDzdPlain(recon.clearedPaid)} DZD
            </span>
            {recon.pendingPaid > 0 && (
              <span className="flex items-center gap-1 text-status-warning">
                <span className="h-1.5 w-1.5 rounded-full bg-status-warning" />
                En attente : {formatDzdPlain(recon.pendingPaid)} DZD
              </span>
            )}
            <span className="flex items-center gap-1 text-status-danger">
              <span className="h-1.5 w-1.5 rounded-full bg-status-danger" />
              Reste : {formatDzdPlain(recon.derivedRemaining)} DZD
            </span>
          </div>
        </div>
      )}

      {/* Breakdown Card */}
      <Card className="rounded-xl border border-border/80 bg-surface-panel overflow-hidden shadow-sm">
        <div className="border-b border-border/60 px-4 py-3 bg-surface-elevated/30 flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <ShoppingCart className="h-4 w-4 text-primary" />
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-foreground">
                Décomposition du Prix & Affectation des Règlements
              </p>
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
                <span className="flex items-center gap-1 text-primary font-semibold">
                  <Calendar className="h-3 w-3" />
                  Année {breakdown.academicYear}
                </span>
                <span>·</span>
                <span>{students.length} élève(s)</span>
              </div>
            </div>
          </div>

          <div className="flex items-center rounded-lg border border-border bg-background p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setBreakdownMode("by_child")}
              className={cn(
                "flex items-center gap-1 px-3 py-1 rounded-md transition-all font-semibold",
                breakdownMode === "by_child"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Users className="h-3 w-3" /> Par Enfant
            </button>
            <button
              type="button"
              onClick={() => setBreakdownMode("by_service")}
              className={cn(
                "flex items-center gap-1 px-3 py-1 rounded-md transition-all font-semibold",
                breakdownMode === "by_service"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Layers className="h-3 w-3" /> Par Service
            </button>
          </div>
        </div>

        <CardContent className="p-4 space-y-4">
          {/* T-168 (restored T-444/UI-324): the synthetic-tranches honesty
              notice — the échéancier is deduced (40/30/30) when the DB has
              no installment rows for at least one child. */}
          {breakdown.hasSyntheticTranches && (
            <div className="flex items-start gap-2 rounded-lg border border-status-warning/40 bg-status-warning/10 p-2.5 text-[11px] text-status-warning">
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
            <div className="space-y-4">
              {breakdown.byChild.map((child) => (
                <div
                  key={child.student.id}
                  className="rounded-xl border border-border/80 bg-surface-elevated/30 p-3.5 space-y-3"
                >
                  <div className="flex items-center justify-between border-b border-border/50 pb-2.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm text-foreground flex items-center gap-1.5">
                        <BookOpen className="h-4 w-4 text-primary" />
                        {child.student.firstName} {child.student.lastName}
                      </span>
                      <Badge
                        variant="outline"
                        className="text-[10px] bg-primary/10 text-primary border-primary/20"
                      >
                        {child.gradeLabel}
                      </Badge>
                      <Badge variant="secondary" className="text-[10px]">
                        Classe : {child.classLabel ?? "Non assignée"}
                      </Badge>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] uppercase font-bold text-muted-foreground block">
                        Total Dû
                      </span>
                      <span className="font-mono font-bold text-sm text-foreground">
                        {formatDzd(child.billedTotal)}
                      </span>
                    </div>
                  </div>

                  {/* Prestations */}
                  <div className="space-y-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
                      Articles & Prestations
                    </span>
                    <div className="text-xs bg-muted/20 rounded-lg p-2.5 border border-border/40 space-y-1">
                      {child.lineItems.map((item) => (
                        <div
                          key={item.id}
                          className="flex items-center justify-between py-1 border-b border-border/30 last:border-0"
                        >
                          <span className="text-foreground truncate">
                            {item.label}
                          </span>
                          <span className="font-mono font-semibold">
                            {formatDzdPlain(item.amount)} DA
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Tranches */}
                  <div className="space-y-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
                      Apurement des tranches :
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {child.tranches.map((t) => (
                        <div
                          key={t.key}
                          className={cn(
                            "rounded-xl border p-2.5 text-xs space-y-1.5 transition-all shadow-sm",
                            t.status === "paid"
                              ? "border-status-success/40 bg-status-success/5"
                              : t.amountPaid > 0
                                ? "border-status-warning/40 bg-status-warning/5"
                                : "border-border bg-card",
                          )}
                        >
                          <div className="flex items-center justify-between font-semibold">
                            <span
                              className="truncate"
                              title={t.dueDate ? formatDate(t.dueDate) : undefined}
                            >
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
                          <div className="text-[10px] text-muted-foreground flex justify-between font-mono">
                            <span>Échéance : {t.dueWindowLabel}</span>
                            <span>Prévu : <strong className="text-foreground">{formatDzdPlain(t.amountDue)}</strong></span>
                          </div>
                          {t.amountPending > 0 && (
                            <div className="text-[10px] text-status-warning">
                              En attente (chèque/virement) : {formatDzdPlain(t.amountPending)}
                            </div>
                          )}
                          <div className="text-[10px] flex justify-between pt-1 border-t border-border/40 font-mono">
                            <span className="text-status-success">
                              Payé : {formatDzdPlain(t.amountPaid)}
                            </span>
                            <span
                              className={
                                t.remaining > 0
                                  ? "text-status-danger font-bold"
                                  : "text-muted-foreground"
                              }
                            >
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
                          {t.remaining > 0 && (
                            <Button
                              size="sm"
                              className="w-full h-7 text-xs mt-1.5 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
                              onClick={() => onCollectTranche(child, t)}
                              title={
                                t.installment
                                  ? `Encaisser ${formatDzdPlain(t.remaining)} DZD sur cette tranche (cible exacte)`
                                  : `Encaisser ${formatDzdPlain(t.remaining)} DZD (échéancier déduit — affectation waterfall)`
                              }
                            >
                              <Wallet className="h-3 w-3 mr-1" />
                              Encaisser {formatDzdPlain(t.remaining)}
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {breakdown.byService.map((s) => {
                const profile =
                  serviceProfiles.find((p) => p.category === s.category) ??
                  null;
                return (
                  <ServicePricingCard
                    key={s.category}
                    svc={s}
                    profile={profile}
                  />
                );
              })}
              {/* T-168 (restored T-444/UI-324): the family-level items that
                  no child claims — the list stays exhaustive. */}
              {breakdown.unattributedItems.length > 0 && (
                <div className="rounded-lg border border-dashed border-border p-2.5 space-y-1">
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

          {/* Family-level block (Par Enfant view — restored T-444/UI-324):
              keeps the itemization exhaustive in the per-child view too. */}
          {breakdownMode === "by_child" && breakdown.unattributedItems.length > 0 && (
            <div className="rounded-xl border border-dashed border-border bg-muted/10 p-3 space-y-1.5">
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

          {/* T-168 (restored T-444/UI-324): the Mathematical Reconciliation —
              the FULL account equation, every term visible and labelled (no
              mystery numbers), including the bridge to the server balance. */}
          <div className="border-t border-border bg-muted/30 -m-4 p-4 rounded-b-xl space-y-1">
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
        </CardContent>
      </Card>

      <Separator />

      {/* Paiements récents (restored T-444/UI-324) */}
      <div className="rounded-xl border border-border bg-card">
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

      {/* Historique des ajustements (T-168, restored T-444/UI-324): the
          provenance-classified adjustment history — the same canonical
          classification the website portal and the Android terminal render. */}
      <div className="rounded-xl border border-border bg-card">
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
            • <strong className="text-status-danger font-mono">+ En rouge (Positif) :</strong> Majoration, ou <u>annulation d'une remise précédente</u> (qui <u>rajoute</u> de dette).
          </p>
          <p className="pt-1 border-t border-border/40 mt-1">
            <span className="font-medium text-foreground">Origine de chaque écriture (badge) :</span>
            <span className="ml-1 rounded bg-status-success/10 text-status-success px-1 py-0.5">Documenté</span> contenu réel (décision d'opérateur, motif conservé) ·
            <span className="mx-1 rounded bg-status-warning/10 text-status-warning px-1 py-0.5">Contrepassation</span> paire +X/−X détectée — effet net nul (ré-import/révélélateur) ·
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

      {/* Yearly History Section */}
      <ParentYearHistorySection
        parentId={profile?.parentId ?? ""}
        parentName={profile?.parentName || undefined}
        installments={installments}
        payments={payments}
        allocations={allocations}
        ledgerEntries={ledgerEntries}
        academicYears={academicYears}
        pricingConfigs={useMemo(
          () => new Map(yearPricingConfigs.map((c) => [c.academicYearCode, c])),
          [yearPricingConfigs],
        )}
      />
    </div>
  );
}

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
  const [reasonCode, setReasonCode] =
    useState<AdjustmentReasonCode>("sibling_discount");
  const [adminNote, setAdminNote] = useState("");

  async function submit() {
    if (amount === 0 || !adminNote.trim()) {
      toast.showWarning(
        "Champs invalides",
        "Montant non nul et note administrative requis.",
      );
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
        `${amount < 0 ? "Crédit" : "Débit"} de ${formatDzdPlain(Math.abs(amount))} DA`,
      );
      onOpenChange(false);
      setAmount(0);
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
        <div className="rounded-md border border-border p-2.5 text-xs bg-muted/20">
          <p className="text-muted-foreground">Solde en cours</p>
          <p className="font-mono font-semibold text-sm">
            {formatDzd(outstanding)}
          </p>
        </div>
        <FormField
          label="Montant (DZD)"
          required
          hint="Négatif = remise. Positif = majoration."
        >
          <MoneyInput value={amount} onChange={setAmount} />
        </FormField>
        <FormField label="Motif" required>
          <select
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            value={reasonCode}
            onChange={(e) =>
              setReasonCode(e.target.value as AdjustmentReasonCode)
            }
          >
            {ADJUSTMENT_REASON_CODES.map((code) => (
              <option key={code} value={code}>
                {ADJUSTMENT_REASON_LABELS_FR[code]}
              </option>
            ))}
          </select>
        </FormField>
        <FormField
          label="Note administrative"
          required
          hint="Obligatoire pour la traçabilité d'audit"
        >
          <Textarea
            value={adminNote}
            onChange={(e) => setAdminNote(e.target.value)}
            placeholder="Ex. Remise exceptionnelle accordée..."
            rows={3}
          />
        </FormField>
      </div>
    </UnifiedModal>
  );
}

function SectionTitle({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
      {icon}
      {children}
    </div>
  );
}

function Detail({
  label,
  value,
  mono,
  className,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
        {label}
      </span>
      <div
        className={`text-xs sm:text-sm font-semibold text-foreground mt-0.5 ${mono ? "font-mono" : ""}`}
      >
        {value}
      </div>
    </div>
  );
}

/* T-168 (restored T-444/UI-324): the provenance chip + the reconciliation
 * row — the two render helpers the ajustements history and the account
 * equation consume (verbatim from the pre-redesign implementation, so the
 * classification semantics stay shared with the website + Android). */
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
    <div className="rounded-xl border border-border/80 p-3 text-center bg-card shadow-sm">
      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
        {label}
      </span>
      <p
        className={`text-base sm:text-lg font-mono font-bold mt-0.5 ${toneClass}`}
      >
        {formatDzdPlain(value)}
      </p>
      {sub && (
        <span className="text-[10px] text-muted-foreground mt-0.5 block truncate">
          {sub}
        </span>
      )}
    </div>
  );
}

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

function zoneLabel(parent: {
  transportDestination?: TransportDestination | null;
  cityTier?: string | null;
}): string {
  const dest =
    parent.transportDestination ??
    cityTierToDestination(
      parent.cityTier as "t1" | "t2" | "t3" | null | undefined,
    );
  if (dest) return TRANSPORT_DESTINATION_LABELS_FR[dest];
  return "—";
}

function levelLabel(level: string): string {
  if (level === "primaire") return "Primaire";
  if (level === "cem") return "CEM";
  if (level === "lycee") return "Lycée";
  return level;
}

/* T-334/T-168 render helpers (restored T-444/UI-324 — the exhaustive
 * pricing-profile expander consumes them). */
const PROFILE_MONTHS_FR = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];

const PROVENANCE_LABEL_FR: Record<string, string> = {
  excel_import: "Import Excel",
  current_year_wizard: "Saisie année en cours",
  reconciliation: "Réconciliation",
  manual: "Saisie manuelle",
  unknown: "Origine non documentée",
};

function ProfileChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
      {children}
    </span>
  );
}

function ProfileLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </p>
  );
}

function ProfileAmountRow({
  label, amount, strong, tone,
}: {
  label: string;
  amount: number;
  strong?: boolean;
  tone?: "success" | "danger" | "muted";
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className={strong ? "font-semibold text-foreground" : "text-muted-foreground"}>{label}</span>
      <span
        className={`font-mono ${strong ? "font-bold text-sm" : ""} ${
          tone === "success" ? "text-status-success" : tone === "danger" ? "text-status-danger" : tone === "muted" ? "text-muted-foreground" : ""
        }`}
      >
        {formatDzdPlain(amount)} DZD
      </span>
    </div>
  );
}

function ServicePricingCard({
  svc,
  profile,
}: {
  svc: ServiceTotalNode;
  profile: ServicePricingProfile | null;
}) {
  const [open, setOpen] = useState(false);
  const SvcIcon = serviceIconOf(svc.category);

  return (
    <div className="rounded-xl border border-border bg-surface-elevated/30 p-3 space-y-2">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0">
          <SvcIcon className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-foreground text-sm truncate">
            {profile?.label ?? svc.label}
          </p>
          <span className="text-[10px] text-muted-foreground font-mono">
            {svc.count} souscription(s)
          </span>
        </div>
        <div className="text-right shrink-0">
          <span className="font-mono font-bold text-sm text-primary block">
            {formatDzdPlain(svc.amount)} DA
          </span>
          <span className="text-[10px] text-muted-foreground font-mono">
            {svc.sharePct}% du total
          </span>
        </div>
      </div>

      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        className="w-full h-7 text-[11px] text-muted-foreground hover:text-foreground"
      >
        {open ? (
          <ChevronUp className="h-3 w-3 mr-1" />
        ) : (
          <ChevronDown className="h-3 w-3 mr-1" />
        )}
        {open ? "Masquer le détail tarifaire" : "Détails de tarification"}
      </Button>

      {open && (
        <div className="pt-2 border-t border-border/50 space-y-3 text-xs">
          {/* 1 — Couverture par enfant */}
          <div>
            <ProfileLabel>Couverture par enfant</ProfileLabel>
            <div className="space-y-1.5">
              {(profile?.childCoverage ?? []).map((c) => (
                <div key={c.studentId ?? "famille"} className="rounded-lg border border-border/50 bg-muted/20 p-2 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{c.studentName}{c.studentCode ? ` · ${c.studentCode}` : ""}</span>
                    <span className="font-mono font-bold">{formatDzdPlain(c.amount)} DZD</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {c.gradeLevelLabel && <ProfileChip>Niveau : {c.gradeLevelLabel}</ProfileChip>}
                    {c.cycle && <ProfileChip>Cycle : {c.cycle}</ProfileChip>}
                    {c.classLabel && <ProfileChip>Classe : {c.classLabel}</ProfileChip>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 2 — Tarif officiel (catalogue) — restored T-444/UI-324 */}
          <div>
            <ProfileLabel>Tarif officiel (catalogue)</ProfileLabel>
            {(profile?.catalog ?? []).length === 0 ? (
              <p className="text-muted-foreground">Référence catalogue non mappable.</p>
            ) : (
              <div className="space-y-1.5">
                {(profile?.catalog ?? []).map((ref, i) => (
                  <div key={`${ref.kind}-${ref.studentId ?? "f"}-${i}`} className="rounded-lg border border-border/50 bg-muted/20 p-2 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">
                        {ref.kind === "tuition_by_grade"
                          ? "Scolarité — tarif du niveau"
                          : ref.kind === "transport_by_destination"
                            ? "Transport — tarif de la zone"
                            : ref.kind === "registration_fee"
                              ? "Frais d'inscription"
                              : ref.kind === "additional_service"
                                ? "Service additionnel"
                                : "Service complémentaire"}{" "}
                        · {ref.scopeLabel}
                      </span>
                      {ref.annualAmount != null && (
                        <span className="font-mono font-bold">{formatDzdPlain(ref.annualAmount)} DZD</span>
                      )}
                    </div>
                    {ref.tranches.length > 0 && (
                      <div className="grid grid-cols-3 gap-1">
                        {ref.tranches.map((tr) => (
                          <div key={tr.n} className="rounded bg-background border border-border/50 px-1.5 py-1">
                            <p className="text-[9px] text-muted-foreground">
                              T{tr.n} · échéance {PROFILE_MONTHS_FR[tr.dueMonth - 1] ?? tr.dueMonth}
                            </p>
                            <p className="font-mono text-[10px] font-semibold">{formatDzdPlain(tr.amount)}</p>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-1">
                      {ref.unitAmount != null && <ProfileChip>Prix unitaire : {formatDzdPlain(ref.unitAmount)} DZD</ProfileChip>}
                      {ref.semesterAmount != null && <ProfileChip>Par semestre : {formatDzdPlain(ref.semesterAmount)} DZD</ProfileChip>}
                      {ref.billingModel && <ProfileChip>Facturation : {ref.billingModel}</ProfileChip>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 3 — Conditions applicables — restored T-444/UI-324 */}
          <div>
            <ProfileLabel>Conditions applicables</ProfileLabel>
            <div className="space-y-1">
              {(profile?.conditions ?? []).map((c, i) => (
                <div key={`${c.kind}-${c.code ?? i}`} className="flex flex-wrap items-center justify-between gap-2 rounded border border-border/50 bg-muted/20 px-2 py-1">
                  <span className="min-w-0 flex-1">
                    {c.label}
                    {c.deadline && <span className="text-muted-foreground"> · avant le {c.deadline}</span>}
                  </span>
                  <span className="font-mono font-semibold">
                    {c.valueType === "percentage"
                      ? `${c.value} % du prix`
                      : `${formatDzdPlain(c.value)} DZD`}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* 4 — Éléments facturés — restored T-444/UI-324 */}
          <div>
            <ProfileLabel>Éléments facturés ({profile?.items.length ?? 0})</ProfileLabel>
            <div className="space-y-1.5">
              {(profile?.items ?? []).map((item) => (
                <div key={item.id} className="rounded-lg border border-border/50 bg-muted/20 p-2 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 flex-1 font-medium">{item.description || "—"}</span>
                    <span className="font-mono font-bold">{formatDzdPlain(item.amount)} DZD</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <ProfileChip>{item.studentName}</ProfileChip>
                    {item.academicYear && <ProfileChip>{item.academicYear}</ProfileChip>}
                    {item.gradeLevelCode && <ProfileChip>Niveau : {item.gradeLevelCode}</ProfileChip>}
                    {item.trancheNumber != null && <ProfileChip>Tranche {item.trancheNumber}</ProfileChip>}
                    {item.destination && <ProfileChip>Zone : {item.destination}</ProfileChip>}
                    {item.paymentPlan && <ProfileChip>Plan : {item.paymentPlan}</ProfileChip>}
                    <ProfileChip>{PROVENANCE_LABEL_FR[item.provenance.source] ?? item.provenance.source}</ProfileChip>
                    {item.provenance.importRunId && <ProfileChip>run {item.provenance.importRunId}</ProfileChip>}
                    {item.provenance.reconciliation && <ProfileChip>récon. {item.provenance.reconciliation}</ProfileChip>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 5 — Remises appliquées — restored T-444/UI-324 */}
          <div>
            <ProfileLabel>Remises appliquées</ProfileLabel>
            {(profile?.appliedDiscounts ?? []).length === 0 ? (
              <p className="text-muted-foreground">Aucune remise appliquée sur ce service.</p>
            ) : (
              <div className="space-y-1">
                {(profile?.appliedDiscounts ?? []).map((d) => (
                  <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-status-success/30 bg-status-success/5 px-2 py-1">
                    <span className="min-w-0 flex-1">{d.label} · {d.studentName}</span>
                    <span className="font-mono font-semibold text-status-success">− {formatDzdPlain(d.amount)} DZD</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 6 — Échéancier — restored T-444/UI-324 */}
          <div>
            <ProfileLabel>Échéancier de paiement (cadre des tranches)</ProfileLabel>
            {(profile?.installmentPlan ?? []).length === 0 ? (
              <p className="text-muted-foreground">Aucun échéancier physique — devis global.</p>
            ) : (
              <div className="space-y-1">
                {(profile?.installmentPlan ?? []).map((tr) => {
                  // T-424 (DATA-042): the canonical settled predicate —
                  // the SAME rule Statistics and Finance use (INV-4).
                  const settled = isInstallmentSettled(tr);
                  return (
                    <div
                      key={tr.installmentId}
                      className={`rounded border p-2 space-y-0.5 ${
                        settled ? "border-status-success/40 bg-status-success/5" : "border-border/50 bg-muted/20"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold">{tr.studentName} · {tr.label}</span>
                        <span className={`font-mono text-[10px] ${settled ? "text-status-success" : "text-status-warning"}`}>
                          {formatDzdPlain(tr.amountPaid)} / {formatDzdPlain(tr.amountDue)} DZD
                          {tr.remaining > 0 && <span className="text-status-danger font-bold"> · reste {formatDzdPlain(tr.remaining)}</span>}
                        </span>
                      </div>
                      {tr.dueDate && (
                        <p className="text-[10px] text-muted-foreground">Échéance : {tr.dueDate}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 7 — Construction du prix — restored T-444/UI-324 */}
          <div>
            <ProfileLabel>Construction du prix</ProfileLabel>
            <div className="space-y-1 rounded-lg border border-border/50 bg-muted/20 p-2">
              {profile?.construction.catalogAnnual != null ? (
                <ProfileAmountRow label="Tarif catalogue (référence)" amount={profile.construction.catalogAnnual} tone="muted" />
              ) : (
                <p className="text-muted-foreground">Référence catalogue non mappable.</p>
              )}
              <ProfileAmountRow label="Devis brut facturé" amount={profile?.construction.billedGross ?? 0} />
              {(profile?.construction.adjustmentsDebit ?? 0) > 0 && (
                <ProfileAmountRow label="+ Annulations de remise / majorations" amount={profile?.construction.adjustmentsDebit ?? 0} tone="danger" />
              )}
              {(profile?.construction.discountsTotal ?? 0) > 0 && (
                <ProfileAmountRow label="− Remises appliquées" amount={profile?.construction.discountsTotal ?? 0} tone="success" />
              )}
              <ProfileAmountRow label="= Net facturé" amount={profile?.construction.billedNet ?? 0} strong />
              {profile?.construction.deltaVsCatalog != null && Math.abs(profile.construction.deltaVsCatalog) > 0 && (
                <div className="flex items-center justify-between gap-2 border-t border-border/50 pt-1">
                  <span className="inline-flex items-center gap-1 text-muted-foreground">
                    <Scale className="h-3 w-3" /> Écart vs tarif catalogue
                  </span>
                  <span
                    className={`font-mono font-bold ${
                      profile.construction.deltaVsCatalog > 0 ? "text-status-danger" : "text-status-success"
                    }`}
                  >
                    {profile.construction.deltaVsCatalog > 0 ? "+" : "−"}{" "}
                    {formatDzdPlain(Math.abs(profile.construction.deltaVsCatalog))} DZD
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

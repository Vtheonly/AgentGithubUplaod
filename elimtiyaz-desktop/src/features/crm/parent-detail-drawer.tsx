/**
 * ParentDetailDrawer — slide-over panel showing a parent's complete profile.
 *
 * Plan §04.05: 3 sections — Identity / Children / Finances.
 * The Finances section embeds:
 *   1. Balance Cards (Total Dû, Payé, Reste / Crédit parent).
 *   2. Itemized Shopping List / Prestations Facturées:
 *      Full breakdown of what the Total Dû covers, with a toggle
 *      between "Vue par Enfant" and "Vue Consolidée par Service".
 *   3. Installment schedule (Tranches).
 *   4. Recent payments list with breakdown.
 *   5. Explicit Adjustments History with clear context, badges, and diagnostic notes.
 */
import { useState, useMemo } from "react";
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
  Pencil,
  KeyRound,
  User as UserIcon,
  ShoppingCart,
  Users,
  Layers,
  HelpCircle,
  Sparkles,
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
  PAYMENT_CATEGORY_LABELS_FR,
  ADJUSTMENT_REASON_CODES,
  ADJUSTMENT_REASON_LABELS_FR,
  type AdjustmentReasonCode,
  type ParentFinancialProfile,
  type Payment,
  type PaymentCategory,
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
import type { Student } from "../../domain/model/student";
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
  const classes = useObservable(() => repos.classes.observe(), []);

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
          const detail = res && "error" in res && res.error ? (res.error as { message?: string; userMessage?: string }) : null;
          const why = detail?.userMessage ?? detail?.message ?? "erreur inconnue";
          toast.showError(
            "Émission impossible",
            `Le code n'a PAS été enregistré sur le serveur — Détail : ${why}`,
          );
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
          {/* Contact & Personal Info Card */}
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

            {/* Direct Communication Actions */}
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

          {/* Portal Access & Security Card */}
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
          parent={p}
          profile={financialProfile}
          outstanding={financialProfile?.totalOutstanding ?? 0}
          overdue={financialProfile?.overdueAmount ?? 0}
          payments={payments}
          students={students}
          ledgerEntries={ledgerEntries}
          canAdjust={canAdjust}
          onAdjust={() => setAdjustOpen(true)}
          onDownloadStatement={() => void handleDownloadStatement(p)}
        />
      ),
    },
  ];

  // === Footer Actions ===
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
        widthClass="max-w-2xl"
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
// FinancesTab — Balance cards + Itemized Shopping List + Tranches + Adjustments
// ============================================================

function FinancesTab({
  parent,
  profile,
  outstanding,
  overdue,
  payments,
  students,
  ledgerEntries,
  canAdjust,
  onAdjust,
  onDownloadStatement,
}: {
  parent: Parent;
  profile: ParentFinancialProfile | null | undefined;
  outstanding: number;
  overdue: number;
  payments: readonly Payment[];
  students: readonly Student[];
  ledgerEntries: readonly LedgerEntry[];
  canAdjust: boolean;
  onAdjust: () => void;
  onDownloadStatement: () => void;
}) {
  const [breakdownMode, setBreakdownMode] = useState<"by_child" | "by_service">("by_child");

  // Filter charges (items billed / purchased)
  const chargeEntries = useMemo(
    () => (ledgerEntries ?? []).filter((e) => e.type === "charge"),
    [ledgerEntries],
  );

  // Group charges by child
  const chargesByChild = useMemo(() => {
    const map = new Map<string, { student: Student; charges: LedgerEntry[]; total: number }>();
    for (const s of students) {
      map.set(s.id, { student: s, charges: [], total: 0 });
    }

    const unassigned: LedgerEntry[] = [];
    let unassignedTotal = 0;

    for (const c of chargeEntries) {
      if (c.studentId && map.has(c.studentId)) {
        const item = map.get(c.studentId)!;
        item.charges.push(c);
        item.total += c.amount;
      } else {
        unassigned.push(c);
        unassignedTotal += c.amount;
      }
    }

    return {
      children: Array.from(map.values()),
      unassigned,
      unassignedTotal,
    };
  }, [students, chargeEntries]);

  // Group charges by service category
  const chargesByCategory = useMemo(() => {
    const map = new Map<string, { category: PaymentCategory; label: string; total: number; count: number }>();
    for (const c of chargeEntries) {
      const cat = c.category;
      const existing = map.get(cat);
      if (existing) {
        existing.total += c.amount;
        existing.count += 1;
      } else {
        map.set(cat, {
          category: cat,
          label: PAYMENT_CATEGORY_LABELS_FR[cat] ?? cat,
          total: c.amount,
          count: 1,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [chargeEntries]);

  // Sum of all charge entries
  const totalBilledCharges = useMemo(
    () => chargeEntries.reduce((acc, c) => acc + c.amount, 0),
    [chargeEntries],
  );

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

      {/* Balance Cards */}
      <div className="grid grid-cols-3 gap-2">
        <BalanceCard label="Total Dû" value={profile?.totalDue ?? totalBilledCharges} tone="default" />
        <BalanceCard label="Payé" value={profile?.totalPaid ?? 0} tone="success" />
        {outstanding < 0 ? (
          <BalanceCard
            label="Crédit parent"
            value={displayParentCredit(outstanding, profile?.totalUnallocatedCredit ?? 0)}
            tone="success"
          />
        ) : (
          <BalanceCard label="Reste à payer" value={outstanding} tone={outstanding > 0 ? "danger" : "neutral"} />
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
      {/* SECTION: Itemized Shopping List / Ce que couvre le Total Dû */}
      {/* ============================================================ */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="border-b border-border px-3 py-2.5 bg-muted/30 flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <ShoppingCart className="h-4 w-4 text-primary" />
            <p className="text-xs font-semibold uppercase tracking-wide text-foreground">
              Détail des Prestations Facturées
            </p>
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

        <div className="p-3">
          {chargeEntries.length === 0 ? (
            <div className="text-center py-4 space-y-1.5 text-xs text-muted-foreground">
              <p>Aucune ligne de facturation détaillée trouvée dans le journal.</p>
              <p className="italic text-[11px]">
                Le montant total dû ({formatDzd(profile?.totalDue ?? 0)}) est calculé sur la base de la fiche d'inscription initiale ou de dettes antérieures.
              </p>
            </div>
          ) : breakdownMode === "by_child" ? (
            /* VIEW 1: Per Child Breakdown */
            <div className="space-y-3">
              {chargesByChild.children.map(({ student, charges, total }) => (
                <div key={student.id} className="rounded-md border border-border/80 bg-surface-panel/30 p-2.5 space-y-2">
                  <div className="flex items-center justify-between border-b border-border/50 pb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-foreground text-xs">
                        {student.firstName} {student.lastName}
                      </span>
                      <Badge variant="outline" className="text-[10px] font-mono">
                        {student.gradeLevel?.toUpperCase() ?? levelLabel(student.level)}
                      </Badge>
                    </div>
                    <span className="font-mono font-bold text-xs text-primary">
                      {formatDzdPlain(total)}
                    </span>
                  </div>
                  {charges.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground italic pl-2">Aucune prestation individualisée.</p>
                  ) : (
                    <ul className="divide-y divide-border/40 text-xs">
                      {charges.map((c) => (
                        <li key={c.id} className="py-1.5 flex items-center justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-foreground text-[11px] font-medium">
                              {c.description}
                            </p>
                            <span className="text-[10px] text-muted-foreground">
                              {PAYMENT_CATEGORY_LABELS_FR[c.category] ?? c.category}
                            </span>
                          </div>
                          <span className="font-mono font-medium text-xs shrink-0">
                            {formatDzdPlain(c.amount)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}

              {/* Shared or Unassigned family charges */}
              {chargesByChild.unassigned.length > 0 && (
                <div className="rounded-md border border-border/80 bg-surface-panel/30 p-2.5 space-y-2">
                  <div className="flex items-center justify-between border-b border-border/50 pb-1.5">
                    <span className="font-semibold text-foreground text-xs">
                      Frais Communs & Dossier Famille
                    </span>
                    <span className="font-mono font-bold text-xs text-primary">
                      {formatDzdPlain(chargesByChild.unassignedTotal)}
                    </span>
                  </div>
                  <ul className="divide-y divide-border/40 text-xs">
                    {chargesByChild.unassigned.map((c) => (
                      <li key={c.id} className="py-1.5 flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-foreground text-[11px] font-medium">
                            {c.description}
                          </p>
                          <span className="text-[10px] text-muted-foreground">
                            {PAYMENT_CATEGORY_LABELS_FR[c.category] ?? c.category}
                          </span>
                        </div>
                        <span className="font-mono font-medium text-xs shrink-0">
                          {formatDzdPlain(c.amount)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            /* VIEW 2: Consolidated By Service Category */
            <div className="space-y-2">
              <ul className="divide-y divide-border text-xs">
                {chargesByCategory.map((cat) => (
                  <li key={cat.category} className="py-2 flex items-center justify-between">
                    <div>
                      <p className="font-medium text-foreground">{cat.label}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {cat.count} prestation{cat.count > 1 ? "s" : ""} inscrite{cat.count > 1 ? "s" : ""}
                      </p>
                    </div>
                    <span className="font-mono font-bold text-sm">
                      {formatDzdPlain(cat.total)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Shopping list footer total */}
          {chargeEntries.length > 0 && (
            <div className="border-t border-border mt-3 pt-2 flex items-center justify-between text-xs font-semibold">
              <span className="text-muted-foreground uppercase">Sous-total des prestations facturées :</span>
              <span className="font-mono text-foreground font-bold">{formatDzd(totalBilledCharges)}</span>
            </div>
          )}
        </div>
      </div>

      <Separator />

      {/* Installments (Tranches) */}
      <div className="rounded-md border border-border bg-card">
        <div className="border-b border-border px-3 py-2 bg-muted/30">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Échéances / Tranches de Règlement
          </p>
        </div>
        {profile && profile.installments.length > 0 ? (
          <ul className="divide-y divide-border text-xs">
            {profile.installments.map((i) => (
              <li key={i.id} className="flex items-center gap-2 px-3 py-2.5">
                <div className="flex-1 min-w-0">
                  <span className="font-medium text-foreground">{i.label}</span>
                  <span className="text-muted-foreground ml-2">
                    {PAYMENT_CATEGORY_LABELS_FR[i.category]}
                  </span>
                </div>
                <span className="font-mono">{formatDzdPlain(i.amountDue)}</span>
                <span className="text-muted-foreground text-[11px]">→ {formatDate(i.dueDate)}</span>
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
          <p className="px-3 py-3 text-xs text-muted-foreground">Aucune tranche d'échéance générée.</p>
        )}
      </div>

      {/* Recent Payments */}
      <div className="rounded-md border border-border bg-card">
        <div className="border-b border-border px-3 py-2 bg-muted/30">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Paiements récents
          </p>
        </div>
        {profile && profile.recentPayments.length > 0 ? (
          <ul className="divide-y divide-border text-xs">
            {profile.recentPayments.slice(0, 5).map((p) => (
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

      {/* ============================================================ */}
      {/* SECTION: Explicit Adjustments History (Transparency)         */}
      {/* ============================================================ */}
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

        {/* Diagnostic Explanation Banner */}
        <div className="p-3 bg-muted/15 border-b border-border/60 text-[11px] text-muted-foreground space-y-1">
          <p className="flex items-center gap-1.5 font-medium text-foreground">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            Comprendre ces montants :
          </p>
          <p>
            • <strong className="text-status-success font-mono">− En vert (Négatif) :</strong> Remise, déduction ou crédit parent qui <u>diminue</u> ce que doit la famille.
          </p>
          <p>
            • <strong className="text-status-danger font-mono">+ En rouge (Positif) :</strong> Majoration, pénalité, ou <u>annulation/contrepassation</u> d'une remise précédente (ce qui <u>rajoute</u> de la dette).
          </p>
        </div>

        {profile && profile.adjustments.length > 0 ? (
          <ul className="divide-y divide-border text-xs">
            {profile.adjustments.map((a) => {
              const isCredit = a.amount < 0;
              const cleanReason = a.reason && a.reason.trim().length > 0 ? a.reason : null;

              // Fallback diagnostic explanation when system created an empty-reason adjustment
              const diagnosticReason = cleanReason ?? (
                isCredit
                  ? "Déduction / Remise enregistrée automatiquement par le système"
                  : "Régularisation / Rétablissement de dette (contrepassation automatique)"
              );

              return (
                <li key={a.id} className="px-3 py-2.5 space-y-1 hover:bg-accent/5 transition-colors">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={`font-mono font-bold text-sm ${
                        isCredit ? "text-status-success" : "text-status-danger"
                      }`}
                    >
                      {isCredit ? "− " : "+ "}
                      {formatDzdPlain(Math.abs(a.amount))}
                    </span>

                    <Badge
                      variant="outline"
                      className={`text-[9px] ${
                        isCredit
                          ? "bg-status-success/10 text-status-success border-status-success/30"
                          : "bg-status-danger/10 text-status-danger border-status-danger/30"
                      }`}
                    >
                      {isCredit ? "Crédit / Déduction" : "Débit / Majoration"}
                    </Badge>

                    <span className="text-muted-foreground text-[10px]">
                      {formatRelative(a.approvedAt)} ({formatDate(a.approvedAt)})
                    </span>

                    <span className="ml-auto text-[10px] text-muted-foreground font-mono bg-muted/40 px-1.5 py-0.5 rounded">
                      Auteur : {a.approvedBy}
                    </span>
                  </div>

                  <p className="text-[11px] text-foreground font-medium">
                    {diagnosticReason}
                  </p>

                  {a.receiptRef && (
                    <p className="text-[10px] text-muted-foreground font-mono">
                      Réf. pièce : {a.receiptRef}
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
    <div className="rounded-md border border-border p-2.5 text-center bg-card">
      <p className="text-[10px] uppercase text-muted-foreground">{label}</p>
      <p className={`text-sm font-mono font-semibold mt-0.5 ${toneClass}`}>{formatDzdPlain(value)}</p>
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
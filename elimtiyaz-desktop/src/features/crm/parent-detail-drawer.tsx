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
  Mail,
  FileText,
  Plus,
  UserPlus,
  Wallet,
  AlertTriangle,
  Users,
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
  type ParentFinancialProfile,
} from "../../domain/model/payment";
import { UnifiedPaymentModal } from "../financials/unified-payment-modal";
import {
  TRANSPORT_DESTINATION_LABELS_FR,
  cityTierToDestination,
  parentDisplayName,
  type Parent,
  type TransportDestination,
} from "../../domain/model/parent";
import { Permission } from "../../core/rbac/permissions";
import { generateAccountStatementPdf, downloadPdf } from "../../infrastructure/receipt-pdf";

export function ParentDetailDrawer({
  parentId,
  open,
  onOpenChange,
  onAddChild,
}: {
  parentId: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onAddChild?: (parentId: string) => void;
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

  // === Epic 6.3 — UnifiedPaymentModal + AdjustAccount modal triggers ===
  const [collectOpen, setCollectOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);

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
              <Button size="sm" variant="outline" onClick={() => onAddChild(p.id)}>
                <Plus className="h-4 w-4" /> Ajouter un enfant
              </Button>
            )}
          </div>
          {students.length === 0 ? (
            <p className="text-xs text-muted-foreground">Aucun enfant inscrit.</p>
          ) : (
            <ul className="space-y-1.5">
              {students.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center gap-3 rounded-md border border-border p-2.5 hover:bg-accent/5"
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
                  <Badge variant="outline" className="text-[10px]">
                    {levelLabel(s.level)} · An. {s.gradeYear}
                  </Badge>
                  <StatusChip
                    label={s.status === "active" ? "Actif" : s.status}
                    tone={s.status === "active" ? "success" : "neutral"}
                  />
                </li>
              ))}
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
  const actions = (p: Parent): readonly EntityDrawerAction<Parent>[] => {
    const list: EntityDrawerAction<Parent>[] = [];
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
        <BalanceCard label="Reste" value={outstanding} tone={outstanding > 0 ? "danger" : "neutral"} />
      </div>

      {overdue > 0 && (
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
  const [reason, setReason] = useState("");

  async function submit() {
    if (amount === 0 || !reason.trim()) {
      toast.showWarning("Champs invalides", "Montant non nul et motif requis.");
      return;
    }
    const r = await repos.payments.adjust(
      parentId,
      amount,
      reason.trim(),
      session?.userId ?? "usr-current",
    );
    if (r.ok) {
      toast.showSuccess("Ajustement appliqué", formatDzd(amount));
      onOpenChange(false);
      setAmount(0);
      setReason("");
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
      submitDisabled={amount === 0 || !reason.trim()}
    >
      <div className="space-y-3">
        <div className="rounded-md border border-border p-2 text-xs">
          <p className="text-muted-foreground">Solde en cours</p>
          <p className="font-mono font-semibold">{formatDzd(outstanding)}</p>
        </div>
        <FormField
          label="Montant"
          required
          hint="Positif = crédit (remise). Négatif = débit (pénalité)."
        >
          <MoneyInput value={amount} onChange={setAmount} />
        </FormField>
        <FormField label="Motif" required hint="Reason code obligatoire pour audit">
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Remise fratrie 2ème enfant — 10%"
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

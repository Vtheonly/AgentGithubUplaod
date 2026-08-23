/**
 * PaymentDetailDrawer — slide-over panel showing a payment's details.
 *
 * FIX (deep link + missing detail view): the global search routes to
 * `/financials?paymentId=…` but nothing consumed that param, and the
 * financials page had no way to inspect a payment at all (the Android app
 * has a full PaymentDetailScreen; the desktop had none).
 */
import {
  useRepositories,
} from "../../app/providers/repository-provider";
import { useObservable } from "../../shared/hooks/use-observable";
import { EntityDetailDrawer, type EntityDrawerTab, type EntityDrawerMetaItem } from "../../shared/ui/entity-drawer";
import {
  PAYMENT_METHOD_LABELS_FR,
  PAYMENT_STATUS_LABELS_FR,
  PAYMENT_CATEGORY_LABELS_FR,
  type Payment,
} from "../../domain/model/payment";
import { formatDzd, formatDzdPlain } from "../../core/format/currency";
import { formatDate, formatRelative } from "../../core/format/date";

export function PaymentDetailDrawer({
  paymentId,
  open,
  onOpenChange,
  onOpenParent,
}: {
  paymentId: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onOpenParent?: (parentId: string) => void;
}) {
  const repos = useRepositories();
  const payment = useObservable(
    () => repos.payments.observeById(paymentId ?? ""),
    [paymentId],
  );
  const parents = useObservable(() => repos.parents.observe(), []);
  const students = useObservable(() => repos.students.observe(), []);

  const entity: Payment | null = open && paymentId && payment ? payment : null;

  const parent = entity ? parents.find((p) => p.id === entity.parentId) : null;
  const student = entity && entity.studentId
    ? students.find((s) => s.id === entity.studentId)
    : null;

  const metadata = (p: Payment): readonly EntityDrawerMetaItem[] => [
    { label: "Reçu", value: p.receiptNumber },
    { label: "Méthode", value: PAYMENT_METHOD_LABELS_FR[p.method] },
    { label: "Catégorie", value: PAYMENT_CATEGORY_LABELS_FR[p.category] },
    { label: "Statut", value: PAYMENT_STATUS_LABELS_FR[p.status] },
    { label: "Encaissé le", value: formatDate(p.collectedAt) },
  ];

  const tabs: readonly EntityDrawerTab<Payment>[] = [
    {
      id: "details",
      label: "Détails",
      content: () => (
        <div className="space-y-3 text-sm">
          <div className="rounded-md border border-border p-3 text-center">
            <p className="text-[10px] uppercase text-muted-foreground">Montant encaissé</p>
            <p className="text-xl font-mono font-bold">{formatDzd(entity?.amount ?? 0)}</p>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            <Detail label="Parent" value={parent ? `${parent.firstName} ${parent.lastName}` : entity?.parentId ?? "—"} />
            <Detail label="Élève" value={student ? `${student.firstName} ${student.lastName}` : "—"} />
            <Detail label="Tranche liée" value={entity?.installmentId ?? "—"} mono />
            <Detail label="Encaissé par" value={entity?.collectedBy ?? "—"} mono />
            <Detail
              label="Justificatif"
              value={entity?.proofUrl ? "Fourni" : "—"}
              className={entity?.proofUrl ? "text-status-success" : undefined}
            />
            <Detail label="Notes" value={entity?.notes ?? "—"} />
          </div>
          {parent && onOpenParent && (
            <button
              type="button"
              className="text-xs text-primary underline underline-offset-2"
              onClick={() => onOpenParent(parent.id)}
            >
              Ouvrir le dossier du parent →
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <EntityDetailDrawer<Payment>
      open={open}
      onOpenChange={onOpenChange}
      entity={entity}
      widthClass="max-w-md"
      title={() => `Paiement ${entity?.receiptNumber ?? ""}`}
      subtitle={(p) => `${PAYMENT_METHOD_LABELS_FR[p.method]} · ${formatRelative(p.collectedAt)}`}
      metadata={metadata}
      tabs={() => tabs}
    />
  );
}

function Detail({
  label,
  value,
  mono,
  className,
}: {
  label: string;
  value: string;
  mono?: boolean;
  className?: string;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase text-muted-foreground">{label}</p>
      <p className={`text-sm text-foreground ${mono ? "font-mono" : ""} ${className ?? ""}`}>{value}</p>
    </div>
  );
}

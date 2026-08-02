/**
 * Discounts card — 5 canonical codes + custom discounts.
 *
 * Trash icons defer the actual removal to the orchestrator via
 * `onRequestRemoval` (which opens the ConfirmModal).
 *
 * Extracted from `pricing-tab.tsx` (iteration 6-a). Behavior preserved
 * exactly — only file location + import paths changed.
 */
import { useState } from "react";
import { Award, Plus, Trash2, Tag, Percent } from "lucide-react";
import { useRepositories } from "../../../app/providers/repository-provider";
import { useAuth } from "../../../app/providers/auth-provider";
import { useToast } from "../../../app/providers/toast-provider";
import { Permission } from "../../../core/rbac/permissions";
import { formatDzd } from "../../../core/format/currency";
import type { DiscountType, DiscountCode } from "../../../domain/model/pricing";
import {
  DISCOUNT_TYPE_LABELS_FR,
  DISCOUNT_CODE_LABELS_FR,
} from "../../../domain/model/pricing";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../../shared/ui/card";
import { Button } from "../../../shared/ui/button";
import { Badge } from "../../../shared/ui/badge";
import { Input } from "../../../shared/ui/input";
import { FormField } from "../../../shared/ui/form-field";
import { MoneyInput } from "../../../shared/ui/money-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../shared/ui/select";
import type { RequestRemoval } from "./types";

export function DiscountsCard({ onRequestRemoval }: { onRequestRemoval: RequestRemoval }) {
  const repos = useRepositories();
  const { session } = useAuth();
  const toast = useToast();
  const config = useRepositories().pricing.observe().get();

  const canEdit = !!session && session.permissions.has(Permission.ManagePricing);
  const actorId = session?.userId ?? "usr-current";

  const fail = (title: string, msg: string) => toast.showError(title, msg);
  const ok = (msg: string) => toast.showSuccess(msg);

  const [newDiscount, setNewDiscount] = useState<{ label: string; amount: number; discountType: DiscountType; discountCode: DiscountCode }>({
    label: "",
    amount: 0,
    discountType: "percentage",
    discountCode: "custom",
  });

  async function addDiscount() {
    if (!newDiscount.label.trim()) { fail("Champ manquant", "Libellé requis"); return; }
    const r = await repos.pricing.addDiscount(newDiscount, actorId);
    if (r.ok) {
      ok("Remise ajoutée");
      setNewDiscount({ label: "", amount: 0, discountType: "percentage", discountCode: "custom" });
    } else fail("Échec", r.error.userMessage);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Award className="size-5 text-primary" />
          Remises
        </CardTitle>
        <CardDescription>
          5 codes canoniques (passage de palier, ancienneté, paiement annuel, meilleure moyenne, fratrie) plus remises personnalisées.
          Pour les remises fixes, saisir un montant négatif (ex. -10000).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          {config.discounts.map((d) => (
            <div key={d.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface-panel/50 p-3">
              <div className="flex-1 min-w-[200px]">
                <div className="font-medium text-bright">{d.label}</div>
                <div className="text-xs text-muted">
                  Code : <code className="font-mono">{d.discountCode ?? "custom"}</code> · Type : {DISCOUNT_TYPE_LABELS_FR[d.discountType ?? "percentage"]}
                </div>
              </div>
              <Badge variant={d.discountType === "percentage" ? "info" : "warning"}>
                {d.discountType === "percentage" ? <Percent className="size-3 mr-1" /> : <Tag className="size-3 mr-1" />}
                {d.discountType === "percentage" ? `${d.amount}%` : formatDzd(d.amount)}
              </Badge>
              <Button
                size="sm"
                variant="ghost"
                disabled={!canEdit}
                onClick={() => onRequestRemoval({ kind: "discount", id: d.id, label: d.label })}
              >
                <Trash2 className="size-4 text-status-danger" />
              </Button>
            </div>
          ))}
          {config.discounts.length === 0 && (
            <div className="text-sm text-muted italic">Aucune remise configurée.</div>
          )}
        </div>

        {canEdit && (
          <div className="rounded-lg border border-dashed border-border p-4 space-y-3">
            <div className="text-sm font-medium">Ajouter une remise</div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <FormField label="Libellé" required>
                <Input
                  value={newDiscount.label}
                  onChange={(e) => setNewDiscount({ ...newDiscount, label: e.target.value })}
                  placeholder="Ex. Remise personnalisée"
                />
              </FormField>
              <FormField label="Code">
                <Select
                  value={newDiscount.discountCode}
                  onValueChange={(v) => setNewDiscount({ ...newDiscount, discountCode: v as DiscountCode })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(DISCOUNT_CODE_LABELS_FR) as DiscountCode[]).map((code) => (
                      <SelectItem key={code} value={code}>{DISCOUNT_CODE_LABELS_FR[code]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <FormField label="Type">
                <Select
                  value={newDiscount.discountType}
                  onValueChange={(v) => setNewDiscount({ ...newDiscount, discountType: v as DiscountType })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percentage">Pourcentage</SelectItem>
                    <SelectItem value="fixed_amount">Montant fixe (négatif)</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
              <FormField label={newDiscount.discountType === "percentage" ? "Pourcentage (%)" : "Montant (DA, négatif)"}>
                <MoneyInput
                  value={newDiscount.amount}
                  onChange={(v) => setNewDiscount({ ...newDiscount, amount: v })}
                />
              </FormField>
            </div>
            <Button size="sm" variant="default" onClick={addDiscount}>
              <Plus className="size-3.5 mr-1.5" />
              Ajouter
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

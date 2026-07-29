/**
 * WarehouseWorker dashboard — modals (iteration 9).
 *
 * Two UnifiedModal forms used by the WarehouseWorkerDashboard:
 *   - ScanProductModal: scans an SKU + quantity, calls repos.inventory.scan
 *   - DamageReportModal: picks an existing item + quantity + reason, calls
 *     repos.inventory.transact with type="damage"
 *
 * Extracted into a helper file to keep warehouse-worker-dashboard.tsx under
 * the ~500-line budget while preserving the iteration-7 modal-unification
 * invariant (UnifiedModal only — no raw <Dialog>).
 */
import { useState } from "react";
import { ScanLine, AlertTriangle, CheckCircle2, Plus } from "lucide-react";
import {
  INVENTORY_CATEGORY_LABELS_FR,
  type InventoryCategory,
  type InventoryItem,
} from "../../../domain/model/operations-workforce";
import { Label } from "../../../shared/ui/label";
import { Input } from "../../../shared/ui/input";
import { Textarea } from "../../../shared/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../../../shared/ui/select";
import { UnifiedModal } from "../../../shared/components/unified-modal";

const CATEGORY_OPTIONS: { value: InventoryCategory; label: string }[] = (
  Object.keys(INVENTORY_CATEGORY_LABELS_FR) as InventoryCategory[]
).map((value) => ({ value, label: INVENTORY_CATEGORY_LABELS_FR[value] }));

const UNIT_OPTIONS = ["pièce", "lot", "boîte", "pack", "litre", "kg", "mètre"];

export function ScanProductModal({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: {
    sku: string;
    label: string;
    category: InventoryCategory;
    unit: string;
    quantity: number;
  }) => void | Promise<void>;
}) {
  const [sku, setSku] = useState("");
  const [label, setLabel] = useState("");
  const [category, setCategory] = useState<InventoryCategory>("fournitures");
  const [unit, setUnit] = useState<string>("pièce");
  const [qty, setQty] = useState("1");

  function reset() {
    setSku(""); setLabel(""); setCategory("fournitures");
    setUnit("pièce"); setQty("1");
  }

  function handleSubmit() {
    const q = Number(qty);
    if (!sku.trim() || !label.trim() || !Number.isFinite(q) || q <= 0) return;
    onSubmit({
      sku: sku.trim(),
      label: label.trim(),
      category,
      unit,
      quantity: q,
    });
    reset();
  }

  return (
    <UnifiedModal
      open={open}
      onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}
      title="Scanner un produit"
      description="Saisissez le SKU, la désignation, la catégorie et la quantité reçue."
      icon={ScanLine}
      size="md"
      submitLabel="Valider"
      submitIcon={CheckCircle2}
      onSubmit={handleSubmit}
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="scan-sku">SKU / Code-barres</Label>
          <Input
            id="scan-sku"
            value={sku}
            onChange={(e) => setSku(e.target.value)}
            placeholder="Ex. STY-BLE-50"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="scan-label">Désignation</Label>
          <Input
            id="scan-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Ex. Stylos bleus (lot 50)"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Catégorie</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as InventoryCategory)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORY_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Unité</Label>
            <Select value={unit} onValueChange={setUnit}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {UNIT_OPTIONS.map((u) => (
                  <SelectItem key={u} value={u}>{u}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="scan-qty">Quantité</Label>
          <Input
            id="scan-qty"
            type="number"
            min={1}
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
        </div>
      </div>
    </UnifiedModal>
  );
}

export function DamageReportModal({
  open,
  onOpenChange,
  items,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: readonly InventoryItem[];
  onSubmit: (input: { itemId: string; quantity: number; reason: string }) => void | Promise<void>;
}) {
  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState("1");
  const [reason, setReason] = useState("");

  function reset() { setItemId(""); setQty("1"); setReason(""); }

  function handleSubmit() {
    const q = Number(qty);
    if (!itemId || !reason.trim() || !Number.isFinite(q) || q <= 0) return;
    onSubmit({ itemId, quantity: q, reason: reason.trim() });
    reset();
  }

  const selectedItem = items.find((i) => i.id === itemId) ?? null;
  const maxQty = selectedItem?.quantityOnHand ?? 0;

  return (
    <UnifiedModal
      open={open}
      onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}
      title="Signaler une avarie"
      description="Sélectionnez un produit existant — la quantité sera retirée du stock et tracée."
      icon={AlertTriangle}
      iconTone="warning"
      size="md"
      submitLabel="Signaler"
      submitIcon={Plus}
      submitVariant="destructive"
      onSubmit={handleSubmit}
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label>Produit</Label>
          <Select value={itemId} onValueChange={setItemId}>
            <SelectTrigger><SelectValue placeholder="Sélectionner un produit" /></SelectTrigger>
            <SelectContent>
              {items.map((i) => (
                <SelectItem key={i.id} value={i.id}>
                  <span className="font-mono text-xs text-muted-foreground mr-2">{i.sku}</span>
                  {i.label} (stock : {i.quantityOnHand} {i.unit})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedItem && (
            <p className="text-xs text-muted-foreground">
              Stock actuel : {selectedItem.quantityOnHand} {selectedItem.unit} • Emplacement : {selectedItem.location ?? "—"}
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="dmg-qty">Quantité avariée</Label>
          <Input
            id="dmg-qty"
            type="number"
            min={1}
            max={maxQty || undefined}
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="dmg-reason">Raison</Label>
          <Textarea
            id="dmg-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Ex. Casse lors du transport, humidité…"
          />
        </div>
      </div>
    </UnifiedModal>
  );
}

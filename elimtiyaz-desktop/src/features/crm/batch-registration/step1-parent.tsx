/**
 * Step 1 — Parent info form (atomic registration wizard, Plan §04.03).
 *
 * Pure presentational component — state lives in the orchestrator and is
 * threaded via props.
 */
import { Input } from "../../../shared/ui/input";
import { FormField } from "../../../shared/ui/form-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../shared/ui/select";
import type { Gender } from "../../../domain/model/student";
import {
  TRANSPORT_DESTINATIONS,
  TRANSPORT_DESTINATION_LABELS_FR,
  type TransportDestination,
} from "../../../domain/model/parent";
import type { Step1Parent } from "./types";
import type { Parent } from "../../../domain/model/parent";

export function Step1({
  parent,
  setParent,
  errors,
  lockedParent,
}: {
  parent: Step1Parent;
  setParent: (p: Step1Parent) => void;
  errors: Record<string, string>;
  /**
   * FIX (add-child duplication): when set, the wizard is in "add children to
   * an existing parent" mode — step 1 becomes a read-only summary of the
   * locked parent instead of an editable form that would create a duplicate.
   */
  lockedParent?: Parent | null;
}) {
  if (lockedParent) {
    return (
      <div className="space-y-3">
        <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
          <p className="font-medium text-primary">Parent existant sélectionné</p>
          <p className="text-xs text-muted-foreground mt-1">
            Les nouveaux élèves seront rattachés au dossier ci-dessous — aucun
            nouveau parent ne sera créé. Pour corriger les coordonnées, utilisez
            « Modifier » dans le tiroir du parent.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md border border-border p-3 text-sm">
          <ReadonlyField label="Nom" value={`${lockedParent.firstName} ${lockedParent.lastName}`} />
          <ReadonlyField label="Code" value={lockedParent.code} mono />
          <ReadonlyField label="Téléphone" value={lockedParent.phone} mono />
          <ReadonlyField label="WhatsApp" value={lockedParent.whatsapp ?? "—"} mono />
          <ReadonlyField label="E-mail" value={lockedParent.email ?? "—"} />
          <ReadonlyField label="Profession" value={lockedParent.occupation ?? "—"} />
          <ReadonlyField
            label="Zone"
            value={
              lockedParent.transportDestination
                ? TRANSPORT_DESTINATION_LABELS_FR[lockedParent.transportDestination]
                : "—"
            }
          />
          <ReadonlyField label="Adresse" value={lockedParent.address ?? "—"} />
        </div>
      </div>
    );
  }
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <FormField label="Prénom" required error={errors.parent_firstName}>
        <Input
          value={parent.firstName}
          onChange={(e) => setParent({ ...parent, firstName: e.target.value })}
          placeholder="Karim"
        />
      </FormField>
      <FormField label="Nom" required error={errors.parent_lastName}>
        <Input
          value={parent.lastName}
          onChange={(e) => setParent({ ...parent, lastName: e.target.value })}
          placeholder="Benali"
        />
      </FormField>
      <FormField label="Genre">
        <Select value={parent.gender} onValueChange={(v) => setParent({ ...parent, gender: v as Gender })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="male">Homme</SelectItem>
            <SelectItem value="female">Femme</SelectItem>
            <SelectItem value="unspecified">Non spécifié</SelectItem>
          </SelectContent>
        </Select>
      </FormField>
      <FormField label="Téléphone" required error={errors.parent_phone} hint="+213 555 12 34 56">
        <Input
          value={parent.phone}
          onChange={(e) => setParent({ ...parent, phone: e.target.value })}
          placeholder="+213 555 12 34 56"
        />
      </FormField>
      <FormField label="WhatsApp" error={errors.parent_whatsapp}>
        <Input
          value={parent.whatsapp}
          onChange={(e) => setParent({ ...parent, whatsapp: e.target.value })}
          placeholder="+213 555 12 34 56"
        />
      </FormField>
      <FormField label="E-mail" error={errors.parent_email}>
        <Input
          type="email"
          value={parent.email}
          onChange={(e) => setParent({ ...parent, email: e.target.value })}
          placeholder="k.benali@example.dz"
        />
      </FormField>
      <FormField label="Profession">
        <Input
          value={parent.occupation}
          onChange={(e) => setParent({ ...parent, occupation: e.target.value })}
          placeholder="Ingénieur"
        />
      </FormField>
      <FormField label="Zone de résidence" hint="Détermine le tarif transport">
        <Select
          value={parent.transportDestination}
          onValueChange={(v) => setParent({ ...parent, transportDestination: v as TransportDestination })}
        >
          <SelectTrigger>
            <SelectValue placeholder="Sélectionner…" />
          </SelectTrigger>
          <SelectContent>
            {TRANSPORT_DESTINATIONS.map((d) => (
              <SelectItem key={d} value={d}>{TRANSPORT_DESTINATION_LABELS_FR[d]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>
      <FormField label="Adresse" className="md:col-span-2">
        <Input
          value={parent.address}
          onChange={(e) => setParent({ ...parent, address: e.target.value })}
          placeholder="12 rue des Frères Bouadou, Oran"
        />
      </FormField>
      <FormField label="Langue préférée">
        <Select
          value={parent.preferredLanguage}
          onValueChange={(v) => setParent({ ...parent, preferredLanguage: v as "fr" | "ar" })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="fr">Français</SelectItem>
            <SelectItem value="ar">العربية</SelectItem>
          </SelectContent>
        </Select>
      </FormField>
    </div>
  );
}

function ReadonlyField({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase text-muted-foreground">{label}</p>
      <p className={`text-sm text-foreground ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  );
}

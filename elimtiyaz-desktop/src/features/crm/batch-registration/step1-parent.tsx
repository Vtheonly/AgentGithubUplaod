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

export function Step1({
  parent,
  setParent,
  errors,
}: {
  parent: Step1Parent;
  setParent: (p: Step1Parent) => void;
  errors: Record<string, string>;
}) {
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

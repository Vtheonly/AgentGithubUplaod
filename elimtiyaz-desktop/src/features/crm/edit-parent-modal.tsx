/**
 * EditParentModal — edit form for an existing parent.
 *
 * FIX (missing editing feature): `updateParent` existed in every repository
 * implementation but NO UI ever called it. This modal wires the parent
 * drawer's "Modifier" action to `repos.parents.updateParent`.
 *
 * Editable fields: identity (prénom/nom), contact (téléphone/WhatsApp/e-mail),
 * profession, address, transport zone, and preferred language.
 */
import { useEffect, useState } from "react";
import { Pencil } from "lucide-react";
import { useRepositories } from "../../app/providers/repository-provider";
import { useToast } from "../../app/providers/toast-provider";
import { useAuth } from "../../app/providers/auth-provider";
import { useObservable } from "../../shared/hooks/use-observable";
import { UnifiedModal } from "../../shared/ui/unified-modal";
import { FormField } from "../../shared/ui/form-field";
import { Input } from "../../shared/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../shared/ui/select";
import {
  TRANSPORT_DESTINATIONS,
  TRANSPORT_DESTINATION_LABELS_FR,
  type TransportDestination,
  type Parent,
} from "../../domain/model/parent";

/** Sentinel for "no transport zone" — Radix Select forbids empty values. */
const NO_TRANSPORT = "__none__";

const PHONE_RE = /^[+]?[0-9\s]{8,15}$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function EditParentModal({
  parentId,
  open,
  onOpenChange,
}: {
  parentId: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const repos = useRepositories();
  const toast = useToast();
  const { session } = useAuth();
  const parent = useObservable(
    () => repos.parents.observeById(parentId ?? ""),
    [parentId],
  );

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [email, setEmail] = useState("");
  const [occupation, setOccupation] = useState("");
  const [address, setAddress] = useState("");
  const [transportDestination, setTransportDestination] = useState<string>(NO_TRANSPORT);
  const [preferredLanguage, setPreferredLanguage] = useState<"fr" | "ar" | "en">("fr");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // Re-seed the form whenever the modal opens or the target parent changes.
  useEffect(() => {
    if (!open || !parent) return;
    setFirstName(parent.firstName);
    setLastName(parent.lastName);
    setPhone(parent.phone);
    setWhatsapp(parent.whatsapp ?? "");
    setEmail(parent.email ?? "");
    setOccupation(parent.occupation ?? "");
    setAddress(parent.address ?? "");
    setTransportDestination(parent.transportDestination ?? NO_TRANSPORT);
    setPreferredLanguage(parent.preferredLanguage);
    setErrors({});
  }, [open, parent]);

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!firstName.trim()) e.firstName = "Prénom requis";
    if (!lastName.trim()) e.lastName = "Nom requis";
    if (!phone.trim()) e.phone = "Téléphone requis";
    else if (!PHONE_RE.test(phone.trim())) e.phone = "Format invalide (8-15 chiffres)";
    if (whatsapp.trim() && !PHONE_RE.test(whatsapp.trim())) e.whatsapp = "Format invalide";
    if (email.trim() && !EMAIL_RE.test(email.trim())) e.email = "E-mail invalide";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function submit() {
    if (!parentId || !session) return;
    if (!validate()) return;
    setSaving(true);
    try {
      const result = await repos.parents.updateParent(parentId, {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        displayName: `${firstName.trim()} ${lastName.trim()}`,
        phone: phone.trim(),
        whatsapp: whatsapp.trim() || null,
        email: email.trim() || null,
        occupation: occupation.trim() || null,
        address: address.trim() || null,
        transportDestination:
          transportDestination === NO_TRANSPORT ? null : (transportDestination as TransportDestination),
        preferredLanguage,
      });
      if (result.ok) {
        toast.showSuccess(
          "Parent modifié",
          `${firstName.trim()} ${lastName.trim()} a été mis à jour.`,
        );
        onOpenChange(false);
      } else {
        toast.showError("Échec de la modification", result.error.userMessage);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <UnifiedModal
      open={open}
      onOpenChange={onOpenChange}
      variant="dialog"
      size="md"
      icon={Pencil}
      iconTone="primary"
      title="Modifier le parent"
      description="Les changements sont tracés dans le journal d'audit."
      submitLabel="Enregistrer"
      submitIcon={Pencil}
      onSubmit={submit}
      submitLoading={saving}
      submitDisabled={saving}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <FormField label="Prénom" required error={errors.firstName}>
          <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
        </FormField>
        <FormField label="Nom" required error={errors.lastName}>
          <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </FormField>
        <FormField label="Téléphone" required error={errors.phone}>
          <Input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="0550 12 34 56"
            className="font-mono"
          />
        </FormField>
        <FormField label="WhatsApp" error={errors.whatsapp}>
          <Input
            value={whatsapp}
            onChange={(e) => setWhatsapp(e.target.value)}
            placeholder="0550 12 34 56"
            className="font-mono"
          />
        </FormField>
        <FormField label="E-mail" error={errors.email}>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="parent@example.com"
          />
        </FormField>
        <FormField label="Profession">
          <Input
            value={occupation}
            onChange={(e) => setOccupation(e.target.value)}
            placeholder="Ingénieur"
          />
        </FormField>
        <FormField label="Adresse" className="md:col-span-2">
          <Input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Cité 200 logements, Boumerdès"
          />
        </FormField>
        <FormField label="Zone transport" hint="Utilisée pour la tarification du transport">
          <Select value={transportDestination} onValueChange={setTransportDestination}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_TRANSPORT}>Aucune zone</SelectItem>
              {TRANSPORT_DESTINATIONS.map((d) => (
                <SelectItem key={d} value={d}>{TRANSPORT_DESTINATION_LABELS_FR[d]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <FormField label="Langue préférée">
          <Select
            value={preferredLanguage}
            onValueChange={(v) => setPreferredLanguage(v as "fr" | "ar" | "en")}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="fr">Français</SelectItem>
              <SelectItem value="ar">العربية</SelectItem>
              <SelectItem value="en">English</SelectItem>
            </SelectContent>
          </Select>
        </FormField>
      </div>
      {parent && (
        <p className="mt-3 text-[11px] text-muted-foreground">
          Code parent <span className="font-mono">{parent.code}</span> — non modifiable.
        </p>
      )}
    </UnifiedModal>
  );
}

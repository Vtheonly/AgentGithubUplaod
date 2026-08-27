/**
 * ActivationCodeModal — VAULT §02.08 (Account Activation Protocol), Step 1.
 *
 * Presents the staff-issued 6-7 digit single-use activation code to hand to
 * the parent, with the three delivery channels the vault describes:
 *   - the numeric code itself (read aloud / typed),
 *   - a QR code "for camera-based entry" on the parent's phone,
 *   - a WhatsApp share button (1-tap delivery of the code + instructions).
 *
 * Used by:
 *   - ParentDetailDrawer — "Code d'activation" footer action.
 *   - BatchRegistrationModal — issued at enrollment time, right after the
 *     atomic family registration completes (vault: "Office staff registers
 *     family AND issues 6-7 digit activation code or QR").
 */
import { MessageCircle, KeyRound } from "lucide-react";
import { Button } from "../../shared/ui/button";
import { UnifiedModal } from "../../shared/ui/unified-modal";
import { QrCode } from "../../shared/ui/qr-code";
import { useToast } from "../../app/providers/toast-provider";

export function ActivationCodeModal({
  open,
  onOpenChange,
  code,
  parentName,
  whatsapp,
  phone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** The issued code (6-7 digits, single-use). `null` renders nothing. */
  code: string | null;
  /** Parent display name — used in the WhatsApp message. */
  parentName: string;
  /** Preferred WhatsApp number (falls back to phone). */
  whatsapp?: string | null;
  /** Primary phone number. */
  phone?: string | null;
}) {
  const toast = useToast();

  const waNumber = (whatsapp ?? phone ?? "").replace(/[\s+]/g, "");
  const shareText =
    `Bonjour ${parentName}, voici votre code d'activation pour le portail El-Imtiyaz : ${code}. ` +
    "Ouvrez le portail, connectez-vous avec Google, puis saisissez ce code (ou scannez le QR code). " +
    "Il est à usage unique et lie votre compte au dossier de la famille.";

  return (
    <UnifiedModal
      open={open && code !== null}
      onOpenChange={onOpenChange}
      variant="dialog"
      size="sm"
      icon={KeyRound}
      iconTone="primary"
      title="Code d'activation portail"
      description="Communiquez ce code au parent : il le saisira sur le portail web après connexion Google pour lier son compte au profil de la famille (usage unique)."
      hideFooter
    >
      <div className="space-y-3 text-center">
        <p className="text-4xl font-mono font-bold tracking-[0.35em] text-primary">{code}</p>

        {/* VAULT §02.08 — the code "can also be delivered as a QR code for
            camera-based entry" on the parent's phone. */}
        {code && (
          <div className="flex justify-center">
            <QrCode value={code} size={132} label="QR code d'activation" />
          </div>
        )}

        <div className="flex justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void navigator.clipboard?.writeText(code ?? "");
              toast.showSuccess("Code copié", "Le code d'activation est dans le presse-papiers.");
            }}
          >
            Copier le code
          </Button>
          {waNumber && (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                window.open(`https://wa.me/${waNumber}?text=${encodeURIComponent(shareText)}`)
              }
            >
              <MessageCircle className="h-4 w-4" /> Envoyer via WhatsApp
            </Button>
          )}
        </div>

        <p className="text-[11px] text-muted-foreground">
          Code à 6-7 chiffres, à usage unique, lié au profil maître de la famille — protocole
          d'activation du portail (plan §02). Le QR code permet la saisie par caméra sur le
          portable du parent. L'émission est journalisée.
        </p>
      </div>
    </UnifiedModal>
  );
}

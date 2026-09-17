/**
 * WhatsApp browser handoff helpers.
 *
 * WhatsApp's wa.me endpoint expects an international phone number without
 * a leading `+`, spaces, punctuation, or a national leading zero. Algerian
 * local numbers such as `0550123456` are therefore normalized to
 * `213550123456` before opening the chat.
 */
export function normalizeWhatsAppPhone(rawPhone: string): string | null {
  const raw = rawPhone.trim();
  if (!raw) return null;

  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;

  if (digits.startsWith("00")) {
    const international = digits.slice(2);
    return international || null;
  }

  if (digits.startsWith("213")) {
    return digits;
  }

  if (digits.startsWith("0")) {
    const national = digits.slice(1);
    return national ? `213${national}` : null;
  }

  return digits;
}

export function buildWhatsAppUrl(
  phone: string,
  message?: string,
): string | null {
  const normalized = normalizeWhatsAppPhone(phone);
  if (!normalized) return null;

  const baseUrl = `https://wa.me/${normalized}`;
  if (!message) return baseUrl;

  return `${baseUrl}?text=${encodeURIComponent(message)}`;
}

export async function openWhatsApp(
  phone: string,
  message?: string,
): Promise<{ ok: boolean; error?: string }> {
  const url = buildWhatsAppUrl(phone, message);
  if (!url) {
    return { ok: false, error: "Numéro WhatsApp invalide." };
  }

  // Electron: explicitly hand the URL to the user's external browser.
  // Web/browser builds: fall back to the browser's normal popup mechanism.
  if (typeof window !== "undefined" && window.elImtiyaz?.shell?.openExternal) {
    return window.elImtiyaz.shell.openExternal(url);
  }

  if (typeof window !== "undefined") {
    window.open(url, "_blank", "noopener,noreferrer");
    return { ok: true };
  }

  return { ok: false, error: "Environnement navigateur indisponible." };
}

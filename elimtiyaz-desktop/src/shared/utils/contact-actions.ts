/**
 * The contact-actions helpers (E2.5 / S-U5) — the ONE home for the
 * phone-call / e-mail handoff idioms and the no-phone WhatsApp share form
 * that were scattered as inline `window.open(…)` constructions.
 *
 * WHY window.open and NOT the `shell:open-external` IPC: the main process
 * validates the IPC surface's schemes to `https:` + `mailto:` ONLY
 * (electron/main.cts `shell:open-external`) and refuses `tel:` — while the
 * renderer's `window.open` rides `setWindowOpenHandler` (main.cts), which
 * hands EVERY url to `shell.openExternal` with no scheme filter. So:
 *   - `tel:` reaches the OS dialer ONLY through window.open;
 *   - `mailto:` works through either path — window.open stays for the
 *     symmetric, popup-safe semantics (a synchronous call inside the
 *     click handler, never after an await).
 * (The WhatsApp handoffs keep their own canonical helpers —
 * shared/utils/whatsapp.ts — which DO prefer the IPC for their https URLs.)
 */

/** Open the OS dialer for a phone number (fail-closed on empty input).
 * Returns whether the handoff was attempted. */
export function openPhoneCall(phone: string | null | undefined): boolean {
  const trimmed = (phone ?? "").trim();
  if (!trimmed) return false;
  window.open(`tel:${trimmed}`);
  return true;
}

/** Open the OS mail composer for an e-mail address (fail-closed on empty
 * input). Returns whether the handoff was attempted. */
export function openEmail(email: string | null | undefined): boolean {
  const trimmed = (email ?? "").trim();
  if (!trimmed) return false;
  window.open(`mailto:${trimmed}`);
  return true;
}

/**
 * The no-phone WhatsApp share URL — `https://wa.me/?text=…` (the
 * share-sheet form financials-page's reminder flow hand-rolled). The
 * with-number form stays `buildWhatsAppUrl` (shared/utils/whatsapp.ts),
 * which also normalizes the Algerian local numbers this form never sees.
 */
export function buildWhatsAppShareUrl(message: string): string {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}

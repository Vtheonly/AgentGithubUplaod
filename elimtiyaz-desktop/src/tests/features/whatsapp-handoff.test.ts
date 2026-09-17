import { describe, expect, it } from "vitest";
import {
  buildWhatsAppUrl,
  normalizeWhatsAppPhone,
} from "../../shared/utils/whatsapp";

describe("WhatsApp browser handoff", () => {
  it("normalizes Algerian local numbers to international format", () => {
    expect(normalizeWhatsAppPhone("0550 12 34 56")).toBe("213550123456");
    expect(normalizeWhatsAppPhone("+213 550 12 34 56")).toBe("213550123456");
    expect(normalizeWhatsAppPhone("00213 550 12 34 56")).toBe("213550123456");
  });

  it("builds a direct WhatsApp chat URL", () => {
    expect(buildWhatsAppUrl("0550123456")).toBe(
      "https://wa.me/213550123456",
    );
  });

  it("builds an encoded prefilled message URL", () => {
    expect(buildWhatsAppUrl("0550123456", "Bonjour, merci de nous contacter.")).toBe(
      "https://wa.me/213550123456?text=Bonjour%2C%20merci%20de%20nous%20contacter.",
    );
  });

  it("rejects empty phone numbers", () => {
    expect(normalizeWhatsAppPhone("   ")).toBeNull();
    expect(buildWhatsAppUrl("   ")).toBeNull();
  });
});

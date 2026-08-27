/**
 * QrCode — renders a QR code for short alphanumeric payloads.
 *
 * VAULT §02.08 (Account Activation Protocol): activation codes "can also be
 * delivered as a QR code for camera-based entry". This component is the
 * desktop-side renderer used by:
 *   - the parent drawer's activation-code modal (staff-issued code),
 *   - the batch-registration success screen (code issued at enrollment).
 *
 * Implementation notes:
 *   - `qrcode-generator` is a tiny, dependency-free, pure-JS encoder that
 *     runs fully OFFLINE in the Electron renderer — no network call, no
 *     telemetry, the code never leaves the terminal.
 *   - Error-correction level "M" (~15% redundancy) keeps the module count
 *     low enough that a 6-7 digit code scans reliably from a screen.
 *   - The payload is exactly the numeric code (no URL wrapper) so any
 *     generic camera/QR scanner app can fill the portal's activation field.
 */
import { useMemo } from "react";
import qrcode from "qrcode-generator";
import { cn } from "./cn";

export interface QrCodeProps {
  /** The payload encoded into the QR (e.g. "483920"). */
  value: string;
  /** Rendered size in CSS pixels (square). Default 128. */
  size?: number;
  /** Extra classes for the wrapper. */
  className?: string;
  /** Accessible label (defaults to the value). */
  label?: string;
}

export function QrCode({ value, size = 128, className, label }: QrCodeProps) {
  const dataUrl = useMemo(() => {
    try {
      const qr = qrcode(0, "M");
      qr.addData(value);
      qr.make();
      // 4px per module — crisp on HiDPI screens, small file size.
      return qr.createDataURL(4, 4);
    } catch {
      // Invalid payload (too long for the type) — render nothing rather
      // than crashing the modal that hosts the QR.
      return null;
    }
  }, [value]);

  if (!dataUrl) return null;

  return (
    <img
      src={dataUrl}
      width={size}
      height={size}
      alt={label ?? `QR code: ${value}`}
      className={cn("rounded-md border border-border bg-white p-1.5", className)}
      draggable={false}
    />
  );
}

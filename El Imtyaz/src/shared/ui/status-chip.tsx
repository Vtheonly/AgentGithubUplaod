/**
 * StatusChip — pill with leading colored dot, used everywhere to convey
 * status semantics. Maps directly to the Android `StatusChip` component.
 *
 * Six tones map to the four status colors + neutral + info.
 */
import { cn } from "../ui/cn";
import type { ReactNode } from "react";

export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";

const TONE_CLASSES: Record<StatusTone, string> = {
  success: "bg-status-success/15 text-status-success",
  warning: "bg-status-warning/15 text-status-warning",
  danger: "bg-status-danger/15 text-status-danger",
  info: "bg-status-info/15 text-status-info",
  neutral: "bg-status-neutral/15 text-status-neutral",
};

const DOT_CLASSES: Record<StatusTone, string> = {
  success: "bg-status-success",
  warning: "bg-status-warning",
  danger: "bg-status-danger",
  info: "bg-status-info",
  neutral: "bg-status-neutral",
};

export function StatusChip({
  label,
  tone,
  className,
}: {
  label: ReactNode;
  tone: StatusTone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold",
        TONE_CLASSES[tone],
        className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", DOT_CLASSES[tone])} />
      {label}
    </span>
  );
}

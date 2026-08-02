/**
 * FormField — Label + control + error message wrapper.
 *
 * Standardizes the layout of every form input in the app. Pair with
 * react-hook-form's <Controller> or direct bindings.
 */
import type { ReactNode } from "react";
import { Label } from "../ui/label";
import { cn } from "../ui/cn";

export function FormField({
  label,
  htmlFor,
  error,
  hint,
  required,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={htmlFor} className="flex items-center gap-1">
        {label}
        {required && <span className="text-status-danger">*</span>}
      </Label>
      {children}
      {hint && !error && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      {error && <p className="text-[11px] text-status-danger">{error}</p>}
    </div>
  );
}

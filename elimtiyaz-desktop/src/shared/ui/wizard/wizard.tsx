/**
 * <Wizard> — multi-step wizard primitive.
 * Replaces hand-rolled steppers in BatchRegistration + Onboarding.
 */
import { useState, useCallback, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Loader2, ChevronLeft, ChevronRight, Check } from "lucide-react";
import { Button } from "../button";
import { Progress } from "../progress";
import { cn } from "../cn";

export interface WizardStep {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly render: () => ReactNode;
  readonly validate?: () => string | null | Promise<string | null>;
  readonly isFinal?: boolean;
}

export interface WizardProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly steps: readonly WizardStep[];
  readonly onFinish: () => Promise<void> | void;
  readonly onCancel?: () => void;
  readonly widthClass?: string;
}

export function Wizard(props: WizardProps): ReactNode {
  const { open, onOpenChange, title, steps, onFinish, onCancel, widthClass = "max-w-2xl" } = props;
  const [current, setCurrent] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const step = steps[current];
  const isLast = current === steps.length - 1;
  const isFirst = current === 0;
  const progress = ((current + 1) / steps.length) * 100;

  const goNext = useCallback(async () => {
    if (!step) return;
    setError(null);
    if (step.validate) {
      setBusy(true);
      try {
        const err = await step.validate();
        if (err) { setError(err); return; }
      } finally { setBusy(false); }
    }
    if (isLast) {
      setBusy(true);
      try {
        await onFinish();
        onOpenChange(false);
        setCurrent(0);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erreur inconnue");
        return;
      } finally { setBusy(false); }
      return;
    }
    setCurrent((c) => Math.min(c + 1, steps.length - 1));
  }, [step, isLast, steps.length, onFinish, onOpenChange]);

  const goBack = useCallback(() => {
    setError(null);
    if (isFirst) {
      onCancel?.();
      onOpenChange(false);
      return;
    }
    setCurrent((c) => Math.max(c - 1, 0));
  }, [isFirst, onCancel, onOpenChange]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className={cn(
          "fixed left-1/2 top-1/2 z-50 w-full -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-popover shadow-lg",
          widthClass,
        )}>
          <div className="flex items-center justify-between border-b border-border p-4">
            <div className="flex-1">
              <Dialog.Title className="text-base font-semibold">{title}</Dialog.Title>
              <div className="mt-1 text-xs text-muted-foreground">
                Étape {current + 1} / {steps.length} — {step?.label}
              </div>
            </div>
            <Dialog.Close asChild>
              <button className="text-muted-foreground hover:text-foreground" aria-label="Fermer">
                <X className="size-4" />
              </button>
            </Dialog.Close>
          </div>

          <div className="px-4 pt-3">
            <Progress value={progress} className="h-1.5" />
          </div>

          <div className="flex flex-wrap gap-1.5 px-4 pt-3">
            {steps.map((s, idx) => (
              <button
                key={s.id}
                disabled={idx > current}
                onClick={() => idx < current && setCurrent(idx)}
                className={cn(
                  "rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
                  idx === current && "bg-primary text-primary-foreground",
                  idx < current && "bg-primary/10 text-primary hover:bg-primary/20 cursor-pointer",
                  idx > current && "bg-muted text-muted-foreground",
                )}
              >
                {idx < current && <Check className="mr-1 inline size-3" />}
                {s.label}
              </button>
            ))}
          </div>

          <div className="max-h-[60vh] overflow-auto p-4">
            {step?.render()}
            {error && <p className="mt-3 text-xs text-status-danger">{error}</p>}
          </div>

          <div className="flex justify-between gap-2 border-t border-border p-3">
            <Button variant="outline" onClick={goBack} disabled={busy}>
              <ChevronLeft className="size-4" />
              {isFirst ? "Annuler" : "Précédent"}
            </Button>
            <Button onClick={goNext} disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              {isLast ? "Terminer" : "Suivant"}
              {!isLast && <ChevronRight className="size-4" />}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

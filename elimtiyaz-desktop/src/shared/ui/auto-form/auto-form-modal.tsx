/**
 * <AutoFormModal<T>> — schema-driven modal form primitive.
 * Replaces 25+ handwritten form modals. Built on react-hook-form + zod.
 */
import { useEffect, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Loader2 } from "lucide-react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ZodType } from "zod";
import { Input } from "../input";
import { Textarea } from "../textarea";
import { Button } from "../button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../select";
import { Switch } from "../switch";
import { MoneyInput } from "../money-input";
import { cn } from "../cn";
import { FormField } from "../form-field";
import type { AutoFormModalProps, AutoFormField } from "./types";

export function AutoFormModal<T extends ZodType>(props: AutoFormModalProps<T>): ReactNode {
  const { open, onOpenChange, title, description, schema, fields, initialValues,
    onSubmit, submitLabel = "Enregistrer", cancelLabel = "Annuler", footer } = props;

  const form = useForm<Record<string, unknown>>({
    resolver: zodResolver(schema as unknown as Parameters<typeof zodResolver>[0]),
    defaultValues: initialValues as Record<string, unknown>,
    mode: "onSubmit",
  });

  useEffect(() => {
    if (open) form.reset(initialValues as Record<string, unknown>);
  }, [open, initialValues, form]);

  const isSubmitting = form.formState.isSubmitting;
  const errors = form.formState.errors as Record<string, { message?: string }>;

  const handleSubmit = form.handleSubmit(async (values) => {
    await onSubmit(values as unknown as Parameters<typeof onSubmit>[0]);
    onOpenChange(false);
  });

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-popover p-6 shadow-lg">
          <Dialog.Title className="text-lg font-semibold">{title}</Dialog.Title>
          {description && <Dialog.Description className="mt-1 text-sm text-muted-foreground">{description}</Dialog.Description>}
          <Dialog.Close asChild>
            <button className="absolute right-4 top-4 text-muted-foreground hover:text-foreground" aria-label="Fermer">
              <X className="size-4" />
            </button>
          </Dialog.Close>
          <form onSubmit={handleSubmit} className="mt-4 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              {fields.map((f) => (
                <Controller
                  key={f.name}
                  control={form.control}
                  name={f.name}
                  render={({ field }) => (
                    <FormField
                      label={f.label}
                      htmlFor={f.name}
                      required={f.required}
                      error={errors[f.name]?.message}
                      hint={f.help}
                      className={cn(f.wide && "col-span-2")}
                    >
                      {renderField(f, field)}
                    </FormField>
                  )}
                />
              ))}
            </div>
            {footer}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
                {cancelLabel}
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="size-4 animate-spin" />}
                {submitLabel}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function renderField(f: AutoFormField, field: { value: unknown; onChange: (v: unknown) => void; onBlur: () => void; ref?: (el: HTMLElement | null) => void }): ReactNode {
  switch (f.type) {
    case "textarea":
      return <Textarea id={f.name} value={(field.value as string) ?? ""} onChange={(e) => field.onChange(e.target.value)} onBlur={field.onBlur} placeholder={f.placeholder} disabled={f.disabled} />;
    case "number":
      return <Input id={f.name} type="number" value={(field.value as number | string) ?? ""} min={f.min} max={f.max} onChange={(e) => field.onChange(e.target.value === "" ? undefined : Number(e.target.value))} onBlur={field.onBlur} placeholder={f.placeholder} disabled={f.disabled} />;
    case "email":
      return <Input id={f.name} type="email" value={(field.value as string) ?? ""} onChange={(e) => field.onChange(e.target.value)} onBlur={field.onBlur} placeholder={f.placeholder} disabled={f.disabled} />;
    case "tel":
      return <Input id={f.name} type="tel" value={(field.value as string) ?? ""} onChange={(e) => field.onChange(e.target.value)} onBlur={field.onBlur} placeholder={f.placeholder} disabled={f.disabled} />;
    case "password":
      return <Input id={f.name} type="password" value={(field.value as string) ?? ""} onChange={(e) => field.onChange(e.target.value)} onBlur={field.onBlur} placeholder={f.placeholder} disabled={f.disabled} />;
    case "date":
      return <Input id={f.name} type="date" value={(field.value as string) ?? ""} onChange={(e) => field.onChange(e.target.value)} onBlur={field.onBlur} disabled={f.disabled} />;
    case "select":
      return (
        <Select value={(field.value as string) ?? ""} onValueChange={field.onChange} disabled={f.disabled}>
          <SelectTrigger id={f.name}><SelectValue placeholder={f.placeholder ?? "Sélectionner…"} /></SelectTrigger>
          <SelectContent>
            {(f.options ?? []).map((opt) => (
              <SelectItem key={String(opt.value)} value={String(opt.value)}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case "switch":
      return <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} disabled={f.disabled} />;
    case "money":
      return <MoneyInput value={(field.value as number) ?? 0} onChange={field.onChange as (v: number) => void} disabled={f.disabled} />;
    case "text":
    default:
      return <Input id={f.name} type="text" value={(field.value as string) ?? ""} onChange={(e) => field.onChange(e.target.value)} onBlur={field.onBlur} placeholder={f.placeholder} disabled={f.disabled} />;
  }
}

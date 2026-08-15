import type { z, ZodType } from "zod";
import type { ReactNode } from "react";

export type AutoFormFieldType =
  | "text" | "textarea" | "number" | "email" | "tel" | "date"
  | "select" | "switch" | "money";

export interface AutoFormFieldOption {
  readonly label: string;
  readonly value: string | number;
}

export interface AutoFormField {
  readonly name: string;
  readonly label: string;
  readonly type: AutoFormFieldType;
  readonly placeholder?: string;
  readonly options?: readonly AutoFormFieldOption[];
  readonly defaultValue?: unknown;
  readonly required?: boolean;
  readonly wide?: boolean;
  readonly help?: string;
  readonly min?: number;
  readonly max?: number;
  readonly disabled?: boolean;
}

export interface AutoFormModalProps<T extends ZodType> {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly description?: string;
  readonly schema: T;
  readonly fields: readonly AutoFormField[];
  readonly initialValues?: Partial<z.infer<T>>;
  readonly onSubmit: (data: z.infer<T>) => Promise<void> | void;
  readonly submitLabel?: string;
  readonly cancelLabel?: string;
  readonly footer?: ReactNode;
}

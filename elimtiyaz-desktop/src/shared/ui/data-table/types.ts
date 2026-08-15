/**
 * DataTable column definition — declarative spec for a single column.
 */
import type { ReactNode } from "react";

export interface DataTableColumn<T> {
  readonly header: ReactNode;
  readonly accessor: keyof T | ((row: T) => unknown);
  readonly cell?: (row: T, index: number) => ReactNode;
  readonly className?: string;
  readonly sortable?: boolean;
  readonly searchable?: boolean;
}

export interface DataTableAction<T> {
  readonly label: ReactNode;
  readonly onClick: (row: T) => void;
  readonly variant?: "default" | "outline" | "ghost" | "destructive";
  readonly disabled?: (row: T) => boolean;
  readonly icon?: ReactNode;
}

export interface DataTableProps<T> {
  readonly data: readonly T[];
  readonly columns: readonly DataTableColumn<T>[];
  readonly actions?: readonly DataTableAction<T>[];
  readonly searchFields?: readonly (keyof T)[];
  readonly searchPlaceholder?: string;
  readonly emptyMessage?: string;
  readonly pageSize?: number;
  readonly onRowClick?: (row: T) => void;
  readonly getRowId?: (row: T, index: number) => string;
  readonly title?: ReactNode;
  readonly toolbar?: ReactNode;
}

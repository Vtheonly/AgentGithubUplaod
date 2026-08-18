/**
 * <DataTable<T>> — generic, declarative data table primitive.
 * Features: global search (debounced), column sorting, pagination, empty state, row actions.
 * ~165 lines. Built on TanStack Table v8.
 */
import { useState, useMemo, type ReactNode } from "react";
import {
  useReactTable, getCoreRowModel, getSortedRowModel,
  getFilteredRowModel, getPaginationRowModel, flexRender,
  type SortingState, type ColumnDef, type CellContext,
} from "@tanstack/react-table";
import { Search, ChevronUp, ChevronDown, ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight } from "lucide-react";
import { Input } from "../input";
import { Button } from "../button";
import { cn } from "../cn";
import { useDebounce } from "../../hooks/use-debounce";
import type { DataTableProps, DataTableColumn } from "./types";

export function DataTable<T>(props: DataTableProps<T>): ReactNode {
  const {
    data, columns, actions, searchFields, searchPlaceholder = "Rechercher…",
    emptyMessage = "Aucune donnée.", pageSize = 10, onRowClick, getRowId,
    title, toolbar, hideSearch = false,
  } = props;

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 200);
  const [sorting, setSorting] = useState<SortingState>([]);

  const searchableKeys = useMemo(() => {
    if (searchFields) return searchFields.map((k) => String(k));
    return columns
      .filter((c) => typeof c.accessor === "string" && c.searchable !== false)
      .map((c) => c.accessor as string);
  }, [columns, searchFields]);

  const filteredData = useMemo(() => {
    const rows = data as T[];
    if (!debouncedSearch.trim()) return rows;
    const q = debouncedSearch.toLowerCase();
    return rows.filter((row) =>
      searchableKeys.some((key) => {
        const v = (row as Record<string, unknown>)[key];
        return v != null && String(v).toLowerCase().includes(q);
      }),
    );
  }, [data, debouncedSearch, searchableKeys]);

  const tanstackColumns = useMemo(() => {
    const cols = columns.map((col, idx) => toTanstackColumn(col, idx));
    if (actions && actions.length > 0) {
      cols.push({
        id: "__actions",
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row }) => (
          <div className="flex justify-end gap-1">
            {actions.map((a, i) => (
              <Button
                key={i}
                variant={a.variant ?? "ghost"}
                size="sm"
                disabled={a.disabled?.(row.original)}
                onClick={(e) => { e.stopPropagation(); a.onClick(row.original); }}
              >
                {a.icon}
                {a.label}
              </Button>
            ))}
          </div>
        ),
        enableSorting: false,
      });
    }
    return cols;
  }, [columns, actions]);

  const table = useReactTable({
    data: filteredData,
    columns: tanstackColumns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getRowId: getRowId ? (row, i) => getRowId(row as T, i) : undefined,
    initialState: { pagination: { pageSize } },
  });

  return (
    <div className="flex flex-col gap-3">
      {(title || (searchFields !== null && !hideSearch)) && (
        <div className="flex items-center justify-between gap-3">
          {title ? <h3 className="text-base font-semibold">{title}</h3> : <span />}
          <div className="flex items-center gap-2">
            {toolbar}
            {!hideSearch && (
              <div className="relative">
                <Search className="absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={searchPlaceholder}
                  className="h-8 w-56 pl-8"
                />
              </div>
            )}
          </div>
        </div>
      )}
      <div className="rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/30">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => {
                  const sorted = h.column.getIsSorted();
                  return (
                    <th
                      key={h.id}
                      className={cn(
                        "px-3 py-2 text-left font-medium",
                        h.column.getCanSort() && "cursor-pointer select-none hover:bg-muted/60",
                      )}
                      onClick={h.column.getToggleSortingHandler()}
                    >
                      <div className="flex items-center gap-1">
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {sorted === "asc" && <ChevronUp className="size-3" />}
                        {sorted === "desc" && <ChevronDown className="size-3" />}
                      </div>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td colSpan={tanstackColumns.length} className="px-3 py-8 text-center text-muted-foreground">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  className={cn("border-t hover:bg-muted/30", onRowClick && "cursor-pointer")}
                  onClick={onRowClick ? () => onRowClick(row.original as T) : undefined}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-3 py-2 align-middle">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <DataTablePagination table={table as ReturnType<typeof useReactTable<T>>} />
    </div>
  );
}

function DataTablePagination<T>({ table }: { table: ReturnType<typeof useReactTable<T>> }) {
  const { pageIndex, pageSize } = table.getState().pagination;
  const total = table.getFilteredRowModel().rows.length;
  const from = total === 0 ? 0 : pageIndex * pageSize + 1;
  const to = Math.min((pageIndex + 1) * pageSize, total);
  return (
    <div className="flex items-center justify-between text-xs text-muted-foreground">
      <span>{total > 0 ? `${from}–${to} sur ${total}` : "—"}</span>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="icon" disabled={!table.getCanPreviousPage()} onClick={() => table.setPageIndex(0)}>
          <ChevronsLeft className="size-3" />
        </Button>
        <Button variant="outline" size="icon" disabled={!table.getCanPreviousPage()} onClick={() => table.previousPage()}>
          <ChevronLeft className="size-3" />
        </Button>
        <span className="px-2">Page {pageIndex + 1} / {table.getPageCount() || 1}</span>
        <Button variant="outline" size="icon" disabled={!table.getCanNextPage()} onClick={() => table.nextPage()}>
          <ChevronRight className="size-3" />
        </Button>
        <Button variant="outline" size="icon" disabled={!table.getCanNextPage()} onClick={() => table.setPageIndex(table.getPageCount() - 1)}>
          <ChevronsRight className="size-3" />
        </Button>
      </div>
    </div>
  );
}

function toTanstackColumn<T>(col: DataTableColumn<T>, idx: number): ColumnDef<T, unknown> {
  const base = {
    header: (() => col.header) as () => ReactNode,
    enableSorting: col.sortable !== false && typeof col.accessor === "string",
  };
  const defaultCell = ({ getValue }: CellContext<T, unknown>) => {
    const v = getValue();
    return v == null ? "" : String(v);
  };
  if (typeof col.accessor === "function") {
    const fn = col.accessor as (row: T) => unknown;
    return {
      ...base,
      id: `col_${idx}`,
      accessorFn: (row: T) => fn(row),
      cell: col.cell
        ? ({ row, table }: CellContext<T, unknown>) =>
            col.cell!(row.original, table.getSortedRowModel().rows.findIndex((r) => r.id === row.id))
        : defaultCell,
    };
  }
  const key = col.accessor as keyof T & string;
  return {
    ...base,
    id: key,
    accessorKey: key,
    cell: col.cell
      ? ({ row, table }: CellContext<T, unknown>) =>
          col.cell!(row.original, table.getSortedRowModel().rows.findIndex((r) => r.id === row.id))
      : defaultCell,
  };
}

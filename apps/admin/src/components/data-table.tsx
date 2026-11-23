'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type RowSelectionState,
  type SortingState,
} from '@tanstack/react-table';
import { InboxIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

export type DataColumn<T> = {
  id: string;
  header: string;
  cell: (row: T) => React.ReactNode;
  sortValue?: (row: T) => string | number;
  className?: string;
};

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  loading,
  emptyTitle,
  emptyDescription,
  globalFilter = '',
  pageSizeOptions = [10, 20, 50],
  manualPagination,
  selectable = false,
  selectedKeys,
  onSelectedKeysChange,
}: {
  rows: T[];
  columns: DataColumn<T>[];
  rowKey: (row: T) => string | number;
  loading?: boolean;
  emptyTitle: string;
  emptyDescription: string;
  globalFilter?: string;
  pageSizeOptions?: number[];
  manualPagination?: {
    pageIndex: number;
    pageSize: number;
    pageCount: number;
    onPageIndexChange: (pageIndex: number) => void;
    onPageSizeChange: (pageSize: number) => void;
  };
  selectable?: boolean;
  /** Controlled selection (string keys from rowKey). */
  selectedKeys?: Array<string | number>;
  onSelectedKeysChange?: (keys: Array<string | number>) => void;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pageSize, setPageSize] = useState(manualPagination?.pageSize ?? pageSizeOptions[0] ?? 10);
  const [pageIndex, setPageIndex] = useState(manualPagination?.pageIndex ?? 0);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

  const effectivePageIndex = manualPagination?.pageIndex ?? pageIndex;
  const effectivePageSize = manualPagination?.pageSize ?? pageSize;

  // Sync controlled selection → table state
  useEffect(() => {
    if (!selectable || selectedKeys === undefined) return;
    const next: RowSelectionState = {};
    for (const k of selectedKeys) next[String(k)] = true;
    setRowSelection(next);
  }, [selectable, selectedKeys]);

  const tableColumns = useMemo<ColumnDef<T>[]>(() => {
    const cols: ColumnDef<T>[] = columns.map((column) => ({
      id: column.id,
      accessorFn: (row) => column.sortValue?.(row) ?? '',
      header: column.header,
      cell: ({ row }) => column.cell(row.original),
      enableSorting: Boolean(column.sortValue),
      meta: { className: column.className },
    }));

    if (selectable) {
      cols.unshift({
        id: '__select',
        header: ({ table }) => (
          <input
            type="checkbox"
            className="size-4 accent-foreground"
            aria-label="Select all on page"
            checked={table.getIsAllPageRowsSelected()}
            ref={(el) => {
              if (el) el.indeterminate = table.getIsSomePageRowsSelected();
            }}
            onChange={table.getToggleAllPageRowsSelectedHandler()}
          />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            className="size-4 accent-foreground"
            aria-label="Select row"
            checked={row.getIsSelected()}
            disabled={!row.getCanSelect()}
            onChange={row.getToggleSelectedHandler()}
            onClick={(e) => e.stopPropagation()}
          />
        ),
        enableSorting: false,
        meta: { className: 'w-10' },
      });
    }
    return cols;
  }, [columns, selectable]);

  const table = useReactTable({
    data: rows,
    columns: tableColumns,
    state: {
      sorting,
      globalFilter: manualPagination ? '' : globalFilter,
      pagination: { pageIndex: effectivePageIndex, pageSize: effectivePageSize },
      rowSelection,
    },
    enableRowSelection: selectable,
    onRowSelectionChange: (updater) => {
      const next = typeof updater === 'function' ? updater(rowSelection) : updater;
      setRowSelection(next);
      if (onSelectedKeysChange) {
        onSelectedKeysChange(
          Object.keys(next)
            .filter((k) => next[k])
            .map((k) => {
              const asNum = Number(k);
              return Number.isFinite(asNum) && String(asNum) === k ? asNum : k;
            }),
        );
      }
    },
    onSortingChange: setSorting,
    onPaginationChange: (updater) => {
      const next =
        typeof updater === 'function'
          ? updater({ pageIndex: effectivePageIndex, pageSize: effectivePageSize })
          : updater;
      if (manualPagination) {
        manualPagination.onPageIndexChange(next.pageIndex);
        if (next.pageSize !== effectivePageSize) {
          manualPagination.onPageSizeChange(next.pageSize);
        }
      } else {
        setPageIndex(next.pageIndex);
        setPageSize(next.pageSize);
      }
    },
    manualPagination: Boolean(manualPagination),
    pageCount: manualPagination?.pageCount,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: manualPagination ? undefined : getPaginationRowModel(),
    getRowId: (row) => String(rowKey(row)),
    globalFilterFn: (row, _columnId, filter) => {
      const q = String(filter || '')
        .toLowerCase()
        .trim();
      if (!q) return true;
      return columns.some((col) => {
        const raw = col.sortValue?.(row.original);
        if (raw != null && String(raw).toLowerCase().includes(q)) return true;
        const rendered = col.cell(row.original);
        if (typeof rendered === 'string' || typeof rendered === 'number') {
          return String(rendered).toLowerCase().includes(q);
        }
        return false;
      });
    },
  });

  const pageCount = manualPagination?.pageCount || table.getPageCount() || 1;
  const colSpan = columns.length + (selectable ? 1 : 0);

  return (
    <Card className="overflow-hidden py-0">
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((hg) => (
                <TableRow key={hg.id} className="hover:bg-transparent">
                  {hg.headers.map((header) => {
                    const canSort = header.column.getCanSort();
                    return (
                      <TableHead
                        key={header.id}
                        className={cn(
                          'bg-muted/40 text-muted-foreground',
                          (header.column.columnDef.meta as { className?: string } | undefined)
                            ?.className,
                        )}
                      >
                        {header.isPlaceholder ? null : canSort ? (
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 font-medium"
                            onClick={header.column.getToggleSortingHandler()}
                          >
                            {flexRender(header.column.columnDef.header, header.getContext())}
                            {{
                              asc: ' ↑',
                              desc: ' ↓',
                            }[header.column.getIsSorted() as string] ?? null}
                          </button>
                        ) : (
                          flexRender(header.column.columnDef.header, header.getContext())
                        )}
                      </TableHead>
                    );
                  })}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: colSpan }).map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-24" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : table.getRowModel().rows.length ? (
                table.getRowModel().rows.map((row) => (
                  <TableRow
                    key={row.id}
                    data-state={row.getIsSelected() ? 'selected' : undefined}
                    className={row.getIsSelected() ? 'bg-muted/40' : undefined}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell
                        key={cell.id}
                        className={cn(
                          (cell.column.columnDef.meta as { className?: string } | undefined)
                            ?.className,
                        )}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={colSpan} className="h-40">
                    <Empty>
                      <EmptyHeader>
                        <EmptyMedia variant="icon">
                          <InboxIcon />
                        </EmptyMedia>
                        <EmptyTitle>{emptyTitle}</EmptyTitle>
                        <EmptyDescription>{emptyDescription}</EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <div className="flex flex-col gap-3 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            Page {Math.min(effectivePageIndex + 1, pageCount)} of {pageCount}
            {selectable && selectedKeys && selectedKeys.length > 0
              ? ` · ${selectedKeys.length} selected`
              : null}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>Rows</span>
              <div className="flex gap-1">
                {pageSizeOptions.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => {
                      if (manualPagination) {
                        manualPagination.onPageSizeChange(n);
                        manualPagination.onPageIndexChange(0);
                      } else {
                        setPageSize(n);
                        setPageIndex(0);
                      }
                    }}
                    className={cn(
                      'inline-flex size-7 items-center justify-center rounded-full text-xs font-medium',
                      effectivePageSize === n
                        ? 'bg-foreground text-background'
                        : 'hover:bg-muted',
                    )}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={!table.getCanPreviousPage()}
                onClick={() => table.previousPage()}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!table.getCanNextPage()}
                onClick={() => table.nextPage()}
              >
                Next
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

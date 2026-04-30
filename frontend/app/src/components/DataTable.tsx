import {
  useReactTable, getCoreRowModel, getSortedRowModel, getPaginationRowModel,
  flexRender,
} from '@tanstack/react-table';
import type { ColumnDef, SortingState } from '@tanstack/react-table';
import { useState } from 'react';
import { ChevronUp, ChevronDown, ChevronsLeft, ChevronsRight, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DataTableSkeleton } from '@/components/Skeleton';

type Props<T> = {
  columns: ColumnDef<T, unknown>[];
  data: T[];
  pageSize?: number;
  emptyMessage?: string;
  maxBodyHeight?: number;
  loading?: boolean;
  skeletonRows?: number;
  onRowClick?: (row: T) => void;
};

export function DataTable<T>({ columns, data, pageSize = 10, emptyMessage = 'Hech narsa topilmadi', maxBodyHeight = 480, loading = false, skeletonRows = 6, onRowClick }: Props<T>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
  });

  // Skeleton path — hooks above always called to keep hook order stable.
  if (loading && data.length === 0) {
    return <DataTableSkeleton rows={skeletonRows} cols={Math.min(columns.length, 6)} />;
  }

  const total = data.length;
  const { pageIndex, pageSize: ps } = table.getState().pagination;
  const startRow = total === 0 ? 0 : pageIndex * ps + 1;
  const endRow = Math.min(total, (pageIndex + 1) * ps);

  return (
    <div className="bg-bg2 border border-border rounded-lg overflow-hidden shadow">
      <div style={{ maxHeight: maxBodyHeight }} className="overflow-y-auto relative">
        <table className="w-full" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => {
                  const canSort = h.column.getCanSort();
                  const sortDir = h.column.getIsSorted();
                  return (
                    <th
                      key={h.id}
                      onClick={canSort ? h.column.getToggleSortingHandler() : undefined}
                      className={cn(
                        'sticky top-0 z-[5] px-4 py-2.5 text-left text-[11px] text-text3 font-medium uppercase tracking-wider bg-bg3',
                        'shadow-[inset_0_-1px_0_var(--border)]',
                        canSort && 'cursor-pointer select-none',
                      )}
                    >
                      <span className="inline-flex items-center gap-1">
                        {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                        {canSort && (
                          <span className={cn('opacity-40 text-[9px]', sortDir && 'opacity-100 text-blue')}>
                            {sortDir === 'desc' ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
                          </span>
                        )}
                      </span>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="text-center py-12 text-text3 text-[12.5px]">{emptyMessage}</td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  className={cn(
                    'border-b border-border last:border-b-0 hover:bg-bg3 transition-colors',
                    onRowClick && 'cursor-pointer',
                  )}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-4 py-2.5 text-[12.5px] text-text">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between px-4 py-2.5 border-t border-border bg-bg2 text-[12px] text-text2">
        <div className="text-text3">{startRow}–{endRow}, jami {total}</div>
        <div className="flex items-center gap-1">
          <select
            className="px-2 py-1 border border-border rounded-md bg-bg2 text-[12px] text-text2 cursor-pointer mr-1.5"
            value={ps}
            onChange={(e) => table.setPageSize(Number(e.target.value))}
          >
            {[10, 25, 50].map(n => <option key={n} value={n}>{n}/sahifa</option>)}
          </select>
          <PagerBtn onClick={() => table.setPageIndex(0)} disabled={!table.getCanPreviousPage()}><ChevronsLeft className="w-3 h-3" /></PagerBtn>
          <PagerBtn onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}><ChevronLeft className="w-3 h-3" /></PagerBtn>
          <span className="px-2 text-[12px] text-text2">{pageIndex + 1} / {Math.max(1, table.getPageCount())}</span>
          <PagerBtn onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}><ChevronRight className="w-3 h-3" /></PagerBtn>
          <PagerBtn onClick={() => table.setPageIndex(table.getPageCount() - 1)} disabled={!table.getCanNextPage()}><ChevronsRight className="w-3 h-3" /></PagerBtn>
        </div>
      </div>
    </div>
  );
}

function PagerBtn({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-7 h-7 rounded-md border border-border bg-bg2 text-text2 cursor-pointer inline-flex items-center justify-center text-[12px] font-medium hover:bg-bg3 hover:text-text disabled:opacity-40 disabled:cursor-not-allowed"
    >{children}</button>
  );
}

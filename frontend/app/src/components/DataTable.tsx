import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  flexRender,
} from "@tanstack/react-table";
import type {
  ColumnDef,
  SortingState,
  VisibilityState,
  ColumnOrderState,
  Table,
  Column,
} from "@tanstack/react-table";
import { useEffect, useRef, useState } from "react";
import {
  ChevronUp,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  ChevronLeft,
  ChevronRight,
  Columns3,
  GripVertical,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { DataTableSkeleton } from "@/components/Skeleton";

type Props<T> = {
  columns: ColumnDef<T, unknown>[];
  data: T[];
  pageSize?: number;
  emptyMessage?: string;
  maxBodyHeight?: number;
  loading?: boolean;
  skeletonRows?: number;
  onRowClick?: (row: T) => void;
  /** When set, shows a "Columns" toggle and persists user's choice in localStorage. */
  storageKey?: string;
  /** Column ids hidden by default (until user toggles them on). */
  defaultHidden?: string[];
};

function loadVisibility(
  storageKey: string | undefined,
  defaultHidden: string[] | undefined,
): VisibilityState {
  if (storageKey) {
    try {
      const raw = localStorage.getItem(`columns.${storageKey}`);
      if (raw) return JSON.parse(raw) as VisibilityState;
    } catch {
      /* ignore */
    }
  }
  const init: VisibilityState = {};
  defaultHidden?.forEach((id) => {
    init[id] = false;
  });
  return init;
}

function loadColumnOrder(storageKey: string | undefined): ColumnOrderState {
  if (storageKey) {
    try {
      const raw = localStorage.getItem(`col-order.${storageKey}`);
      if (raw) return JSON.parse(raw) as ColumnOrderState;
    } catch {
      /* ignore */
    }
  }
  return [];
}

export function DataTable<T>({
  columns,
  data,
  pageSize = 10,
  emptyMessage = "Hech narsa topilmadi",
  maxBodyHeight = 480,
  loading = false,
  skeletonRows = 6,
  onRowClick,
  storageKey,
  defaultHidden,
}: Props<T>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(
    () => loadVisibility(storageKey, defaultHidden),
  );
  const [columnOrder, setColumnOrder] = useState<ColumnOrderState>(() =>
    loadColumnOrder(storageKey),
  );
  const dragColId = useRef<string | null>(null);

  useEffect(() => {
    if (!storageKey) return;
    try {
      localStorage.setItem(
        `columns.${storageKey}`,
        JSON.stringify(columnVisibility),
      );
    } catch {
      /* ignore */
    }
  }, [columnVisibility, storageKey]);

  useEffect(() => {
    if (!storageKey || columnOrder.length === 0) return;
    try {
      localStorage.setItem(
        `col-order.${storageKey}`,
        JSON.stringify(columnOrder),
      );
    } catch {
      /* ignore */
    }
  }, [columnOrder, storageKey]);

  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnVisibility, columnOrder },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onColumnOrderChange: setColumnOrder,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
  });

  // Skeleton path — hooks above always called to keep hook order stable.
  if (loading && data.length === 0) {
    return (
      <DataTableSkeleton
        rows={skeletonRows}
        cols={Math.min(columns.length, 6)}
      />
    );
  }

  const total = data.length;
  const { pageIndex, pageSize: ps } = table.getState().pagination;
  const startRow = total === 0 ? 0 : pageIndex * ps + 1;
  const endRow = Math.min(total, (pageIndex + 1) * ps);

  return (
    <div className="bg-bg2 border border-border rounded-lg overflow-hidden shadow">
      {storageKey && (
        <div className="flex items-center justify-end px-3 py-2 border-b border-border bg-bg2">
          <ColumnsToggle table={table} defaultHidden={defaultHidden ?? []} />
        </div>
      )}
      <div
        style={{ maxHeight: maxBodyHeight }}
        className="overflow-y-auto relative"
      >
        <table
          className="w-full"
          style={{ borderCollapse: "separate", borderSpacing: 0 }}
        >
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => {
                  const canSort = h.column.getCanSort();
                  const sortDir = h.column.getIsSorted();
                  return (
                    <th
                      key={h.id}
                      draggable
                      onClick={
                        canSort ? h.column.getToggleSortingHandler() : undefined
                      }
                      onDragStart={() => {
                        dragColId.current = h.id;
                      }}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => {
                        if (!dragColId.current || dragColId.current === h.id)
                          return;
                        setColumnOrder((prev) => {
                          const base = prev.length
                            ? [...prev]
                            : table.getAllLeafColumns().map((c) => c.id);
                          const from = base.indexOf(dragColId.current!);
                          const to = base.indexOf(h.id);
                          if (from < 0 || to < 0) return prev;
                          const next = [...base];
                          next.splice(from, 1);
                          next.splice(to, 0, dragColId.current!);
                          return next;
                        });
                        dragColId.current = null;
                      }}
                      className={cn(
                        "sticky top-0 z-[5] px-4 py-2.5 text-left text-[11px] text-text3 font-medium uppercase tracking-wider bg-bg3",
                        "shadow-[inset_0_-1px_0_var(--border)]",
                        canSort && "cursor-pointer select-none",
                      )}
                    >
                      <span className="inline-flex items-center gap-1">
                        <GripVertical className="w-3 h-3 opacity-30 cursor-grab shrink-0" />
                        {h.isPlaceholder
                          ? null
                          : flexRender(
                              h.column.columnDef.header,
                              h.getContext(),
                            )}
                        {canSort && (
                          <span
                            className={cn(
                              "opacity-40 text-[9px]",
                              sortDir && "opacity-100 text-blue",
                            )}
                          >
                            {sortDir === "desc" ? (
                              <ChevronDown className="w-3 h-3" />
                            ) : (
                              <ChevronUp className="w-3 h-3" />
                            )}
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
                <td
                  colSpan={columns.length}
                  className="text-center py-12 text-text3 text-[12.5px]"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  className={cn(
                    "border-b border-border last:border-b-0 hover:bg-bg3 transition-colors",
                    onRowClick && "cursor-pointer",
                  )}
                  onClick={
                    onRowClick ? () => onRowClick(row.original) : undefined
                  }
                >
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      className="px-4 py-2.5 text-[12.5px] text-text"
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between px-4 py-2.5 border-t border-border bg-bg2 text-[12px] text-text2">
        <div className="text-text3">
          {startRow}–{endRow}, jami {total}
        </div>
        <div className="flex items-center gap-1">
          <select
            className="px-2 py-1 border border-border rounded-md bg-bg2 text-[12px] text-text2 cursor-pointer mr-1.5"
            value={ps}
            onChange={(e) => table.setPageSize(Number(e.target.value))}
          >
            {[10, 25, 50].map((n) => (
              <option key={n} value={n}>
                {n}/sahifa
              </option>
            ))}
          </select>
          <PagerBtn
            onClick={() => table.setPageIndex(0)}
            disabled={!table.getCanPreviousPage()}
            ariaLabel="Birinchi sahifa"
          >
            <ChevronsLeft className="w-3 h-3" />
          </PagerBtn>
          <PagerBtn
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            ariaLabel="Oldingi sahifa"
          >
            <ChevronLeft className="w-3 h-3" />
          </PagerBtn>
          <span className="px-2 text-[12px] text-text2">
            {pageIndex + 1} / {Math.max(1, table.getPageCount())}
          </span>
          <PagerBtn
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            ariaLabel="Keyingi sahifa"
          >
            <ChevronRight className="w-3 h-3" />
          </PagerBtn>
          <PagerBtn
            onClick={() => table.setPageIndex(table.getPageCount() - 1)}
            disabled={!table.getCanNextPage()}
            ariaLabel="Oxirgi sahifa"
          >
            <ChevronsRight className="w-3 h-3" />
          </PagerBtn>
        </div>
      </div>
    </div>
  );
}

function PagerBtn({
  onClick,
  disabled,
  ariaLabel,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  ariaLabel: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className="w-7 h-7 rounded-md border border-border bg-bg2 text-text2 cursor-pointer inline-flex items-center justify-center text-[12px] font-medium hover:bg-bg3 hover:text-text disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {children}
    </button>
  );
}

function getHeaderLabel<T>(col: Column<T, unknown>): string {
  const h = col.columnDef.header;
  if (typeof h === "string") return h;
  return col.id;
}

function ColumnsToggle<T>({
  table,
  defaultHidden,
}: {
  table: Table<T>;
  defaultHidden: string[];
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const allCols = table.getAllLeafColumns();
  const visibleCount = allCols.filter((c) => c.getIsVisible()).length;

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border2 bg-bg2 text-[12px] text-text2 hover:bg-bg3 hover:text-text"
        aria-label="Kolonnalarni boshqarish"
      >
        <Columns3 className="w-3.5 h-3.5" />
        <span>
          Kolonnalar{" "}
          <span className="text-text3">
            ({visibleCount}/{allCols.length})
          </span>
        </span>
      </button>
      {open && (
        <div className="absolute right-0 top-[calc(100%+4px)] z-50 w-64 bg-bg2 border border-border rounded-lg shadow-lg overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border">
            <span className="text-[12px] font-medium text-text">
              Ko'rsatish
            </span>
            <div className="flex items-center gap-2 text-[11px]">
              <button
                type="button"
                className="text-blue hover:underline"
                onClick={() => allCols.forEach((c) => c.toggleVisibility(true))}
              >
                Hammasi
              </button>
              <span className="text-text3">·</span>
              <button
                type="button"
                className="text-text2 hover:text-text"
                onClick={() => {
                  // reset to defaults — apply defaultHidden, show others
                  const next: VisibilityState = {};
                  defaultHidden.forEach((id) => {
                    next[id] = false;
                  });
                  table.setColumnVisibility(next);
                }}
              >
                Standart
              </button>
            </div>
          </div>
          <div className="max-h-[320px] overflow-y-auto p-1">
            {allCols.map((col) => (
              <label
                key={col.id}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-[6px] cursor-pointer hover:bg-bg3 text-[12.5px]"
              >
                <input
                  type="checkbox"
                  checked={col.getIsVisible()}
                  onChange={col.getToggleVisibilityHandler()}
                  className="w-3.5 h-3.5 cursor-pointer accent-blue"
                />
                <span className="text-text">{getHeaderLabel(col)}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

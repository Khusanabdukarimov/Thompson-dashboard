import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Search, X, Pin, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export type FilterPreset = { id: string; label: string; pinned?: boolean };
export type SavedFilter = { id: string; label: string; values: FilterValues; created_at: number };

export type FilterField =
  | { key: string; label: string; type: 'text'; placeholder?: string }
  | { key: string; label: string; type: 'select'; options: { value: string; label: string }[] }
  | { key: string; label: string; type: 'amount' }
  | { key: string; label: string; type: 'date' };

export type FilterValues = Record<string, string | undefined>;

type Props = {
  presets: FilterPreset[];
  activePreset: string | null;
  onPresetChange: (id: string | null) => void;

  searchValue: string;
  onSearchChange: (v: string) => void;

  fields: FilterField[];
  values: FilterValues;
  onChange: (key: string, val: string | undefined) => void;

  onClear: () => void;
  onApply: () => void;

  /** Renders inside the chip area (before the search input). Pass undefined to hide. */
  activeChipLabel?: string;
  onActiveChipClear?: () => void;

  rightSlot?: ReactNode;

  /** When set, "Save filter" button persists current values to localStorage under this key.
   *  Saved filters appear in the preset sidebar. */
  storageKey?: string;
  /** Callback when a saved filter is selected — should set values from preset. */
  onApplySavedFilter?: (values: FilterValues) => void;
};

export function FilterBar({
  presets, activePreset, onPresetChange,
  searchValue, onSearchChange,
  fields, values, onChange,
  onClear, onApply,
  activeChipLabel, onActiveChipClear,
  rightSlot,
  storageKey, onApplySavedFilter,
}: Props) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<'left' | 'right'>('left');
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>([]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const hasSomethingToClear =
    searchValue.length > 0
    || !!activeChipLabel
    || Object.values(values).some(v => v != null && v !== '');

  // "/" shortcut to focus search (when not already in an input/textarea)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== '/') return;
      const t = e.target;
      if (t instanceof HTMLElement) {
        const tag = t.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || t.isContentEditable) return;
      }
      e.preventDefault();
      inputRef.current?.focus();
      setOpen(true);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Load saved filters from localStorage
  useEffect(() => {
    if (!storageKey) return;
    try {
      const raw = localStorage.getItem(`filter-saved.${storageKey}`);
      if (raw) setSavedFilters(JSON.parse(raw) as SavedFilter[]);
    } catch { /* ignore */ }
  }, [storageKey]);

  function saveFilter() {
    if (!storageKey) return;
    const name = prompt('Filtr nomi:');
    if (!name?.trim()) return;
    const newFilter: SavedFilter = {
      id: `saved_${Date.now()}`,
      label: name.trim(),
      values: { ...values },
      created_at: Date.now(),
    };
    const next = [...savedFilters, newFilter];
    setSavedFilters(next);
    try { localStorage.setItem(`filter-saved.${storageKey}`, JSON.stringify(next)); } catch { /* ignore */ }
  }

  function deleteSavedFilter(id: string) {
    const next = savedFilters.filter(f => f.id !== id);
    setSavedFilters(next);
    if (storageKey) {
      try { localStorage.setItem(`filter-saved.${storageKey}`, JSON.stringify(next)); } catch { /* ignore */ }
    }
  }

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  // Smart anchor: align popover to right edge of wrap if not enough space on right
  useEffect(() => {
    if (!open || !wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const POPOVER_W = 720;
    // If left-anchored popover would extend past viewport, use right anchor
    if (rect.left + POPOVER_W > window.innerWidth - 16) {
      setAnchor('right');
    } else {
      setAnchor('left');
    }
  }, [open]);

  return (
    <div ref={wrapRef} className="relative w-full max-w-[560px]">
      <div
        className={cn(
          'flex items-center gap-1.5 rounded-[22px] pl-1.5 pr-2.5 py-[5px] cursor-text transition-colors min-h-[38px]',
          open ? 'bg-bg2 shadow-xs' : 'bg-bg3 hover:bg-bg2',
        )}
        onClick={() => setOpen(true)}
      >
        {activeChipLabel && (
          <span className="inline-flex items-center gap-1.5 bg-blue-bg border border-blue-bd text-blue text-[12.5px] font-medium pl-3 pr-1 py-1 rounded-[18px] whitespace-nowrap">
            <span>{activeChipLabel}</span>
            {onActiveChipClear && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onActiveChipClear(); }}
                className="w-[18px] h-[18px] rounded-full inline-flex items-center justify-center text-blue hover:bg-blue/15"
                aria-label="Clear filter"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </span>
        )}
        <input
          ref={inputRef}
          className="flex-1 bg-transparent text-[13px] text-text font-sans py-1 px-1.5 min-w-[120px] placeholder:text-text3 border-0 outline-none focus:outline-none focus-visible:outline-none"
          placeholder="+ qidiruv"
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
          onClick={() => setOpen(true)}
        />
        <div className="flex items-center gap-1 ml-auto text-text3">
          <kbd
            title="Tezkor: / tugmasini bosing"
            className="hidden sm:inline-flex items-center justify-center mono text-[10px] px-1.5 h-5 rounded border border-border bg-bg2 text-text3"
          >/</kbd>
          <button type="button" className="w-[30px] h-[30px] rounded-full inline-flex items-center justify-center hover:bg-bg2 hover:text-text" aria-label="Qidirish">
            <Search className="w-3.5 h-3.5" />
          </button>
          {hasSomethingToClear && (
            <button
              type="button"
              className="w-[30px] h-[30px] rounded-full inline-flex items-center justify-center hover:bg-bg2 hover:text-text"
              onClick={(e) => { e.stopPropagation(); onClear(); }}
              aria-label="Tozalash"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {open && (
        <div className={cn(
          'absolute top-[calc(100%+6px)] bg-bg2 border border-border rounded-xl shadow-lg z-50 overflow-hidden w-[720px] max-w-[calc(100vw-32px)]',
          anchor === 'left' ? 'left-0 right-auto' : 'right-0 left-auto',
        )}>
          <div className="grid grid-cols-[200px_1fr]">
            {/* Saved presets */}
            <div className="bg-bg3 border-r border-border p-2 flex flex-col gap-px overflow-y-auto max-h-[480px]">
              {presets.map((p) => (
                <div
                  key={p.id}
                  onClick={() => { onPresetChange(p.id); setOpen(false); }}
                  className={cn(
                    'flex items-center justify-between px-2.5 py-2 rounded-[7px] cursor-pointer text-[12.5px] font-medium transition-colors',
                    activePreset === p.id ? 'text-blue' : 'text-text2 hover:bg-bg2 hover:text-text',
                  )}
                >
                  <span>{p.label}</span>
                  <Pin className={cn('w-3 h-3', p.pinned ? 'opacity-100 text-blue' : 'opacity-30')} />
                </div>
              ))}
              {savedFilters.length > 0 && <div className="h-px bg-border my-2 mx-1" />}
              {savedFilters.map((sf) => (
                <div
                  key={sf.id}
                  onClick={() => {
                    onApplySavedFilter?.(sf.values);
                    onPresetChange(null);
                    setOpen(false);
                  }}
                  className="group flex items-center justify-between px-2.5 py-2 rounded-[7px] cursor-pointer text-[12.5px] font-medium text-text2 hover:bg-bg2 hover:text-text transition-colors"
                >
                  <span className="truncate">{sf.label}</span>
                  <button
                    type="button"
                    className="w-4 h-4 rounded opacity-0 group-hover:opacity-100 text-text3 hover:text-red flex items-center justify-center"
                    onClick={(e) => { e.stopPropagation(); deleteSavedFilter(sf.id); }}
                    aria-label="O'chirish"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
              <div className="h-px bg-border my-2 mx-1" />
              <div className="px-2.5 py-2 text-[12px] text-text3 italic">{savedFilters.length === 0 ? 'Saqlangan filtr yo\'q' : `${savedFilters.length} ta saqlangan`}</div>
            </div>

            {/* Body */}
            <div className="p-[18px_22px] overflow-y-auto max-h-[480px]">
              {fields.map((f) => (
                <FieldRow key={f.key} field={f} value={values[f.key]} onChange={(v) => onChange(f.key, v)} />
              ))}
              <span className="text-[12px] text-text3 cursor-pointer hover:text-text2" onClick={onClear}>Standart maydonlarga qaytish</span>
            </div>

            {/* Footer (spans both cols) */}
            <div className="col-span-2 flex justify-between items-center px-[22px] py-3 border-t border-border">
              <div className="flex items-center gap-3.5">
                {storageKey ? (
                  <span className="text-[12px] text-blue cursor-pointer font-medium hover:underline" onClick={saveFilter}>+ Filtrni saqlash</span>
                ) : (
                  <span className="text-[12px] text-text3 italic">filtr saqlash o'chirilgan</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => { onApply(); setOpen(false); }}
                  className="bg-blue border border-blue text-white px-[18px] py-2 rounded-[7px] text-[12.5px] font-semibold inline-flex items-center gap-1.5 shadow-[0_1px_3px_rgba(34,102,245,0.3)] hover:bg-blue-2"
                >
                  <Search className="w-3.5 h-3.5" /> Topish
                </button>
                <button type="button" onClick={onClear} className="text-text2 text-[12.5px] font-medium px-3 py-2 hover:text-text">Tozalash</button>
              </div>
            </div>
          </div>
          {rightSlot}
        </div>
      )}
    </div>
  );
}

function FieldRow({ field, value, onChange }: { field: FilterField; value: string | undefined; onChange: (v: string | undefined) => void }) {
  const inputCls = 'w-full px-2.5 py-2 rounded-[7px] bg-bg3 text-text text-[12.5px] font-sans transition-colors h-[34px] border-0 outline-0 focus:bg-bg4 focus:outline-none';
  return (
    <div className="mb-3.5">
      <div className="text-[11px] text-text3 mb-1 font-medium flex justify-between items-center">
        <span>{field.label}</span>
        <span className="text-text3 cursor-pointer text-[14px] tracking-widest leading-none px-1 hover:text-text">···</span>
      </div>
      {field.type === 'text' && (
        <input
          className={inputCls}
          placeholder={field.placeholder ?? ''}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value || undefined)}
        />
      )}
      {field.type === 'select' && (
        <select
          className={inputCls}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value || undefined)}
        >
          <option value="">Barchasi</option>
          {field.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )}
      {field.type === 'amount' && (
        <input className={inputCls} type="number" placeholder="0" value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)} />
      )}
      {field.type === 'date' && (
        <input className={inputCls} type="date" value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)} />
      )}
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { groupOptions, groupState, toggleGroup, type SelectOption } from "./multiSelectGroups";

/**
 * Filter dropdown shared by the Lidlar and Sdelkalar filter panels.
 *
 * - "Barchasi" row: one click back to no filter (every box shown ticked).
 * - "Faqat" on row hover: narrow to just that value in one click.
 * - "Istisno" (pass `onExcludeChange`): the chosen values become "everything
 *   except these"; the button turns amber and reads "Istisno · …". The caller
 *   sends it to the API as a leading "!".
 * - Search appears for long lists (or always with `searchable`).
 * - Options carrying a `group` are listed under collapsible group headings
 *   (e.g. operators by team): the heading opens/closes the group, its checkbox
 *   ticks the whole group without opening it.
 * Shortcuts modelled on the PowerGym dashboard's filters.
 */
export function MultiSelect({
  label, icon, options, values, onChange, loading, searchable = false, exclude = false, onExcludeChange,
}: {
  label: string;
  icon: React.ReactNode;
  options: SelectOption[];
  values: string[];
  onChange: (v: string[]) => void;
  loading?: boolean;
  searchable?: boolean;
  /** Istisno is on: the chosen values are excluded instead of kept. */
  exclude?: boolean;
  /** Pass to show the Istisno toggle. */
  onExcludeChange?: (exclude: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hover, setHover] = useState<string | null>(null);
  // Groups the user has opened. All start closed; a search opens every group it matches.
  const [openGroups, setOpenGroups] = useState<string[]>([]);
  // "Barchasi" sends [] (no filter), which alone looks exactly like the untouched
  // picker — so remember the choice and render every box ticked.
  const [allMode, setAllMode] = useState(false);
  // A selection set from outside (a preset, a drill-down) ends "all ticked".
  if (allMode && values.length > 0) setAllMode(false);
  const ticked = allMode && values.length === 0 ? options.map(o => o.value) : values;
  const ex = exclude && values.length > 0;

  /** Emit a selection; every option ticked collapses to [] ("no filter"). */
  const emit = (next: string[]) => {
    const all = options.length > 0 && options.every(o => next.includes(o.value));
    setAllMode(all);
    onChange(all ? [] : next);
    if (all || next.length === 0) onExcludeChange?.(false);
  };
  const clearAll = (tickEverything: boolean) => {
    setAllMode(tickEverything);
    onChange([]);
    onExcludeChange?.(false);
  };
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setQuery(""); }
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const showSearch = searchable || options.length > 8;
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter(o => o.label.toLowerCase().includes(q)) : options;
  }, [options, query]);

  const toggle = (v: string) => {
    emit(ticked.includes(v) ? ticked.filter(x => x !== v) : [...ticked, v]);
  };
  const only = (v: string) => { setAllMode(false); onChange([v]); onExcludeChange?.(false); };

  // null → plain list. Groups are built from what the search leaves, so a header
  // only ever ticks the options currently visible under it.
  const grouped = useMemo(() => groupOptions(shown), [shown]);
  const searching = query.trim() !== "";

  const accent = ex ? "#f59e0b" : "#2196F3";
  const tint = ex ? "rgba(245,158,11,0.10)" : "rgba(33,150,243,0.08)";

  const renderOption = (o: SelectOption) => {
    const checked = ticked.includes(o.value);
    return (
      <div key={o.value} style={{ position: "relative" }}
        onMouseEnter={() => setHover(o.value)} onMouseLeave={() => setHover(h => (h === o.value ? null : h))}>
        <label
          style={{ display: "flex", alignItems: "center", gap: 8, padding: grouped ? "7px 12px 7px 24px" : "7px 12px", cursor: "pointer",
            background: checked ? tint : hover === o.value ? "var(--bg3)" : "transparent" }}
        >
          <input type="checkbox" checked={checked} onChange={() => toggle(o.value)} style={{ accentColor: accent, flexShrink: 0 }} />
          <span style={{ fontSize: 12, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            paddingRight: hover === o.value ? 52 : 0, textDecoration: ex && checked ? "line-through" : "none" }}>
            {o.label}
          </span>
        </label>
        {/* "Faqat" — just this value, in one click. */}
        {hover === o.value && !(values.length === 1 && values[0] === o.value && !ex) && (
          <button type="button" onClick={() => only(o.value)}
            style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", fontSize: 11, fontWeight: 600,
              padding: "2px 8px", borderRadius: 7, cursor: "pointer", background: "var(--bg2)", border: "1px solid #2196F3", color: "#2196F3" }}>
            Faqat
          </button>
        )}
      </div>
    );
  };

  const chosen = values.length === 0
    ? "Barchasi"
    : values.length === 1
      ? (options.find(o => o.value === values[0])?.label ?? values[0]).slice(0, 22)
      : `${values.length} ta tanlangan`;
  const displayLabel = ex ? `Istisno · ${chosen}` : chosen;

  return (
    <div ref={ref} style={{ flex: "1 1 190px", minWidth: 170, position: "relative" }}>
      <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 600, color: "var(--text3)", marginBottom: 6 }}>
        {icon}{label}
      </label>
      <button
        type="button"
        onClick={() => { setOpen(o => !o); setQuery(""); }}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 6,
          background: "var(--bg)", border: `1px solid ${values.length > 0 ? (ex ? "rgba(245,158,11,0.6)" : "rgba(33,150,243,0.5)") : "var(--border)"}`,
          borderRadius: 8, color: values.length > 0 ? accent : "var(--text3)",
          fontSize: 12, padding: "8px 10px", cursor: "pointer", boxSizing: "border-box",
        }}
      >
        {values.length > 1 && (
          <span style={{ flexShrink: 0, fontSize: 10.5, fontWeight: 700, color: "#fff", background: accent, borderRadius: 20, padding: "0 6px", lineHeight: "16px" }}>
            {values.length}
          </span>
        )}
        <span style={{ flex: 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {loading ? "Yuklanmoqda…" : displayLabel}
        </span>
        {values.length > 0 && (
          <span role="button" tabIndex={0} aria-label="Tozalash" title="Tozalash"
            onClick={e => { e.stopPropagation(); clearAll(false); }}
            onKeyDown={e => { if (e.key === "Enter") { e.stopPropagation(); clearAll(false); } }}
            style={{ display: "grid", placeItems: "center", color: "var(--text3)", flexShrink: 0 }}>
            <X size={12} />
          </span>
        )}
        <ChevronDown size={12} style={{ flexShrink: 0, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "100%", left: 0, minWidth: "100%", zIndex: 600,
          background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 8,
          boxShadow: "0 4px 24px rgba(0,0,0,0.5)", maxHeight: showSearch ? 300 : 260, overflowY: "auto", marginTop: 4,
        }}>
          {showSearch && (
            <div style={{ position: "sticky", top: 0, zIndex: 1, background: "var(--bg2)", padding: 8, borderBottom: "1px solid var(--border)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6, padding: "5px 8px" }}>
                <Search size={12} style={{ color: "var(--text3)", flexShrink: 0 }} />
                <input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="Qidirish…"
                  style={{ flex: 1, minWidth: 0, background: "transparent", border: "none", outline: "none", color: "var(--text)", fontSize: 12 }} />
              </div>
            </div>
          )}
          {options.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", borderBottom: "1px solid var(--border)" }}>
              {/* Every option ticked means "no filter": an explicit id list would silently drop
                  rows whose value is not offered (inactive or system users, unassigned deals). */}
              <button type="button" onClick={() => clearAll(true)} title="Barchasini tanlash"
                style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: values.length === 0 ? 600 : 400,
                  color: values.length === 0 ? "#2196F3" : "var(--text2)", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                <span style={{ width: 14, display: "grid", placeItems: "center" }}>{values.length === 0 && <Check size={13} />}</span>
                Barchasi
              </button>
              {ticked.length > 0 && (
                <button type="button" onClick={() => clearAll(false)}
                  style={{ fontSize: 11, color: "#9E9E9E", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                  Hammasini olib tashlash
                </button>
              )}
              {/* "Istisno" — invert the chosen values to "everything except these". */}
              {onExcludeChange && (
                <button type="button" onClick={() => onExcludeChange(!exclude)} title="Tanlanganlardan tashqari hammasi"
                  disabled={values.length === 0}
                  style={{ marginLeft: "auto", flexShrink: 0, fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 7,
                    cursor: values.length === 0 ? "default" : "pointer", opacity: values.length === 0 ? 0.45 : 1,
                    border: `1px solid ${ex ? "#f59e0b" : "var(--border)"}`, background: ex ? "#f59e0b" : "transparent", color: ex ? "#fff" : "var(--text3)" }}>
                  Istisno
                </button>
              )}
            </div>
          )}
          {grouped ? grouped.map(g => {
            const state = groupState(ticked, g.items);
            const isOpen = searching || openGroups.includes(g.name);
            return (
              <div key={g.name}>
                <div role="button" aria-expanded={isOpen} tabIndex={0}
                  onClick={() => { if (!searching) setOpenGroups(o => o.includes(g.name) ? o.filter(n => n !== g.name) : [...o, g.name]); }}
                  onKeyDown={e => { if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) { e.preventDefault(); e.currentTarget.click(); } }}
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", cursor: searching ? "default" : "pointer", background: "var(--bg3)", borderTop: "1px solid var(--border)", borderBottom: isOpen ? "1px solid var(--border)" : "none", userSelect: "none" }}>
                  <input type="checkbox" checked={state === "all"}
                    ref={el => { if (el) el.indeterminate = state === "some"; }}
                    onClick={e => e.stopPropagation()}
                    onChange={() => emit(toggleGroup(ticked, g.items))}
                    style={{ accentColor: accent, flexShrink: 0 }} />
                  <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text2)", textTransform: "uppercase", letterSpacing: "0.04em" }}>{g.name}</span>
                  <span style={{ fontSize: 11, color: "var(--text3)", marginLeft: "auto" }}>
                    {g.items.filter(o => ticked.includes(o.value)).length}/{g.items.length}
                  </span>
                  <ChevronDown size={12} style={{ flexShrink: 0, color: "var(--text3)", transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
                </div>
                {isOpen && g.items.map(renderOption)}
              </div>
            );
          }) : shown.map(renderOption)}
          {showSearch && shown.length === 0 && (
            <div style={{ padding: "10px 12px", fontSize: 12, color: "var(--text3)" }}>Topilmadi</div>
          )}
        </div>
      )}
    </div>
  );
}

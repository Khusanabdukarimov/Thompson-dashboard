import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";

/**
 * Filter dropdown shared by the Lidlar and Sdelkalar filter panels: checkbox
 * list with "select all / clear all". `searchable` adds a type-to-filter box
 * for long lists (e.g. managers).
 */
export function MultiSelect({
  label, icon, options, values, onChange, loading, searchable = false,
}: {
  label: string;
  icon: React.ReactNode;
  options: { value: string; label: string }[];
  values: string[];
  onChange: (v: string[]) => void;
  loading?: boolean;
  searchable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setQuery(""); }
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter(o => o.label.toLowerCase().includes(q)) : options;
  }, [options, query]);

  const toggle = (v: string) => {
    onChange(values.includes(v) ? values.filter(x => x !== v) : [...values, v]);
  };

  const displayLabel = values.length === 0
    ? "Barchasi"
    : values.length === 1
      ? (options.find(o => o.value === values[0])?.label ?? values[0]).slice(0, 22)
      : `${values.length} ta tanlangan`;

  return (
    <div ref={ref} style={{ flex: "1 1 190px", minWidth: 170, position: "relative" }}>
      <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 600, color: "var(--text3)", marginBottom: 6 }}>
        {icon}{label}
      </label>
      <button
        type="button"
        onClick={() => { setOpen(o => !o); setQuery(""); }}
        style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
          background: "var(--bg)", border: `1px solid ${values.length > 0 ? "rgba(33,150,243,0.5)" : "var(--border)"}`,
          borderRadius: 8, color: values.length > 0 ? "#2196F3" : "var(--text3)",
          fontSize: 12, padding: "8px 10px", cursor: "pointer", boxSizing: "border-box",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {loading ? "Yuklanmoqda…" : displayLabel}
        </span>
        <ChevronDown size={12} style={{ flexShrink: 0, marginLeft: 4, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "100%", left: 0, minWidth: "100%", zIndex: 600,
          background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 8,
          boxShadow: "0 4px 24px rgba(0,0,0,0.5)", maxHeight: searchable ? 280 : 220, overflowY: "auto", marginTop: 4,
        }}>
          {searchable && (
            <div style={{ position: "sticky", top: 0, zIndex: 1, background: "var(--bg2)", padding: 8, borderBottom: "1px solid var(--border)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6, padding: "5px 8px" }}>
                <Search size={12} style={{ color: "var(--text3)", flexShrink: 0 }} />
                <input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="Qidirish…"
                  style={{ flex: 1, minWidth: 0, background: "transparent", border: "none", outline: "none", color: "var(--text)", fontSize: 12 }} />
              </div>
            </div>
          )}
          {options.length > 0 && (
            <div style={{ padding: "6px 12px", borderBottom: "1px solid var(--border)", display: "flex", gap: 12 }}>
              {/* Every option ticked means "no filter": an explicit id list would silently drop
                  rows whose value is not offered (inactive or system users, unassigned deals). */}
              <button type="button" onClick={() => {
                const next = [...new Set([...values, ...shown.map(o => o.value)])];
                onChange(options.every(o => next.includes(o.value)) ? [] : next);
              }}
                style={{ fontSize: 11, color: "#2196F3", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                Barchasini tanlash
              </button>
              {values.length > 0 && (
                <button type="button" onClick={() => onChange([])}
                  style={{ fontSize: 11, color: "#9E9E9E", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                  Hammasini olib tashlash
                </button>
              )}
            </div>
          )}
          {shown.map(o => {
            const checked = values.includes(o.value);
            return (
              <label key={o.value}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", cursor: "pointer", background: checked ? "rgba(33,150,243,0.08)" : "transparent" }}
                onMouseEnter={e => { if (!checked) (e.currentTarget as HTMLElement).style.background = "var(--bg3)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = checked ? "rgba(33,150,243,0.08)" : "transparent"; }}
              >
                <input type="checkbox" checked={checked} onChange={() => toggle(o.value)} style={{ accentColor: "#2196F3", flexShrink: 0 }} />
                <span style={{ fontSize: 12, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {o.label}
                </span>
              </label>
            );
          })}
          {searchable && shown.length === 0 && (
            <div style={{ padding: "10px 12px", fontSize: 12, color: "var(--text3)" }}>Topilmadi</div>
          )}
        </div>
      )}
    </div>
  );
}

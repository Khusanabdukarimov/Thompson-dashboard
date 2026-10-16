import { useEffect, useMemo, useRef, useState } from "react";
import { Building2, ChevronDown, ChevronRight, Search, User, X } from "lucide-react";

/**
 * Bo'lim / Mas'ul — the Bitrix company structure as one picker (ported from the
 * PowerGym dashboard): open a department to see its people, tick the whole
 * department or just some of them.
 *
 * The value is always a flat list of user ids; a department checkbox is only a
 * shortcut for "everyone under it". The API keeps its single responsible_id
 * filter and knows nothing about the tree. Bitrix lets an operator see the leads
 * of their own department, so ticking that department reproduces their view.
 */
export type Dept = { id: string; name: string; parentId: string | null; userIds: string[] };
type DNode = Dept & { children: DNode[]; everyone: string[]; leads: number };

/** Forest with each node's members (sub-departments included) and lead volume; empty branches pruned. */
function buildTree(depts: Dept[], known: Set<string>, counts: Record<string, number>): DNode[] {
  const byId = new Map<string, DNode>(depts.map(d => [d.id, { ...d, userIds: d.userIds.filter(u => known.has(u)), children: [], everyone: [], leads: 0 }]));
  const roots: DNode[] = [];
  for (const n of byId.values()) {
    const parent = n.parentId ? byId.get(n.parentId) : undefined;
    if (parent && parent !== n) parent.children.push(n); else roots.push(n);
  }
  const fill = (n: DNode, seen: Set<string>): string[] => {
    if (seen.has(n.id)) return [];          // guard against a cycle in the source data
    seen.add(n.id);
    const set = new Set(n.userIds);
    for (const c of n.children) for (const u of fill(c, seen)) set.add(u);
    n.everyone = [...set];
    n.leads = n.everyone.reduce((a, u) => a + (counts[u] ?? 0), 0);
    n.userIds.sort((a, b) => (counts[b] ?? 0) - (counts[a] ?? 0));
    return n.everyone;
  };
  roots.forEach(r => fill(r, new Set()));
  const sort = (ns: DNode[]) => { ns.sort((a, b) => b.leads - a.leads || a.name.localeCompare(b.name)); ns.forEach(n => sort(n.children)); };
  sort(roots);
  const prune = (ns: DNode[]): DNode[] => ns.filter(n => n.everyone.length > 0).map(n => ({ ...n, children: prune(n.children) }));
  return prune(roots);
}

export function DeptTree({ label, icon, departments, users, counts, value, onChange, loading, exclude = false, onExcludeChange }: {
  label: string;
  icon: React.ReactNode;
  departments: Dept[];
  users: { id: string; name: string }[];
  /** Leads per user id in the selected window. */
  counts?: Record<string, number>;
  /** Selected user ids; empty = everyone (no filter). */
  value: string[];
  onChange: (userIds: string[]) => void;
  loading?: boolean;
  /** Istisno: the chosen people are excluded instead of kept. */
  exclude?: boolean;
  /** Pass to show the Istisno toggle. */
  onExcludeChange?: (exclude: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Most people own nothing in a given window; they stay reachable behind one switch.
  const [showIdle, setShowIdle] = useState(false);
  // Same rule as MultiSelect: "Barchasini tanlash" sends [] (no filter, so leads of
  // people outside the tree are kept) but every box is shown ticked.
  const [allMode, setAllMode] = useState(false);
  if (allMode && value.length > 0) setAllMode(false);
  const ref = useRef<HTMLDivElement>(null);
  const n = useMemo(() => counts ?? {}, [counts]);
  const userName = useMemo(() => new Map(users.map(u => [u.id, u.name])), [users]);
  const tree = useMemo(() => buildTree(departments, new Set(users.map(u => u.id)), n), [departments, users, n]);
  const allUsers = useMemo(() => {
    const out = new Set<string>();
    const walk = (ns: DNode[]) => ns.forEach(x => { x.everyone.forEach(u => out.add(u)); walk(x.children); });
    walk(tree);
    return [...out];
  }, [tree]);
  const idleCount = useMemo(() => allUsers.filter(u => !(n[u] > 0)).length, [allUsers, n]);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as globalThis.Node)) { setOpen(false); setQuery(""); } };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const ex = exclude && value.length > 0;
  const accent = ex ? "#f59e0b" : "#2196F3";
  const ticked = useMemo(() => new Set(allMode && value.length === 0 ? allUsers : value), [allMode, value, allUsers]);
  const emit = (next: Set<string>) => {
    const all = allUsers.length > 0 && allUsers.every(u => next.has(u));
    setAllMode(all);
    onChange(all ? [] : [...next]);
    if (all || next.size === 0) onExcludeChange?.(false);
  };
  const toggle = (ids: string[], on: boolean) => {
    const next = new Set(ticked);
    ids.forEach(id => (on ? next.add(id) : next.delete(id)));
    emit(next);
  };

  const q = query.trim().toLowerCase();
  const matches = (x: DNode): boolean =>
    !q || x.name.toLowerCase().includes(q)
    || x.everyone.some(u => (userName.get(u) ?? "").toLowerCase().includes(q))
    || x.children.some(matches);

  const rowBase: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, padding: "7px 10px 7px 0", borderRadius: 6, userSelect: "none" };
  const hover = (on: boolean) => ({
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => { if (on) e.currentTarget.style.background = "var(--bg3)"; },
    onMouseLeave: (e: React.MouseEvent<HTMLElement>) => { e.currentTarget.style.background = "transparent"; },
  });
  const countStyle = (v: number): React.CSSProperties => ({ fontSize: 11, marginLeft: "auto", flexShrink: 0, fontVariantNumeric: "tabular-nums", color: v > 0 ? "var(--text2)" : "var(--text3)" });

  const renderNode = (node: DNode, depth: number): React.ReactNode => {
    const all = node.everyone;
    const on = all.length > 0 && all.every(u => ticked.has(u));
    const some = !on && all.some(u => ticked.has(u));
    const isOpen = expanded.has(node.id) || (!!q && matches(node));
    const people = node.userIds
      .filter(u => !q || (userName.get(u) ?? "").toLowerCase().includes(q))
      .filter(u => showIdle || !!q || (n[u] ?? 0) > 0 || ticked.has(u));
    const hiddenHere = node.userIds.length - people.length;
    const canOpen = node.children.length > 0 || node.userIds.length > 0;
    const flip = () => canOpen && setExpanded(prev => { const s = new Set(prev); if (s.has(node.id)) s.delete(node.id); else s.add(node.id); return s; });
    return (
      <div key={node.id}>
        {/* Clicking the row opens the department; only the checkbox selects it. */}
        <div role={canOpen ? "button" : undefined} tabIndex={canOpen ? 0 : -1} onClick={flip}
          onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); flip(); } }}
          style={{ ...rowBase, paddingLeft: 6 + depth * 14, cursor: canOpen ? "pointer" : "default" }} {...hover(canOpen)}>
          <span style={{ width: 14, display: "grid", placeItems: "center", color: "var(--text3)", flexShrink: 0 }}>
            {canOpen ? (isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />) : null}
          </span>
          <input type="checkbox" checked={on} title={on ? "Bekor qilish" : "Butun bo'limni tanlash"}
            ref={el => { if (el) el.indeterminate = some; }}
            onClick={e => e.stopPropagation()} onChange={e => toggle(all, e.target.checked)}
            style={{ accentColor: accent, flexShrink: 0, cursor: "pointer" }} />
          <Building2 size={13} style={{ color: "var(--text3)", flexShrink: 0 }} />
          <span style={{ fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: on || some ? "#2196F3" : "var(--text)", fontWeight: on || some ? 600 : 500 }}>
            {node.name}
          </span>
          <span style={countStyle(node.leads)} title={`${all.length} ta xodim · ${node.leads} ta lid`}>{node.leads > 0 ? node.leads : "—"}</span>
        </div>
        {isOpen && (
          <>
            {node.children.filter(matches).map(c => renderNode(c, depth + 1))}
            {people.map(uid => (
              <label key={uid} style={{ ...rowBase, paddingLeft: 6 + (depth + 1) * 14 + 18, cursor: "pointer", background: ticked.has(uid) ? "rgba(33,150,243,0.08)" : "transparent" }} {...hover(!ticked.has(uid))}>
                <input type="checkbox" checked={ticked.has(uid)} onChange={e => toggle([uid], e.target.checked)}
                  style={{ accentColor: accent, flexShrink: 0, cursor: "pointer" }} />
                <User size={12} style={{ color: "var(--text3)", flexShrink: 0 }} />
                <span style={{ fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: ticked.has(uid) ? "#2196F3" : "var(--text2)" }}>
                  {userName.get(uid) ?? `#${uid}`}
                </span>
                <span style={countStyle(n[uid] ?? 0)}>{(n[uid] ?? 0) > 0 ? n[uid] : "—"}</span>
              </label>
            ))}
            {hiddenHere > 0 && !q && !showIdle && (
              <div onClick={() => setShowIdle(true)} style={{ fontSize: 11, color: "var(--text3)", cursor: "pointer", padding: "5px 0", paddingLeft: 6 + (depth + 1) * 14 + 18 }}>
                + {hiddenHere} ta lidsiz xodim
              </div>
            )}
          </>
        )}
      </div>
    );
  };

  const visibleTree = tree.filter(matches).filter(x => showIdle || !!q || x.leads > 0 || x.everyone.some(u => ticked.has(u)));

  // A selection that is exactly one department reads as that department.
  const exactDept = useMemo(() => {
    if (value.length === 0) return null;
    const v = new Set(value);
    let hit: DNode | null = null;
    const walk = (ns: DNode[]) => ns.forEach(x => { if (!hit && x.everyone.length === v.size && x.everyone.every(u => v.has(u))) hit = x; walk(x.children); });
    walk(tree);
    return hit as DNode | null;
  }, [value, tree]);
  const summary = loading ? "Yuklanmoqda…"
    : value.length === 0 ? "Barchasi"
    : exactDept ? exactDept.name
    : value.length === 1 ? (userName.get(value[0]) ?? "1 ta xodim")
    : `${value.length} ta xodim`;
  const shownSummary = ex ? `Istisno · ${summary}` : summary;

  const linkBtn: React.CSSProperties = { fontSize: 11, background: "none", border: "none", cursor: "pointer", padding: 0 };

  return (
    <div ref={ref} style={{ flex: "1 1 190px", minWidth: 170, position: "relative" }}>
      <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 600, color: "var(--text3)", marginBottom: 6 }}>
        {icon}{label}
      </label>
      <button type="button" onClick={() => {
        // First open: show the top-level departments' teams (e.g. Sotuv bo'limi → O'QUV MARKAZ, MAKTAB, LAND).
        if (!open && expanded.size === 0) setExpanded(new Set(tree.filter(t => t.children.length > 0).map(t => t.id)));
        setOpen(o => !o); setQuery("");
      }}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 6, background: "var(--bg)",
          border: `1px solid ${value.length > 0 ? (ex ? "rgba(245,158,11,0.6)" : "rgba(33,150,243,0.5)") : "var(--border)"}`, borderRadius: 8,
          color: value.length > 0 ? accent : "var(--text3)", fontSize: 12, padding: "8px 10px", cursor: "pointer", boxSizing: "border-box",
        }}>
        {exactDept && <Building2 size={12} style={{ flexShrink: 0 }} />}
        <span style={{ flex: 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{shownSummary}</span>
        {value.length > 0 && (
          <span role="button" tabIndex={0} aria-label="Tozalash" title="Tozalash"
            onClick={e => { e.stopPropagation(); setAllMode(false); onChange([]); onExcludeChange?.(false); }}
            onKeyDown={e => { if (e.key === "Enter") { e.stopPropagation(); setAllMode(false); onChange([]); } }}
            style={{ display: "grid", placeItems: "center", color: "var(--text3)", flexShrink: 0 }}>
            <X size={12} />
          </span>
        )}
        <ChevronDown size={12} style={{ flexShrink: 0, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
      </button>

      {open && (
        <div style={{ position: "absolute", top: "100%", left: 0, minWidth: "100%", width: 320, zIndex: 600, marginTop: 4,
          background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 8, boxShadow: "0 4px 24px rgba(0,0,0,0.5)", overflow: "hidden" }}>
          <div style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6, padding: "5px 8px" }}>
              <Search size={12} style={{ color: "var(--text3)", flexShrink: 0 }} />
              <input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="Bo'lim yoki xodim…"
                style={{ flex: 1, minWidth: 0, background: "transparent", border: "none", outline: "none", color: "var(--text)", fontSize: 12 }} />
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 12px", borderBottom: "1px solid var(--border)" }}>
            <button type="button" onClick={() => { setAllMode(true); onChange([]); onExcludeChange?.(false); }} style={{ ...linkBtn, color: "#2196F3" }}>Barchasini tanlash</button>
            {ticked.size > 0 && (
              <button type="button" onClick={() => { setAllMode(false); onChange([]); onExcludeChange?.(false); }} style={{ ...linkBtn, color: "#9E9E9E" }}>Tozalash</button>
            )}
            {idleCount > 0 && (
              <button type="button" onClick={() => setShowIdle(v => !v)} title="Tanlangan davrda lidi bo'lmagan xodimlar"
                style={{ ...linkBtn, color: showIdle ? "#2196F3" : "var(--text3)" }}>
                {showIdle ? "Lidsizlarni yashirish" : `Lidsizlar (${idleCount})`}
              </button>
            )}
            <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text3)" }}>{ticked.size}/{allUsers.length}</span>
            {onExcludeChange && (
              <button type="button" onClick={() => onExcludeChange(!exclude)} disabled={value.length === 0} title="Tanlanganlardan tashqari hammasi"
                style={{ flexShrink: 0, fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 7,
                  cursor: value.length === 0 ? "default" : "pointer", opacity: value.length === 0 ? 0.45 : 1,
                  border: `1px solid ${ex ? "#f59e0b" : "var(--border)"}`, background: ex ? "#f59e0b" : "transparent", color: ex ? "#fff" : "var(--text3)" }}>
                Istisno
              </button>
            )}
          </div>
          <div style={{ maxHeight: 320, overflowY: "auto", padding: "4px 4px" }}>
            {visibleTree.length === 0
              ? <div style={{ padding: "14px 12px", fontSize: 12, color: "var(--text3)", textAlign: "center" }}>{loading ? "Yuklanmoqda…" : "Topilmadi"}</div>
              : visibleTree.map(x => renderNode(x, 0))}
          </div>
        </div>
      )}
    </div>
  );
}

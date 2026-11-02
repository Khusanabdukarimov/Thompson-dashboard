/**
 * Right-side detail panel: a card, row or bar opens what is behind it here, over the page,
 * instead of unfolding further down where it has to be scrolled to. Esc, the X or a click
 * outside closes it; the page underneath keeps its scroll position.
 */
import { useRef } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";

const CSS = `
  @keyframes sp-in { from { transform: translateX(32px); opacity: 0 } to { transform: none; opacity: 1 } }
  @keyframes sp-fade { from { opacity: 0 } to { opacity: 1 } }
  .sp-content { animation: sp-in .2s cubic-bezier(.2,.8,.2,1); }
  .sp-overlay { animation: sp-fade .15s ease-out; }
  @media (prefers-reduced-motion: reduce) { .sp-content, .sp-overlay { animation: none; } }
`;

export function SidePanel({ open, onClose, title, subtitle, width = 960, headerExtra, children }: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  width?: number;
  /** Small figures shown under the title (a summary of what the panel lists). */
  headerExtra?: React.ReactNode;
  children: React.ReactNode;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  return (
    <Dialog.Root open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <Dialog.Portal>
        <style>{CSS}</style>
        <Dialog.Overlay className="sp-overlay" style={{ position: "fixed", inset: 0, zIndex: 900, background: "rgba(12,14,20,0.32)" }} />
        <Dialog.Content
          ref={contentRef}
          tabIndex={-1}
          className="sp-content"
          aria-describedby={undefined}
          // Focus the panel itself on open. Radix focuses the first button otherwise — the
          // "?" next to the title — and focusing it opens its explanation every time.
          onOpenAutoFocus={(e) => { e.preventDefault(); contentRef.current?.focus(); }}
          style={{
            position: "fixed", top: 12, right: 12, bottom: 12, zIndex: 901,
            width: `min(${width}px, calc(100vw - 24px))`,
            display: "flex", flexDirection: "column", overflow: "hidden",
            background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 18,
            boxShadow: "0 24px 64px rgba(0,0,0,0.28)", outline: "none",
          }}>
          <div style={{ padding: "18px 22px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "flex-start", gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Dialog.Title style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.01em" }}>{title}</Dialog.Title>
              {subtitle && <div style={{ marginTop: 3, fontSize: 13, color: "var(--text3)" }}>{subtitle}</div>}
              {headerExtra && <div style={{ marginTop: 14 }}>{headerExtra}</div>}
            </div>
            <Dialog.Close aria-label="Yopish" style={{ width: 36, height: 36, borderRadius: "50%", border: 0, background: "transparent", color: "var(--text2)", cursor: "pointer", display: "grid", placeItems: "center", flexShrink: 0 }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg3)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
              <X size={18} />
            </Dialog.Close>
          </div>
          <div style={{ flex: 1, minHeight: 0, overflow: "auto", overscrollBehavior: "contain" }}>{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** A row of small labelled figures for a panel header. */
export function PanelStats({ items }: { items: { label: string; value: React.ReactNode; color?: string }[] }) {
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {items.map((it) => (
        // The number stays in ink; a colour, when given, is a small dot that tags the label.
        <div key={it.label} style={{ padding: "8px 14px", borderRadius: 12, background: "var(--bg2)", border: "1px solid var(--border)", minWidth: 96 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text3)", fontWeight: 500, whiteSpace: "nowrap" }}>
            {it.color && <span style={{ width: 7, height: 7, borderRadius: "50%", background: it.color, flexShrink: 0 }} />}
            {it.label}
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", fontVariantNumeric: "tabular-nums", marginTop: 2, whiteSpace: "nowrap" }}>{it.value}</div>
        </div>
      ))}
    </div>
  );
}

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * "?" badge that explains a card.
 *
 * - hover → shows; leaving → hides (unless pinned)
 * - click → pins it open; clicking "?" again, clicking anywhere else, or Esc → closes
 *
 * The bubble is portalled to <body> with fixed positioning, because the cards
 * it sits on clip their content (overflow: hidden, for the sparkline).
 * Clicks never reach the card underneath, so it is safe on clickable cards.
 */
export function InfoTip({ text, label = "Izoh", size = 16 }: {
  text: React.ReactNode;
  /** Accessible name of the button. */
  label?: string;
  size?: number;
}) {
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; above: boolean } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const open = hover || pinned;

  const close = useCallback(() => { setPinned(false); setHover(false); }, []);

  // Place the bubble under the badge, or above it when there is no room below,
  // and keep it inside the viewport horizontally.
  const place = useCallback(() => {
    const b = btnRef.current?.getBoundingClientRect();
    if (!b) return;
    const w = Math.min(300, window.innerWidth - 16);
    const h = tipRef.current?.offsetHeight ?? 80;
    const above = b.bottom + 8 + h > window.innerHeight && b.top - 8 - h > 0;
    const left = Math.max(8, Math.min(b.left + b.width / 2 - w / 2, window.innerWidth - w - 8));
    setPos({ top: above ? b.top - 8 - h : b.bottom + 8, left, above });
  }, []);

  useLayoutEffect(() => { if (open) place(); }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onScroll = () => place();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open, place]);

  // While pinned: a press anywhere outside the badge and bubble closes it.
  useEffect(() => {
    if (!pinned) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || tipRef.current?.contains(t)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [pinned, close]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onFocus={() => setHover(true)}
        onBlur={() => { if (!pinned) setHover(false); }}
        onClick={(e) => {
          // The card under the badge may be clickable itself (Sdelkalar opens deal lists).
          e.stopPropagation();
          if (pinned) close(); else setPinned(true);
        }}
        style={{
          width: size, height: size, flexShrink: 0, padding: 0, borderRadius: "50%",
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          fontSize: Math.round(size * 0.66), fontWeight: 700, lineHeight: 1, cursor: "help",
          color: open ? "#fff" : "currentColor",
          background: open ? "#6366f1" : "transparent",
          border: `1.5px solid ${open ? "#6366f1" : "currentColor"}`,
          opacity: open ? 1 : 0.6, transition: "opacity .15s, background .15s, color .15s",
        }}>
        ?
      </button>
      {open && createPortal(
        <div
          ref={tipRef}
          id={id}
          role="tooltip"
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          style={{
            position: "fixed", zIndex: 1000,
            top: pos?.top ?? -9999, left: pos?.left ?? -9999,
            width: Math.min(300, window.innerWidth - 16),
            padding: "10px 12px", borderRadius: 10,
            background: "var(--bg2)", color: "var(--text)", border: "1px solid var(--border)",
            boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
            fontSize: 12.5, lineHeight: 1.5, fontWeight: 400, textAlign: "left",
            whiteSpace: "normal", pointerEvents: "auto",
          }}>
          {text}
        </div>,
        document.body,
      )}
    </>
  );
}
